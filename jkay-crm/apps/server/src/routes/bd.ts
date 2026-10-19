/**
 * BD desk. A "deal" is a lead the CRE desk handed over (desk = 'bd').
 *
 * Rules that come from the BD mockup, kept data-driven so they follow
 * whatever stages Admin sets up:
 *  - A stage flagged `requiresQuotation` can't be entered without a quotation.
 *  - The first quotation moves the deal forward to the first such stage.
 *  - Measuring the site, or uploading the first drawing, moves a deal off the
 *    first working stage to the next one.
 *  - Won locks the contract value from the latest quotation. An advance payment
 *    on an open, quoted deal marks it won.
 *  - A quotation cut deeper than the Admin discount threshold (vs the highest
 *    earlier quotation) needs an approved discount request first.
 *  - Lost needs a BD lost reason; Reopen puts the deal back where it was.
 */
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, max, sql } from 'drizzle-orm';
import {
  bdCallInput,
  bdStageInput,
  cadInput,
  discountDecisionInput,
  discountInput,
  lostInput,
  paymentInput,
  productionDateInput,
  quotationInput,
  tagInput,
  visitInput,
  whatsappLogInput,
  type PaymentKind,
} from '@jkay/shared';
import {
  appSettings,
  attachments,
  cadRevisions,
  discountRequests,
  employees,
  leadTags,
  leads,
  messageTemplates,
  notes,
  payments,
  quotations,
  siteVisits,
  stageHistory,
  stages,
  tags,
} from '../db/schema.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../http.js';
import { requireRole, type SessionUser } from '../auth/session.js';
import {
  activeAdminIds,
  changeStage,
  employeeById,
  getLead,
  getStage,
  logActivity,
  namesOf,
  notify,
  notifyWatchers,
  stageOfKind,
  type Lead,
  type Q,
  type Stage,
} from '../services/leads.js';
import { leadDetail } from './leads.js';

const money = (n: number) => '₹' + n.toLocaleString('en-IN');
const ist = (d: Date | string) =>
  new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
const istDate = (iso: string) =>
  new Date(iso + 'T00:00:00+05:30').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const KIND_LABEL: Record<PaymentKind, string> = { advance: 'Advance', installment: 'Installment', final: 'Final balance' };

async function setting<T>(q: Q, key: string, fallback: T): Promise<T> {
  const [r] = await q.select().from(appSettings).where(eq(appSettings.key, key));
  return (r?.value as T) ?? fallback;
}

/* ------------------------------ stage helpers ---------------------------- */
async function bdStages(q: Q) {
  return q
    .select()
    .from(stages)
    .where(and(eq(stages.desk, 'bd'), isNull(stages.archivedAt)))
    .orderBy(asc(stages.position));
}
/** The working stage after the first one, if the deal is still on the first. */
async function advanceOffFirst(q: Q, l: Lead, byId: string) {
  const working = (await bdStages(q)).filter((s) => s.kind === 'working');
  if (working.length < 2 || l.bdStageId !== working[0]!.id || l.wonAt || l.lostAt) return null;
  await changeStage(q, l, 'bd', working[1]!.id, byId);
  return working[1]!;
}

async function latestQuote(q: Q, leadId: string) {
  const [r] = await q.select().from(quotations).where(eq(quotations.leadId, leadId)).orderBy(desc(quotations.version)).limit(1);
  return r ?? null;
}
async function paidSoFar(q: Q, leadId: string) {
  const [r] = await q.select({ n: sql<string>`coalesce(sum(${payments.amount}), 0)` }).from(payments).where(eq(payments.leadId, leadId));
  return Number(r?.n ?? 0);
}

