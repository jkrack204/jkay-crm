/**
 * Routes every role shares: open a lead's record, sticky notes, and Admin's
 * "Add a lead by hand".
 */
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { createLeadInput, normalizePhone, noteInput, noteUpdateInput, NOTE_COLORS, PLATFORM_LABEL, type NoteScope } from '@jkay/shared';
import {
  activities,
  attachments,
  categories,
  followups,
  leadOwners,
  leadTags,
  leads,
  notes,
  stageHistory,
  stages,
  tags,
} from '../db/schema.js';
import { badRequest, forbidden, notFound, parse } from '../http.js';
import { requireRole, requireUser, type SessionUser } from '../auth/session.js';
import {
  assertCanView,
  changeOwner,
  changeStage,
  employeeById,
  firstWorkingStage,
  getLead,
  getStage,
  logActivity,
  namesOf,
  notify,
  stageOfKind,
  type Lead,
  type Q,
} from '../services/leads.js';

const noteScopeFor = (u: SessionUser): NoteScope => (u.role === 'admin' ? 'admin' : u.role === 'bde' ? 'bd' : 'cre');

/** Which notes a person may read on a lead. */
function notesVisibleTo(u: SessionUser) {
  if (u.role === 'cre') return eq(notes.scope, 'cre');
  if (u.role === 'bde') return or(eq(notes.scope, 'cre'), and(eq(notes.scope, 'bd'), eq(notes.authorId, u.id)));
  return or(eq(notes.scope, 'cre'), and(eq(notes.scope, 'admin'), eq(notes.authorId, u.id)));
}

/** Can this person add a note right now? */
function assertCanNote(u: SessionUser, l: Lead) {
  if (u.role === 'admin') return;
  if (u.role === 'cre' && l.desk === 'cre' && l.ownerId === u.id && !l.lostAt) return;
  if (u.role === 'bde' && l.desk === 'bd' && l.ownerId === u.id) return;
  throw forbidden('You can only add notes to leads you own');
}

