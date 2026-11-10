/**
 * Admin console.
 *
 * Records: one row shape for every lead/deal, used by the dashboard, both desk
 * views, the sales pipeline, closed, payments, lost and search.
 *
 * Each Admin's workspace is private: admin tags, sticky notes, pipeline ranking
 * and "Notify me" watches belong to the Admin who made them — another Admin
 * never sees them. Everything else (stages, tags library, settings) is shared.
 */
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, max, or, sql, type SQL } from 'drizzle-orm';
import {
  ADMIN_SCOPES,
  categoryInput,
  reassignInput,
  rankInput,
  SETTING_RULES,
  settingInput,
  stageCreateInput,
  stageOrderInput,
  stageUpdateInput,
  tagCreateInput,
  tagInput,
  tagUpdateInput,
  templateInput,
  watchInput,
  type AdminScope,
} from '@jkay/shared';
import {
  adminLeadTags,
  adminRankings,
  adminWatches,
  appSettings,
  categories,
  discountRequests,
  employees,
  leadTags,
  leads,
  messageTemplates,
  notes,
  payments,
  quotations,
  stages,
  tags,
} from '../db/schema.js';
import { badRequest, conflict, notFound, parse } from '../http.js';
import { requireRole, type SessionUser } from '../auth/session.js';
import { changeOwner, closeOpenFollowup, changeStage, employeeById, getLead, logActivity, notify, reassignFollowup, stageOfKind, type Lead, type Q } from '../services/leads.js';

