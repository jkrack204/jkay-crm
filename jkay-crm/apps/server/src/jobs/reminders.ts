/**
 * Reminders and escalations. Runs every minute from the scheduler (and directly
 * from tests with a chosen `now`). Every rule is safe to run again and again:
 *
 *   follop    at the follop time → the owner
 *   repeat    not acted on by 10:00 IST the next day → the owner again
 *   escalate  still not acted on 4 hours after the repeat → every Admin (+ owner told)
 *   unclaimed a pool lead nobody has claimed for N hours → Admins (one summary)
 *   idle      an owned, open lead with no contact for N days → owner + Admins (summary)
 *   quote     latest quotation unanswered for N days → the BDE
 *   balance   final balance still due N days before production → BDE + Admins
 *   visit     the morning (08:00 IST) of a booked site visit → BDE + engineer
 *
 * "Acted on" a follop = it was closed or rescheduled, or the client was contacted
 * (call logged / WhatsApp opened) after it fell due.
 *
 * Every alert except the follop chain is recorded in reminder_log under a key that
 * names the exact situation, so it fires once and only fires again when something new happens.
 */
import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { appSettings, employees, followups, leads, quotations, reminderLog, siteVisits, stages } from '../db/schema.js';
import { activeAdminIds, notify, type Q } from '../services/leads.js';
import { addDays, dayLabel, daysAgo, hoursAgo, istAt, istDate, timeLabel, whenLabel } from './time.js';

/** Hours after the repeat before a missed follop goes to Admin. */
export const ESCALATE_AFTER_REPEAT_HOURS = 4;
/** Site-visit-day reminder time (IST). */
const VISIT_REMINDER_AT = '08:00';
/** Lock id shared by every scheduler tick so only one copy of the app runs jobs at a time. */
export const JOBS_LOCK = 7_421_001;

const money = (n: number) => '₹' + n.toLocaleString('en-IN');

export async function settings(q: Q) {
  const rows = await q.select().from(appSettings);
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => (typeof m.get(k) === 'number' ? (m.get(k) as number) : d);
  const repeat = m.get('followup_repeat_time');
  return {
    repeatAt: typeof repeat === 'string' && /^\d{2}:\d{2}$/.test(repeat) ? repeat : '10:00',
    unclaimedHours: num('unclaimed_alert_hours', 24),
    idleDays: num('idle_alert_days', 6),
    quoteDays: num('quote_unanswered_days', 7),
    balanceDays: num('balance_alert_days_before_production', 5),
    cnaEscalateAt: num('cna_escalate_at', 3),
  };
}

/** Records the alert key; true only the first time (so the caller sends it once). */
async function firstTime(q: Q, key: string, leadId: string | null) {
  const r = await q.insert(reminderLog).values({ key, leadId }).onConflictDoNothing().returning({ key: reminderLog.key });
  return r.length > 0;
}