/* --------------------------------- detail -------------------------------- */
/** The BD half of a deal's record (visits, drawings, quotations, payments, discounts). */
export async function bdBlock(q: Q, l: Lead) {
  const [visitRows, cadRows, quoteRows, payRows, discRows, handedBy] = await Promise.all([
    q.select().from(siteVisits).where(eq(siteVisits.leadId, l.id)).orderBy(desc(siteVisits.scheduledAt)),
    q
      .select({ c: cadRevisions, fileName: attachments.fileName })
      .from(cadRevisions)
      .innerJoin(attachments, eq(attachments.id, cadRevisions.attachmentId))
      .where(eq(cadRevisions.leadId, l.id))
      .orderBy(desc(cadRevisions.rev)),
    q
      .select({ qt: quotations, fileName: attachments.fileName })
      .from(quotations)
      .leftJoin(attachments, eq(attachments.id, quotations.attachmentId))
      .where(eq(quotations.leadId, l.id))
      .orderBy(desc(quotations.version)),
    q.select().from(payments).where(eq(payments.leadId, l.id)).orderBy(asc(payments.receivedOn), asc(payments.id)),
    q.select().from(discountRequests).where(eq(discountRequests.leadId, l.id)).orderBy(desc(discountRequests.createdAt)),
    l.qualifiedById ? employeeById(q, l.qualifiedById) : Promise.resolve(null),
  ]);
  const names = await namesOf(q, [
    ...visitRows.flatMap((v) => [v.engineerId, v.createdById]),
    ...cadRows.map((c) => c.c.byId),
    ...quoteRows.map((r) => r.qt.byId),
    ...payRows.map((p) => p.recordedById),
    ...discRows.flatMap((d) => [d.requestedById, d.decidedById]),
  ]);
  const paid = payRows.reduce((a, p) => a + p.amount, 0);
  const latest = quoteRows[0]?.qt;
  const value = l.contractValue ?? latest?.amount ?? null;
  return {
    handedBy: handedBy ? { id: handedBy.id, name: handedBy.fullName, phone: handedBy.phone } : null,
    value,
    contractValue: l.contractValue,
    paid,
    balance: l.contractValue ? Math.max(0, l.contractValue - paid) : null,
    productionDate: l.productionDate,
    discountThreshold: Number(await setting(q, 'discount_threshold_pct', 8)),
    visits: visitRows.map((v) => ({
      id: v.id,
      scheduledAt: v.scheduledAt,
      engineer: v.engineerId ? (names.get(v.engineerId) ?? '—') : (v.engineerName ?? '—'),
      engineerId: v.engineerId,
      note: v.note,
      status: v.status,
      doneAt: v.doneAt,
    })),
    cad: cadRows.map(({ c, fileName }) => ({ id: c.id, rev: c.rev, attachmentId: c.attachmentId, fileName, note: c.note, by: c.byId ? (names.get(c.byId) ?? '—') : '—', at: c.createdAt })),
    quotations: quoteRows.map(({ qt, fileName }) => ({
      id: qt.id,
      version: qt.version,
      amount: qt.amount,
      attachmentId: qt.attachmentId,
      fileName,
      note: qt.note,
      by: qt.byId ? (names.get(qt.byId) ?? '—') : '—',
      at: qt.createdAt,
    })),
    payments: payRows.map((p) => ({
      id: p.id,
      kind: p.kind,
      amount: p.amount,
      receivedOn: p.receivedOn,
      mode: p.mode,
      reference: p.reference,
      by: p.recordedById ? (names.get(p.recordedById) ?? '—') : '—',
    })),
    discounts: discRows.map((d) => ({
      id: d.id,
      percent: Number(d.percent),
      proposedAmount: d.proposedAmount,
      reason: d.reason,
      status: d.status,
      by: names.get(d.requestedById) ?? '—',
      decidedBy: d.decidedById ? (names.get(d.decidedById) ?? '—') : null,
      decidedAt: d.decidedAt,
      decisionNote: d.decisionNote,
      at: d.createdAt,
    })),
  };
}

/* ---------------------------------- lists -------------------------------- */
async function dealRows(q: Q, rows: Lead[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [stageRows, tagRows, quoteRows, cadRows, visitRows, payRows, pendingDisc, catRows] = await Promise.all([
    q.select().from(stages).where(eq(stages.desk, 'bd')),
    q
      .select({ leadId: leadTags.leadId, id: tags.id, name: tags.name, tone: tags.tone })
      .from(leadTags)
      .innerJoin(tags, eq(tags.id, leadTags.tagId))
      .where(and(inArray(leadTags.leadId, ids), eq(tags.scope, 'bd'))),
    q
      .select({ leadId: quotations.leadId, version: quotations.version, amount: quotations.amount, at: quotations.createdAt })
      .from(quotations)
      .where(inArray(quotations.leadId, ids))
      .orderBy(asc(quotations.version)),
    q.select({ leadId: cadRevisions.leadId, rev: max(cadRevisions.rev), at: max(cadRevisions.createdAt) }).from(cadRevisions).where(inArray(cadRevisions.leadId, ids)).groupBy(cadRevisions.leadId),
    q.select().from(siteVisits).where(and(inArray(siteVisits.leadId, ids), sql`${siteVisits.status} <> 'cancelled'`)).orderBy(desc(siteVisits.scheduledAt)),
    q.select({ leadId: payments.leadId, n: sql<string>`sum(${payments.amount})` }).from(payments).where(inArray(payments.leadId, ids)).groupBy(payments.leadId),
    q.select({ leadId: discountRequests.leadId }).from(discountRequests).where(and(inArray(discountRequests.leadId, ids), eq(discountRequests.status, 'pending'))),
    q.execute(sql`select id, name from categories`),
  ]);
  const st = new Map(stageRows.map((s) => [s.id, s]));
  const names = await namesOf(q, [...rows.flatMap((r) => [r.qualifiedById, r.ownerId]), ...visitRows.map((v) => v.engineerId)]);
  const lostTags = rows.some((r) => r.lostReasonId) ? await q.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.scope, 'bd_lost')) : [];
  const lostName = new Map(lostTags.map((t) => [t.id, t.name]));
  const cats = new Map((catRows as unknown as { id: number; name: string }[]).map((c) => [c.id, c.name]));
  const pending = new Set(pendingDisc.map((d) => d.leadId));

  return rows.map((l) => {
    const qs = quoteRows.filter((x) => x.leadId === l.id);
    const lastQ = qs[qs.length - 1];
    const stage = l.bdStageId ? st.get(l.bdStageId) : undefined;
    const vs = visitRows.filter((v) => v.leadId === l.id);
    const visit = vs.find((v) => v.status === 'booked') ?? vs[0];
    const cad = cadRows.find((c) => c.leadId === l.id);
    const paid = Number(payRows.find((p) => p.leadId === l.id)?.n ?? 0);
    return {
      id: l.id,
      number: l.number,
      customerName: l.customerName,
      contactName: l.contactName,
      phone: l.phone,
      place: l.place,
      requirement: l.requirement,
      category: l.categoryId ? (cats.get(l.categoryId) ?? null) : null,
      platform: l.platform,
      sourceLabel: l.sourceLabel,
      stage: stage ? { id: stage.id, name: stage.name, kind: stage.kind, position: stage.position, showsValue: stage.showsValue } : null,
      owner: l.ownerId ? { id: l.ownerId, name: names.get(l.ownerId) ?? '—' } : null,
      handedBy: l.qualifiedById ? (names.get(l.qualifiedById) ?? '—') : '—',
      handedAt: l.qualifiedAt,
      estimate: l.estimate,
      tags: tagRows.filter((t) => t.leadId === l.id).map(({ id, name, tone }) => ({ id, name, tone })),
      quoteCount: qs.length,
      latestQuote: lastQ ? { version: lastQ.version, amount: lastQ.amount, at: lastQ.at } : null,
      value: l.contractValue ?? lastQ?.amount ?? null,
      contractValue: l.contractValue,
      paid,
      balance: l.contractValue ? Math.max(0, l.contractValue - paid) : null,
      cad: cad ? { rev: cad.rev, at: cad.at } : null,
      visit: visit
        ? { id: visit.id, scheduledAt: visit.scheduledAt, status: visit.status, engineer: visit.engineerId ? (names.get(visit.engineerId) ?? '—') : (visit.engineerName ?? '—') }
        : null,
      discountPending: pending.has(l.id),
      wonAt: l.wonAt,
      productionDate: l.productionDate,
      lostAt: l.lostAt,
      lostReason: l.lostReasonId ? (lostName.get(l.lostReasonId) ?? null) : null,
      updatedAt: l.updatedAt,
    };
  });
}

