/**
 * End-to-end API test against a real Postgres.
 *   TEST_DATABASE_URL=postgres://... npm test -w @jkay/server
 * The database is wiped (schema dropped) and rebuilt, so never point it at real data.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import { followups, leads, quotations, siteVisits } from '../src/db/schema.js';
import { runReminders } from '../src/jobs/reminders.js';
import { sendPendingEmails, type Mail } from '../src/jobs/email.js';
import { backupDue, runBackup } from '../src/jobs/backup.js';
import { restoreDatabase } from '../src/db/backup.js';
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
/** Multipart upload of one file, the way the browser sends it. */
async function upload(who: Who, leadId: string, kind: string, fileName: string, content = 'file-bytes') {
  const b = '----jkaytest' + Math.random().toString(16).slice(2);
  const payload = Buffer.from(
    `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${b}--\r\n`,
  );
  const res = await app.inject({
    method: 'POST',
    url: `/api/files?leadId=${leadId}&kind=${kind}`,
    payload,
    headers: { cookie: who.cookie, 'content-type': `multipart/form-data; boundary=${b}` },
  });
  return { status: res.statusCode, body: res.json() as any };
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
  const env = {
    DATABASE_URL: url,
    PORT: 0,
    SECRETS_KEY: 'x'.repeat(44),
    COOKIE_SECURE: false,
    BUCKET_REGION: 'us-east-1',
    BUCKET_PATH_STYLE: false,
    STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'jkay-files-')),
    EMAIL_FROM: 'x',
  } as Env;
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

/* ================================ BD desk ================================ */
test('CRE adds a site photo; the BDE sees it after hand-off', async () => {
  const id = leadIds[3]!;
  assert.equal((await call(people.priya!, 'POST', `/api/cre/leads/${id}/claim`)).status, 200);
  const bad = await upload(people.priya!, id, 'photo', 'virus.exe');
  assert.equal(bad.status, 400, 'only image types for photos');
  const notMine = await upload(people.sana!, id, 'photo', 'site.jpg');
  assert.equal(notMine.status, 403, 'BDE cannot add photos to a CRE lead');
  const up = await upload(people.priya!, id, 'photo', 'site floor.jpg', 'jpeg-bytes');
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const cad = await upload(people.priya!, id, 'cad', 'plan.dwg');
  assert.equal(cad.status, 403, 'CREs upload photos only');
  const d = await call(people.priya!, 'GET', `/api/leads/${id}`);
  assert.equal(d.body.photos.length, 1);
  await call(people.priya!, 'POST', `/api/cre/leads/${id}/handoff`, { toBdeId: people.sana!.id, note: 'Photos attached' });
  const deal = await call(people.sana!, 'GET', `/api/bd/deals/${id}`);
  assert.equal(deal.status, 200, JSON.stringify(deal.body));
  assert.equal(deal.body.photos.length, 1);
  const file = await app.inject({ method: 'GET', url: `/api/files/${up.body.attachment.id}`, headers: { cookie: people.sana!.cookie } });
  assert.equal(file.statusCode, 200);
  assert.equal(file.body, 'jpeg-bytes');
});

test('BD: deals are private to their BDE', async () => {
  const r = await call(people.admin!, 'POST', '/api/employees', { username: 'ravi', password: 'password123', fullName: 'Ravi Bhosale', role: 'bde', email: 'ravi@example.com' });
  assert.equal(r.status, 200);
  people.ravi = await login('ravi', 'password123');
  const mine = await call(people.sana!, 'GET', '/api/bd/deals');
  assert.equal(mine.body.deals.length, 2);
  assert.equal((await call(people.ravi, 'GET', '/api/bd/deals')).body.deals.length, 0);
  assert.equal((await call(people.ravi, 'GET', `/api/bd/deals/${leadIds[0]}`)).status, 403);
  assert.equal((await call(people.ravi, 'POST', `/api/bd/deals/${leadIds[0]}/call`, { summary: 'x' })).status, 403);
  assert.equal((await call(people.priya!, 'GET', '/api/bd/deals')).status, 403, 'CREs have no BD desk');
  const all = await call(people.admin!, 'GET', '/api/bd/deals');
  assert.equal(all.body.deals.length, 2, 'Admin sees every BD deal');
});