export async function leadDetail(q: Q, u: SessionUser, l: Lead) {
  const creView = u.role === 'cre';
  const handedOff = l.desk === 'bd';

  const [stageRows, tagRows, noteRows, actRows, ownerRows, [fu], catRows, photoRows] = await Promise.all([
    q.select().from(stages),
    q
      .select({ id: tags.id, name: tags.name, tone: tags.tone, scope: tags.scope, addedAt: leadTags.addedAt })
      .from(leadTags)
      .innerJoin(tags, eq(tags.id, leadTags.tagId))
      .where(eq(leadTags.leadId, l.id)),
    q.select().from(notes).where(and(eq(notes.leadId, l.id), notesVisibleTo(u))).orderBy(desc(notes.pinned), desc(notes.createdAt)),
    q
      .select()
      .from(activities)
      .where(and(eq(activities.leadId, l.id), creView && handedOff ? or(isNull(activities.desk), ne(activities.desk, 'bd')) : undefined))
      .orderBy(desc(activities.at)),
    q.select().from(leadOwners).where(eq(leadOwners.leadId, l.id)).orderBy(asc(leadOwners.startedAt)),
    q.select().from(followups).where(and(eq(followups.leadId, l.id), eq(followups.status, 'open'))),
    l.categoryId ? q.select().from(categories).where(eq(categories.id, l.categoryId)) : Promise.resolve([]),
    q
      .select()
      .from(attachments)
      .where(and(eq(attachments.leadId, l.id), eq(attachments.kind, 'photo'), isNull(attachments.deletedAt)))
      .orderBy(asc(attachments.createdAt)),
  ]);
  const st = new Map(stageRows.map((s) => [s.id, s]));
  const names = await namesOf(q, [
    l.ownerId,
    l.qualifiedById,
    l.lostById,
    ...noteRows.map((n) => n.authorId),
    ...actRows.map((a) => a.actorId),
    ...ownerRows.flatMap((o) => [o.ownerId, o.byId]),
    ...photoRows.map((p) => p.uploadedById),
  ]);
  const stageTag = l.stageTagId ? (await q.select().from(tags).where(eq(tags.id, l.stageTagId)))[0] : undefined;
  const lostReason = l.lostReasonId ? (await q.select().from(tags).where(eq(tags.id, l.lostReasonId)))[0] : undefined;

  const creStage = st.get(l.creStageId);
  const bdStage = l.bdStageId ? st.get(l.bdStageId) : undefined;
  const pick = (s?: typeof creStage) => (s ? { id: s.id, name: s.name, kind: s.kind, definition: s.definition } : null);

  return {
    lead: {
      id: l.id,
      number: l.number,
      customerName: l.customerName,
      contactName: l.contactName,
      phone: l.phone,
      altPhone: l.altPhone,
      email: l.email,
      place: l.place,
      requirement: l.requirement,
      category: catRows[0] ? { id: catRows[0].id, name: catRows[0].name } : null,
      platform: l.platform,
      sourceLabel: l.sourceLabel,
      desk: l.desk,
      creStage: pick(creStage),
      // After hand-off a CRE sees only which BD stage it's in — nothing else from BD.
      bdStage: pick(bdStage),
      stageTag: stageTag ? { id: stageTag.id, name: stageTag.name, tone: stageTag.tone } : null,
      owner: l.ownerId ? { id: l.ownerId, name: names.get(l.ownerId) ?? '—' } : null,
      ownerSince: l.ownerSince,
      qualifiedBy: l.qualifiedById ? { id: l.qualifiedById, name: names.get(l.qualifiedById) ?? '—' } : null,
      qualifiedAt: l.qualifiedAt,
      estimate: l.estimate,
      contractValue: creView ? null : l.contractValue,
      wonAt: l.wonAt,
      lost: l.lostAt
        ? { at: l.lostAt, desk: l.lostDesk, reason: lostReason?.name ?? '—', note: l.lostNote, by: l.lostById ? names.get(l.lostById) : null }
        : null,
      nextFollowupAt: l.nextFollowupAt,
      createdAt: l.createdAt,
    },
    followup: fu ? { id: fu.id, dueAt: fu.dueAt, note: fu.note } : null,
    tags: tagRows.filter((t) => (creView ? t.scope === 'cre' : true)),
    notes: noteRows.map((n) => ({
      id: n.id,
      text: n.text,
      color: n.color,
      pinned: n.pinned,
      scope: n.scope,
      author: names.get(n.authorId) ?? '—',
      mine: n.authorId === u.id,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
    activity: actRows.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      body: a.body,
      by: a.actorId ? (names.get(a.actorId) ?? '—') : 'System',
      at: a.at,
    })),
    /** Site photos — taken on the CRE desk, visible to the BDE after hand-off. Open via /api/files/:id. */
    photos: photoRows.map((p) => ({
      id: p.id,
      fileName: p.fileName,
      by: p.uploadedById ? (names.get(p.uploadedById) ?? '—') : '—',
      mine: p.uploadedById === u.id,
      at: p.createdAt,
    })),
    owners: ownerRows.map((o) => ({
      owner: o.ownerId ? (names.get(o.ownerId) ?? '—') : 'Unclaimed pool',
      desk: o.desk,
      reason: o.reason,
      by: o.byId ? (names.get(o.byId) ?? '—') : 'System',
      note: o.note,
      from: o.startedAt,
      to: o.endedAt,
    })),
  };
}