/* --------------------------------- rows ---------------------------------- */
async function recordRows(q: Q, admin: SessionUser, rows: Lead[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const wonIds = rows.filter((r) => r.wonAt).map((r) => r.id);
  const [stageRows, tagRows, people, myTags, myWatch, myNotes, myRanks, quoteRows, payRows, pending] = await Promise.all([
    q.select().from(stages),
    q.select({ id: tags.id, name: tags.name, tone: tags.tone, scope: tags.scope }).from(tags),
    q.select({ id: employees.id, name: employees.fullName, role: employees.role }).from(employees),
    q
      .select({ leadId: adminLeadTags.leadId, id: tags.id, name: tags.name, tone: tags.tone })
      .from(adminLeadTags)
      .innerJoin(tags, eq(tags.id, adminLeadTags.tagId))
      .where(and(eq(adminLeadTags.adminId, admin.id), inArray(adminLeadTags.leadId, ids), isNull(tags.archivedAt))),
    q.select({ leadId: adminWatches.leadId }).from(adminWatches).where(and(eq(adminWatches.adminId, admin.id), inArray(adminWatches.leadId, ids))),
    q
      .select()
      .from(notes)
      .where(and(eq(notes.authorId, admin.id), eq(notes.scope, 'admin'), inArray(notes.leadId, ids)))
      .orderBy(desc(notes.pinned), desc(notes.updatedAt)),
    q.select().from(adminRankings).where(and(eq(adminRankings.adminId, admin.id), inArray(adminRankings.leadId, ids))),
    q.select({ leadId: quotations.leadId, version: quotations.version, amount: quotations.amount }).from(quotations).where(inArray(quotations.leadId, ids)),
    wonIds.length
      ? q.select().from(payments).where(inArray(payments.leadId, wonIds)).orderBy(asc(payments.receivedOn), asc(payments.id))
      : Promise.resolve([]),
    q.select({ leadId: discountRequests.leadId }).from(discountRequests).where(and(inArray(discountRequests.leadId, ids), eq(discountRequests.status, 'pending'))),
  ]);
  const st = new Map(stageRows.map((s) => [s.id, s]));
  const tg = new Map(tagRows.map((t) => [t.id, t]));
  const who = new Map(people.map((p) => [p.id, p]));
  const watch = new Set(myWatch.map((w) => w.leadId));
  const rank = new Map(myRanks.map((r) => [r.leadId, Number(r.rank)]));
  const pend = new Set(pending.map((p) => p.leadId));
  const person = (id: string | null | undefined) => (id && who.get(id) ? { id, name: who.get(id)!.name, role: who.get(id)!.role } : null);
  const stageRef = (id: number | null | undefined) => {
    const s = id ? st.get(id) : undefined;
    return s ? { id: s.id, name: s.name, kind: s.kind, position: s.position } : null;
  };

  return rows.map((l) => {
    const qs = quoteRows.filter((x) => x.leadId === l.id).sort((a, b) => a.version - b.version);
    const pays = payRows.filter((p) => p.leadId === l.id);
    const paid = pays.reduce((a, p) => a + p.amount, 0);
    // The CRE this lead belongs to: whoever qualified it, else the CRE who owns (or lost) it.
    const cre = person(l.qualifiedById) ?? (l.desk === 'cre' ? person(l.ownerId) : null);
    const lostReason = l.lostReasonId ? tg.get(l.lostReasonId) : undefined;
    const stageTag = l.stageTagId ? tg.get(l.stageTagId) : undefined;
    return {
      id: l.id,
      number: l.number,
      customerName: l.customerName,
      contactName: l.contactName,
      phone: l.phone,
      place: l.place,
      platform: l.platform,
      sourceLabel: l.sourceLabel,
      desk: l.desk,
      creStage: stageRef(l.creStageId),
      bdStage: stageRef(l.bdStageId),
      stageTag: stageTag ? { name: stageTag.name, tone: stageTag.tone } : null,
      owner: person(l.ownerId),
      cre,
      bde: l.desk === 'bd' ? person(l.ownerId) : null,
      createdAt: l.createdAt,
      qualifiedAt: l.qualifiedAt,
      ownerSince: l.ownerSince,
      nextFollowupAt: l.nextFollowupAt,
      lastContactAt: l.lastContactAt,
      estimate: l.estimate,
      quoteCount: qs.length,
      latestQuote: qs.length ? qs[qs.length - 1]!.amount : null,
      value: l.contractValue ?? (qs.length ? qs[qs.length - 1]!.amount : null),
      contractValue: l.contractValue,
      paid,
      payments: l.wonAt ? pays.map((p) => ({ id: p.id, kind: p.kind, amount: p.amount, receivedOn: p.receivedOn, mode: p.mode })) : [],
      wonAt: l.wonAt,
      productionDate: l.productionDate,
      lost: l.lostAt ? { desk: l.lostDesk, reason: lostReason?.name ?? '—', note: l.lostNote, at: l.lostAt, by: person(l.lostById)?.name ?? null } : null,
      discountPending: pend.has(l.id),
      adminTags: myTags.filter((t) => t.leadId === l.id).map(({ id, name, tone }) => ({ id, name, tone })),
      watch: watch.has(l.id),
      notes: myNotes.filter((n) => n.leadId === l.id).map((n) => ({ id: n.id, text: n.text, color: n.color, pinned: n.pinned, updatedAt: n.updatedAt })),
      rank: rank.get(l.id) ?? null,
    };
  });
}

function scopeWhere(scope: AdminScope, opts: { from?: string; q?: string }): SQL | undefined {
  switch (scope) {
    case 'live':
      return and(isNull(leads.lostAt), isNull(leads.wonAt));
    case 'cre':
      return and(eq(leads.desk, 'cre'), isNull(leads.lostAt));
    case 'bd':
      return and(eq(leads.desk, 'bd'), isNull(leads.lostAt));
    case 'won':
      return and(isNotNull(leads.wonAt), isNull(leads.lostAt));
    case 'lost':
      return isNotNull(leads.lostAt);
    case 'all':
      return opts.from ? gte(leads.createdAt, new Date(opts.from + 'T00:00:00+05:30')) : undefined;
    case 'search': {
      const s = (opts.q ?? '').trim();
      if (s.length < 2) return sql`false`;
      const like = `%${s.replace(/[%_]/g, '')}%`;
      const digits = s.replace(/\D/g, '');
      return or(
        ilike(leads.customerName, like),
        ilike(leads.contactName, like),
        ilike(leads.place, like),
        ilike(leads.sourceLabel, like),
        digits.length >= 3 ? ilike(leads.phone, `%${digits}%`) : undefined,
        /^\d{1,7}$/.test(s) ? eq(leads.number, Number(s)) : undefined,
      );
    }
  }
}

const SETTING_KEYS = Object.keys(SETTING_RULES);

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  app.addHook('preHandler', async (req) => {
    requireRole(req, 'admin');
  });

  /* -------------------------------- records ------------------------------- */
  app.get<{ Querystring: { scope?: string; from?: string; q?: string } }>('/records', async (req) => {
    const u = requireRole(req, 'admin');
    const scope = (ADMIN_SCOPES as readonly string[]).includes(req.query.scope ?? '') ? (req.query.scope as AdminScope) : 'live';
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from ?? '') ? req.query.from : undefined;
    const rows = await db
      .select()
      .from(leads)
      .where(scopeWhere(scope, { from, q: req.query.q }))
      .orderBy(desc(leads.createdAt))
      .limit(scope === 'search' ? 25 : 5000);
    return { scope, records: await recordRows(db, u, rows) };
  });

  /** A single row (for the record sheet's private block). */
  app.get<{ Params: { id: string } }>('/records/:id', async (req) => {
    const u = requireRole(req, 'admin');
    const l = await getLead(db, req.params.id);
    return { record: (await recordRows(db, u, [l]))[0] };
  });

  /* ------------------------- private Admin workspace ----------------------- */
  app.put<{ Params: { id: string } }>('/records/:id/watch', async (req) => {
    const u = requireRole(req, 'admin');
    const { on } = parse(watchInput, req.body);
    await getLead(db, req.params.id);
    if (on) await db.insert(adminWatches).values({ adminId: u.id, leadId: req.params.id }).onConflictDoNothing();
    else await db.delete(adminWatches).where(and(eq(adminWatches.adminId, u.id), eq(adminWatches.leadId, req.params.id)));
    return { ok: true, watch: on };
  });

  app.post<{ Params: { id: string } }>('/records/:id/tags', async (req) => {
    const u = requireRole(req, 'admin');
    const { tagId } = parse(tagInput, req.body);
    await getLead(db, req.params.id);
    const [t] = await db.select().from(tags).where(eq(tags.id, tagId));
    if (!t || t.scope !== 'admin' || t.archivedAt) throw badRequest('Pick one of the admin tags');
    await db.insert(adminLeadTags).values({ adminId: u.id, leadId: req.params.id, tagId }).onConflictDoNothing();
    return { ok: true };
  });

  app.delete<{ Params: { id: string; tagId: string } }>('/records/:id/tags/:tagId', async (req) => {
    const u = requireRole(req, 'admin');
    await db
      .delete(adminLeadTags)
      .where(and(eq(adminLeadTags.adminId, u.id), eq(adminLeadTags.leadId, req.params.id), eq(adminLeadTags.tagId, Number(req.params.tagId))));
    return { ok: true };
  });

  /** Replace this Admin's manual order. Ranks are stored as zero-padded positions. */
  app.put('/rank', async (req) => {
    const u = requireRole(req, 'admin');
    const { order } = parse(rankInput, req.body);
    const uniq = [...new Set(order)];
    await db.transaction(async (tx) => {
      const exist = uniq.length ? await tx.select({ id: leads.id }).from(leads).where(inArray(leads.id, uniq)) : [];
      const ok = new Set(exist.map((e) => e.id));
      await tx.delete(adminRankings).where(eq(adminRankings.adminId, u.id));
      const vals = uniq.filter((id) => ok.has(id)).map((leadId, i) => ({ adminId: u.id, leadId, rank: String(i + 1).padStart(6, '0') }));
      for (let i = 0; i < vals.length; i += 500) await tx.insert(adminRankings).values(vals.slice(i, i + 500));
    });
    return { ok: true };
  });

  /* ------------------------------- reassign ------------------------------- */
  /**
   * Admin moves ownership: a BD deal to another BDE, or a CRE lead to another CRE
   * or back to the pool. Ownership moves at once; both people are told.
   */
  app.post<{ Params: { id: string } }>('/records/:id/reassign', async (req) => {
    const u = requireRole(req, 'admin');
    const input = parse(reassignInput, req.body);
    await db.transaction(async (tx) => {
      const l = await getLead(tx, req.params.id, true);
      if (l.lostAt) throw badRequest('This record is closed lost');
      const from = l.ownerId;
      if (input.to === from) throw badRequest('That person already owns it');
      if (l.desk === 'bd') {
        if (input.to === 'pool') throw badRequest('A BD deal goes to another BDE, not the pool');
        const to = await employeeById(tx, input.to);
        if (!to || !to.active || to.role !== 'bde') throw badRequest('Pick an active BDE');
        await changeOwner(tx, l, { ownerId: to.id, desk: 'bd', reason: 'reassign', byId: u.id, note: input.note });
        await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'bd', kind: 'transfer', title: `Reassigned to ${to.fullName} by Admin`, body: input.note });
        await notify(tx, [to.id], { kind: 'transfer', leadId: l.id, title: `Admin gave you a deal: ${l.customerName}`, body: input.note });
        await notify(tx, [from], { kind: 'transfer', leadId: l.id, title: `${l.customerName} moved to ${to.fullName}`, body: input.note });
        return;
      }
      if (input.to === 'pool') {
        const pool = await stageOfKind(tx, 'cre', 'pool');
        await changeStage(tx, l, 'cre', pool.id, u.id);
        await tx.update(leads).set({ stageTagId: null }).where(eq(leads.id, l.id));
        await closeOpenFollowup(tx, l.id, 'cancelled');
        await changeOwner(tx, l, { ownerId: null, desk: 'cre', reason: 'release', byId: u.id, note: input.note });
        await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'transfer', title: 'Sent back to the unclaimed pool by Admin', body: input.note });
        await notify(tx, [from], { kind: 'transfer', leadId: l.id, title: `${l.customerName} went back to the pool`, body: input.note });
        return;
      }
      const to = await employeeById(tx, input.to);
      if (!to || !to.active || to.role !== 'cre') throw badRequest('Pick an active CRE');
      if (!from) {
        // From the pool: give it the first working stage, same as a claim.
        const [first] = await tx
          .select()
          .from(stages)
          .where(and(eq(stages.desk, 'cre'), eq(stages.kind, 'working'), isNull(stages.archivedAt)))
          .orderBy(asc(stages.position))
          .limit(1);
        if (first) await changeStage(tx, l, 'cre', first.id, u.id);
      }
      await changeOwner(tx, l, { ownerId: to.id, desk: 'cre', reason: 'admin_assign', byId: u.id, note: input.note });
      await reassignFollowup(tx, l.id, to.id);
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'transfer', title: `Assigned to ${to.fullName} by Admin`, body: input.note });
      await notify(tx, [to.id], { kind: 'transfer', leadId: l.id, title: `Admin assigned you ${l.customerName}`, body: input.note });
      await notify(tx, [from], { kind: 'transfer', leadId: l.id, title: `${l.customerName} moved to ${to.fullName}`, body: input.note });
    });
    return { ok: true };
  });

  /* -------------------------------- library ------------------------------- */
  /** Everything Settings shows, with usage counts so Admin knows what's safe to remove. */
  app.get('/library', async () => {
    const [st, tg, cats, tpl, settings, stageUse, tagUse, adminTagUse, lostUse, stageTagUse, catUse] = await Promise.all([
      db.select().from(stages).where(isNull(stages.archivedAt)).orderBy(asc(stages.desk), asc(stages.position)),
      db.select().from(tags).where(isNull(tags.archivedAt)).orderBy(asc(tags.scope), asc(tags.position), asc(tags.id)),
      db.select().from(categories).where(isNull(categories.archivedAt)).orderBy(asc(categories.position)),
      db.select().from(messageTemplates).where(isNull(messageTemplates.ownerId)).orderBy(asc(messageTemplates.desk), asc(messageTemplates.audience), asc(messageTemplates.position)),
      db.select().from(appSettings),
      db.execute<{ stage_id: number; n: number }>(sql`
        select stage_id, count(*)::int as n from (
          select cre_stage_id as stage_id from leads where desk = 'cre' and lost_at is null
          union all select bd_stage_id from leads where desk = 'bd' and lost_at is null
        ) s group by stage_id`),
      db.select({ id: leadTags.tagId, n: count() }).from(leadTags).groupBy(leadTags.tagId),
      db.select({ id: adminLeadTags.tagId, n: count() }).from(adminLeadTags).groupBy(adminLeadTags.tagId),
      db.select({ id: leads.lostReasonId, n: count() }).from(leads).where(isNotNull(leads.lostReasonId)).groupBy(leads.lostReasonId),
      db.select({ id: leads.stageTagId, n: count() }).from(leads).where(isNotNull(leads.stageTagId)).groupBy(leads.stageTagId),
      db.select({ id: leads.categoryId, n: count() }).from(leads).where(isNotNull(leads.categoryId)).groupBy(leads.categoryId),
    ]);
    const use = new Map<number, number>();
    for (const r of [...tagUse, ...adminTagUse, ...lostUse, ...stageTagUse]) if (r.id) use.set(r.id, (use.get(r.id) ?? 0) + r.n);
    const sUse = new Map((stageUse as unknown as { stage_id: number; n: number }[]).map((r) => [r.stage_id, Number(r.n)]));
    const cUse = new Map(catUse.map((c) => [c.id!, c.n]));
    const vals = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    return {
      stages: st.map((s) => ({ ...s, live: sUse.get(s.id) ?? 0 })),
      tags: tg.map((t) => ({ ...t, used: use.get(t.id) ?? 0 })),
      categories: cats.map((c) => ({ ...c, used: cUse.get(c.id) ?? 0 })),
      templates: tpl,
      settings: Object.entries(SETTING_RULES).map(([key, r]) => ({ key, ...r, value: Number(vals[key] ?? 0) })),
    };
  });

  /* --------------------------------- stages ------------------------------- */
  app.post('/stages', async (req) => {
    const input = parse(stageCreateInput, req.body);
    const [m] = await db.select({ p: max(stages.position) }).from(stages).where(eq(stages.desk, input.desk));
    // New stages are working stages, placed before the desk's closing stages (hand-off / won / lost).
    const all = await db.select().from(stages).where(and(eq(stages.desk, input.desk), isNull(stages.archivedAt))).orderBy(asc(stages.position));
    const closing = all.find((s) => s.kind !== 'working' && s.kind !== 'pool');
    const pos = closing ? closing.position : (m?.p ?? 0) + 1;
    await db.transaction(async (tx) => {
      if (closing) {
        for (const s of all.filter((x) => x.position >= pos)) await tx.update(stages).set({ position: s.position + 1 }).where(eq(stages.id, s.id));
      }
      await tx.insert(stages).values({ desk: input.desk, kind: 'working', name: input.name, definition: input.definition, position: pos });
    });
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/stages/:id', async (req) => {
    const input = parse(stageUpdateInput, req.body);
    const [s] = await db.select().from(stages).where(eq(stages.id, Number(req.params.id)));
    if (!s || s.archivedAt) throw notFound('Stage not found');
    const patch: Partial<typeof stages.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.definition !== undefined) patch.definition = input.definition;
    if (s.kind === 'working') {
      if (s.desk === 'cre') {
        if (input.requiresFollowup !== undefined) patch.requiresFollowup = input.requiresFollowup;
        if (input.requiresStageTag !== undefined) patch.requiresStageTag = input.requiresStageTag;
      } else {
        if (input.showsValue !== undefined) patch.showsValue = input.showsValue;
        if (input.requiresQuotation !== undefined) patch.requiresQuotation = input.requiresQuotation;
      }
    }
    if (patch.requiresStageTag) {
      const [t] = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.stageId, s.id), isNull(tags.archivedAt))).limit(1);
      if (!t) throw badRequest('Add at least one tag to this stage first');
    }
    if (Object.keys(patch).length) await db.update(stages).set(patch).where(eq(stages.id, s.id));
    return { ok: true };
  });

  /** Reorder a desk's working stages. Pool / hand-off / won / lost keep their places. */
  app.post('/stages/order', async (req) => {
    const { desk, ids } = parse(stageOrderInput, req.body);
    const all = await db.select().from(stages).where(and(eq(stages.desk, desk), isNull(stages.archivedAt))).orderBy(asc(stages.position));
    const working = all.filter((s) => s.kind === 'working');
    if (ids.length !== working.length || !working.every((w) => ids.includes(w.id))) throw badRequest('Send every working stage once');
    const slots = all.filter((s) => s.kind === 'working').map((s) => s.position);
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) await tx.update(stages).set({ position: slots[i]! }).where(eq(stages.id, ids[i]!));
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/stages/:id', async (req) => {
    const [s] = await db.select().from(stages).where(eq(stages.id, Number(req.params.id)));
    if (!s || s.archivedAt) throw notFound('Stage not found');
    if (s.kind !== 'working') throw badRequest('This stage is part of the workflow — rename it instead');
    const col = s.desk === 'cre' ? leads.creStageId : leads.bdStageId;
    const [n] = await db.select({ n: count() }).from(leads).where(and(eq(col, s.id), isNull(leads.lostAt)));
    if ((n?.n ?? 0) > 0) throw conflict(`${n!.n} open record${n!.n === 1 ? ' is' : 's are'} in ${s.name} — move them first`);
    const working = await db.select({ id: stages.id }).from(stages).where(and(eq(stages.desk, s.desk), eq(stages.kind, 'working'), isNull(stages.archivedAt)));
    if (working.length <= 1) throw badRequest('A desk needs at least one working stage');
    await db.update(stages).set({ archivedAt: new Date() }).where(eq(stages.id, s.id));
    await db.update(tags).set({ archivedAt: new Date() }).where(and(eq(tags.stageId, s.id), isNull(tags.archivedAt)));
    return { ok: true };
  });

  /* ---------------------------------- tags -------------------------------- */
  app.post('/tags', async (req) => {
    const input = parse(tagCreateInput, req.body);
    if (input.stageId) {
      const [s] = await db.select().from(stages).where(eq(stages.id, input.stageId));
      if (!s || s.archivedAt || s.desk !== 'cre' || s.kind !== 'working') throw badRequest('Stage tags belong to a working CRE stage');
      if (input.scope !== 'cre') throw badRequest('Stage tags are CRE tags');
    }
    const [dupe] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.scope, input.scope), sql`lower(${tags.name}) = lower(${input.name})`, isNull(tags.archivedAt)));
    if (dupe) throw conflict('That tag already exists');
    const [m] = await db.select({ p: max(tags.position) }).from(tags).where(eq(tags.scope, input.scope));
    await db.insert(tags).values({ scope: input.scope, name: input.name, tone: input.tone, stageId: input.stageId ?? null, position: (m?.p ?? 0) + 1 });
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/tags/:id', async (req) => {
    const input = parse(tagUpdateInput, req.body);
    const [t] = await db.select().from(tags).where(eq(tags.id, Number(req.params.id)));
    if (!t || t.archivedAt) throw notFound('Tag not found');
    if (input.name && input.name.toLowerCase() !== t.name.toLowerCase()) {
      const [dupe] = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.scope, t.scope), sql`lower(${tags.name}) = lower(${input.name})`, isNull(tags.archivedAt)));
      if (dupe) throw conflict('That tag already exists');
    }
    await db.update(tags).set(input).where(eq(tags.id, t.id));
    return { ok: true };
  });

  /** Removing a tag hides it from the pickers; records that already carry it keep it. */
  app.delete<{ Params: { id: string } }>('/tags/:id', async (req) => {
    const [t] = await db.select().from(tags).where(eq(tags.id, Number(req.params.id)));
    if (!t || t.archivedAt) throw notFound('Tag not found');
    if (t.scope === 'cre_lost' || t.scope === 'bd_lost') {
      const [n] = await db.select({ n: count() }).from(tags).where(and(eq(tags.scope, t.scope), isNull(tags.archivedAt)));
      if ((n?.n ?? 0) <= 1) throw badRequest('Keep at least one lost reason — marking lost needs one');
    }
    if (t.stageId) {
      const [s] = await db.select().from(stages).where(eq(stages.id, t.stageId));
      const [n] = await db.select({ n: count() }).from(tags).where(and(eq(tags.stageId, t.stageId), isNull(tags.archivedAt)));
      if (s?.requiresStageTag && (n?.n ?? 0) <= 1) throw badRequest(`${s.name} needs a tag — turn that off for the stage first`);
    }
    await db.update(tags).set({ archivedAt: new Date() }).where(eq(tags.id, t.id));
    return { ok: true };
  });

  /* ------------------------------- categories ----------------------------- */
  app.post('/categories', async (req) => {
    const { name } = parse(categoryInput, req.body);
    const [dupe] = await db.select().from(categories).where(sql`lower(${categories.name}) = lower(${name})`);
    if (dupe && !dupe.archivedAt) throw conflict('That category already exists');
    if (dupe) await db.update(categories).set({ archivedAt: null }).where(eq(categories.id, dupe.id));
    else {
      const [m] = await db.select({ p: max(categories.position) }).from(categories);
      await db.insert(categories).values({ name, position: (m?.p ?? 0) + 1 });
    }
    return { ok: true };
  });
  app.patch<{ Params: { id: string } }>('/categories/:id', async (req) => {
    const { name } = parse(categoryInput, req.body);
    const [dupe] = await db.select().from(categories).where(and(sql`lower(${categories.name}) = lower(${name})`, sql`${categories.id} <> ${Number(req.params.id)}`));
    if (dupe) throw conflict('That category already exists');
    await db.update(categories).set({ name }).where(eq(categories.id, Number(req.params.id)));
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/categories/:id', async (req) => {
    await db.update(categories).set({ archivedAt: new Date() }).where(eq(categories.id, Number(req.params.id)));
    return { ok: true };
  });

  /* -------------------------------- settings ------------------------------ */
  app.put('/settings', async (req) => {
    const u = requireRole(req, 'admin');
    const { key, value } = parse(settingInput, req.body);
    const r = SETTING_RULES[key];
    if (!SETTING_KEYS.includes(key) || value < r.min || value > r.max) throw badRequest(`${r.label}: use ${r.min}–${r.max}`);
    await db
      .insert(appSettings)
      .values({ key, value, updatedBy: u.id })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date(), updatedBy: u.id } });
    return { ok: true };
  });

  /* ------------------------------- templates ------------------------------ */
  app.post('/templates', async (req) => {
    const input = parse(templateInput, req.body);
    const [m] = await db.select({ p: max(messageTemplates.position) }).from(messageTemplates).where(and(eq(messageTemplates.desk, input.desk), eq(messageTemplates.audience, input.audience)));
    await db.insert(messageTemplates).values({ ...input, position: (m?.p ?? 0) + 1 });
    return { ok: true };
  });
  app.patch<{ Params: { id: string } }>('/templates/:id', async (req) => {
    const input = parse(templateInput.partial(), req.body);
    await db.update(messageTemplates).set(input).where(and(eq(messageTemplates.id, Number(req.params.id)), isNull(messageTemplates.ownerId)));
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/templates/:id', async (req) => {
    await db.delete(messageTemplates).where(and(eq(messageTemplates.id, Number(req.params.id)), isNull(messageTemplates.ownerId)));
    return { ok: true };
  });
};