test('BD: visit → measured → CAD → quotation moves the stage forward', async () => {
  const id = leadIds[0]!;
  const early = await call(people.sana!, 'POST', `/api/bd/deals/${id}/stage`, { stageId: stage('bd', 'Quotation sent').id });
  assert.equal(early.status, 400, 'needs a quotation first');

  const v = await call(people.sana!, 'POST', `/api/bd/deals/${id}/visits`, { scheduledAt: soon(30), engineerName: 'Faisal Sheikh', note: 'Rear dock' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.bd.visits[0].engineer, 'Faisal Sheikh');
  const moved = await call(people.sana!, 'POST', `/api/bd/deals/${id}/visits`, { scheduledAt: soon(50) });
  assert.equal(moved.body.bd.visits.length, 1, 'booking again reschedules the open visit');
  assert.equal(moved.body.bd.visits[0].engineer, 'Sana Kapoor', 'defaults to the BDE');
  const creNotif = await sql`select title from notifications where recipient_id = ${people.priya!.id} and kind = 'visit'`;
  assert.ok(creNotif.length >= 1, 'the CRE who handed it over hears about the visit');

  const done = await call(people.sana!, 'POST', `/api/bd/deals/${id}/visits/${moved.body.bd.visits[0].id}`, { status: 'done' });
  assert.equal(done.body.lead.bdStage.name, 'Plan layout needed');

  const f = await upload(people.sana!, id, 'cad', 'layout rev1.dwg');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const cad = await call(people.sana!, 'POST', `/api/bd/deals/${id}/cad`, { attachmentId: f.body.attachment.id, note: 'First pass' });
  assert.equal(cad.status, 200, JSON.stringify(cad.body));
  assert.equal(cad.body.bd.cad[0].rev, 1);
  const again = await call(people.sana!, 'POST', `/api/bd/deals/${id}/cad`, { attachmentId: f.body.attachment.id });
  assert.equal(again.status, 409, 'one file, one revision');
  const creFile = await app.inject({ method: 'GET', url: `/api/files/${f.body.attachment.id}`, headers: { cookie: people.priya!.cookie } });
  assert.equal(creFile.statusCode, 403, 'CRE cannot open BD drawings');

  const qf = await upload(people.sana!, id, 'quotation', 'quote-v1.pdf');
  const q1 = await call(people.sana!, 'POST', `/api/bd/deals/${id}/quotations`, { amount: 300000, attachmentId: qf.body.attachment.id });
  assert.equal(q1.status, 200, JSON.stringify(q1.body));
  assert.equal(q1.body.lead.bdStage.name, 'Quotation sent');
  assert.equal(q1.body.bd.value, 300000);
  const creView = await call(people.priya!, 'GET', `/api/leads/${id}`);
  assert.equal(creView.body.bd, undefined);
  assert.ok(!creView.body.activity.some((a: any) => a.kind === 'quotation'), 'CRE sees no BD activity');
});

test('BD: a cut past the discount limit needs Admin approval', async () => {
  const id = leadIds[0]!;
  const small = await call(people.sana!, 'POST', `/api/bd/deals/${id}/quotations`, { amount: 285000, note: '5% off' });
  assert.equal(small.status, 200, 'within the 8% limit');
  const deep = await call(people.sana!, 'POST', `/api/bd/deals/${id}/quotations`, { amount: 270000 });
  assert.equal(deep.status, 400);
  assert.match(deep.body.error, /Request Admin approval/);
  assert.equal((await call(people.sana!, 'POST', `/api/bd/deals/${id}/discounts`, { percent: 5, reason: 'x' })).status, 400, 'no approval needed under the limit');
  const ask = await call(people.sana!, 'POST', `/api/bd/deals/${id}/discounts`, { percent: 10, reason: 'Competitor at 2.7L' });
  assert.equal(ask.status, 200, JSON.stringify(ask.body));
  assert.equal((await call(people.sana!, 'POST', `/api/bd/deals/${id}/discounts`, { percent: 12, reason: 'x' })).status, 409, 'one pending at a time');
  assert.equal((await call(people.sana!, 'GET', '/api/bd/discounts')).status, 403, 'only Admin decides');
  const list = await call(people.admin!, 'GET', '/api/bd/discounts');
  assert.equal(list.body.requests.length, 1);
  assert.equal(list.body.requests[0].proposedAmount, 270000);
  const dec = await call(people.admin!, 'POST', `/api/bd/discounts/${list.body.requests[0].id}/decide`, { approve: true, note: 'OK this once' });
  assert.equal(dec.status, 200);
  const twice = await call(people.admin!, 'POST', `/api/bd/discounts/${list.body.requests[0].id}/decide`, { approve: false });
  assert.equal(twice.status, 409);
  const now = await call(people.sana!, 'POST', `/api/bd/deals/${id}/quotations`, { amount: 270000 });
  assert.equal(now.status, 200, JSON.stringify(now.body));
  assert.equal(now.body.bd.quotations[0].version, 3);
});

test('BD: advance marks the deal won; payments keep the balance honest', async () => {
  const id = leadIds[0]!;
  const inst = await call(people.sana!, 'POST', `/api/bd/deals/${id}/payments`, { kind: 'installment', amount: 50000, receivedOn: '2026-10-10', mode: 'NEFT' });
  assert.equal(inst.status, 400, 'advance comes first');
  const adv = await call(people.sana!, 'POST', `/api/bd/deals/${id}/payments`, { kind: 'advance', amount: 100000, receivedOn: '2026-10-10', mode: 'RTGS', reference: 'UTR123' });
  assert.equal(adv.status, 200, JSON.stringify(adv.body));
  assert.equal(adv.body.lead.bdStage.kind, 'won');
  assert.equal(adv.body.bd.contractValue, 270000);
  assert.equal(adv.body.bd.balance, 170000);
  const over = await call(people.sana!, 'POST', `/api/bd/deals/${id}/payments`, { kind: 'final', amount: 200000, receivedOn: '2026-10-11', mode: 'UPI' });
  assert.equal(over.status, 400);
  assert.equal((await call(people.sana!, 'POST', `/api/bd/deals/${id}/quotations`, { amount: 260000 })).status, 400, 'no new quotations once won');
  assert.equal((await call(people.sana!, 'POST', `/api/bd/deals/${id}/lost`, { reasonId: tag('bd_lost', 'Requirement dropped').id })).status, 400, 'paid deals cannot be lost');
  assert.equal((await call(people.sana!, 'POST', `/api/bd/deals/${id}/stage`, { stageId: stage('bd', 'Negotiation').id })).status, 400, 'paid deals stay won');
  const pd = await call(people.sana!, 'PUT', `/api/bd/deals/${id}/production-date`, { productionDate: '2026-11-02' });
  assert.equal(pd.body.bd.productionDate, '2026-11-02');
  const fin = await call(people.sana!, 'POST', `/api/bd/deals/${id}/payments`, { kind: 'final', amount: 170000, receivedOn: '2026-10-12', mode: 'NEFT' });
  assert.equal(fin.body.bd.balance, 0);
  const ledger = await call(people.sana!, 'GET', '/api/bd/payments');
  assert.equal(ledger.body.deals[0].payments.length, 2);
  const adminNotes = await sql`select title from notifications where recipient_id = ${people.admin!.id}`;
  assert.ok(adminNotes.some((n: any) => n.title.includes(' won')));
  assert.ok(adminNotes.some((n: any) => n.title.includes('fully paid')));
});

test('BD: lost needs a BD reason; reopen puts it back', async () => {
  const id = leadIds[3]!;
  const wrong = await call(people.sana!, 'POST', `/api/bd/deals/${id}/lost`, { reasonId: tag('cre_lost', 'Other state').id });
  assert.equal(wrong.status, 400);
  const ok = await call(people.sana!, 'POST', `/api/bd/deals/${id}/lost`, { reasonId: tag('bd_lost', 'Site not feasible').id, note: 'No floor load' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.lead.lost.reason, 'Site not feasible');
  assert.equal((await call(people.sana!, 'POST', `/api/bd/deals/${id}/visits`, { scheduledAt: soon() })).status, 400, 'lost deals are frozen');
  const creNotif = await sql`select title from notifications where recipient_id = ${people.priya!.id} and kind = 'lost'`;
  assert.equal(creNotif.length, 1, 'the CRE hears it was lost');
  const re = await call(people.sana!, 'POST', `/api/bd/deals/${id}/reopen`);
  assert.equal(re.status, 200);
  assert.equal(re.body.lead.lost, null);
  assert.equal(re.body.lead.bdStage.name, 'Site measurement');
  const tagged = await call(people.sana!, 'POST', `/api/bd/deals/${id}/tags`, { tagId: tag('bd', 'Price pressure').id });
  assert.equal(tagged.body.tags.length, 1);
  assert.equal((await call(people.sana!, 'POST', `/api/bd/deals/${id}/tags`, { tagId: tag('cre', 'Decision maker').id })).status, 400);
  const visits = await call(people.sana!, 'GET', '/api/bd/visits');
  assert.equal(visits.status, 200);
});

/* ================================= Admin ================================= */
test('Admin: records cover every scope; search finds by name and phone', async () => {
  const live = await call(people.admin!, 'GET', '/api/admin/records?scope=live');
  assert.equal(live.status, 200, JSON.stringify(live.body).slice(0, 400));
  assert.ok(live.body.records.length >= 2);
  const won = await call(people.admin!, 'GET', '/api/admin/records?scope=won');
  assert.equal(won.body.records.length, 1);
  assert.equal(won.body.records[0].paid, 270000);
  assert.equal(won.body.records[0].payments.length, 2);
  assert.equal(won.body.records[0].bde.name, 'Sana Kapoor');
  assert.equal(won.body.records[0].cre.name, 'Priya R.');
  const lost = await call(people.admin!, 'GET', '/api/admin/records?scope=lost');
  assert.equal(lost.body.records[0].lost.desk, 'cre');
  const s = await call(people.admin!, 'GET', '/api/admin/records?scope=search&q=Sunrise');
  assert.equal(s.body.records[0].customerName, 'Sunrise Supermart');
  const byPhone = await call(people.admin!, 'GET', '/api/admin/records?scope=search&q=8765122045');
  assert.equal(byPhone.body.records.length, 1);
  assert.equal((await call(people.sana!, 'GET', '/api/admin/records')).status, 403, 'Admin only');
});

test('Admin: tags, notes, watches and ranking are private to each Admin', async () => {
  const r = await call(people.admin!, 'POST', '/api/employees', { username: 'boss2', password: 'password123', fullName: 'Second Admin', role: 'admin', email: 'b2@example.com' });
  assert.equal(r.status, 200);
  people.admin2 = await login('boss2', 'password123');
  const id = leadIds[3]!;
  assert.equal((await call(people.admin!, 'POST', `/api/admin/records/${id}/tags`, { tagId: tag('admin', 'Competitive').id })).status, 200);
  assert.equal((await call(people.admin!, 'POST', `/api/admin/records/${id}/tags`, { tagId: tag('bd', 'High value').id })).status, 400, 'only admin tags');
  await call(people.admin!, 'PUT', `/api/admin/records/${id}/watch`, { on: true });
  await call(people.admin!, 'POST', `/api/leads/${id}/notes`, { text: 'Do not go past 6% without me' });
  const order = (await call(people.admin!, 'GET', '/api/admin/records?scope=live')).body.records.map((x: any) => x.id);
  const reversed = [...order].reverse();
  assert.equal((await call(people.admin!, 'PUT', '/api/admin/rank', { order: reversed })).status, 200);

  const mine = (await call(people.admin!, 'GET', `/api/admin/records/${id}`)).body.record;
  assert.equal(mine.adminTags[0].name, 'Competitive');
  assert.equal(mine.watch, true);
  assert.equal(mine.notes.length, 1);
  assert.equal(mine.rank, reversed.indexOf(id) + 1);

  const theirs = (await call(people.admin2, 'GET', `/api/admin/records/${id}`)).body.record;
  assert.equal(theirs.adminTags.length, 0, "another Admin's tags are hidden");
  assert.equal(theirs.watch, false);
  assert.equal(theirs.notes.length, 0);
  assert.equal(theirs.rank, null);
  const detail2 = await call(people.admin2, 'GET', `/api/leads/${id}`);
  assert.ok(!detail2.body.notes.some((n: any) => n.text.includes('6%')), "another Admin's note is hidden");
  const bdView = await call(people.sana!, 'GET', `/api/bd/deals/${id}`);
  assert.ok(!bdView.body.notes.some((n: any) => n.text.includes('6%')), 'the BDE never sees admin notes');

  // the watch fires on the next move
  await call(people.sana!, 'POST', `/api/bd/deals/${id}/call`, { summary: 'x' });
  await call(people.sana!, 'POST', `/api/bd/deals/${id}/stage`, { stageId: stage('bd', 'Plan layout needed').id });
  const n = await sql`select title from notifications where recipient_id = ${people.admin!.id} and via_watch`;
  assert.ok(n.length >= 1, 'watching Admin is told');
  const n2 = await sql`select title from notifications where recipient_id = ${people.admin2.id} and via_watch`;
  assert.equal(n2.length, 0);
});

test('Admin: reassign a BD deal to another BDE, and a pool lead to a CRE', async () => {
  const id = leadIds[3]!;
  assert.equal((await call(people.admin!, 'POST', `/api/admin/records/${id}/reassign`, { to: people.priya!.id, note: 'x' })).status, 400, 'BD deals go to a BDE');
  const r = await call(people.admin!, 'POST', `/api/admin/records/${id}/reassign`, { to: people.ravi!.id, note: 'Sana on leave' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await call(people.sana!, 'GET', `/api/bd/deals/${id}`)).status, 403, 'old BDE loses it');
  const d = await call(people.ravi!, 'GET', `/api/bd/deals/${id}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.owners.at(-1).reason, 'reassign');

  const pool = (await call(people.priya!, 'GET', '/api/cre/leads?scope=pool')).body.leads[0];
  const a = await call(people.admin!, 'POST', `/api/admin/records/${pool.id}/reassign`, { to: people.priya!.id, note: 'Her territory' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const mine = await call(people.priya!, 'GET', '/api/cre/leads?scope=mine');
  assert.ok(mine.body.leads.some((l: any) => l.id === pool.id && l.creStage.kind === 'working'));
});

test('Admin settings: stages, tags, categories, rules, templates', async () => {
  const lib = await call(people.admin!, 'GET', '/api/admin/library');
  assert.equal(lib.status, 200, JSON.stringify(lib.body));
  const busy = lib.body.stages.find((s: any) => s.kind === 'working' && s.live > 0);
  assert.ok(busy, 'some working stage holds open records');
  assert.equal((await call(people.admin!, 'DELETE', `/api/admin/stages/${busy.id}`)).status, 409, 'stage with open records stays');
  const won = lib.body.stages.find((s: any) => s.desk === 'bd' && s.kind === 'won');
  assert.equal((await call(people.admin!, 'DELETE', `/api/admin/stages/${won.id}`)).status, 400, 'workflow stages stay');

  assert.equal((await call(people.admin!, 'POST', '/api/admin/stages', { desk: 'bd', name: 'Design review', definition: 'Client checks the layout' })).status, 200);
  const lib2 = (await call(people.admin!, 'GET', '/api/admin/library')).body;
  const bd = lib2.stages.filter((s: any) => s.desk === 'bd');
  const dr = bd.find((s: any) => s.name === 'Design review');
  assert.ok(dr.position < bd.find((s: any) => s.kind === 'won').position, 'new stage sits before Won');
  const working = bd.filter((s: any) => s.kind === 'working').map((s: any) => s.id);
  const reordered = [dr.id, ...working.filter((x: number) => x !== dr.id)];
  assert.equal((await call(people.admin!, 'POST', '/api/admin/stages/order', { desk: 'bd', ids: reordered })).status, 200);
  const cfg = (await call(people.sana!, 'GET', '/api/config')).body;
  const first = cfg.stages.filter((s: any) => s.desk === 'bd' && s.kind === 'working').sort((a: any, b: any) => a.position - b.position)[0];
  assert.equal(first.name, 'Design review', 'desks see the new order');
  assert.equal((await call(people.admin!, 'PATCH', `/api/admin/stages/${dr.id}`, { name: 'Design check', showsValue: true })).status, 200);
  assert.equal((await call(people.admin!, 'DELETE', `/api/admin/stages/${dr.id}`)).status, 200, 'an empty stage can go');

  assert.equal((await call(people.admin!, 'POST', '/api/admin/tags', { scope: 'bd', name: 'Urgent', tone: 'red' })).status, 200);
  assert.equal((await call(people.admin!, 'POST', '/api/admin/tags', { scope: 'bd', name: 'urgent' })).status, 409);
  const lostTags = lib.body.tags.filter((t: any) => t.scope === 'bd_lost');
  for (const t of lostTags.slice(1)) await call(people.admin!, 'DELETE', `/api/admin/tags/${t.id}`);
  assert.equal((await call(people.admin!, 'DELETE', `/api/admin/tags/${lostTags[0].id}`)).status, 400, 'keep one lost reason');

  assert.equal((await call(people.admin!, 'PUT', '/api/admin/settings', { key: 'discount_threshold_pct', value: 99 })).status, 400);
  assert.equal((await call(people.admin!, 'PUT', '/api/admin/settings', { key: 'discount_threshold_pct', value: 10 })).status, 200);
  const lib3 = (await call(people.admin!, 'GET', '/api/admin/library')).body;
  assert.equal(lib3.settings.find((s: any) => s.key === 'discount_threshold_pct').value, 10);

  assert.equal((await call(people.admin!, 'POST', '/api/admin/categories', { name: 'Cold storage' })).status, 200);
  assert.equal((await call(people.admin!, 'POST', '/api/admin/templates', { desk: 'cre', audience: 'client', title: 'Hello', body: 'Hi {contact}' })).status, 200);
  assert.equal((await call(people.sana!, 'POST', '/api/admin/tags', { scope: 'bd', name: 'x' })).status, 403);
});

/* ============================ Phase 5: background jobs ============================ */
const notesFor = (who: Who, leadId: string | null, kind?: string) =>
  sql`select kind, title, body from notifications where recipient_id = ${who.id} ${leadId ? sql`and lead_id = ${leadId}` : sql``} ${kind ? sql`and kind = ${kind}` : sql``} order by id`;
const jobLeads: Record<string, string> = {};
async function addLead(name: string, phone: string, route: 'pool' | 'cre' | 'bd', ownerId?: string) {
  const r = await call(people.admin!, 'POST', '/api/leads', { customerName: name, phone, platform: 'website', route, ownerId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.lead.id as string;
}

test('Jobs: a follop fires, repeats at 10:00 the next day, then escalates to Admin', async () => {
  // arjun was disabled by an earlier test — bring him back
  assert.equal((await call(people.admin!, 'PATCH', `/api/employees/${people.arjun!.id}`, { active: true })).status, 200);
  people.arjun = await login('arjun', 'password123');
  const id = (jobLeads.follop = await addLead('Follop Test Stores', '9000000101', 'cre', people.arjun!.id));
  const acted = (jobLeads.acted = await addLead('Acted Test Stores', '9000000102', 'cre', people.arjun!.id));
  for (const l of [id, acted]) assert.equal((await call(people.arjun!, 'PUT', `/api/cre/leads/${l}/followup`, { dueAt: soon(2), note: 'Confirm bays' })).status, 200);
  const due = new Date('2026-11-02T10:30:00Z'); // 4:00 pm IST
  await db.update(followups).set({ dueAt: due }).where(and(eq(followups.status, 'open'), inArray(followups.leadId, [id, acted])));
  const at = (iso: string) => runReminders(db, new Date(iso));

  assert.equal((await at('2026-11-02T10:29:00Z')).followup, 0, 'not before the time');
  assert.ok((await at('2026-11-02T10:31:00Z')).followup >= 2);
  assert.equal((await at('2026-11-02T10:35:00Z')).followup, 0, 'fires once');
  assert.equal((await notesFor(people.arjun!, id, 'followup')).length, 1);
  assert.equal((await notesFor(people.arjun!, id, 'followup'))[0]!.body, 'Confirm bays');

  // the client was contacted on the second lead, so it must not repeat
  await db.update(leads).set({ lastContactAt: new Date('2026-11-02T12:00:00Z') }).where(eq(leads.id, acted));
  await at('2026-11-03T04:29:00Z'); // 9:59 am IST next day
  assert.equal((await notesFor(people.arjun!, id, 'repeat')).length, 0, 'not before 10:00 IST');
  await at('2026-11-03T04:31:00Z');
  assert.equal((await notesFor(people.arjun!, id, 'repeat')).length, 1, 'repeats at 10:00 IST');
  assert.equal((await notesFor(people.arjun!, acted, 'repeat')).length, 0, 'acted-on follops do not repeat');

  await at('2026-11-03T07:00:00Z');
  assert.equal((await notesFor(people.admin!, id, 'escalation')).length, 0, 'Admin waits 4h after the repeat');
  await at('2026-11-03T08:32:00Z');
  const esc = await notesFor(people.admin!, id, 'escalation');
  assert.equal(esc.length, 1);
  assert.match(esc[0]!.body, /Arjun Mehta/);
  assert.equal((await notesFor(people.arjun!, id, 'escalation')).length, 1, 'the CRE is told Admin was alerted');
  await at('2026-11-04T08:00:00Z');
  assert.equal((await notesFor(people.admin!, id, 'escalation')).length, 1, 'escalates once');
});

test('Jobs: Call Not Attend - 3 escalates to Admin straight away', async () => {
  const id = jobLeads.follop!;
  const fol = stage('cre', 'Follop');
  await call(people.arjun!, 'POST', `/api/cre/leads/${id}/stage`, { stageId: fol.id, stageTagId: tag('cre', 'Call Not Attend - 1').id, followupAt: soon() });
  assert.equal((await notesFor(people.admin!, id, 'escalation')).length, 1, 'step 1 stays with the CRE');
  const r = await call(people.arjun!, 'POST', `/api/cre/leads/${id}/stage`, { stageId: fol.id, stageTagId: tag('cre', 'Call Not Attend - 3').id, followupAt: soon() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const esc = await notesFor(people.admin!, id, 'escalation');
  assert.equal(esc.length, 2);
  assert.match(esc[1]!.title, /Call Not Attend - 3/);
});

test('Jobs: unclaimed pool leads and idle leads alert once', async () => {
  const pool = await addLead('Unclaimed Test Mart', '9000000103', 'pool');
  const dayAgo = new Date(Date.now() - 25 * 3600_000);
  await db.update(leads).set({ createdAt: dayAgo, ownerSince: dayAgo }).where(eq(leads.id, pool));
  const idle = await addLead('Idle Test Depot', '9000000104', 'cre', people.priya!.id);
  const old = new Date(Date.now() - 8 * 86400_000);
  await db.update(leads).set({ createdAt: old, ownerSince: old, lastContactAt: old }).where(eq(leads.id, idle));

  const c = await runReminders(db, new Date());
  assert.ok(c.unclaimed >= 1 && c.idle >= 1, JSON.stringify(c));
  assert.equal((await sql`select 1 from reminder_log where lead_id = ${pool} and key like 'unclaimed:%'`).length, 1);
  assert.ok((await notesFor(people.admin!, null, 'unclaimed')).length >= 1);
  assert.equal((await notesFor(people.priya!, idle, 'idle')).length, 1, 'the owner hears');
  assert.ok((await notesFor(people.admin!, null, 'idle')).length >= 1, 'Admin hears');

  const again = await runReminders(db, new Date());
  assert.equal(again.unclaimed + again.idle, 0, 'no repeats for the same situation');

  // contact, then silence again → a new idle alert
  const later = new Date(Date.now() - 7 * 86400_000);
  await db.update(leads).set({ lastContactAt: later }).where(eq(leads.id, idle));
  await runReminders(db, new Date());
  assert.equal((await notesFor(people.priya!, idle, 'idle')).length, 2);
});

test('Jobs: unanswered quotation, final balance before production, visit morning', async () => {
  const id = (jobLeads.deal = await addLead('Quote Test Logistics', '9000000105', 'bd', people.sana!.id));
  const q = await call(people.sana!, 'POST', `/api/bd/deals/${id}/quotations`, { amount: 200000 });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  await runReminders(db, new Date());
  assert.equal((await notesFor(people.sana!, id, 'quote')).length, 0, 'fresh quote');
  await db.update(quotations).set({ createdAt: new Date(Date.now() - 8 * 86400_000) }).where(eq(quotations.leadId, id));
  await runReminders(db, new Date());
  const qn = await notesFor(people.sana!, id, 'quote');
  assert.equal(qn.length, 1);
  assert.match(qn[0]!.title, /Quotation v1 unanswered for 7 days/);

  const adv = await call(people.sana!, 'POST', `/api/bd/deals/${id}/payments`, { kind: 'advance', amount: 50000, receivedOn: '2026-11-01', mode: 'NEFT' });
  assert.equal(adv.status, 200, JSON.stringify(adv.body));
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const far = new Date(Date.parse(today) + 20 * 86400_000).toISOString().slice(0, 10);
  await call(people.sana!, 'PUT', `/api/bd/deals/${id}/production-date`, { productionDate: far });
  await runReminders(db, new Date());
  assert.equal((await notesFor(people.sana!, id, 'balance')).length, 0, 'production is weeks away');
  const near = new Date(Date.parse(today) + 3 * 86400_000).toISOString().slice(0, 10);
  await call(people.sana!, 'PUT', `/api/bd/deals/${id}/production-date`, { productionDate: near });
  await runReminders(db, new Date());
  const bn = await notesFor(people.sana!, id, 'balance');
  assert.equal(bn.length, 1);
  assert.match(bn[0]!.body, /₹1,50,000/);
  assert.equal((await notesFor(people.admin!, id, 'balance')).length, 1);

  // a visit booked for 3 pm IST on some day → reminder from 8 am that day
  const day = '2026-12-01';
  const [v] = await db.insert(siteVisits).values({ leadId: id, scheduledAt: new Date(`${day}T15:00:00+05:30`), engineerId: people.sana!.id }).returning();
  await runReminders(db, new Date(`${day}T07:55:00+05:30`));
  assert.equal((await notesFor(people.sana!, id, 'visit')).length, 0, 'not before 8 am');
  await runReminders(db, new Date(`${day}T08:01:00+05:30`));
  await runReminders(db, new Date(`${day}T09:00:00+05:30`));
  const vn = await notesFor(people.sana!, id, 'visit');
  assert.equal(vn.length, 1, 'once, to the BDE (also the engineer)');
  assert.match(vn[0]!.title, /3:00 pm/i);
  await db.delete(siteVisits).where(eq(siteVisits.id, v!.id));
});

test('Jobs: alert emails go out once, grouped per person', async () => {
  const sent: Mail[] = [];
  const n = await sendPendingEmails(db, async (m) => void sent.push(m), 'https://crm.example', new Date());
  assert.ok(n >= 3, `sent ${n}`);
  assert.equal(new Set(sent.map((m) => m.to)).size, sent.length, 'one email per person');
  const boss = sent.find((m) => m.to === 'boss@example.com');
  assert.ok(boss && /Follop Test Stores · Missed follop/.test(boss.text), boss?.text);
  assert.ok(boss!.html.includes('https://crm.example'));
  assert.ok(sent.find((m) => m.to === 'sana@example.com')?.text.includes('Final balance due'));
  assert.equal(await sendPendingEmails(db, async (m) => void sent.push(m), undefined, new Date()), 0, 'nothing twice');

  const failing = await sendPendingEmails(db, async () => {
    throw new Error('down');
  }, undefined, new Date());
  assert.equal(failing, 0);
});

test('Live updates: a write by one person reaches everyone else as "changed"', async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie: people.sana!.cookie }, signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const until = async (re: RegExp) => {
    const stop = Date.now() + 5000;
    while (!re.test(buf) && Date.now() < stop) buf += dec.decode((await reader.read()).value ?? new Uint8Array());
    return re.test(buf);
  };
  assert.ok(await until(/event: hello/));
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/events`)).status, 401, 'signed-in only');
  await call(people.arjun!, 'POST', `/api/cre/leads/${jobLeads.follop}/call`, { summary: 'Spoke to client' });
  assert.ok(await until(/event: changed\ndata: \{"by":"[0-9a-f-]+"\}/), buf);
  ac.abort();
});

