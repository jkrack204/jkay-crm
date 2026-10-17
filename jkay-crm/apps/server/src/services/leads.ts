/**
 * The lead rules every desk shares: who can see a lead, how ownership and stages
 * change (always with an owner-log / stage-history row), and the activity log.
 * Every write here runs inside the caller's transaction.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Desk, OwnershipReason, StageKind } from '@jkay/shared';
import type { DB } from '../db/client.js';
import {
  activities,
  adminWatches,
  employees,
  followups,
  leadOwners,
  leads,
  notifications,
  stageHistory,
  stages,
} from '../db/schema.js';
import type { SessionUser } from '../auth/session.js';
import { badRequest, forbidden, notFound } from '../http.js';

export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type Q = DB | Tx;
export type Lead = typeof leads.$inferSelect;
export type Stage = typeof stages.$inferSelect;

/* ------------------------------- stages -------------------------------- */
export async function stageOfKind(q: Q, desk: Desk, kind: Exclude<StageKind, 'working'>): Promise<Stage> {
  const [s] = await q
    .select()
    .from(stages)
    .where(and(eq(stages.desk, desk), eq(stages.kind, kind), isNull(stages.archivedAt)));
  if (!s) throw badRequest(`No "${kind}" stage is set up on the ${desk.toUpperCase()} desk — ask an Admin`);
  return s;
}

export async function firstWorkingStage(q: Q, desk: Desk): Promise<Stage> {
  const [s] = await q
    .select()
    .from(stages)
    .where(and(eq(stages.desk, desk), eq(stages.kind, 'working'), isNull(stages.archivedAt)))
    .orderBy(asc(stages.position))
    .limit(1);
  if (!s) throw badRequest(`No working stages are set up on the ${desk.toUpperCase()} desk — ask an Admin`);
  return s;
}

export async function getStage(q: Q, id: number): Promise<Stage> {
  const [s] = await q.select().from(stages).where(eq(stages.id, id));
  if (!s || s.archivedAt) throw badRequest('That stage no longer exists');
  return s;
}

/* -------------------------------- access ------------------------------- */
export async function getLead(q: Q, id: string, lock = false): Promise<Lead> {
  const base = q.select().from(leads).where(eq(leads.id, id));
  const [l] = lock ? await base.for('update') : await base;
  if (!l) throw notFound('Lead not found');
  return l;
}

/** What a CRE may see: the pool, their own leads, leads they handed to BD, their lost leads. */
export async function creCanView(q: Q, u: SessionUser, l: Lead): Promise<boolean> {
  if (l.ownerId === u.id && l.desk === 'cre') return true;
  if (l.qualifiedById === u.id) return true;
  if (l.desk === 'cre' && l.ownerId === null && !l.lostAt) {
    const pool = await stageOfKind(q, 'cre', 'pool');
    return l.creStageId === pool.id;
  }
  return false;
}

export async function assertCanView(q: Q, u: SessionUser, l: Lead) {
  if (u.role === 'admin') return;
  if (u.role === 'bde' && l.desk === 'bd' && l.ownerId === u.id) return;
  if (u.role === 'cre' && (await creCanView(q, u, l))) return;
  throw forbidden('This lead is not on your desk');
}

/** A CRE can only change a lead they own that is still open on the CRE desk. */
export function assertCreOwnsOpen(u: SessionUser, l: Lead) {
  if (u.role !== 'cre' && u.role !== 'admin') throw forbidden();
  if (l.desk !== 'cre' || l.lostAt) throw forbidden('This lead is no longer open on the CRE desk');
  if (u.role === 'cre' && l.ownerId !== u.id) throw forbidden('Only the CRE who owns this lead can change it');
}

/* ------------------------------ activity ------------------------------- */
export async function logActivity(
  q: Q,
  a: { leadId: string; actorId: string | null; desk: Desk | null; kind: string; title: string; body?: string | null; meta?: Record<string, unknown> },
) {
  await q.insert(activities).values({ ...a, body: a.body ?? null });
}

