/**
 * CRE desk. Every action checks ownership on the server, writes the activity
 * log, and (where ownership or stage changes) the owner log / stage history.
 */
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import {
  callLogInput,
  claimManyInput,
  CRE_SCOPES,
  editLeadInput,
  followupInput,
  handoffInput,
  lostInput,
  normalizePhone,
  setStageInput,
  tagInput,
  transferInput,
  whatsappLogInput,
  type CreScope,
} from '@jkay/shared';
import { activities, categories, leadOwners, leadTags, leads, messageTemplates, stageHistory, stages, tags } from '../db/schema.js';
import { badRequest, conflict, forbidden, parse } from '../http.js';
import { requireRole, type SessionUser } from '../auth/session.js';
import {
  activeAdminIds,
  assertCanView,
  assertCreOwnsOpen,
  changeOwner,
  changeStage,
  closeOpenFollowup,
  employeeById,
  firstWorkingStage,
  getLead,
  getStage,
  logActivity,
  notify,
  notifyWatchers,
  reassignFollowup,
  setFollowup,
  stageOfKind,
  type Lead,
  type Q,
} from '../services/leads.js';
import { leadDetail } from './leads.js';

const DEFAULT_MAX_OPEN = 30;
/** "19 Oct, 10:00 am" in IST, for activity-log text. */
const ist = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });

