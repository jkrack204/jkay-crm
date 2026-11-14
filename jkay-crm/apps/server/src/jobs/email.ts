/**
 * Alert emails. Every minute, bell notifications of the kinds below that haven't
 * been emailed yet are grouped per person into ONE email and sent through Resend.
 *
 * Switched off (nothing is sent, nothing is marked) until RESEND_API_KEY is set,
 * which needs JK Racks' sending domain verified in Resend first. Only notifications
 * from the last EMAIL_WINDOW_HOURS are sent, so turning email on later doesn't
 * flood inboxes with old alerts.
 */
import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { Env } from '../env.js';
import type { Q } from '../services/leads.js';
import { employees, leads, notifications } from '../db/schema.js';
import { hoursAgo, whenLabel } from './time.js';

/** Kinds worth an email. The first follop ping, watch moves, wins and losses stay in the bell. */
export const EMAIL_KINDS = ['repeat', 'escalation', 'unclaimed', 'idle', 'quote', 'balance', 'visit', 'handoff', 'transfer', 'discount'] as const;
const EMAIL_WINDOW_HOURS = 2;
/** Resend allows a few requests a second; keep each tick small. */
const MAX_PEOPLE_PER_TICK = 20;

export const emailEnabled = (env: Env) => !!env.RESEND_API_KEY;

export type Mail = { to: string; subject: string; text: string; html: string };
export type Sender = (m: Mail) => Promise<void>;

export function resendSender(env: Env): Sender {
  return async (m) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function buildMail(
  to: { name: string; email: string },
  items: { title: string; body: string | null; customer: string | null; createdAt: Date }[],
  appUrl?: string,
): Mail {
  const head = (i: (typeof items)[number]) => (i.customer ? `${i.customer} · ${i.title}` : i.title);
  const subject = items.length === 1 ? `JK Racks CRM · ${items[0]!.customer ? `${items[0]!.customer} · ` : ''}${items[0]!.title}` : `JK Racks CRM · ${items.length} alerts`;
  const first = to.name.split(' ')[0] ?? to.name;
  const lines = items.map((i) => `• ${head(i)}${i.body ? ` — ${i.body}` : ''} (${whenLabel(i.createdAt)})`);
  const open = appUrl ? `Open the CRM: ${appUrl}` : 'Open the CRM to see the details.';
  const text = `Hi ${first},\n\n${lines.join('\n')}\n\n${open}\n\nYou get these because they need your attention. They're also in the bell inside the CRM.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#1f1e1c;line-height:1.5">
<p>Hi ${esc(first)},</p>
<ul style="padding-left:18px">${items
    .map(
      (i) =>
        `<li style="margin-bottom:8px"><strong>${esc(head(i))}</strong>${i.body ? `<br><span style="color:#5f5c55">${esc(i.body)}</span>` : ''}<br><span style="color:#8a867d;font-size:12px">${esc(whenLabel(i.createdAt))}</span></li>`,
    )
    .join('')}</ul>
<p>${appUrl ? `<a href="${esc(appUrl)}" style="color:#b4532a">Open the CRM</a>` : 'Open the CRM to see the details.'}</p>
<p style="color:#8a867d;font-size:12px">You get these because they need your attention. They're also in the bell inside the CRM.</p></div>`;
  return { to: to.email, subject, text, html };
}

/** Sends what's pending. Returns how many emails went out; failures are left for the next tick. */
export async function sendPendingEmails(q: Q, send: Sender, appUrl: string | undefined, now = new Date(), log?: (e: unknown) => void) {
  const rows = await q
    .select({ n: notifications, customer: leads.customerName, name: employees.fullName, email: employees.email })
    .from(notifications)
    .innerJoin(employees, eq(employees.id, notifications.recipientId))
    .leftJoin(leads, eq(leads.id, notifications.leadId))
    .where(
      and(
        isNull(notifications.emailedAt),
        isNull(notifications.readAt),
        inArray(notifications.kind, [...EMAIL_KINDS]),
        gte(notifications.createdAt, hoursAgo(now, EMAIL_WINDOW_HOURS)),
        eq(employees.active, true),
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(500);

  const byPerson = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.email?.includes('@')) continue;
    const list = byPerson.get(r.n.recipientId) ?? [];
    list.push(r);
    byPerson.set(r.n.recipientId, list);
  }

  let sent = 0;
  for (const list of [...byPerson.values()].slice(0, MAX_PEOPLE_PER_TICK)) {
    const p = list[0]!;
    const mail = buildMail(
      { name: p.name, email: p.email },
      list.map((r) => ({ title: r.n.title, body: r.n.body, customer: r.customer, createdAt: r.n.createdAt })),
      appUrl,
    );
    try {
      await send(mail);
      await q.update(notifications).set({ emailedAt: now }).where(inArray(notifications.id, list.map((r) => r.n.id)));
      sent++;
    } catch (e) {
      log?.(e);
    }
  }
  return sent;
}