/* ----------------------------- notifications --------------------------- */
export async function notify(
  q: Q,
  recipientIds: (string | null | undefined)[],
  n: { kind: string; leadId?: string | null; title: string; body?: string | null; viaWatch?: boolean },
) {
  const ids = [...new Set(recipientIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await q.insert(notifications).values(ids.map((recipientId) => ({ recipientId, ...n, leadId: n.leadId ?? null, body: n.body ?? null })));
}

/** Admins who pressed "Notify me" on this lead hear about every move. */
export async function notifyWatchers(q: Q, leadId: string, title: string, body?: string, exceptId?: string) {
  const rows = await q.select({ id: adminWatches.adminId }).from(adminWatches).where(eq(adminWatches.leadId, leadId));
  await notify(q, rows.map((r) => (r.id === exceptId ? null : r.id)), { kind: 'move', leadId, title, body, viaWatch: true });
}

export async function activeAdminIds(q: Q): Promise<string[]> {
  const rows = await q
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.role, 'admin'), eq(employees.active, true)));
  return rows.map((r) => r.id);
}

/* ------------------------------ ownership ------------------------------ */
/**
 * Moves ownership and writes the owner log: closes the open stint, opens a new one.
 * ownerId null = back in the unclaimed pool.
 */
export async function changeOwner(
  q: Q,
  lead: Lead,
  next: { ownerId: string | null; desk: Desk; reason: OwnershipReason; byId: string | null; note?: string | null },
) {
  const now = new Date();
  await q
    .update(leadOwners)
    .set({ endedAt: now })
    .where(and(eq(leadOwners.leadId, lead.id), isNull(leadOwners.endedAt)));
  await q.insert(leadOwners).values({
    leadId: lead.id,
    ownerId: next.ownerId,
    desk: next.desk,
    reason: next.reason,
    byId: next.byId,
    note: next.note ?? null,
    startedAt: now,
  });
  await q.update(leads).set({ ownerId: next.ownerId, ownerSince: now, updatedAt: now }).where(eq(leads.id, lead.id));
  lead.ownerId = next.ownerId;
  lead.ownerSince = now;
}

/* -------------------------------- stages ------------------------------- */
export async function changeStage(q: Q, lead: Lead, desk: Desk, toStageId: number, byId: string | null) {
  const from = desk === 'cre' ? lead.creStageId : lead.bdStageId;
  if (from === toStageId) return false;
  await q.insert(stageHistory).values({ leadId: lead.id, desk, fromStageId: from, toStageId, byId });
  const patch = desk === 'cre' ? { creStageId: toStageId } : { bdStageId: toStageId };
  await q.update(leads).set({ ...patch, updatedAt: new Date() }).where(eq(leads.id, lead.id));
  if (desk === 'cre') lead.creStageId = toStageId;
  else lead.bdStageId = toStageId;
  return true;
}

/* ------------------------------ follow-ups ----------------------------- */
export async function closeOpenFollowup(q: Q, leadId: string, status: 'done' | 'cancelled' = 'cancelled') {
  await q
    .update(followups)
    .set({ status, closedAt: new Date() })
    .where(and(eq(followups.leadId, leadId), eq(followups.status, 'open')));
  await q.update(leads).set({ nextFollowupAt: null }).where(eq(leads.id, leadId));
}

export async function setFollowup(q: Q, lead: Lead, ownerId: string, dueAt: Date, note: string | null, byId: string) {
  if (dueAt.getTime() < Date.now() - 5 * 60 * 1000) throw badRequest('The follop time is in the past');
  await closeOpenFollowup(q, lead.id, 'done');
  await q.insert(followups).values({ leadId: lead.id, ownerId, dueAt, note, createdById: byId });
  await q.update(leads).set({ nextFollowupAt: dueAt }).where(eq(leads.id, lead.id));
}

/** Move the open follow-up to the new owner when a lead is transferred. */
export async function reassignFollowup(q: Q, leadId: string, ownerId: string) {
  await q
    .update(followups)
    .set({ ownerId })
    .where(and(eq(followups.leadId, leadId), eq(followups.status, 'open')));
}

/* ------------------------------- helpers ------------------------------- */
export async function employeeById(q: Q, id: string) {
  const [e] = await q.select().from(employees).where(eq(employees.id, id));
  return e ?? null;
}

export async function namesOf(q: Q, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await q.select({ id: employees.id, name: employees.fullName }).from(employees).where(inArray(employees.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const touch = (q: Q, leadId: string) => q.update(leads).set({ updatedAt: sql`now()` }).where(eq(leads.id, leadId));