/* ------------------------------- list rows ------------------------------ */
async function listRows(q: Q, rows: Lead[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [tagRows, stageRows, catRows, tagLib] = await Promise.all([
    q
      .select({ leadId: leadTags.leadId, id: tags.id, name: tags.name, tone: tags.tone })
      .from(leadTags)
      .innerJoin(tags, eq(tags.id, leadTags.tagId))
      .where(and(inArray(leadTags.leadId, ids), eq(tags.scope, 'cre'))),
    q.select({ id: stages.id, name: stages.name, kind: stages.kind }).from(stages),
    q.select({ id: categories.id, name: categories.name }).from(categories),
    q.select({ id: tags.id, name: tags.name, tone: tags.tone }).from(tags),
  ]);
  const st = new Map(stageRows.map((s) => [s.id, s]));
  const cat = new Map(catRows.map((c) => [c.id, c.name]));
  const tg = new Map(tagLib.map((t) => [t.id, t]));
  return rows.map((l) => ({
    id: l.id,
    number: l.number,
    customerName: l.customerName,
    phone: l.phone,
    place: l.place,
    platform: l.platform,
    sourceLabel: l.sourceLabel,
    category: l.categoryId ? (cat.get(l.categoryId) ?? null) : null,
    creStage: st.get(l.creStageId) ?? null,
    bdStage: l.bdStageId ? (st.get(l.bdStageId)?.name ?? null) : null,
    stageTag: l.stageTagId ? (tg.get(l.stageTagId) ?? null) : null,
    tags: tagRows.filter((t) => t.leadId === l.id).map(({ id, name, tone }) => ({ id, name, tone })),
    nextFollowupAt: l.nextFollowupAt,
    qualifiedAt: l.qualifiedAt,
    lostAt: l.lostAt,
    lostReason: l.lostReasonId ? (tg.get(l.lostReasonId)?.name ?? null) : null,
    createdAt: l.createdAt,
    ownerSince: l.ownerSince,
  }));
}

async function scopeWhere(q: Q, u: SessionUser, scope: CreScope) {
  switch (scope) {
    case 'pool': {
      const pool = await stageOfKind(q, 'cre', 'pool');
      return and(eq(leads.desk, 'cre'), isNull(leads.ownerId), eq(leads.creStageId, pool.id), isNull(leads.lostAt));
    }
    case 'mine':
      return and(eq(leads.desk, 'cre'), eq(leads.ownerId, u.id), isNull(leads.lostAt));
    case 'bd':
      return and(eq(leads.desk, 'bd'), eq(leads.qualifiedById, u.id));
    case 'lost':
      return and(eq(leads.lostDesk, 'cre'), eq(leads.ownerId, u.id));
  }
}

const orderFor = (scope: CreScope) =>
  scope === 'mine'
    ? [sql`${leads.nextFollowupAt} asc nulls last`, desc(leads.ownerSince)]
    : scope === 'bd'
      ? [desc(leads.qualifiedAt)]
      : scope === 'lost'
        ? [desc(leads.lostAt)]
        : [desc(leads.createdAt)];

export const creRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  /** Load a lead the current CRE owns (or Admin), locked for update, inside a transaction. */
  const owned = async (tx: Q, u: SessionUser, id: string) => {
    const l = await getLead(tx, id, true);
    assertCreOwnsOpen(u, l);
    return l;
  };
  const detail = async (u: SessionUser, id: string) => leadDetail(db, u, await getLead(db, id));

  /* --------------------------------- lists -------------------------------- */
  app.get<{ Querystring: { scope?: string; stageId?: string; tagId?: string; q?: string } }>('/leads', async (req) => {
    const u = requireRole(req, 'cre');
    const scope = (CRE_SCOPES as readonly string[]).includes(req.query.scope ?? '') ? (req.query.scope as CreScope) : 'pool';
    const conds = [await scopeWhere(db, u, scope)];
    if (req.query.stageId) conds.push(eq(leads.creStageId, Number(req.query.stageId)));
    if (req.query.tagId) {
      const t = Number(req.query.tagId);
      conds.push(
        or(
          eq(leads.stageTagId, t),
          eq(leads.lostReasonId, t),
          sql`exists (select 1 from ${leadTags} where ${leadTags.leadId} = ${leads.id} and ${leadTags.tagId} = ${t})`,
        ),
      );
    }
    const q = (req.query.q ?? '').trim();
    if (q) {
      const like = `%${q.replace(/[%_]/g, '')}%`;
      const digits = q.replace(/\D/g, '');
      conds.push(
        or(
          ilike(leads.customerName, like),
          ilike(leads.place, like),
          ilike(leads.sourceLabel, like),
          ilike(leads.contactName, like),
          digits.length >= 3 ? ilike(leads.phone, `%${digits}%`) : undefined,
        ),
      );
    }
    const rows = await db.select().from(leads).where(and(...conds)).orderBy(...orderFor(scope)).limit(500);
    return { scope, leads: await listRows(db, rows) };
  });

  /** Counts for the sidebar. */
  app.get('/counts', async (req) => {
    const u = requireRole(req, 'cre');
    const out: Record<string, number> = {};
    for (const s of CRE_SCOPES) {
      const [r] = await db.select({ n: count() }).from(leads).where(await scopeWhere(db, u, s));
      out[s] = r?.n ?? 0;
    }
    const byStage = await db
      .select({ stageId: leads.creStageId, n: count() })
      .from(leads)
      .where(await scopeWhere(db, u, 'mine'))
      .groupBy(leads.creStageId);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const [due] = await db
      .select({ n: count() })
      .from(leads)
      .where(and(await scopeWhere(db, u, 'mine'), isNotNull(leads.nextFollowupAt), lte(leads.nextFollowupAt, endOfDay)));
    return { counts: out, mineByStage: Object.fromEntries(byStage.map((b) => [b.stageId, b.n])), dueToday: due?.n ?? 0 };
  });

  /* --------------------------------- claim -------------------------------- */
  /**
   * First come, first served. The UPDATE only matches while the lead is still
   * unowned in the pool, so two CREs clicking at once can't both get it.
   */
  async function claimOne(u: SessionUser, id: string) {
    return db.transaction(async (tx) => {
      const pool = await stageOfKind(tx, 'cre', 'pool');
      const max = Number((u.prefs as { maxOpenLeads?: number }).maxOpenLeads ?? DEFAULT_MAX_OPEN);
      const [open] = await tx.select({ n: count() }).from(leads).where(and(eq(leads.desk, 'cre'), eq(leads.ownerId, u.id), isNull(leads.lostAt)));
      if ((open?.n ?? 0) >= max) throw badRequest(`You already have ${max} open leads — close or hand some off first`);

      const first = await firstWorkingStage(tx, 'cre');
      const [l] = await tx
        .update(leads)
        .set({ ownerId: u.id, ownerSince: new Date(), creStageId: first.id, updatedAt: new Date() })
        .where(and(eq(leads.id, id), isNull(leads.ownerId), eq(leads.desk, 'cre'), eq(leads.creStageId, pool.id), isNull(leads.lostAt)))
        .returning();
      if (!l) throw conflict('Someone else already claimed this lead');
      await tx.update(leadOwners).set({ endedAt: new Date() }).where(and(eq(leadOwners.leadId, l.id), isNull(leadOwners.endedAt)));
      await tx.insert(leadOwners).values({ leadId: l.id, ownerId: u.id, desk: 'cre', reason: 'claim', byId: u.id });
      await tx.insert(stageHistory).values({ leadId: l.id, desk: 'cre', fromStageId: pool.id, toStageId: first.id, byId: u.id });
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'claim', title: 'Claimed from the unclaimed pool', body: 'Now hidden from other CREs' });
      await notifyWatchers(tx, l.id, `${l.customerName} claimed by ${u.fullName}`);
      return l;
    });
  }

  app.post<{ Params: { id: string } }>('/leads/:id/claim', async (req) => {
    const u = requireRole(req, 'cre');
    const l = await claimOne(u, req.params.id);
    return detail(u, l.id);
  });

  app.post('/claim', async (req) => {
    const u = requireRole(req, 'cre');
    const { leadIds } = parse(claimManyInput, req.body);
    const claimed: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of leadIds) {
      try {
        claimed.push((await claimOne(u, id)).id);
      } catch (e) {
        failed.push({ id, error: (e as Error).message });
      }
    }
    return { claimed, failed };
  });

  /* ------------------------------ edit details ---------------------------- */
  app.patch<{ Params: { id: string } }>('/leads/:id', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    const input = parse(editLeadInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const patch: Partial<Lead> = {};
      if (input.customerName !== undefined) patch.customerName = input.customerName;
      if (input.contactName !== undefined) patch.contactName = input.contactName || null;
      if (input.phone !== undefined) {
        const p = normalizePhone(input.phone);
        if (!p) throw badRequest('That phone number does not look right');
        patch.phone = p;
      }
      if (input.altPhone !== undefined) patch.altPhone = input.altPhone ? normalizePhone(input.altPhone) : null;
      if (input.email !== undefined) patch.email = input.email || null;
      if (input.place !== undefined) patch.place = input.place || null;
      if (input.requirement !== undefined) patch.requirement = input.requirement || null;
      if (input.sourceLabel !== undefined) patch.sourceLabel = input.sourceLabel || null;
      if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
      if (input.estimate !== undefined) patch.estimate = input.estimate;
      const changed = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== (l as Record<string, unknown>)[k]);
      if (!changed.length) return;
      await tx.update(leads).set({ ...patch, updatedAt: new Date() }).where(eq(leads.id, l.id));
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'edit', title: 'Lead details edited', body: changed.join(', '), meta: { changed } });
    });
    return detail(u, req.params.id);
  });

  /* ------------------------------- set stage ------------------------------ */
  app.post<{ Params: { id: string } }>('/leads/:id/stage', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    const input = parse(setStageInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const stage = await getStage(tx, input.stageId);
      if (stage.desk !== 'cre' || stage.kind !== 'working')
        throw badRequest('Use Hand off to BD or Mark lost for those — this sets stages inside My Leads');

      let stageTagId: number | null = null;
      let tagName = '';
      if (stage.requiresStageTag) {
        if (!input.stageTagId) throw badRequest(`${stage.name} needs a tag`);
        const [t] = await tx.select().from(tags).where(eq(tags.id, input.stageTagId));
        if (!t || t.stageId !== stage.id || t.archivedAt) throw badRequest(`That tag doesn't belong to ${stage.name}`);
        stageTagId = t.id;
        tagName = t.name;
      }
      if (stage.requiresFollowup && !input.followupAt) throw badRequest(`${stage.name} needs a next follop date and time`);

      await changeStage(tx, l, 'cre', stage.id, u.id);
      await tx
        .update(leads)
        .set({ stageTagId, categoryId: input.categoryId ?? l.categoryId, updatedAt: new Date() })
        .where(eq(leads.id, l.id));
      if (input.followupAt) await setFollowup(tx, l, l.ownerId ?? u.id, new Date(input.followupAt), null, u.id);

      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'cre',
        kind: 'stage',
        title: `Stage set to ${stage.name}${tagName ? ' · ' + tagName : ''}`,
        body: input.followupAt ? `Next follop ${ist(input.followupAt)}` : null,
        meta: { stageId: stage.id, stageTagId },
      });
      await notifyWatchers(tx, l.id, `${l.customerName} moved to ${stage.name}`, undefined, u.id);
    });
    return detail(u, req.params.id);
  });

  /* -------------------------------- follop -------------------------------- */
  app.put<{ Params: { id: string } }>('/leads/:id/followup', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    const input = parse(followupInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      await setFollowup(tx, l, l.ownerId ?? u.id, new Date(input.dueAt), input.note ?? null, u.id);
      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'cre',
        kind: 'followup',
        title: `Follop scheduled for ${ist(input.dueAt)}`,
        body: input.note ?? null,
        meta: { dueAt: input.dueAt },
      });
    });
    return detail(u, req.params.id);
  });

  app.delete<{ Params: { id: string } }>('/leads/:id/followup', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const [stage] = await tx.select().from(stages).where(eq(stages.id, l.creStageId));
      if (stage?.requiresFollowup) throw badRequest(`${stage.name} needs a follop — change the stage first`);
      await closeOpenFollowup(tx, l.id, 'cancelled');
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'followup', title: 'Follop removed' });
    });
    return detail(u, req.params.id);
  });

  /* ------------------------------ call / whatsapp ------------------------- */
  app.post<{ Params: { id: string } }>('/leads/:id/call', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    const input = parse(callLogInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'cre',
        kind: 'call',
        title: input.nextFollowupAt ? `Call logged · next follop ${ist(input.nextFollowupAt)}` : 'Call logged',
        body: input.summary,
      });
      await tx.update(leads).set({ lastContactAt: new Date() }).where(eq(leads.id, l.id));
      if (input.nextFollowupAt) await setFollowup(tx, l, l.ownerId ?? u.id, new Date(input.nextFollowupAt), null, u.id);
      else await closeOpenFollowup(tx, l.id, 'done');
    });
    return detail(u, req.params.id);
  });

  /** WhatsApp opens on the person's own phone (wa.me) — we only record that it was opened. */
  app.post<{ Params: { id: string } }>('/leads/:id/whatsapp', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    const input = parse(whatsappLogInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const tpl = input.templateId ? (await tx.select().from(messageTemplates).where(eq(messageTemplates.id, input.templateId)))[0] : undefined;
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'whatsapp', title: 'WhatsApp opened', body: tpl ? `Template: ${tpl.title}` : null });
      await tx.update(leads).set({ lastContactAt: new Date() }).where(eq(leads.id, l.id));
    });
    return { ok: true };
  });

  /* --------------------------------- tags --------------------------------- */
  app.post<{ Params: { id: string } }>('/leads/:id/tags', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    const { tagId } = parse(tagInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const [t] = await tx.select().from(tags).where(eq(tags.id, tagId));
      if (!t || t.scope !== 'cre' || t.stageId || t.archivedAt) throw badRequest("That isn't one of the CRE tags Admin issued");
      await tx.insert(leadTags).values({ leadId: l.id, tagId, addedById: u.id }).onConflictDoNothing();
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'tag', title: `Tagged ${t.name}` });
    });
    return detail(u, req.params.id);
  });

  app.delete<{ Params: { id: string; tagId: string } }>('/leads/:id/tags/:tagId', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const [t] = await tx.select().from(tags).where(eq(tags.id, Number(req.params.tagId)));
      await tx.delete(leadTags).where(and(eq(leadTags.leadId, l.id), eq(leadTags.tagId, Number(req.params.tagId))));
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'tag', title: `Tag removed · ${t?.name ?? ''}` });
    });
    return detail(u, req.params.id);
  });

  app.post('/tags/bulk', async (req) => {
    const u = requireRole(req, 'cre');
    const { leadIds } = parse(claimManyInput, req.body);
    const { tagId } = parse(tagInput, req.body);
    const [t] = await db.select().from(tags).where(eq(tags.id, tagId));
    if (!t || t.scope !== 'cre' || t.stageId || t.archivedAt) throw badRequest("That isn't one of the CRE tags Admin issued");
    let n = 0;
    for (const id of leadIds) {
      await db.transaction(async (tx) => {
        const l = await getLead(tx, id, true);
        if (l.desk !== 'cre' || l.ownerId !== u.id || l.lostAt) return;
        const r = await tx.insert(leadTags).values({ leadId: l.id, tagId, addedById: u.id }).onConflictDoNothing().returning();
        if (r.length) {
          n++;
          await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'tag', title: `Tagged ${t.name}` });
        }
      });
    }
    return { tagged: n };
  });

  /* ------------------------------ hand off to BD -------------------------- */
  app.post<{ Params: { id: string } }>('/leads/:id/handoff', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    const input = parse(handoffInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const bde = await employeeById(tx, input.toBdeId);
      if (!bde || !bde.active || bde.role !== 'bde') throw badRequest('Pick an active BDE');
      const handoff = await stageOfKind(tx, 'cre', 'handoff');
      const firstBd = await firstWorkingStage(tx, 'bd');

      await changeStage(tx, l, 'cre', handoff.id, u.id);
      await tx
        .update(leads)
        .set({ desk: 'bd', bdStageId: firstBd.id, qualifiedById: l.ownerId ?? u.id, qualifiedAt: new Date(), stageTagId: null, updatedAt: new Date() })
        .where(eq(leads.id, l.id));
      l.desk = 'bd';
      await tx.insert(stageHistory).values({ leadId: l.id, desk: 'bd', fromStageId: null, toStageId: firstBd.id, byId: u.id });
      await closeOpenFollowup(tx, l.id, 'done');
      await changeOwner(tx, l, { ownerId: bde.id, desk: 'bd', reason: 'handoff', byId: u.id, note: input.note });

      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'cre',
        kind: 'handoff',
        title: `Handed off to ${bde.fullName}`,
        body: input.note + (input.verified ? ` · ${input.verified}` : ''),
      });
      await notify(tx, [bde.id], { kind: 'handoff', leadId: l.id, title: `${u.fullName} handed you a deal`, body: `${l.customerName} — ${input.note}` });
      await notifyWatchers(tx, l.id, `${l.customerName} handed to ${bde.fullName}`, undefined, u.id);
    });
    return detail(u, req.params.id);
  });

  /* -------------------------------- transfer ------------------------------ */
  /** CRE → another CRE (ownership moves now, follop goes with it) or back to the pool. */
  app.post<{ Params: { id: string } }>('/leads/:id/transfer', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    const input = parse(transferInput, req.body);
    const result = await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      if (input.to === 'pool') {
        const pool = await stageOfKind(tx, 'cre', 'pool');
        await changeStage(tx, l, 'cre', pool.id, u.id);
        await tx.update(leads).set({ stageTagId: null }).where(eq(leads.id, l.id));
        await closeOpenFollowup(tx, l.id, 'cancelled');
        await changeOwner(tx, l, { ownerId: null, desk: 'cre', reason: 'release', byId: u.id, note: `${input.reason} — ${input.note}` });
        await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'transfer', title: 'Released to the unclaimed pool', body: `${input.reason} · ${input.note}` });
        return { to: 'pool' as const };
      }
      if (input.to === l.ownerId) throw badRequest('That CRE already owns this lead');
      const to = await employeeById(tx, input.to);
      if (!to || !to.active || to.role !== 'cre') throw badRequest('Pick an active CRE (use Hand off to BD for a BDE)');
      await changeOwner(tx, l, { ownerId: to.id, desk: 'cre', reason: 'transfer', byId: u.id, note: `${input.reason} — ${input.note}` });
      await reassignFollowup(tx, l.id, to.id);
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'transfer', title: `Transferred to ${to.fullName}`, body: `${input.reason} · ${input.note}` });
      await notify(tx, [to.id], { kind: 'transfer', leadId: l.id, title: `${u.fullName} transferred a lead to you`, body: `${l.customerName} — ${input.reason}` });
      await notifyWatchers(tx, l.id, `${l.customerName} transferred to ${to.fullName}`, undefined, u.id);
      return { to: to.id };
    });
    return { ok: true, ...result };
  });

  /* ------------------------------- mark lost ------------------------------ */
  app.post<{ Params: { id: string } }>('/leads/:id/lost', async (req) => {
    const u = requireRole(req, 'cre', 'admin');
    const input = parse(lostInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const [reason] = await tx.select().from(tags).where(eq(tags.id, input.reasonId));
      if (!reason || reason.scope !== 'cre_lost' || reason.archivedAt) throw badRequest('Pick one of the CRE lost reasons');
      const lostStage = await stageOfKind(tx, 'cre', 'lost');
      await changeStage(tx, l, 'cre', lostStage.id, u.id);
      await tx
        .update(leads)
        .set({ lostAt: new Date(), lostDesk: 'cre', lostReasonId: reason.id, lostNote: input.note || null, lostById: u.id, stageTagId: null })
        .where(eq(leads.id, l.id));
      await closeOpenFollowup(tx, l.id, 'cancelled');
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'cre', kind: 'lost', title: `Marked lost · ${reason.name}`, body: input.note || null });
      await notifyWatchers(tx, l.id, `${l.customerName} marked lost`, reason.name, u.id);
    });
    return detail(u, req.params.id);
  });

  /* -------------------------------- dashboard ----------------------------- */
  app.get('/dashboard', async (req) => {
    const u = requireRole(req, 'cre');
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const rowsFor = async (s: CreScope) => db.select().from(leads).where(await scopeWhere(db, u, s));
    const [pool, mine, bd, lost] = await Promise.all([rowsFor('pool'), rowsFor('mine'), rowsFor('bd'), rowsFor('lost')]);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const days = Array.from({ length: 7 }, (_, i) => day(new Date(Date.now() - (6 - i) * 24 * 3600 * 1000)));
    const series = (dates: Date[]) => days.map((d) => dates.filter((x) => day(x) === d).length);

    const [claims, calls, handoffs, losses] = await Promise.all([
      db.select({ at: leadOwners.startedAt }).from(leadOwners).where(and(eq(leadOwners.ownerId, u.id), eq(leadOwners.reason, 'claim'), gte(leadOwners.startedAt, weekAgo))),
      db.select({ at: activities.at }).from(activities).where(and(eq(activities.actorId, u.id), eq(activities.kind, 'call'), gte(activities.at, weekAgo))),
      db.select({ at: activities.at }).from(activities).where(and(eq(activities.actorId, u.id), eq(activities.kind, 'handoff'), gte(activities.at, weekAgo))),
      db.select({ at: activities.at }).from(activities).where(and(eq(activities.actorId, u.id), eq(activities.kind, 'lost'), gte(activities.at, weekAgo))),
    ]);

    const stageRows = await db.select().from(stages).where(and(eq(stages.desk, 'cre'), isNull(stages.archivedAt))).orderBy(asc(stages.position));
    const tagRows = await db.select().from(tags);
    const tagName = new Map(tagRows.map((t) => [t.id, t.name]));
    const bdStageRows = await db.select({ id: stages.id, name: stages.name }).from(stages).where(eq(stages.desk, 'bd'));
    const bdStageName = new Map(bdStageRows.map((s) => [s.id, s.name]));
    const countBy = <T,>(xs: T[], key: (x: T) => string | null | undefined) => {
      const m: Record<string, number> = {};
      xs.forEach((x) => {
        const k = key(x);
        if (k) m[k] = (m[k] ?? 0) + 1;
      });
      return m;
    };
    const worked = mine.length + bd.length + lost.length;
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    return {
      totals: {
        pool: pool.length,
        mine: mine.length,
        handed: bd.length,
        lost: lost.length,
        dueToday: mine.filter((l) => l.nextFollowupAt && l.nextFollowupAt <= endOfDay).length,
        handoffRate: worked ? Math.round((bd.length / worked) * 100) : 0,
        worked,
      },
      week: { days, claims: series(claims.map((c) => c.at)), calls: series(calls.map((c) => c.at)), handoffs: series(handoffs.map((c) => c.at)), lost: series(losses.map((c) => c.at)) },
      byStage: stageRows.filter((s) => s.kind === 'working').map((s) => ({ id: s.id, name: s.name, n: mine.filter((l) => l.creStageId === s.id).length })),
      upcoming: (await listRows(db, mine.filter((l) => l.nextFollowupAt).sort((a, b) => +a.nextFollowupAt! - +b.nextFollowupAt!).slice(0, 8))),
      byPlatform: countBy([...mine, ...bd, ...lost], (l) => l.platform),
      lostReasons: countBy(lost, (l) => (l.lostReasonId ? tagName.get(l.lostReasonId) : null)),
      stageTags: countBy(mine, (l) => (l.stageTagId ? tagName.get(l.stageTagId) : null)),
      bdStages: countBy(bd, (l) => (l.bdStageId ? (bdStageName.get(l.bdStageId) ?? null) : null)),
    };
  });
};