export const leadRoutes: FastifyPluginAsync = async (app) => {
  /* ----------------------------- open a record ---------------------------- */
  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const u = requireUser(req);
    const l = await getLead(app.db, req.params.id);
    await assertCanView(app.db, u, l);
    return leadDetail(app.db, u, l);
  });

  /* ---------------------------- add lead by hand -------------------------- */
  app.post('/', async (req) => {
    const admin = requireRole(req, 'admin');
    const input = parse(createLeadInput, req.body);
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw badRequest('That phone number does not look right');

    const id = await app.db.transaction(async (tx) => {
      const pool = await stageOfKind(tx, 'cre', 'pool');
      const dupe = phone ? (await tx.select({ id: leads.id }).from(leads).where(eq(leads.phone, phone)).limit(1))[0] : undefined;

      const [l] = await tx
        .insert(leads)
        .values({
          customerName: input.customerName,
          contactName: input.contactName || null,
          phone,
          place: input.place || null,
          requirement: input.requirement || null,
          platform: input.platform,
          sourceLabel: input.sourceLabel || null,
          estimate: input.estimate ?? null,
          categoryId: input.categoryId ?? null,
          creStageId: pool.id,
          duplicateOfId: dupe?.id ?? null,
          createdById: admin.id,
        })
        .returning();
      if (!l) throw new Error('insert failed');
      await changeOwner(tx, l, { ownerId: null, desk: 'cre', reason: 'intake', byId: admin.id, note: 'Added by hand' });
      await logActivity(tx, { leadId: l.id, actorId: admin.id, desk: 'cre', kind: 'created', title: 'Lead added by hand', body: `Source: ${PLATFORM_LABEL[input.platform]}` });

      if (input.route === 'cre' || input.route === 'bd') {
        if (!input.ownerId) throw badRequest('Pick who owns it');
        const owner = await employeeById(tx, input.ownerId);
        const want = input.route === 'cre' ? 'cre' : 'bde';
        if (!owner || !owner.active || owner.role !== want) throw badRequest(`Pick an active ${want.toUpperCase()}`);

        if (input.route === 'cre') {
          const stage = input.stageId ? await getStage(tx, input.stageId) : await firstWorkingStage(tx, 'cre');
          if (stage.desk !== 'cre' || stage.kind !== 'working') throw badRequest('Pick a working CRE stage');
          await changeStage(tx, l, 'cre', stage.id, admin.id);
          await changeOwner(tx, l, { ownerId: owner.id, desk: 'cre', reason: 'admin_assign', byId: admin.id });
          await notify(tx, [owner.id], { kind: 'transfer', leadId: l.id, title: 'Admin assigned you a lead', body: l.customerName });
        } else {
          const stage = input.stageId ? await getStage(tx, input.stageId) : await firstWorkingStage(tx, 'bd');
          if (stage.desk !== 'bd' || stage.kind !== 'working') throw badRequest('Pick a working BD stage');
          const handoff = await stageOfKind(tx, 'cre', 'handoff');
          await changeStage(tx, l, 'cre', handoff.id, admin.id);
          await tx.update(leads).set({ desk: 'bd', bdStageId: stage.id, qualifiedById: admin.id, qualifiedAt: new Date() }).where(eq(leads.id, l.id));
          l.desk = 'bd';
          await tx.insert(stageHistory).values({ leadId: l.id, desk: 'bd', fromStageId: null, toStageId: stage.id, byId: admin.id });
          await changeOwner(tx, l, { ownerId: owner.id, desk: 'bd', reason: 'admin_assign', byId: admin.id });
          await notify(tx, [owner.id], { kind: 'handoff', leadId: l.id, title: 'Admin handed you a deal', body: l.customerName });
        }
      }

      if (input.note) await tx.insert(notes).values({ leadId: l.id, authorId: admin.id, scope: 'admin', text: input.note, pinned: true });
      return l.id;
    });
    const l = await getLead(app.db, id);
    return leadDetail(app.db, admin, l);
  });

  /* --------------------------------- notes -------------------------------- */
  app.post<{ Params: { id: string } }>('/:id/notes', async (req) => {
    const u = requireUser(req);
    const input = parse(noteInput, req.body);
    const l = await getLead(app.db, req.params.id);
    await assertCanView(app.db, u, l);
    assertCanNote(u, l);
    const color = input.color && (NOTE_COLORS as readonly string[]).includes(input.color) ? input.color : NOTE_COLORS[0];
    const [n] = await app.db.insert(notes).values({ leadId: l.id, authorId: u.id, scope: noteScopeFor(u), text: input.text, color }).returning();
    return { note: n };
  });

  app.patch<{ Params: { id: string; noteId: string } }>('/:id/notes/:noteId', async (req) => {
    const u = requireUser(req);
    const input = parse(noteUpdateInput, req.body);
    const [n] = await app.db.select().from(notes).where(and(eq(notes.id, Number(req.params.noteId)), eq(notes.leadId, req.params.id)));
    if (!n) throw notFound('Note not found');
    if (n.authorId !== u.id) throw forbidden('You can only change your own notes');
    const [row] = await app.db.update(notes).set({ ...input, updatedAt: new Date() }).where(eq(notes.id, n.id)).returning();
    return { note: row };
  });

  app.delete<{ Params: { id: string; noteId: string } }>('/:id/notes/:noteId', async (req) => {
    const u = requireUser(req);
    const [n] = await app.db.select().from(notes).where(and(eq(notes.id, Number(req.params.noteId)), eq(notes.leadId, req.params.id)));
    if (!n) throw notFound('Note not found');
    if (n.authorId !== u.id) throw forbidden('You can only delete your own notes');
    await app.db.delete(notes).where(eq(notes.id, n.id));
    return { ok: true };
  });
};