/** BDE: their own deals. Admin: every BD deal, or one BDE's with ?ownerId=. */
function ownerWhere(u: SessionUser, ownerId?: string) {
  if (u.role === 'bde') return eq(leads.ownerId, u.id);
  return ownerId ? eq(leads.ownerId, ownerId) : undefined;
}

export const bdRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const detail = async (u: SessionUser, id: string) => {
    const l = await getLead(db, id);
    return { ...(await leadDetail(db, u, l)), bd: await bdBlock(db, l) };
  };

  /** Load a deal the current BDE owns (or Admin), locked, inside a transaction. */
  async function owned(tx: Q, u: SessionUser, id: string, need: 'any' | 'open' | 'notLost' = 'notLost') {
    const l = await getLead(tx, id, true);
    if (l.desk !== 'bd') throw forbidden('This lead is not on the BD desk');
    if (u.role === 'bde' && l.ownerId !== u.id) throw forbidden('Only the BDE who owns this deal can change it');
    if (need !== 'any' && l.lostAt) throw badRequest('This deal is marked lost — reopen it first');
    if (need === 'open' && l.wonAt) throw badRequest('This deal is already won');
    return l;
  }

  async function markWon(tx: Q, u: SessionUser, l: Lead, why: string) {
    const quote = await latestQuote(tx, l.id);
    if (!quote) throw badRequest('A won deal needs a quotation — send one first');
    const won = await stageOfKind(tx, 'bd', 'won');
    await changeStage(tx, l, 'bd', won.id, u.id);
    await tx.update(leads).set({ wonAt: new Date(), contractValue: quote.amount, updatedAt: new Date() }).where(eq(leads.id, l.id));
    l.wonAt = new Date();
    l.contractValue = quote.amount;
    await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'bd', kind: 'won', title: 'Deal won', body: `${money(quote.amount)} on quotation v${quote.version} · ${why}` });
    const admins = await activeAdminIds(tx);
    await notify(tx, [...admins.filter((a) => a !== u.id), l.qualifiedById], {
      kind: 'won',
      leadId: l.id,
      title: `${l.customerName} won`,
      body: `${money(quote.amount)} · ${u.fullName}`,
    });
  }

  /* --------------------------------- lists -------------------------------- */
  app.get<{ Querystring: { ownerId?: string } }>('/deals', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const rows = await db
      .select()
      .from(leads)
      .where(and(eq(leads.desk, 'bd'), ownerWhere(u, req.query.ownerId)))
      .orderBy(desc(leads.updatedAt))
      .limit(2000);
    return { deals: await dealRows(db, rows) };
  });

  app.get<{ Params: { id: string } }>('/deals/:id', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const l = await getLead(db, req.params.id);
    if (l.desk !== 'bd' || (u.role === 'bde' && l.ownerId !== u.id)) throw forbidden('This deal is not on your desk');
    return detail(u, l.id);
  });

  /** Site visits in a date range (YYYY-MM-DD, IST), for the measurement calendar. */
  app.get<{ Querystring: { from?: string; to?: string } }>('/visits', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const from = req.query.from ? new Date(req.query.from + 'T00:00:00+05:30') : new Date(Date.now() - 7 * 864e5);
    const to = req.query.to ? new Date(req.query.to + 'T23:59:59+05:30') : new Date(Date.now() + 30 * 864e5);
    const rows = await db
      .select({ v: siteVisits, l: { id: leads.id, customerName: leads.customerName, place: leads.place } })
      .from(siteVisits)
      .innerJoin(leads, eq(leads.id, siteVisits.leadId))
      .where(and(eq(leads.desk, 'bd'), ownerWhere(u), gte(siteVisits.scheduledAt, from), lte(siteVisits.scheduledAt, to), sql`${siteVisits.status} <> 'cancelled'`))
      .orderBy(asc(siteVisits.scheduledAt));
    const names = await namesOf(db, rows.map((r) => r.v.engineerId));
    return {
      visits: rows.map(({ v, l }) => ({
        id: v.id,
        leadId: l.id,
        customerName: l.customerName,
        place: l.place,
        scheduledAt: v.scheduledAt,
        status: v.status,
        engineer: v.engineerId ? (names.get(v.engineerId) ?? '—') : (v.engineerName ?? '—'),
        note: v.note,
      })),
    };
  });

  /** Won deals with their payment rows, for the balance ledger. */
  app.get('/payments', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const won = await db
      .select()
      .from(leads)
      .where(and(eq(leads.desk, 'bd'), ownerWhere(u), isNotNull(leads.wonAt), isNull(leads.lostAt)))
      .orderBy(desc(leads.wonAt));
    const ids = won.map((w) => w.id);
    const pays = ids.length ? await db.select().from(payments).where(inArray(payments.leadId, ids)).orderBy(asc(payments.receivedOn), asc(payments.id)) : [];
    return {
      deals: won.map((l) => {
        const ps = pays.filter((p) => p.leadId === l.id);
        const paid = ps.reduce((a, p) => a + p.amount, 0);
        return {
          id: l.id,
          customerName: l.customerName,
          contactName: l.contactName,
          phone: l.phone,
          place: l.place,
          contractValue: l.contractValue ?? 0,
          productionDate: l.productionDate,
          wonAt: l.wonAt,
          paid,
          balance: Math.max(0, (l.contractValue ?? 0) - paid),
          payments: ps.map((p) => ({ id: p.id, kind: p.kind, amount: p.amount, receivedOn: p.receivedOn, mode: p.mode, reference: p.reference })),
        };
      }),
    };
  });

  /** Every private note this BDE has written, with the deal it's on. */
  app.get('/notes', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const rows = await db
      .select({ n: notes, l: { id: leads.id, customerName: leads.customerName } })
      .from(notes)
      .innerJoin(leads, eq(leads.id, notes.leadId))
      .where(and(eq(notes.authorId, u.id), eq(notes.scope, u.role === 'admin' ? 'admin' : 'bd')))
      .orderBy(desc(notes.pinned), desc(notes.createdAt))
      .limit(500);
    return { notes: rows.map(({ n, l }) => ({ id: n.id, text: n.text, color: n.color, pinned: n.pinned, createdAt: n.createdAt, leadId: l.id, customerName: l.customerName })) };
  });

  /* --------------------------------- stage -------------------------------- */
  app.post<{ Params: { id: string } }>('/deals/:id/stage', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const { stageId } = parse(bdStageInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const to = await getStage(tx, stageId);
      if (to.desk !== 'bd') throw badRequest('Pick a BD stage');
      if (to.kind === 'lost') throw badRequest('Use Mark lost — a reason is required');
      if (to.id === l.bdStageId) return;
      if (to.requiresQuotation && !(await latestQuote(tx, l.id))) throw badRequest(`Send a quotation before moving it to ${to.name}`);

      if (to.kind === 'won') return markWon(tx, u, l, 'stage set to Won');

      if (l.wonAt) {
        if ((await paidSoFar(tx, l.id)) > 0) throw badRequest('Payments are recorded on this deal — it stays Won');
        await tx.update(leads).set({ wonAt: null, contractValue: null }).where(eq(leads.id, l.id));
      }
      const from = l.bdStageId ? await getStage(tx, l.bdStageId).catch(() => null) : null;
      await changeStage(tx, l, 'bd', to.id, u.id);
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'bd', kind: 'stage', title: `Stage moved to ${to.name}`, body: from ? `Was ${from.name}` : null });
      await notifyWatchers(tx, l.id, `${l.customerName} moved to ${to.name}`, undefined, u.id);
    });
    return detail(u, req.params.id);
  });

  /* ------------------------------ site visits ----------------------------- */
  /** Book a measurement. If one is already booked, this reschedules it. */
  app.post<{ Params: { id: string } }>('/deals/:id/visits', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const input = parse(visitInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      let engineerId: string | null = null;
      let engineerName: string | null = input.engineerName?.trim() || null;
      if (input.engineerId) {
        const e = await employeeById(tx, input.engineerId);
        if (!e || !e.active) throw badRequest('Pick an active person to measure');
        engineerId = e.id;
        engineerName = null;
      }
      if (!engineerId && !engineerName) engineerId = u.role === 'bde' ? u.id : (l.ownerId ?? u.id);
      const when = new Date(input.scheduledAt);
      const [booked] = await tx.select().from(siteVisits).where(and(eq(siteVisits.leadId, l.id), eq(siteVisits.status, 'booked')));
      if (booked) {
        await tx.update(siteVisits).set({ scheduledAt: when, engineerId, engineerName, note: input.note || null }).where(eq(siteVisits.id, booked.id));
      } else {
        await tx.insert(siteVisits).values({ leadId: l.id, scheduledAt: when, engineerId, engineerName, note: input.note || null, createdById: u.id });
      }
      const who = engineerId ? ((await employeeById(tx, engineerId))?.fullName ?? '—') : engineerName!;
      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'bd',
        kind: 'visit',
        title: `Site measurement ${booked ? 'moved to' : 'booked for'} ${ist(when)}`,
        body: who + (input.note ? ` — ${input.note}` : ''),
      });
      await notify(tx, [l.qualifiedById, engineerId && engineerId !== u.id ? engineerId : null], {
        kind: 'visit',
        leadId: l.id,
        title: `Site measurement for ${l.customerName} on ${ist(when)}`,
        body: `${who} on site`,
      });
    });
    return detail(u, req.params.id);
  });

  app.post<{ Params: { id: string; visitId: string }; Body: { status?: string } }>('/deals/:id/visits/:visitId', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const status = req.body?.status;
    if (status !== 'done' && status !== 'cancelled') throw badRequest('Status must be done or cancelled');
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const [v] = await tx.select().from(siteVisits).where(and(eq(siteVisits.id, Number(req.params.visitId)), eq(siteVisits.leadId, l.id)));
      if (!v) throw notFound('Visit not found');
      if (v.status !== 'booked') throw badRequest('That visit is already closed');
      await tx.update(siteVisits).set({ status, doneAt: status === 'done' ? new Date() : null }).where(eq(siteVisits.id, v.id));
      if (status === 'done') {
        const next = await advanceOffFirst(tx, l, u.id);
        await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'bd', kind: 'visit', title: 'Site measured', body: next ? `Moved to ${next.name}` : null });
      } else {
        await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'bd', kind: 'visit', title: 'Site measurement cancelled' });
      }
    });
    return detail(u, req.params.id);
  });

  /* ---------------------------------- CAD --------------------------------- */
  app.post<{ Params: { id: string } }>('/deals/:id/cad', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const input = parse(cadInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      const [a] = await tx.select().from(attachments).where(and(eq(attachments.id, input.attachmentId), eq(attachments.leadId, l.id), isNull(attachments.deletedAt)));
      if (!a || a.kind !== 'cad') throw badRequest('Upload the drawing first');
      const [used] = await tx.select({ id: cadRevisions.id }).from(cadRevisions).where(eq(cadRevisions.attachmentId, a.id));
      if (used) throw conflict('That drawing is already on the record');
      const [m] = await tx.select({ rev: max(cadRevisions.rev) }).from(cadRevisions).where(eq(cadRevisions.leadId, l.id));
      const rev = (m?.rev ?? 0) + 1;
      await tx.insert(cadRevisions).values({ leadId: l.id, rev, attachmentId: a.id, note: input.note || null, byId: u.id });
      const next = await advanceOffFirst(tx, l, u.id);
      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'bd',
        kind: 'cad',
        title: `CAD rev ${rev} uploaded`,
        body: [a.fileName, input.note, next ? `moved to ${next.name}` : null].filter(Boolean).join(' · '),
      });
    });
    return detail(u, req.params.id);
  });

  /* ------------------------------- quotations ----------------------------- */
  app.post<{ Params: { id: string } }>('/deals/:id/quotations', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const input = parse(quotationInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id, 'open');
      if (input.attachmentId) {
        const [a] = await tx.select().from(attachments).where(and(eq(attachments.id, input.attachmentId), eq(attachments.leadId, l.id), isNull(attachments.deletedAt)));
        if (!a || a.kind !== 'quotation') throw badRequest('Upload the quotation file first');
        const [used] = await tx.select({ id: quotations.id }).from(quotations).where(eq(quotations.attachmentId, a.id));
        if (used) throw conflict('That file is already attached to another quotation');
      }
      const prev = await tx.select().from(quotations).where(eq(quotations.leadId, l.id)).orderBy(asc(quotations.version));
      const highest = Math.max(0, ...prev.map((p) => p.amount));
      let discountNote = '';
      if (highest && input.amount < highest) {
        const pct = ((highest - input.amount) / highest) * 100;
        const threshold = Number(await setting(tx, 'discount_threshold_pct', 8));
        if (pct > threshold + 0.005) {
          const [ok] = await tx
            .select()
            .from(discountRequests)
            .where(and(eq(discountRequests.leadId, l.id), eq(discountRequests.status, 'approved'), gte(discountRequests.percent, (pct - 0.005).toFixed(2))));
          if (!ok)
            throw badRequest(
              `That's ${pct.toFixed(1)}% below the highest quotation (${money(highest)}) — past your ${threshold}% limit. Request Admin approval first.`,
            );
          discountNote = ` · ${pct.toFixed(1)}% discount, approved`;
        }
      }
      const version = (prev[prev.length - 1]?.version ?? 0) + 1;
      await tx.insert(quotations).values({ leadId: l.id, version, amount: input.amount, attachmentId: input.attachmentId ?? null, note: input.note || null, byId: u.id });

      // First quotation: move up to the first stage that needs one (e.g. "Quotation sent").
      const all = await bdStages(tx);
      const cur = all.find((s) => s.id === l.bdStageId);
      const target = all.find((s) => s.kind === 'working' && s.requiresQuotation);
      let moved: Stage | null = null;
      if (cur && target && cur.position < target.position) {
        await changeStage(tx, l, 'bd', target.id, u.id);
        moved = target;
      }
      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'bd',
        kind: 'quotation',
        title: `Quotation v${version} sent · ${money(input.amount)}`,
        body: [input.note, moved ? `moved to ${moved.name}` : null].filter(Boolean).join(' · ') + discountNote || null,
      });
      await notifyWatchers(tx, l.id, `${l.customerName}: quotation v${version} ${money(input.amount)}`, undefined, u.id);
    });
    return detail(u, req.params.id);
  });

  /* -------------------------------- discounts ----------------------------- */
  app.post<{ Params: { id: string } }>('/deals/:id/discounts', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const input = parse(discountInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id, 'open');
      const threshold = Number(await setting(tx, 'discount_threshold_pct', 8));
      if (input.percent <= threshold) throw badRequest(`${input.percent}% is within your ${threshold}% limit — no approval needed`);
      const quote = await latestQuote(tx, l.id);
      if (!quote) throw badRequest('Send a quotation before asking for a discount');
      const [open] = await tx.select({ id: discountRequests.id }).from(discountRequests).where(and(eq(discountRequests.leadId, l.id), eq(discountRequests.status, 'pending')));
      if (open) throw conflict('A discount request is already waiting on Admin');
      const prev = await tx.select({ m: max(quotations.amount) }).from(quotations).where(eq(quotations.leadId, l.id));
      const base = prev[0]?.m ?? quote.amount;
      const proposed = Math.round(base * (1 - input.percent / 100));
      await tx.insert(discountRequests).values({
        leadId: l.id,
        quotationId: quote.id,
        percent: input.percent.toFixed(2),
        proposedAmount: proposed,
        reason: input.reason,
        requestedById: u.id,
      });
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'bd', kind: 'discount', title: `Asked Admin for ${input.percent}% off`, body: `${money(proposed)} · ${input.reason}` });
      await notify(tx, await activeAdminIds(tx), {
        kind: 'discount',
        leadId: l.id,
        title: `${u.fullName} asks for ${input.percent}% off ${l.customerName}`,
        body: `${money(base)} → ${money(proposed)} · ${input.reason}`,
      });
    });
    return detail(u, req.params.id);
  });

  /** Admin: pending (or decided) discount requests across the desk. */
  app.get<{ Querystring: { status?: string } }>('/discounts', async (req) => {
    requireRole(req, 'admin');
    const status = (['pending', 'approved', 'rejected'] as const).find((s) => s === req.query.status) ?? 'pending';
    const rows = await db
      .select({ d: discountRequests, l: { id: leads.id, customerName: leads.customerName, place: leads.place } })
      .from(discountRequests)
      .innerJoin(leads, eq(leads.id, discountRequests.leadId))
      .where(eq(discountRequests.status, status))
      .orderBy(desc(discountRequests.createdAt))
      .limit(200);
    const names = await namesOf(db, rows.flatMap((r) => [r.d.requestedById, r.d.decidedById]));
    const ids = [...new Set(rows.map((r) => r.l.id))];
    const qs = ids.length ? await db.select().from(quotations).where(inArray(quotations.leadId, ids)) : [];
    return {
      threshold: Number(await setting(db, 'discount_threshold_pct', 8)),
      requests: rows.map(({ d, l }) => {
        const mine = qs.filter((q) => q.leadId === l.id);
        return {
          id: d.id,
          leadId: l.id,
          customerName: l.customerName,
          place: l.place,
          percent: Number(d.percent),
          highestQuote: Math.max(0, ...mine.map((q) => q.amount)),
          proposedAmount: d.proposedAmount,
          reason: d.reason,
          status: d.status,
          by: names.get(d.requestedById) ?? '—',
          at: d.createdAt,
          decidedBy: d.decidedById ? (names.get(d.decidedById) ?? '—') : null,
          decisionNote: d.decisionNote,
        };
      }),
    };
  });

  app.post<{ Params: { discountId: string } }>('/discounts/:discountId/decide', async (req) => {
    const admin = requireRole(req, 'admin');
    const input = parse(discountDecisionInput, req.body);
    await db.transaction(async (tx) => {
      const [d] = await tx.select().from(discountRequests).where(eq(discountRequests.id, Number(req.params.discountId))).for('update');
      if (!d) throw notFound('Request not found');
      if (d.status !== 'pending') throw conflict('Another Admin already decided this one');
      const status = input.approve ? 'approved' : 'rejected';
      await tx.update(discountRequests).set({ status, decidedById: admin.id, decidedAt: new Date(), decisionNote: input.note || null }).where(eq(discountRequests.id, d.id));
      const l = await getLead(tx, d.leadId);
      await logActivity(tx, {
        leadId: l.id,
        actorId: admin.id,
        desk: 'bd',
        kind: 'discount',
        title: `${Number(d.percent)}% discount ${status} by ${admin.fullName}`,
        body: input.note || null,
      });
      await notify(tx, [d.requestedById], {
        kind: 'discount',
        leadId: l.id,
        title: `${Number(d.percent)}% off ${l.customerName} ${status}`,
        body: input.note || (input.approve ? 'You can now send the revised quotation.' : null),
      });
    });
    return { ok: true };
  });

  /* -------------------------------- payments ------------------------------ */
  app.post<{ Params: { id: string } }>('/deals/:id/payments', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const input = parse(paymentInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      if (!l.wonAt) {
        if (input.kind !== 'advance') throw badRequest('Record the advance first — it marks the deal won');
        await markWon(tx, u, l, 'advance received');
      }
      const paid = await paidSoFar(tx, l.id);
      const balance = (l.contractValue ?? 0) - paid;
      if (input.amount > balance) throw badRequest(`That's more than the ${money(Math.max(0, balance))} balance`);
      await tx.insert(payments).values({
        leadId: l.id,
        kind: input.kind,
        amount: input.amount,
        receivedOn: input.receivedOn,
        mode: input.mode,
        reference: input.reference || null,
        recordedById: u.id,
      });
      const left = balance - input.amount;
      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'bd',
        kind: 'payment',
        title: `${KIND_LABEL[input.kind]} received — ${money(input.amount)}`,
        body: `${input.mode} on ${istDate(input.receivedOn)}${input.reference ? ` · ref ${input.reference}` : ''}. Balance now ${money(left)}.`,
      });
      if (left === 0) {
        await notify(tx, (await activeAdminIds(tx)).filter((a) => a !== u.id), { kind: 'balance', leadId: l.id, title: `${l.customerName} fully paid`, body: money(l.contractValue ?? 0) });
      }
      await notifyWatchers(tx, l.id, `${l.customerName}: ${KIND_LABEL[input.kind].toLowerCase()} ${money(input.amount)}`, undefined, u.id);
    });
    return detail(u, req.params.id);
  });

  app.put<{ Params: { id: string } }>('/deals/:id/production-date', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const { productionDate } = parse(productionDateInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      if (!l.wonAt) throw badRequest('The production date is set once the deal is won');
      await tx.update(leads).set({ productionDate, updatedAt: new Date() }).where(eq(leads.id, l.id));
      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'bd',
        kind: 'edit',
        title: productionDate ? `Production run set for ${istDate(productionDate)}` : 'Production date cleared',
      });
    });
    return detail(u, req.params.id);
  });

  /* ------------------------------ lost / reopen --------------------------- */
  app.post<{ Params: { id: string } }>('/deals/:id/lost', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const input = parse(lostInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id);
      if (l.wonAt && (await paidSoFar(tx, l.id)) > 0) throw badRequest('Payments are recorded on this deal — it cannot be marked lost');
      const [reason] = await tx.select().from(tags).where(eq(tags.id, input.reasonId));
      if (!reason || reason.scope !== 'bd_lost' || reason.archivedAt) throw badRequest('Pick one of the BD lost reasons');
      const lost = await stageOfKind(tx, 'bd', 'lost');
      await changeStage(tx, l, 'bd', lost.id, u.id);
      await tx
        .update(leads)
        .set({ lostAt: new Date(), lostDesk: 'bd', lostReasonId: reason.id, lostNote: input.note || null, lostById: u.id, wonAt: null, contractValue: null })
        .where(eq(leads.id, l.id));
      await tx.update(siteVisits).set({ status: 'cancelled' }).where(and(eq(siteVisits.leadId, l.id), eq(siteVisits.status, 'booked')));
      await tx.update(discountRequests).set({ status: 'rejected', decisionNote: 'Deal marked lost', decidedAt: new Date() }).where(and(eq(discountRequests.leadId, l.id), eq(discountRequests.status, 'pending')));
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'bd', kind: 'lost', title: `Marked lost · ${reason.name}`, body: input.note || null });
      await notify(tx, [l.qualifiedById], { kind: 'lost', leadId: l.id, title: `${l.customerName} lost on the BD desk`, body: reason.name });
      await notifyWatchers(tx, l.id, `${l.customerName} marked lost`, reason.name, u.id);
    });
    return detail(u, req.params.id);
  });

  app.post<{ Params: { id: string } }>('/deals/:id/reopen', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id, 'any');
      if (!l.lostAt || l.lostDesk !== 'bd') throw badRequest('Only deals lost on the BD desk can be reopened here');
      const [last] = await tx
        .select()
        .from(stageHistory)
        .where(and(eq(stageHistory.leadId, l.id), eq(stageHistory.desk, 'bd'), eq(stageHistory.toStageId, l.bdStageId!)))
        .orderBy(desc(stageHistory.at))
        .limit(1);
      const all = await bdStages(tx);
      let back = all.find((s) => s.id === last?.fromStageId && s.kind === 'working');
      if (!back) back = all.find((s) => s.kind === 'working');
      if (!back) throw badRequest('No working BD stages are set up');
      if (back.requiresQuotation && !(await latestQuote(tx, l.id))) back = all.find((s) => s.kind === 'working')!;
      await changeStage(tx, l, 'bd', back.id, u.id);
      await tx.update(leads).set({ lostAt: null, lostDesk: null, lostReasonId: null, lostNote: null, lostById: null }).where(eq(leads.id, l.id));
      await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'bd', kind: 'reopen', title: `Reopened into ${back.name}` });
      await notifyWatchers(tx, l.id, `${l.customerName} reopened`, undefined, u.id);
    });
    return detail(u, req.params.id);
  });

  /* ---------------------------- call / whatsapp --------------------------- */
  app.post<{ Params: { id: string } }>('/deals/:id/call', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const input = parse(bdCallInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id, 'any');
      const cre = input.to === 'cre' && l.qualifiedById ? await employeeById(tx, l.qualifiedById) : null;
      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'bd',
        kind: 'call',
        title: input.to === 'cre' ? `Call · ${cre?.fullName ?? 'CRE'} (CRE)` : `Call · ${l.contactName || l.customerName}`,
        body: input.summary,
      });
      if (input.to === 'client') await tx.update(leads).set({ lastContactAt: new Date() }).where(eq(leads.id, l.id));
    });
    return detail(u, req.params.id);
  });

  app.post<{ Params: { id: string } }>('/deals/:id/whatsapp', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const input = parse(whatsappLogInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id, 'any');
      const tpl = input.templateId ? (await tx.select().from(messageTemplates).where(eq(messageTemplates.id, input.templateId)))[0] : undefined;
      await logActivity(tx, {
        leadId: l.id,
        actorId: u.id,
        desk: 'bd',
        kind: 'whatsapp',
        title: `WhatsApp opened → ${input.to === 'cre' ? 'the CRE' : 'the client'}`,
        body: tpl ? `Template: ${tpl.title}` : null,
      });
      if (input.to === 'client') await tx.update(leads).set({ lastContactAt: new Date() }).where(eq(leads.id, l.id));
    });
    return { ok: true };
  });

  /* ---------------------------------- tags -------------------------------- */
  app.post<{ Params: { id: string } }>('/deals/:id/tags', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    const { tagId } = parse(tagInput, req.body);
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id, 'any');
      const [t] = await tx.select().from(tags).where(eq(tags.id, tagId));
      if (!t || t.scope !== 'bd' || t.archivedAt) throw badRequest("That isn't one of the BD tags Admin issued");
      const r = await tx.insert(leadTags).values({ leadId: l.id, tagId, addedById: u.id }).onConflictDoNothing().returning();
      if (r.length) await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'bd', kind: 'tag', title: `Tagged ${t.name}` });
    });
    return detail(u, req.params.id);
  });

  app.delete<{ Params: { id: string; tagId: string } }>('/deals/:id/tags/:tagId', async (req) => {
    const u = requireRole(req, 'bde', 'admin');
    await db.transaction(async (tx) => {
      const l = await owned(tx, u, req.params.id, 'any');
      const [t] = await tx.select().from(tags).where(eq(tags.id, Number(req.params.tagId)));
      if (!t || t.scope !== 'bd') throw badRequest('Not a BD tag');
      const r = await tx.delete(leadTags).where(and(eq(leadTags.leadId, l.id), eq(leadTags.tagId, t.id))).returning();
      if (r.length) await logActivity(tx, { leadId: l.id, actorId: u.id, desk: 'bd', kind: 'tag', title: `Tag removed · ${t.name}` });
    });
    return detail(u, req.params.id);
  });

  /** People who can be picked as "engineer on site" (active BDEs). */
  app.get('/engineers', async (req) => {
    requireRole(req, 'bde', 'admin');
    const rows = await db
      .select({ id: employees.id, name: employees.fullName })
      .from(employees)
      .where(and(eq(employees.role, 'bde'), eq(employees.active, true)))
      .orderBy(asc(employees.fullName));
    return { engineers: rows };
  });
};
