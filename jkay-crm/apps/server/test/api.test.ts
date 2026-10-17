/**
 * End-to-end API test against a real Postgres.
 *   TEST_DATABASE_URL=postgres://... npm test -w @jkay/server
 * The database is wiped (schema dropped) and rebuilt, so never point it at real data.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import { followups, leads } from '../src/db/schema.js';
import type { Env } from '../src/env.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a throwaway database');

const { db, sql } = createDb(url);
let app: FastifyInstance;

type Who = { cookie: string; id: string };
const people: Record<string, Who> = {};

async function call(who: Who | null, method: string, path: string, body?: unknown) {
  const res = await app.inject({
    method: method as 'GET',
    url: path,
    payload: body as object,
    headers: who ? { cookie: who.cookie } : {},
  });
  return { status: res.statusCode, body: res.json() as any, headers: res.headers };
}
async function login(username: string, password: string) {
  const r = await call(null, 'POST', '/api/auth/login', { username, password });
  assert.equal(r.status, 200, `login ${username}: ${JSON.stringify(r.body)}`);
  const cookie = String(r.headers['set-cookie']).split(';')[0]!;
  const me = await call({ cookie, id: '' }, 'GET', '/api/auth/me');
  return { cookie, id: me.body.user.id as string };
}

before(async () => {
  await sql.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  execFileSync('npx', ['tsx', 'src/db/seed.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url, SEED_ADMIN_USERNAME: 'boss', SEED_ADMIN_PASSWORD: 'bosspass1', SEED_ADMIN_NAME: 'The Boss', SEED_ADMIN_EMAIL: 'boss@example.com' },
    stdio: 'pipe',
  });
  const env = { DATABASE_URL: url, PORT: 0, SECRETS_KEY: 'x'.repeat(44), COOKIE_SECURE: false, BUCKET_REGION: 'us-east-1', EMAIL_FROM: 'x' } as Env;
  app = await buildApp(env, db, { logger: false, serveWeb: false });
});
after(async () => {
  await app.close();
  await sql.end();
});

let config: any;
const stage = (desk: string, name: string) => config.stages.find((s: any) => s.desk === desk && s.name === name);
const tag = (scope: string, name: string) => config.tags.find((t: any) => t.scope === scope && t.name === name);
const soon = (h = 24) => new Date(Date.now() + h * 3600 * 1000).toISOString();

test('login: wrong password refused, right one works, me returns the user', async () => {
  const bad = await call(null, 'POST', '/api/auth/login', { username: 'boss', password: 'nope' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'Wrong username or password');
  const noUser = await call(null, 'POST', '/api/auth/login', { username: 'ghost', password: 'nope' });
  assert.equal(noUser.status, 401);
  people.admin = await login('BOSS', 'bosspass1'); // usernames are case-insensitive
  const me = await call(people.admin, 'GET', '/api/auth/me');
  assert.equal(me.body.user.role, 'admin');
  assert.equal(me.body.user.passwordHash, undefined, 'hash must never leave the server');
  assert.equal((await call(null, 'GET', '/api/auth/me')).status, 401);
});

test('admin creates employees; others cannot', async () => {
  for (const [username, role, fullName] of [
    ['arjun', 'cre', 'Arjun Mehta'],
    ['priya', 'cre', 'Priya R.'],
    ['sana', 'bde', 'Sana Kapoor'],
  ] as const) {
    const r = await call(people.admin!, 'POST', '/api/employees', { username, password: 'password123', fullName, role, email: `${username}@example.com` });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const dupe = await call(people.admin!, 'POST', '/api/employees', { username: 'arjun', password: 'password123', fullName: 'Another Arjun', role: 'cre', email: 'x@example.com' });
  assert.equal(dupe.status, 409);
  people.arjun = await login('arjun', 'password123');
  people.priya = await login('priya', 'password123');
  people.sana = await login('sana', 'password123');
  const denied = await call(people.arjun, 'POST', '/api/employees', { username: 'hacker', password: 'password123', fullName: 'H', role: 'admin', email: 'h@example.com' });
  assert.equal(denied.status, 403);
  const list = await call(people.arjun, 'GET', '/api/employees');
  assert.equal(list.body.employees[0].email, undefined, 'CREs do not see emails');
  config = (await call(people.admin!, 'GET', '/api/config')).body;
  const creConfig = (await call(people.arjun, 'GET', '/api/config')).body;
  assert.ok(!creConfig.tags.some((t: any) => t.scope === 'admin'), 'admin tags hidden from CREs');
});

const leadIds: string[] = [];
test('admin adds leads to the pool; phone is normalised; duplicates flagged', async () => {
  for (const [name, phone] of [
    ['Rakesh Traders', '098220 41121'],
    ['Sunrise Supermart', '+91 87651 22045'],
    ['Metro Cash & Carry', '99870 10002'],
    ['Rakesh Traders (again)', '9822041121'],
  ]) {
    const r = await call(people.admin!, 'POST', '/api/leads', { customerName: name, phone, platform: 'justdial', route: 'pool' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    leadIds.push(r.body.lead.id);
  }
  const [first] = await db.select().from(leads).where(eq(leads.id, leadIds[0]!));
  assert.equal(first!.phone, '919822041121');
  const [again] = await db.select().from(leads).where(eq(leads.id, leadIds[3]!));
  assert.equal(again!.duplicateOfId, leadIds[0], 'same phone is linked as a duplicate');
});

test('BDE cannot see the pool; CRE can', async () => {
  assert.equal((await call(people.sana!, 'GET', '/api/cre/leads?scope=pool')).status, 403);
  assert.equal((await call(people.sana!, 'GET', `/api/leads/${leadIds[0]}`)).status, 403);
  const pool = await call(people.arjun!, 'GET', '/api/cre/leads?scope=pool');
  assert.equal(pool.body.leads.length, 4);
});

test('two CREs claiming the same lead at once: exactly one wins', async () => {
  const [a, b] = await Promise.all([
    call(people.arjun!, 'POST', `/api/cre/leads/${leadIds[0]}/claim`),
    call(people.priya!, 'POST', `/api/cre/leads/${leadIds[0]}/claim`),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = a.status === 200 ? 'arjun' : 'priya';
  // make arjun the owner for the rest of the test either way
  if (winner === 'priya') {
    await call(people.priya!, 'POST', `/api/cre/leads/${leadIds[0]}/transfer`, { to: people.arjun!.id, reason: 'Workload rebalance', note: 'test' });
  }
  const mine = await call(people.arjun!, 'GET', '/api/cre/leads?scope=mine');
  assert.ok(mine.body.leads.some((l: any) => l.id === leadIds[0]));
  const pool = await call(people.priya!, 'GET', '/api/cre/leads?scope=pool');
  assert.ok(!pool.body.leads.some((l: any) => l.id === leadIds[0]), 'claimed lead left the pool');
});

test("a CRE cannot see or touch another CRE's lead", async () => {
  assert.equal((await call(people.priya!, 'GET', `/api/leads/${leadIds[0]}`)).status, 403);
  const r = await call(people.priya!, 'POST', `/api/cre/leads/${leadIds[0]}/stage`, { stageId: stage('cre', 'New').id });
  assert.equal(r.status, 403);
});

test('stage rules: Follop needs its tag and a follop date', async () => {
  const fol = stage('cre', 'Follop');
  const noTag = await call(people.arjun!, 'POST', `/api/cre/leads/${leadIds[0]}/stage`, { stageId: fol.id, followupAt: soon() });
  assert.equal(noTag.status, 400);
  const wrongTag = await call(people.arjun!, 'POST', `/api/cre/leads/${leadIds[0]}/stage`, { stageId: fol.id, stageTagId: tag('cre', 'High Ticket').id, followupAt: soon() });
  assert.equal(wrongTag.status, 400, 'a photos-stage tag is not valid on Follop');
  const noDate = await call(people.arjun!, 'POST', `/api/cre/leads/${leadIds[0]}/stage`, { stageId: fol.id, stageTagId: tag('cre', 'Follop').id });
  assert.equal(noDate.status, 400);
  const ok = await call(people.arjun!, 'POST', `/api/cre/leads/${leadIds[0]}/stage`, { stageId: fol.id, stageTagId: tag('cre', 'Long Follop').id, followupAt: soon() });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.lead.creStage.name, 'Follop');
  assert.equal(ok.body.lead.stageTag.name, 'Long Follop');
  assert.ok(ok.body.followup);
  const toHandoff = await call(people.arjun!, 'POST', `/api/cre/leads/${leadIds[0]}/stage`, { stageId: stage('cre', 'Qualified to BD').id });
  assert.equal(toHandoff.status, 400, 'hand-off has its own action');
});

test('call, WhatsApp, tags, edit and notes are logged', async () => {
  const id = leadIds[0]!;
  assert.equal((await call(people.arjun!, 'POST', `/api/cre/leads/${id}/call`, { summary: 'Wants 14 bays', nextFollowupAt: soon(48) })).status, 200);
  assert.equal((await call(people.arjun!, 'POST', `/api/cre/leads/${id}/whatsapp`, {})).status, 200);
  assert.equal((await call(people.arjun!, 'POST', `/api/cre/leads/${id}/tags`, { tagId: tag('cre', 'Decision maker').id })).status, 200);
  const bdTag = await call(people.arjun!, 'POST', `/api/cre/leads/${id}/tags`, { tagId: tag('bd', 'High value').id });
  assert.equal(bdTag.status, 400, 'CREs can only use CRE tags');
  const edit = await call(people.arjun!, 'PATCH', `/api/cre/leads/${id}`, { place: 'Bhiwandi, MH', requirement: '14 bays' });
  assert.equal(edit.body.lead.place, 'Bhiwandi, MH');
  assert.equal((await call(people.arjun!, 'POST', `/api/leads/${id}/notes`, { text: 'Only picks up after 3 PM' })).status, 200);
  const d = await call(people.arjun!, 'GET', `/api/leads/${id}`);
  const kinds = d.body.activity.map((a: any) => a.kind);
  for (const k of ['claim', 'stage', 'call', 'whatsapp', 'tag', 'edit']) assert.ok(kinds.includes(k), `activity has ${k}`);
  assert.equal(d.body.notes.length, 1);
});

test('transfer CRE → CRE moves ownership, follop and writes the owner log', async () => {
  const id = leadIds[0]!;
  const r = await call(people.arjun!, 'POST', `/api/cre/leads/${id}/transfer`, { to: people.priya!.id, reason: 'Language barrier', note: 'Speaks Tamil' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await call(people.arjun!, 'GET', `/api/leads/${id}`)).status, 403, 'old owner loses access');
  const d = await call(people.priya!, 'GET', `/api/leads/${id}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.lead.owner.name, 'Priya R.');
  const reasons = d.body.owners.map((o: any) => o.reason);
  assert.equal(reasons.at(-1), 'transfer');
  assert.equal(reasons[0], 'intake');
  assert.equal(d.body.owners.filter((o: any) => !o.to).length, 1, 'exactly one current owner');
  const [fu] = await db.select().from(followups).where(and(eq(followups.leadId, id), eq(followups.status, 'open')));
  assert.equal(fu!.ownerId, people.priya!.id, 'open follop moved with the lead');
  assert.equal(d.body.notes.length, 1, 'CRE notes travel with the lead');
});

test('hand-off to BD: BDE owns it, CRE keeps a read-only view of the stage', async () => {
  const id = leadIds[0]!;
  const noNote = await call(people.priya!, 'POST', `/api/cre/leads/${id}/handoff`, { toBdeId: people.sana!.id, note: '' });
  assert.equal(noNote.status, 400);
  const toCre = await call(people.priya!, 'POST', `/api/cre/leads/${id}/handoff`, { toBdeId: people.arjun!.id, note: 'x' });
  assert.equal(toCre.status, 400, 'can only hand off to a BDE');
  const r = await call(people.priya!, 'POST', `/api/cre/leads/${id}/handoff`, { toBdeId: people.sana!.id, note: 'Budget confirmed', verified: 'Verified — budget and timeline confirmed' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.lead.desk, 'bd');
  assert.equal(r.body.lead.bdStage.name, 'Site measurement');

  const bdView = await call(people.sana!, 'GET', `/api/leads/${id}`);
  assert.equal(bdView.status, 200);
  assert.equal(bdView.body.notes.length, 1, 'BDE sees the CRE notes');
  await call(people.sana!, 'POST', `/api/leads/${id}/notes`, { text: 'BD private' });

  const creView = await call(people.priya!, 'GET', `/api/leads/${id}`);
  assert.equal(creView.status, 200);
  assert.equal(creView.body.notes.length, 1, "CRE does not see the BDE's private note");
  const handed = await call(people.priya!, 'GET', '/api/cre/leads?scope=bd');
  assert.equal(handed.body.leads[0].bdStage, 'Site measurement');
  const edit = await call(people.priya!, 'PATCH', `/api/cre/leads/${id}`, { place: 'x' });
  assert.equal(edit.status, 403, 'read-only after hand-off');
  const owners = bdView.body.owners.map((o: any) => o.reason);
  assert.equal(owners.at(-1), 'handoff');
  const notif = await sql`select title from notifications where recipient_id = ${people.sana!.id}`;
  assert.ok(notif.some((n: any) => n.title.includes('handed you a deal')));
});

test('mark lost needs a CRE lost reason; release to pool works', async () => {
  const [, l2, l3] = leadIds;
  await call(people.arjun!, 'POST', `/api/cre/leads/${l2}/claim`);
  const wrong = await call(people.arjun!, 'POST', `/api/cre/leads/${l2}/lost`, { reasonId: tag('bd_lost', 'Requirement dropped').id });
  assert.equal(wrong.status, 400);
  const ok = await call(people.arjun!, 'POST', `/api/cre/leads/${l2}/lost`, { reasonId: tag('cre_lost', 'Other state').id, note: 'Kerala' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.lead.lost.reason, 'Other state');
  const lostList = await call(people.arjun!, 'GET', '/api/cre/leads?scope=lost');
  assert.equal(lostList.body.leads.length, 1);
  assert.equal((await call(people.arjun!, 'POST', `/api/cre/leads/${l2}/stage`, { stageId: stage('cre', 'New').id })).status, 403, 'closed leads are read-only');

  await call(people.arjun!, 'POST', `/api/cre/leads/${l3}/claim`);
  const rel = await call(people.arjun!, 'POST', `/api/cre/leads/${l3}/transfer`, { to: 'pool', reason: 'On leave', note: 'Back next week' });
  assert.equal(rel.status, 200);
  const pool = await call(people.priya!, 'GET', '/api/cre/leads?scope=pool');
  assert.ok(pool.body.leads.some((l: any) => l.id === l3));
});

test('dashboard and counts answer', async () => {
  const d = await call(people.arjun!, 'GET', '/api/cre/dashboard');
  assert.equal(d.status, 200);
  assert.equal(d.body.totals.lost, 1);
  assert.equal(d.body.week.days.length, 7);
  const c = await call(people.priya!, 'GET', '/api/cre/counts');
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.counts.bd, 1);
});

test('disabling an employee signs them out immediately', async () => {
  const r = await call(people.admin!, 'PATCH', `/api/employees/${people.arjun!.id}`, { active: false });
  assert.equal(r.status, 200);
  assert.equal((await call(people.arjun!, 'GET', '/api/auth/me')).status, 401);
  const relog = await call(null, 'POST', '/api/auth/login', { username: 'arjun', password: 'password123' });
  assert.equal(relog.status, 401);
  const lastAdmin = await call(people.admin!, 'PATCH', `/api/employees/${people.admin!.id}`, { role: 'cre' });
  assert.equal(lastAdmin.status, 400, 'cannot remove the last Admin');
});

test('changing your password signs out your other sessions', async () => {
  const second = await login('priya', 'password123');
  const r = await call(people.priya!, 'POST', '/api/auth/password', { current: 'password123', next: 'newpassword9' });
  assert.equal(r.status, 200);
  assert.equal((await call(second, 'GET', '/api/auth/me')).status, 401);
  assert.equal((await call(people.priya!, 'GET', '/api/auth/me')).status, 200);
});
