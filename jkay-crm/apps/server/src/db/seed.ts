/**
 * First-run defaults, taken from the mockups. Safe to run more than once:
 * each block only inserts when its table is empty.
 *
 * To also create the first Admin, set:
 *   SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME, SEED_ADMIN_EMAIL
 */
import { count, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { PLATFORMS, passwordSchema, usernameSchema } from '@jkay/shared';
import { hashPassword } from '../auth/password.js';
import { createDb } from './client.js';
import * as s from './schema.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const { db, sql } = createDb(url);

const isEmpty = async (table: PgTable) => {
  const [row] = await db.select({ n: count() }).from(table);
  return (row?.n ?? 0) === 0;
};

/* ------------------------------- stages -------------------------------- */
if (await isEmpty(s.stages)) {
  await db.insert(s.stages).values([
    { desk: 'cre', kind: 'pool', position: 1, name: 'Unclaimed pool', definition: 'Fresh lead nobody has claimed yet — sits in the shared pool until a CRE picks it up.' },
    { desk: 'cre', kind: 'working', position: 2, name: 'New', definition: 'Claimed by a CRE. First contact with the customer not made yet.' },
    { desk: 'cre', kind: 'working', position: 3, name: 'Follop', definition: 'In the call / follow-up cycle — chasing the customer for a decision or missing details.', requiresFollowup: true, requiresStageTag: true },
    { desk: 'cre', kind: 'working', position: 4, name: 'Waiting for photos', definition: 'Waiting on the customer to send site photos before the lead can move to BD.', requiresStageTag: true },
    { desk: 'cre', kind: 'handoff', position: 5, name: 'Qualified to BD', definition: "Handed to a BDE. The CRE's work on this lead is complete." },
    { desk: 'cre', kind: 'lost', position: 6, name: 'Lost', definition: 'Closed lost on the CRE desk. A reason is mandatory.' },

    { desk: 'bd', kind: 'working', position: 1, name: 'Site measurement', definition: 'BDE schedules and runs the on-site measurement.' },
    { desk: 'bd', kind: 'working', position: 2, name: 'Plan layout needed', definition: 'CAD layout drawn from the measurements and shared with the customer.' },
    { desk: 'bd', kind: 'working', position: 3, name: 'Quotation sent', definition: 'Priced quotation sent. Order value becomes visible from this stage onward.', showsValue: true, requiresQuotation: true },
    { desk: 'bd', kind: 'working', position: 4, name: 'Negotiation', definition: 'Customer is pushing on price or terms — revisions going back and forth.', showsValue: true, requiresQuotation: true },
    { desk: 'bd', kind: 'working', position: 5, name: 'All okay / awaiting advance', definition: 'Terms agreed. Waiting on the advance payment to release production.', showsValue: true, requiresQuotation: true },
    { desk: 'bd', kind: 'won', position: 6, name: 'Won', definition: 'Advance received and order confirmed.', showsValue: true, requiresQuotation: true },
    { desk: 'bd', kind: 'lost', position: 7, name: 'Lost', definition: 'Closed lost on the BD desk. A reason is mandatory.' },
  ]);
  console.log('Seeded stages');
}

/* -------------------------------- tags --------------------------------- */
if (await isEmpty(s.tags)) {
  const st = await db.select().from(s.stages);
  const follop = st.find((x) => x.desk === 'cre' && x.name === 'Follop')!;
  const photos = st.find((x) => x.desk === 'cre' && x.name === 'Waiting for photos')!;
  type T = typeof s.tags.$inferInsert;
  const list = (scope: T['scope'], items: [string, T['tone']][], stageId?: number): T[] =>
    items.map(([name, tone], i) => ({ scope, name, tone, stageId, position: i }));

  await db.insert(s.tags).values([
    // stage tags (required when entering that stage)
    ...list('cre', [['Follop', 'amber'], ['Long Follop', 'amber'], ['Call Not Attend - 1', 'neutral'], ['Call Not Attend - 2', 'neutral'], ['Call Not Attend - 3', 'red']], follop.id),
    ...list('cre', [['High Ticket', 'green'], ['Medium Ticket', 'blue'], ['Low Ticket', 'neutral'], ['Photos — Call Not Attend - 1', 'neutral'], ['Photos — Call Not Attend - 2', 'neutral'], ['Photos — Call Not Attend - 3', 'red']], photos.id),
    // free desk tags
    ...list('cre', [['Photos promised', 'violet'], ['Decision maker', 'green'], ['Site ready', 'blue'], ['Price sensitive', 'red']]),
    ...list('bd', [['Site visit booked', 'blue'], ['Layout in progress', 'violet'], ['Quote revised', 'amber'], ['Price pressure', 'red'], ['Advance promised', 'green'], ['Customer travelling', 'neutral'], ['High value', 'green'], ['Repeat client', 'blue']]),
    ...list('admin', [['All OK', 'green'], ['Negotiation', 'amber'], ['Competitive', 'red'], ['Follops', 'blue']]),
    ...list('cre_lost', [["Don't pick the call", 'red'], ['Other state', 'neutral'], ['Small requirement', 'neutral'], ['Not our customer', 'neutral'], ['Competitive', 'red']]),
    ...list('bd_lost', [['Price — chose a competitor', 'red'], ['Requirement dropped', 'neutral'], ['Timeline too tight', 'amber'], ['Site not feasible', 'neutral'], ['Went silent after quote', 'violet'], ['Budget not approved', 'amber']]),
  ]);
  console.log('Seeded tags');
}

/* ------------------------------ categories ----------------------------- */
if (await isEmpty(s.categories)) {
  await db.insert(s.categories).values([{ name: 'Standard', position: 1 }, { name: 'Fancy', position: 2 }, { name: 'Sports', position: 3 }]);
  console.log('Seeded categories');
}

/* ------------------------------- settings ------------------------------ */
if (await isEmpty(s.appSettings)) {
  await db.insert(s.appSettings).values([
    { key: 'discount_threshold_pct', value: 8 },
    { key: 'followup_repeat_time', value: '10:00' }, // repeat next morning if not acted on
    { key: 'unclaimed_alert_hours', value: 24 },
    { key: 'idle_alert_days', value: 6 },
    { key: 'quote_unanswered_days', value: 7 },
    { key: 'balance_alert_days_before_production', value: 5 },
    { key: 'cna_escalate_at', value: 3 },
    { key: 'source_sync_minutes', value: 15 },
  ]);
  console.log('Seeded settings');
}

/* ------------------------------ lead sources --------------------------- */
if (await isEmpty(s.leadSources)) {
  await db.insert(s.leadSources).values(PLATFORMS.map((platform) => ({ platform, enabled: platform === 'walkin' })));
  console.log('Seeded lead sources');
}

/* ------------------------------- templates ----------------------------- */
if (await isEmpty(s.messageTemplates)) {
  await db.insert(s.messageTemplates).values([
    { desk: 'cre', audience: 'client', position: 1, title: 'First contact', body: 'Hello, this is {me} from JKAY Racks. Thanks for your enquiry — may I know your site dimensions and the rack category you need?' },
    { desk: 'cre', audience: 'client', position: 2, title: 'Ask for photos', body: 'Sharing our rack catalogue. Please send photos of your site so we can size the racks correctly.' },
    { desk: 'cre', audience: 'client', position: 3, title: 'Site visit offer', body: 'Following up on your enquiry — our BD engineer can visit for measurement this week.' },
    { desk: 'bd', audience: 'client', position: 1, title: 'Visit confirmation', body: 'Hello {contact}, confirming our site measurement visit. Our engineer will carry the measuring kit — please keep the floor area accessible.' },
    { desk: 'bd', audience: 'client', position: 2, title: 'Layout shared', body: 'Hello {contact}, sharing the CAD layout for {client}. Do review the aisle widths and let me know if anything needs to change.' },
    { desk: 'bd', audience: 'client', position: 3, title: 'Quotation follow-up', body: 'Hello {contact}, following up on the quotation we sent for {client}. Happy to walk you through the pricing on a call.' },
    { desk: 'bd', audience: 'client', position: 4, title: 'Advance reminder', body: 'Hello {contact}, once the advance is received we can release {client} to production.' },
    { desk: 'bd', audience: 'cre', position: 1, title: 'Ask for details', body: 'Hi {cre}, need a bit more on {client} before I quote — who is the actual decision maker and what budget did they indicate?' },
    { desk: 'bd', audience: 'cre', position: 2, title: 'Photos missing', body: 'Hi {cre}, the site photos on {client} are not enough for the layout. Can you get two wide shots of the floor?' },
    { desk: 'bd', audience: 'cre', position: 3, title: 'Client unreachable', body: 'Hi {cre}, {contact} at {client} is not picking up. Do you have an alternate number or a better time to call?' },
  ]);
  console.log('Seeded message templates');
}

/* ------------------------------ first admin ---------------------------- */
const { SEED_ADMIN_USERNAME: u, SEED_ADMIN_PASSWORD: p, SEED_ADMIN_NAME: n, SEED_ADMIN_EMAIL: e } = process.env;
if (u && p && n && e) {
  const username = usernameSchema.parse(u);
  passwordSchema.parse(p);
  const [existing] = await db.select().from(s.employees).where(eq(s.employees.username, username));
  if (!existing) {
    await db.insert(s.employees).values({
      username,
      passwordHash: await hashPassword(p),
      fullName: n,
      role: 'admin',
      email: e,
    });
    console.log(`Created first admin "${username}"`);
  } else {
    console.log(`Admin "${username}" already exists — left unchanged`);
  }
} else {
  console.log('Skipped first admin (set SEED_ADMIN_* to create one)');
}

await sql.end();