const summary = (names: string[]) => (names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`);

export type ReminderCounts = Record<'followup' | 'repeat' | 'escalation' | 'unclaimed' | 'idle' | 'quote' | 'balance' | 'visit', number>;

export async function runReminders(q: Q, now = new Date()): Promise<ReminderCounts> {
  const c: ReminderCounts = { followup: 0, repeat: 0, escalation: 0, unclaimed: 0, idle: 0, quote: 0, balance: 0, visit: 0 };
  const cfg = await settings(q);
  const admins = await activeAdminIds(q);
  const stageRows = await q.select().from(stages);
  const ids = (desk: 'cre' | 'bd', kind: string) => stageRows.filter((s) => s.desk === desk && s.kind === kind).map((s) => s.id);
  const creWorking = ids('cre', 'working');
  const bdWorking = ids('bd', 'working');
  const pool = ids('cre', 'pool');
  const won = ids('bd', 'won');
  const today = istDate(now);

  /* ------------------------- follop → repeat → escalate ------------------------- */
  const due = await q
    .select({ f: followups, name: leads.customerName, lastContactAt: leads.lastContactAt, ownerName: employees.fullName })
    .from(followups)
    .innerJoin(leads, eq(leads.id, followups.leadId))
    .innerJoin(employees, eq(employees.id, followups.ownerId))
    .where(and(eq(followups.status, 'open'), lte(followups.dueAt, now), isNull(followups.escalatedAt), eq(leads.desk, 'cre'), isNull(leads.lostAt)));

  for (const { f, name, lastContactAt, ownerName } of due) {
    const acted = !!lastContactAt && lastContactAt >= f.dueAt;
    if (!f.remindedAt) {
      await notify(q, [f.ownerId], { kind: 'followup', leadId: f.leadId, title: `Follop due at ${timeLabel(f.dueAt)}`, body: f.note ?? null });
      await q.update(followups).set({ remindedAt: now }).where(eq(followups.id, f.id));
      c.followup++;
      continue;
    }
    if (acted) continue;
    const repeatAt = istAt(addDays(istDate(f.dueAt), 1), cfg.repeatAt);
    if (!f.repeatedAt) {
      if (now < repeatAt) continue;
      await notify(q, [f.ownerId], {
        kind: 'repeat',
        leadId: f.leadId,
        title: 'Repeat reminder',
        body: `The follop from ${whenLabel(f.dueAt)} hasn't been acted on. Admin is alerted if this one is missed too.`,
      });
      await q.update(followups).set({ repeatedAt: now }).where(eq(followups.id, f.id));
      c.repeat++;
      continue;
    }
    if (now.getTime() - f.repeatedAt.getTime() < ESCALATE_AFTER_REPEAT_HOURS * 3600_000) continue;
    await notify(q, admins, {
      kind: 'escalation',
      leadId: f.leadId,
      title: 'Missed follop',
      body: `${ownerName} didn't act on the follop due ${whenLabel(f.dueAt)} or its repeat.`,
    });
    await notify(q, [f.ownerId], { kind: 'escalation', leadId: f.leadId, title: 'Admin alerted', body: 'The follop and its repeat were both missed.' });
    await q.update(followups).set({ escalatedAt: now }).where(eq(followups.id, f.id));
    c.escalation++;
  }

  /* --------------------------------- unclaimed --------------------------------- */
  if (pool.length && admins.length) {
    const cutoff = hoursAgo(now, cfg.unclaimedHours);
    const rows = await q
      .select({ id: leads.id, name: leads.customerName, since: sql<Date>`coalesce(${leads.ownerSince}, ${leads.createdAt})`.mapWith(leads.createdAt) })
      .from(leads)
      .where(and(eq(leads.desk, 'cre'), isNull(leads.ownerId), isNull(leads.lostAt), inArray(leads.creStageId, pool), sql`coalesce(${leads.ownerSince}, ${leads.createdAt}) <= ${cutoff.toISOString()}::timestamptz`))
      .orderBy(leads.createdAt);
    const fresh: typeof rows = [];
    for (const r of rows) if (await firstTime(q, `unclaimed:${r.id}:${r.since.toISOString()}`, r.id)) fresh.push(r);
    if (fresh.length) {
      await notify(q, admins, {
        kind: 'unclaimed',
        leadId: fresh.length === 1 ? fresh[0]!.id : null,
        title: fresh.length === 1 ? `Unclaimed for ${cfg.unclaimedHours}h+` : `${fresh.length} leads unclaimed for ${cfg.unclaimedHours}h+`,
        body: fresh.length === 1 ? 'Still in the pool — no CRE has picked it up.' : summary(fresh.map((r) => r.name)),
      });
      c.unclaimed += fresh.length;
    }
  }

  /* ----------------------------------- idle ----------------------------------- */
  {
    const cutoff = daysAgo(now, cfg.idleDays);
    const last = sql`greatest(coalesce(${leads.lastContactAt}, '-infinity'::timestamptz), coalesce(${leads.ownerSince}, ${leads.createdAt}))`;
    const openStage = sql`((${leads.desk} = 'cre' and ${leads.creStageId} in ${creWorking.length ? creWorking : [-1]})
                       or (${leads.desk} = 'bd' and ${leads.bdStageId} in ${bdWorking.length ? bdWorking : [-1]}))`;
    const rows = await q
      .select({ id: leads.id, name: leads.customerName, ownerId: leads.ownerId, ownerName: employees.fullName, last: sql<Date>`${last}`.mapWith(leads.createdAt) })
      .from(leads)
      .innerJoin(employees, eq(employees.id, leads.ownerId))
      .where(and(isNull(leads.lostAt), isNotNull(leads.ownerId), openStage, sql`${last} <= ${cutoff.toISOString()}::timestamptz`));
    const fresh: typeof rows = [];
    for (const r of rows) if (await firstTime(q, `idle:${r.id}:${r.last.toISOString()}`, r.id)) fresh.push(r);
    for (const r of fresh)
      await notify(q, [r.ownerId], { kind: 'idle', leadId: r.id, title: `No contact for ${cfg.idleDays} days`, body: 'Call or message the client to keep it moving.' });
    if (fresh.length)
      await notify(q, admins, {
        kind: 'idle',
        leadId: fresh.length === 1 ? fresh[0]!.id : null,
        title: fresh.length === 1 ? `No contact for ${cfg.idleDays} days` : `${fresh.length} leads with no contact for ${cfg.idleDays}+ days`,
        body: fresh.length === 1 ? fresh[0]!.ownerName : summary(fresh.map((r) => `${r.name} (${r.ownerName})`)),
      });
    c.idle += fresh.length;
  }

  /* ----------------------------- quote unanswered ----------------------------- */
  if (bdWorking.length) {
    const latest = await q
      .selectDistinctOn([quotations.leadId], { q: quotations, name: leads.customerName, ownerId: leads.ownerId, lastContactAt: leads.lastContactAt })
      .from(quotations)
      .innerJoin(leads, eq(leads.id, quotations.leadId))
      .where(and(eq(leads.desk, 'bd'), isNull(leads.lostAt), inArray(leads.bdStageId, bdWorking)))
      .orderBy(quotations.leadId, desc(quotations.version));
    const cutoff = daysAgo(now, cfg.quoteDays);
    for (const r of latest) {
      if (r.q.createdAt > cutoff || (r.lastContactAt && r.lastContactAt > r.q.createdAt) || !r.ownerId) continue;
      if (!(await firstTime(q, `quote:${r.q.id}`, r.q.leadId))) continue;
      await notify(q, [r.ownerId], {
        kind: 'quote',
        leadId: r.q.leadId,
        title: `Quotation v${r.q.version} unanswered for ${cfg.quoteDays} days`,
        body: `Sent ${dayLabel(istDate(r.q.createdAt))}, no client contact logged since.`,
      });
      c.quote++;
    }
  }

  /* ------------------------ final balance before production ------------------------ */
  if (won.length) {
    const rows = await q
      .select({
        id: leads.id,
        name: leads.customerName,
        ownerId: leads.ownerId,
        value: leads.contractValue,
        productionDate: leads.productionDate,
        paid: sql<number>`coalesce((select sum(p.amount) from payments p where p.lead_id = "leads"."id"), 0)`.mapWith(Number),
      })
      .from(leads)
      .where(and(eq(leads.desk, 'bd'), inArray(leads.bdStageId, won), isNotNull(leads.productionDate), lte(leads.productionDate, addDays(today, cfg.balanceDays))));
    for (const r of rows) {
      const balance = (r.value ?? 0) - r.paid;
      if (balance <= 0 || !r.productionDate) continue;
      if (!(await firstTime(q, `balance:${r.id}:${r.productionDate}`, r.id))) continue;
      await notify(q, [r.ownerId, ...admins], {
        kind: 'balance',
        leadId: r.id,
        title: 'Final balance due',
        body: `${money(balance)} still to collect · production ${dayLabel(r.productionDate)}`,
      });
      c.balance++;
    }
  }

  /* -------------------------------- visit day -------------------------------- */
  if (now >= istAt(today, VISIT_REMINDER_AT)) {
    const rows = await q
      .select({ v: siteVisits, name: leads.customerName, place: leads.place, ownerId: leads.ownerId })
      .from(siteVisits)
      .innerJoin(leads, eq(leads.id, siteVisits.leadId))
      .where(and(eq(siteVisits.status, 'booked'), sql`(${siteVisits.scheduledAt} at time zone 'Asia/Kolkata')::date = ${today}::date`, isNull(leads.lostAt)));
    for (const r of rows) {
      if (now > r.v.scheduledAt) continue;
      if (!(await firstTime(q, `visit:${r.v.id}:${r.v.scheduledAt.toISOString()}`, r.v.leadId))) continue;
      await notify(q, [r.ownerId, r.v.engineerId], {
        kind: 'visit',
        leadId: r.v.leadId,
        title: `Site visit today at ${timeLabel(r.v.scheduledAt)}`,
        body: [r.place, r.v.engineerName ? `${r.v.engineerName} on site` : null].filter(Boolean).join(' · ') || null,
      });
      c.visit++;
    }
  }

  return c;
}

/** "Call Not Attend - 3" → 3 */
export const cnaStep = (tagName: string) => {
  const m = /call not attend\D*(\d+)/i.exec(tagName);
  return m ? Number(m[1]) : 0;
};

/** One tick: all reminders in one transaction, skipped if another copy of the app holds the lock. */
export async function reminderTick(db: DB, now = new Date()) {
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${JOBS_LOCK}) as ok`);
    if (!lock?.ok) return null;
    return runReminders(tx, now);
  });
}