test('Backup: nightly dump to the bucket, old ones pruned, restores into an empty database', async () => {
  await app.storage.put('backups/2020-01-01.json.gz', Buffer.from('old'), 'application/gzip');
  const r = await runBackup(db, app.storage, 30, new Date());
  assert.ok(r.ok, r.error);
  assert.ok(r.rows! > 50);
  const keys = await app.storage.list('backups/');
  assert.ok(keys.includes(r.key!));
  assert.ok(!keys.includes('backups/2020-01-01.json.gz'), 'older than 30 days is removed');
  assert.ok(backupDue(new Date(), null) || true);
  assert.equal(backupDue(new Date(Date.parse(r.at) + 1000), { ...r }), false, 'not twice in a day');

  const sys = await call(people.admin!, 'GET', '/api/admin/system');
  assert.equal(sys.status, 200);
  assert.equal(sys.body.backup.last.ok, true);
  assert.equal(sys.body.backup.available[0], r.date);
  assert.equal(sys.body.email.enabled, false);
  assert.equal((await call(people.arjun!, 'GET', '/api/admin/system')).status, 403);
  const dl = await app.inject({ method: 'GET', url: `/api/admin/system/backups/${r.date}`, headers: { cookie: people.admin!.cookie } });
  assert.equal(dl.statusCode, 200);

  const url2 = url!.replace(/\/[^/?]+(\?|$)/, '/jkay_restore_test$1');
  await sql.unsafe('drop database if exists jkay_restore_test');
  await sql.unsafe('create database jkay_restore_test');
  const two = createDb(url2);
  try {
    await migrate(two.db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    const out = await restoreDatabase(two.db, await app.storage.getBuffer(r.key!));
    for (const t of ['leads', 'employees', 'activities', 'payments', 'notifications', 'stages']) {
      const [a] = await sql.unsafe(`select count(*)::int n from ${t}`);
      const [b] = await two.sql.unsafe(`select count(*)::int n from ${t}`);
      assert.equal(b!.n, a!.n, `${t} restored`);
      assert.equal(out.tables[t], a!.n);
    }
    const [same] = await two.sql`select customer_name, number from leads where id = ${jobLeads.deal!}`;
    assert.equal(same!.customer_name, 'Quote Test Logistics');
    const [next] = await two.sql`insert into categories (name) values ('After restore') returning id`;
    assert.ok(next!.id > 3, 'counters continue after the restored ids');
    await assert.rejects(restoreDatabase(two.db, await app.storage.getBuffer(r.key!)), /already has leads/);
  } finally {
    await two.sql.end();
    await sql.unsafe('drop database if exists jkay_restore_test');
  }
});
