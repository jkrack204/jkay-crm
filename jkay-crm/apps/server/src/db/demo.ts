/**
 * Demo data for showing the CRM before real leads arrive.
 *
 *   loadDemo   ~24 believable leads spread over the last ~3 months across every
 *              stage of both desks (as Admin has them set up), with 3 demo CREs and
 *              2 demo BDEs, calls, follops, tags, notes, site visits, drawings,
 *              quotation versions, a pending discount, payments, wins and losses.
 *   removeDemo deletes exactly what loadDemo added (leads marked external_ref
 *              'demo:…', users named 'demo.…', their files in the bucket).
 *   eraseAll   deletes EVERY lead and everything hanging off it (files, alerts,
 *              inbound leads) plus the demo users, and restarts lead numbers at 1.
 *              Employees, stages, tags, categories, rules and templates stay.
 *
 * Only reachable from Admin › Settings while the DEMO_DATA variable is "true".
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import type { DB } from './client.js';
import * as s from './schema.js';
import { hashPassword } from '../auth/password.js';
import type { Storage } from '../storage.js';

export const DEMO_REF = 'demo:';
export const DEMO_USER_PREFIX = 'demo.';

type Status = { loaded: boolean; leads: number; users: { username: string; name: string; role: string }[]; password: string | null; loadedAt: string | null };

/* ------------------------------ tiny helpers ------------------------------ */
/** Seeded random, so every load looks the same. */
function rng(seed: number) {
  let x = seed >>> 0;
  const next = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
  return {
    next,
    int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)),
    pick: <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)]!,
    chance: (p: number) => next() < p,
  };
}
const DAY = 86_400_000;
const HOUR = 3_600_000;
const round = (n: number, to = 500) => Math.round(n / to) * to;

/** A one-page PDF with a few lines of text (drawings and quotations). */
function pdf(lines: string[]) {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, '-');
  const stream = ['BT /F1 20 Tf 60 760 Td', `(${esc(lines[0] ?? '')}) Tj`, '/F1 12 Tf', ...lines.slice(1).map((l) => `0 -24 Td (${esc(l)}) Tj`), 'ET'].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/** A simple "site photo" placeholder: floor, back wall and a few rack uprights. */
function photo(seed: number) {
  const w = 480, h = 360;
  const r = rng(seed);
  const wall = [r.int(170, 205), r.int(165, 195), r.int(150, 180)];
  const floor = [r.int(120, 150), r.int(118, 140), r.int(110, 130)];
  const posts = Array.from({ length: r.int(3, 6) }, () => r.int(40, w - 40));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const base = y < h * 0.55 ? wall : floor;
      const shade = y < h * 0.55 ? 1 - y / (h * 3) : 0.8 + (y / h) * 0.2;
      let c = base.map((v) => v * shade);
      if (y >= h * 0.55 && (x + y) % 60 < 2) c = c.map((v) => v * 0.85); // floor tiles
      if (posts.some((p) => Math.abs(x - p) < 4) && y > h * 0.18 && y < h * 0.8) c = [70, 86, 120]; // blue uprights
      if (y % 70 < 4 && y > h * 0.2 && y < h * 0.78 && posts.some((p) => x > p - 4 && x < p + 70)) c = [205, 120, 60]; // orange beams
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]!;
      raw[o + 1] = c[1]!;
      raw[o + 2] = c[2]!;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* -------------------------------- the data -------------------------------- */
const BUSINESSES = [
  'Sri Balaji Supermarket', 'Annapoorna Departmental Store', 'KPR Hardware Mart', 'Velan Pharma Distributors', 'Kovai Cold Storage',
  'Royal Textiles Warehouse', 'Murugan Stores', 'Kaveri Agro Foods', 'Green Leaf Organics', 'Metro Auto Spares', 'Sakthi Electricals',
  'Lakshmi Book Depot', 'Ganesh Steel Traders', 'Nilgiri Tea Traders', 'Salem Silk House', 'Trichy Medicals', 'Erode Turmeric Exports',
  'Madurai Mega Mart', 'Om Sai Logistics', 'Vijay Footwear', 'Daily Fresh Hypermarket', 'Anand Electronics', 'Sri Krishna Sweets',
  'Pune Tyre House', 'Nashik Grapes Cold Chain', 'Thane Pharma Wholesale', 'Vasavi Paper Mart', 'Kongu Engineering Stores',
  'Amman Kitchenware', 'Ramraj Garments Godown', 'Bhavani Rice Mill', 'Tiruppur Knit Exports', 'Hosur Auto Components', 'Selvam Agencies',
  'Classic Furniture World', 'Chennai Book Centre', 'Prakash Paints', 'Supreme Plastics', 'Jaya Provision Stores', 'Arogya Pharmacy',
  'Velmurugan Tiles', 'Arun Ice Creams Depot', 'Sri Venkateswara Traders', 'Mahalakshmi Silks', 'Global Mobiles', 'Shree Ganesh Hardware',
  'Fresh Basket', 'City Mart Chain', 'Annai Wholesale', 'Royal Enfield Spares Hub',
];
const CONTACTS = [
  'Ramesh Kumar', 'Senthil Nathan', 'Lakshmi Priya', 'Mohammed Irfan', 'Karthik Raja', 'Divya S.', 'Suresh Babu', 'Anitha R.', 'Vignesh M.',
  'Prakash Rao', 'Meena K.', 'Rajesh Patil', 'Sunil Jadhav', 'Kavitha Devi', 'Arvind Iyer', 'Nandhini V.', 'Gopal Krishnan', 'Farhan Shaikh',
];
const PLACES = ['Coimbatore, TN', 'Erode, TN', 'Salem, TN', 'Tiruppur, TN', 'Trichy, TN', 'Madurai, TN', 'Hosur, TN', 'Chennai, TN', 'Pune, MH', 'Nashik, MH', 'Thane, MH', 'Bengaluru, KA'];
const NEEDS = [
  'Slotted angle racks for a 1,200 sq ft godown',
  'Heavy-duty pallet racking, 3 levels, 40 bays',
  'Supermarket gondola racks, 40 ft run',
  'Pharmacy wall racks with drawers',
  'Mezzanine floor with racks underneath',
  'Stainless steel racks for a cold room',
  'Boltless shelving for the stock room',
  'Cantilever racks for steel pipes',
  'Display racks for a garment showroom',
  'Mobile compactor storage for files',
  'Wire mesh racks for a dairy chiller',
  'Medium-duty racks for spare parts bins',
];
const PLATFORM_MIX = ['indiamart', 'indiamart', 'justdial', 'justdial', 'meta', 'meta', 'google', 'website', 'sulekha', 'walkin'] as const;
const SOURCE_LABEL: Record<string, string> = {
  indiamart: 'IndiaMART buy lead', justdial: 'Justdial enquiry', meta: 'Facebook lead form · Racks campaign', google: 'Google Ads lead form',
  website: 'Website enquiry form', sulekha: 'Sulekha service lead', walkin: 'Walk-in at Coimbatore office',
};
const CALLS = [
  'Spoke to the owner — wants racks before the festive stock arrives.',
  'Confirmed floor size and ceiling height; needs 3 levels.',
  'Asked for the catalogue on WhatsApp, will discuss with partner.',
  'Customer comparing with a local fabricator; price-sensitive.',
  'Interested, wants a site visit this week.',
  'Shared rough budget; asked about delivery time.',
  'Call back after 5 pm — owner in the market till then.',
  'Needs GST invoice and 3-year warranty in writing.',
];
const CRE_NOTES = [
  'Decision maker is the elder brother — call after 6 pm.',
  'Has an old rack set from 2019, wants matching colour (blue uprights).',
  'Prefers Tamil on calls.',
  'Godown is on the first floor — check stair width for delivery.',
  'Referred by Murugan Stores.',
];
const BD_NOTES = [
  'Slab level dips 40 mm at the west wall — allow levelling plates.',
  'Client wants the quote split into two phases.',
  'Competitor quoted ₹2,000/bay less, but thinner gauge.',
  'Advance promised after Diwali sales close.',
];

/** A business named after a town is in that town; the rest are spread around. */
const TOWN: [RegExp, string][] = [
  [/kovai|coimbatore/i, 'Coimbatore, TN'], [/salem/i, 'Salem, TN'], [/erode|kongu|bhavani/i, 'Erode, TN'], [/trichy/i, 'Trichy, TN'],
  [/madurai/i, 'Madurai, TN'], [/hosur/i, 'Hosur, TN'], [/chennai/i, 'Chennai, TN'], [/tiruppur/i, 'Tiruppur, TN'], [/nilgiri/i, 'Ooty, TN'],
  [/pune/i, 'Pune, MH'], [/nashik/i, 'Nashik, MH'], [/thane/i, 'Thane, MH'],
];
const placeFor = (name: string, pick: () => string) => TOWN.find(([re]) => re.test(name))?.[1] ?? pick();
/** What a business of that kind would ask for. */
const NEED_BY_KIND: [RegExp, string[]][] = [
  [/pharma|medical|arogya/i, ['Pharmacy wall racks with drawers', 'Medium-duty racks for medicine cartons']],
  [/cold|ice cream|dairy|grapes/i, ['Stainless steel racks for a cold room', 'Wire mesh racks for a dairy chiller']],
  [/garment|silk|textile|knit|footwear|furniture/i, ['Display racks for a showroom', 'Boltless shelving for the stock room']],
  [/steel|tyre|auto|spares|components|hardware|electrical|engineering|tiles|paints|plastics/i, ['Medium-duty racks for spare parts bins', 'Cantilever racks for steel pipes', 'Heavy-duty pallet racking, 3 levels, 40 bays']],
  [/super|mart|stores?$|hyper|basket|provision|departmental/i, ['Supermarket gondola racks, 40 ft run', 'Supermarket gondola racks with end caps']],
  [/book|paper/i, ['Boltless shelving for the stock room', 'Mobile compactor storage for files']],
  [/logistics|wholesale|agencies|traders|rice|agro|tea|turmeric|exports|kitchenware|sweets|mobiles|electronics/i, ['Heavy-duty pallet racking, 3 levels, 40 bays', 'Mezzanine floor with racks underneath', 'Slotted angle racks for a 1,200 sq ft godown']],
];
const needFor = (name: string, pick: <T>(a: readonly T[]) => T) => pick(NEED_BY_KIND.find(([re]) => re.test(name))?.[1] ?? NEEDS);

/* ------------------------------- status / guard ------------------------------- */
export async function demoStatus(db: DB): Promise<Status> {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(s.leads).where(like(s.leads.externalRef, `${DEMO_REF}%`));
  const users = await db
    .select({ username: s.employees.username, name: s.employees.fullName, role: s.employees.role })
    .from(s.employees)
    .where(like(s.employees.username, `${DEMO_USER_PREFIX}%`))
    .orderBy(asc(s.employees.role), asc(s.employees.username));
  const [st] = await db.select().from(s.appSettings).where(eq(s.appSettings.key, 'demo_data'));
  const v = (st?.value ?? {}) as { password?: string; loadedAt?: string };
  return { loaded: (n?.n ?? 0) > 0 || users.length > 0, leads: n?.n ?? 0, users, password: users.length ? (v.password ?? null) : null, loadedAt: v.loadedAt ?? null };
}

/* ----------------------------------- load ----------------------------------- */
export async function loadDemo(db: DB, storage: Storage, byAdminId: string | null, now = new Date()) {
  if ((await demoStatus(db)).loaded) throw new Error('Demo data is already loaded — remove it first');
  if (!storage.ready) throw new Error('The storage bucket is not set up, so drawings, quotations and photos cannot be added');

  const r = rng(20261114);
  const T = now.getTime();
  const at = (msAgo: number) => new Date(T - msAgo);
  const password = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x') + '7';
  const hash = await hashPassword(password);

  const stageRows = await db.select().from(s.stages).where(isNull(s.stages.archivedAt)).orderBy(asc(s.stages.position));
  const one = (desk: 'cre' | 'bd', kind: string) => {
    const x = stageRows.find((t) => t.desk === desk && t.kind === kind);
    if (!x) throw new Error(`No "${kind}" stage on the ${desk.toUpperCase()} desk`);
    return x;
  };
  const crePool = one('cre', 'pool'), creHandoff = one('cre', 'handoff'), creLost = one('cre', 'lost'), bdWon = one('bd', 'won'), bdLost = one('bd', 'lost');
  const creWorking = stageRows.filter((t) => t.desk === 'cre' && t.kind === 'working');
  const bdWorking = stageRows.filter((t) => t.desk === 'bd' && t.kind === 'working');
  if (!creWorking.length || bdWorking.length < 2) throw new Error('Set up at least one CRE and two BD working stages first');
  // first BD stage that needs a quotation (never the first stage — that's measurement)
  const qi = bdWorking.findIndex((t) => t.requiresQuotation);
  const quoteFrom = qi >= 1 ? qi : Math.min(2, bdWorking.length - 1);

  const tagRows = await db.select().from(s.tags).where(isNull(s.tags.archivedAt));
  const tagsOf = (scope: string, stageId?: number) => tagRows.filter((t) => t.scope === scope && (stageId === undefined ? !t.stageId : t.stageId === stageId));
  const creLostReasons = tagsOf('cre_lost'), bdLostReasons = tagsOf('bd_lost');
  if (!creLostReasons.length || !bdLostReasons.length) throw new Error('Each desk needs at least one lost reason');
  const cats = await db.select().from(s.categories).where(isNull(s.categories.archivedAt));

  // inserts collected per table
  const rows = {
    leads: [] as (typeof s.leads.$inferInsert)[],
    owners: [] as (typeof s.leadOwners.$inferInsert)[],
    history: [] as (typeof s.stageHistory.$inferInsert)[],
    acts: [] as (typeof s.activities.$inferInsert)[],
    leadTags: [] as (typeof s.leadTags.$inferInsert)[],
    notes: [] as (typeof s.notes.$inferInsert)[],
    followups: [] as (typeof s.followups.$inferInsert)[],
    visits: [] as (typeof s.siteVisits.$inferInsert)[],
    payments: [] as (typeof s.payments.$inferInsert)[],
    notifs: [] as (typeof s.notifications.$inferInsert)[],
    files: [] as { leadId: string; kind: 'photo' | 'cad' | 'quotation'; fileName: string; mime: string; body: Buffer; by: string; at: Date; cadRev?: number; cadNote?: string; quote?: { version: number; amount: number; note: string | null } }[],
    discounts: [] as { leadId: string; version: number; percent: number; amount: number; reason: string; status: 'pending' | 'approved'; by: string; at: Date }[],
  };

  return db.transaction(async (tx) => {
    /* people */
    const people = [
      ['arjun', 'Arjun Mehta', 'cre', 'Coimbatore · Erode'],
      ['priya', 'Priya Raman', 'cre', 'Salem · Trichy'],
      ['fatima', 'Fatima Qureshi', 'cre', 'Pune · Nashik'],
      ['sana', 'Sana Kapoor', 'bde', 'Coimbatore · Tiruppur'],
      ['rohan', 'Rohan Desai', 'bde', 'Pune · Thane'],
    ] as const;
    const made = await tx
      .insert(s.employees)
      .values(
        people.map(([u, name, role, territory], i) => ({
          username: DEMO_USER_PREFIX + u,
          passwordHash: hash,
          fullName: name,
          role,
          email: `${u}@demo.invalid`,
          phone: `9198200411${10 + i}`,
          territory,
          createdAt: at(120 * DAY),
          createdBy: byAdminId,
        })),
      )
      .returning();
    const id = (u: string) => made.find((e) => e.username === DEMO_USER_PREFIX + u)!.id;
    const nameOf = new Map(made.map((e) => [e.id, e.fullName]));

    let n = 0;
    const phoneUsed = new Set<string>();
    const phone = () => {
      let p: string;
      do p = `91${r.pick(['9', '8', '7'])}${String(r.int(100000000, 999999999))}`;
      while (phoneUsed.has(p));
      phoneUsed.add(p);
      return p;
    };

    type Plan = { where: 'pool' | 'cre' | 'creLost' | 'bd' | 'won' | 'bdLost'; stageIdx?: number; age: number };
    const plans: Plan[] = [];
    // pool: fresh, one sitting past the unclaimed alert
    plans.push({ where: 'pool', age: 0.1 }, { where: 'pool', age: 0.6 }, { where: 'pool', age: 1.3 });
    const creCounts = creWorking.length === 3 ? [2, 3, 2] : creWorking.map(() => 2);
    creCounts.forEach((c, i) => {
      for (let k = 0; k < c; k++) plans.push({ where: 'cre', stageIdx: i, age: r.int(2, 24) + r.next() });
    });
    for (let k = 0; k < 2; k++) plans.push({ where: 'creLost', age: r.int(12, 85) });
    const bdCounts = bdWorking.length === 5 ? [2, 1, 2, 2, 1] : bdWorking.map(() => 1);
    bdCounts.forEach((c, i) => {
      for (let k = 0; k < c; k++) plans.push({ where: 'bd', stageIdx: i, age: 12 + i * 6 + r.int(0, 18) });
    });
    for (let k = 0; k < 3; k++) plans.push({ where: 'won', age: 20 + k * 20 + r.int(0, 6) });
    plans.push({ where: 'bdLost', age: r.int(30, 70) });

    const discountFor = new Set([bdWorking.findIndex((_, i) => i === Math.min(quoteFrom + 1, bdWorking.length - 1))]);
    let discountGiven = false;

    for (const p of plans) {
      const leadId = randomUUID();
      const name = BUSINESSES[n % BUSINESSES.length]!;
      n++;
      const created = at(p.age * DAY);
      const platform = r.pick(PLATFORM_MIX);
      const estimate = round(r.int(8, 140) * 10_000, 5_000);
      const place = placeFor(name, () => r.pick(PLACES));
      // each person works their own territory
      const cre = place.endsWith('MH') ? id('fatima') : /Salem|Trichy|Madurai/.test(place) ? id('priya') : id('arjun');
      const bde = place.endsWith('MH') ? id('rohan') : id('sana');
      const lead: typeof s.leads.$inferInsert = {
        id: leadId,
        customerName: name,
        contactName: r.pick(CONTACTS),
        phone: phone(),
        place,
        requirement: needFor(name, r.pick),
        categoryId: cats.length ? r.pick(cats).id : null,
        platform,
        sourceLabel: SOURCE_LABEL[platform] ?? null,
        externalRef: `${DEMO_REF}${n}`,
        desk: 'cre',
        creStageId: crePool.id,
        estimate: p.where === 'pool' ? null : estimate,
        createdAt: created,
        updatedAt: created,
      };
      const act = (when: Date, desk: 'cre' | 'bd' | null, kind: string, title: string, body: string | null = null, actor: string | null = null) =>
        rows.acts.push({ leadId, actorId: actor, desk, kind, title, body, at: when });
      const hist = (desk: 'cre' | 'bd', from: number | null, to: number, when: Date, by: string | null) => rows.history.push({ leadId, desk, fromStageId: from, toStageId: to, byId: by, at: when });
      const stint = (owner: string | null, desk: 'cre' | 'bd', reason: (typeof s.leadOwners.$inferInsert)['reason'], from: Date, to: Date | null, by: string | null, note: string | null = null) =>
        rows.owners.push({ leadId, ownerId: owner, desk, reason, byId: by, note, startedAt: from, endedAt: to });

      act(created, 'cre', 'created', `Lead came in from ${SOURCE_LABEL[platform]}`, lead.requirement ?? null);
      hist('cre', null, crePool.id, created, null);

      if (p.where === 'pool') {
        stint(null, 'cre', 'intake', created, null, null);
        lead.ownerSince = created;
        rows.leads.push(lead);
        continue;
      }

      /* claimed by a CRE */
      const claimed = new Date(created.getTime() + r.int(1, 10) * HOUR);
      stint(null, 'cre', 'intake', created, claimed, null);
      act(claimed, 'cre', 'claim', 'Claimed from the pool', null, cre);
      let cur = creWorking[0]!.id;
      hist('cre', crePool.id, cur, claimed, cre);
      let t = claimed.getTime();
      const step = (minH: number, maxH: number) => (t = Math.min(T - HOUR, t + r.int(minH, maxH) * HOUR));
      const call = (who: string, desk: 'cre' | 'bd' = 'cre') => {
        step(4, 40);
        act(new Date(t), desk, 'call', 'Call logged', r.pick(CALLS), who);
        lead.lastContactAt = new Date(t);
      };
      call(cre);
      if (r.chance(0.6)) {
        step(1, 6);
        act(new Date(t), 'cre', 'whatsapp', 'WhatsApp opened', 'Template: Ask for photos', cre);
      }
      if (r.chance(0.5)) {
        const tg = tagsOf('cre');
        if (tg.length) {
          const tag = r.pick(tg);
          rows.leadTags.push({ leadId, tagId: tag.id, addedById: cre, addedAt: new Date(t) });
          act(new Date(t), 'cre', 'tag', `Tagged ${tag.name}`, null, cre);
        }
      }
      if (r.chance(0.45)) rows.notes.push({ leadId, authorId: cre, scope: 'cre', text: r.pick(CRE_NOTES), createdAt: new Date(t), updatedAt: new Date(t) });
      if (r.chance(0.5)) {
        const ph = photo(n);
        rows.files.push({ leadId, kind: 'photo', fileName: `site-photo-${n}.png`, mime: 'image/png', body: ph, by: cre, at: new Date(t) });
      }

      const creOpen = p.where === 'cre';
      const stageIdx = creOpen ? p.stageIdx! : creWorking.length - 1;
      for (let i = 1; i <= Math.min(stageIdx, creWorking.length - 1); i++) {
        step(6, 30);
        const st = creWorking[i]!;
        hist('cre', cur, st.id, new Date(t), cre);
        act(new Date(t), 'cre', 'stage', `Stage set to ${st.name}`, null, cre);
        cur = st.id;
      }

      if (creOpen) {
        const st = creWorking[stageIdx]!;
        lead.creStageId = st.id;
        lead.ownerId = cre;
        lead.ownerSince = claimed;
        stint(cre, 'cre', 'claim', claimed, null, cre);
        if (st.requiresStageTag) {
          const tg = tagsOf('cre', st.id);
          if (tg.length) lead.stageTagId = r.pick(tg).id;
        }
        // most open leads were touched recently; a couple have gone quiet
        const quiet = r.chance(0.12);
        const last = at(quiet ? r.int(7, 10) * DAY : r.int(2, 70) * HOUR);
        if (last > claimed) {
          act(last, 'cre', 'call', 'Call logged', r.pick(CALLS), cre);
          lead.lastContactAt = last;
        }
        if (st.requiresFollowup || r.chance(0.4)) {
          const due = new Date(Math.round((T + r.pick([-0.5, 2, 5, 20, 26, 30, 50, 75]) * HOUR) / (30 * 60_000)) * 30 * 60_000);
          rows.followups.push({ leadId, ownerId: cre, dueAt: due, note: r.pick(['Confirm site size', 'Send catalogue', 'Ask for site photos', 'Check budget with partner']), createdById: cre, createdAt: last, remindedAt: due < now ? now : null });
          lead.nextFollowupAt = due;
        }
        rows.leads.push(lead);
        continue;
      }

      if (p.where === 'creLost') {
        step(10, 60);
        const reason = r.pick(creLostReasons);
        lead.creStageId = creLost.id;
        lead.ownerId = cre;
        lead.ownerSince = claimed;
        lead.lostAt = new Date(t);
        lead.lostDesk = 'cre';
        lead.lostReasonId = reason.id;
        lead.lostById = cre;
        stint(cre, 'cre', 'claim', claimed, null, cre);
        hist('cre', cur, creLost.id, new Date(t), cre);
        act(new Date(t), 'cre', 'lost', `Marked lost · ${reason.name}`, null, cre);
        rows.leads.push(lead);
        continue;
      }

      /* handed to BD */
      step(12, 60);
      const handed = new Date(t);
      hist('cre', cur, creHandoff.id, handed, cre);
      act(handed, 'cre', 'handoff', `Handed to ${nameOf.get(bde)}`, 'Qualified — budget confirmed, site ready for measurement.', cre);
      stint(cre, 'cre', 'claim', claimed, handed, cre);
      stint(bde, 'bd', 'handoff', handed, null, cre, 'Qualified — budget confirmed, site ready for measurement.');
      Object.assign(lead, { desk: 'bd', creStageId: creHandoff.id, qualifiedById: cre, qualifiedAt: handed, ownerId: bde, ownerSince: handed });
      let bdCur = bdWorking[0]!.id;
      hist('bd', null, bdCur, handed, cre);
      if (handed.getTime() > T - 4 * DAY) rows.notifs.push({ recipientId: bde, kind: 'handoff', leadId, title: `${nameOf.get(cre)} handed you a deal`, body: name, createdAt: handed });

      const target = p.where === 'bd' ? p.stageIdx! : p.where === 'won' ? bdWorking.length : r.int(1, bdWorking.length - 1);
      const moveTo = (i: number) => {
        const st = bdWorking[i]!;
        if (st.id === bdCur) return;
        hist('bd', bdCur, st.id, new Date(t), bde);
        act(new Date(t), 'bd', 'stage', `Moved to ${st.name}`, null, bde);
        bdCur = st.id;
      };
      call(bde, 'bd');

      // site visit
      const engineer = r.chance(0.4) ? { engineerName: r.pick(['Ravi Bhosale', 'Faisal Sheikh', 'Murali K.']) } : { engineerId: bde };
      if (target === 0) {
        const when = new Date(T - (T % DAY) + r.int(1, 6) * DAY + (r.int(20, 33) / 2 - 5.5) * HOUR); // 10:00–4:30 pm IST
        rows.visits.push({ leadId, scheduledAt: when, ...engineer, note: 'Bring laser measure; ceiling ~4.2 m', status: 'booked', createdById: bde, createdAt: new Date(t) });
        act(new Date(t), 'bd', 'visit', 'Site visit booked', null, bde);
      } else {
        step(24, 72);
        rows.visits.push({ leadId, scheduledAt: new Date(t), ...engineer, status: 'done', doneAt: new Date(t), createdById: bde, createdAt: new Date(t - 2 * DAY) });
        act(new Date(t), 'bd', 'visit', 'Site measured', r.pick(BD_NOTES), bde);
        moveTo(1);
        step(24, 60);
        rows.files.push({ leadId, kind: 'cad', fileName: `${name.split(' ')[0]}-layout-rev1.pdf`, mime: 'application/pdf', by: bde, at: new Date(t), cadRev: 1, cadNote: 'First layout from site measurements',
          body: pdf([`${name} — rack layout rev 1`, `Site: ${lead.place}`, `Requirement: ${lead.requirement}`, 'Bays: 28 · Levels: 3 · Aisle 1.2 m', 'DEMO DRAWING — sample data']) });
        act(new Date(t), 'bd', 'cad', 'Drawing rev 1 uploaded', null, bde);
        if (r.chance(0.4)) {
          step(24, 48);
          rows.files.push({ leadId, kind: 'cad', fileName: `${name.split(' ')[0]}-layout-rev2.pdf`, mime: 'application/pdf', by: bde, at: new Date(t), cadRev: 2, cadNote: 'Client asked for a wider aisle',
            body: pdf([`${name} — rack layout rev 2`, 'Aisle widened to 1.5 m', 'DEMO DRAWING — sample data']) });
          act(new Date(t), 'bd', 'cad', 'Drawing rev 2 uploaded', null, bde);
        }
        if (r.chance(0.5)) rows.notes.push({ leadId, authorId: bde, scope: 'bd', text: r.pick(BD_NOTES), createdAt: new Date(t), updatedAt: new Date(t) });
      }

      // quotations
      let lastQuote = 0;
      let version = 0;
      const quote = (amount: number, note: string | null) => {
        version++;
        step(24, 72);
        lastQuote = amount;
        rows.files.push({ leadId, kind: 'quotation', fileName: `${name.split(' ')[0]}-quotation-v${version}.pdf`, mime: 'application/pdf', by: bde, at: new Date(t), quote: { version, amount, note },
          body: pdf([`Quotation v${version} — ${name}`, `Amount: Rs ${amount.toLocaleString('en-IN')} + GST`, `Scope: ${lead.requirement}`, 'Valid for 15 days', 'DEMO QUOTATION — sample data']) });
        act(new Date(t), 'bd', 'quotation', `Quotation v${version} · ₹${amount.toLocaleString('en-IN')}`, note, bde);
      };
      const reachesQuote = target >= quoteFrom;
      if (reachesQuote) {
        const base = round(estimate * (0.9 + r.next() * 0.3), 1000);
        quote(base, null);
        moveTo(quoteFrom);
        for (let i = quoteFrom + 1; i < Math.min(target + 1, bdWorking.length); i++) {
          if (bdWorking[i]!.requiresQuotation && r.chance(0.6)) quote(round(lastQuote * (0.95 + r.next() * 0.03), 1000), 'Revised after negotiation');
          step(12, 48);
          moveTo(i);
        }
        if (p.where === 'bd' && discountFor.has(p.stageIdx!) && !discountGiven) {
          discountGiven = true;
          const ask = round(lastQuote * 0.88, 1000);
          step(2, 10);
          rows.discounts.push({ leadId, version, percent: 12, amount: ask, reason: 'Competitor quoted 12% lower with thinner gauge; client ready to sign at this price.', status: 'pending', by: bde, at: new Date(t) });
          act(new Date(t), 'bd', 'discount', 'Discount of 12% requested', null, bde);
        }
      } else if (p.where === 'bd') {
        for (let i = 1; i <= target; i++) moveTo(i);
      }
      if (p.where === 'bd') {
        const last = at(r.chance(0.15) ? r.int(8, 11) * DAY : r.int(3, 60) * HOUR);
        if (last.getTime() > t) {
          act(last, 'bd', 'call', 'Call logged', r.pick(CALLS), bde);
          lead.lastContactAt = last;
        }
        lead.bdStageId = bdCur;
        rows.leads.push(lead);
        continue;
      }

      if (p.where === 'bdLost') {
        step(48, 200);
        const reason = r.pick(bdLostReasons);
        hist('bd', bdCur, bdLost.id, new Date(t), bde);
        act(new Date(t), 'bd', 'lost', `Marked lost · ${reason.name}`, null, bde);
        Object.assign(lead, { bdStageId: bdLost.id, lostAt: new Date(t), lostDesk: 'bd', lostReasonId: reason.id, lostById: bde });
        rows.notifs.push({ recipientId: cre, kind: 'lost', leadId, title: `${name} lost on the BD desk`, body: reason.name, createdAt: new Date(t) });
        rows.leads.push(lead);
        continue;
      }

      /* won: advance, then installments; production date */
      step(48, 120);
      const won = new Date(t);
      const value = lastQuote;
      hist('bd', bdCur, bdWon.id, won, bde);
      Object.assign(lead, { bdStageId: bdWon.id, wonAt: won, contractValue: value });
      const adv = round(value * r.pick([0.3, 0.4, 0.5]), 1000);
      rows.payments.push({ leadId, kind: 'advance', amount: adv, receivedOn: won.toISOString().slice(0, 10), mode: r.pick(['NEFT', 'RTGS', 'UPI'] as const), reference: `UTR${r.int(100000, 999999)}`, recordedById: bde, createdAt: won });
      act(won, 'bd', 'payment', `Advance ₹${adv.toLocaleString('en-IN')} received`, null, bde);
      act(won, 'bd', 'won', `Won · ₹${value.toLocaleString('en-IN')}`, null, bde);
      let paid = adv;
      const ageDays = (T - won.getTime()) / DAY;
      const prodOffset = ageDays > 40 ? -r.int(5, 20) : r.pick([3, 4, 12, 18]);
      lead.productionDate = new Date(T + prodOffset * DAY).toISOString().slice(0, 10);
      if (ageDays > 15) {
        const inst = round((value - adv) * 0.5, 1000);
        const d = new Date(won.getTime() + 10 * DAY);
        rows.payments.push({ leadId, kind: 'installment', amount: inst, receivedOn: d.toISOString().slice(0, 10), mode: 'NEFT', reference: `UTR${r.int(100000, 999999)}`, recordedById: bde, createdAt: d });
        act(d, 'bd', 'payment', `Installment ₹${inst.toLocaleString('en-IN')} received`, null, bde);
        paid += inst;
      }
      if (prodOffset < 0) {
        const d = new Date(T + (prodOffset - 2) * DAY);
        rows.payments.push({ leadId, kind: 'final', amount: value - paid, receivedOn: d.toISOString().slice(0, 10), mode: 'RTGS', reference: `UTR${r.int(100000, 999999)}`, recordedById: bde, createdAt: d });
        act(d, 'bd', 'payment', `Final balance ₹${(value - paid).toLocaleString('en-IN')} received`, 'Fully paid', bde);
      }
      lead.lastContactAt = new Date(Math.min(T - HOUR, won.getTime() + 3 * DAY));
      rows.leads.push(lead);
    }

    /* write it all */
    const chunks = <T,>(a: T[], k = 200) => Array.from({ length: Math.ceil(a.length / k) }, (_, i) => a.slice(i * k, i * k + k));
    for (const c of chunks(rows.leads)) await tx.insert(s.leads).values(c);
    for (const c of chunks(rows.owners)) await tx.insert(s.leadOwners).values(c);
    for (const c of chunks(rows.history)) await tx.insert(s.stageHistory).values(c);
    for (const c of chunks(rows.acts)) await tx.insert(s.activities).values(c);
    if (rows.leadTags.length) await tx.insert(s.leadTags).values(rows.leadTags).onConflictDoNothing();
    if (rows.notes.length) await tx.insert(s.notes).values(rows.notes);
    if (rows.followups.length) await tx.insert(s.followups).values(rows.followups);
    if (rows.visits.length) await tx.insert(s.siteVisits).values(rows.visits);
    if (rows.payments.length) await tx.insert(s.payments).values(rows.payments);
    if (rows.notifs.length) await tx.insert(s.notifications).values(rows.notifs);

    // files go to the bucket first, then their rows
    const quoteIds = new Map<string, number>();
    for (const f of rows.files) {
      const key = `leads/${f.leadId}/${f.kind}/demo-${randomBytes(4).toString('hex')}-${f.fileName}`;
      await storage.put(key, f.body, f.mime);
      const [a] = await tx
        .insert(s.attachments)
        .values({ leadId: f.leadId, kind: f.kind, bucket: storage.bucket, path: key, fileName: f.fileName, mime: f.mime, sizeBytes: f.body.length, uploadedById: f.by, createdAt: f.at })
        .returning({ id: s.attachments.id });
      if (f.cadRev) await tx.insert(s.cadRevisions).values({ leadId: f.leadId, rev: f.cadRev, attachmentId: a!.id, note: f.cadNote ?? null, byId: f.by, createdAt: f.at });
      if (f.quote) {
        const [q] = await tx
          .insert(s.quotations)
          .values({ leadId: f.leadId, version: f.quote.version, amount: f.quote.amount, attachmentId: a!.id, note: f.quote.note, byId: f.by, createdAt: f.at })
          .returning({ id: s.quotations.id });
        quoteIds.set(`${f.leadId}:${f.quote.version}`, q!.id);
      }
    }
    const admins = (await tx.select({ id: s.employees.id }).from(s.employees).where(and(eq(s.employees.role, 'admin'), eq(s.employees.active, true)))).map((a) => a.id);
    for (const d of rows.discounts) {
      await tx.insert(s.discountRequests).values({ leadId: d.leadId, quotationId: quoteIds.get(`${d.leadId}:${d.version}`) ?? null, percent: String(d.percent), proposedAmount: d.amount, reason: d.reason, status: d.status, requestedById: d.by, createdAt: d.at });
      const lead = rows.leads.find((l) => l.id === d.leadId)!;
      if (admins.length) await tx.insert(s.notifications).values(admins.map((a) => ({ recipientId: a, kind: 'discount', leadId: d.leadId, title: `Discount request · ${d.percent}%`, body: `${nameOf.get(d.by)} on ${lead.customerName}`, createdAt: d.at })));
    }

    await tx
      .insert(s.appSettings)
      .values({ key: 'demo_data', value: { password, loadedAt: now.toISOString() } })
      .onConflictDoUpdate({ target: s.appSettings.key, set: { value: { password, loadedAt: now.toISOString() }, updatedAt: now } });

    return { leads: rows.leads.length, files: rows.files.length, password };
  });
}

/* ---------------------------------- remove ---------------------------------- */
async function deleteFiles(storage: Storage, paths: string[]) {
  let failed = 0;
  for (const p of paths) await storage.remove(p).catch(() => failed++);
  return failed;
}

/** Deletes the demo users. One still tied to real records is disabled instead. */
async function dropDemoUsers(db: DB) {
  const users = await db.select().from(s.employees).where(like(s.employees.username, `${DEMO_USER_PREFIX}%`));
  let removed = 0;
  const kept: string[] = [];
  for (const u of users) {
    try {
      await db.transaction(async (tx) => {
        await tx.delete(s.messageTemplates).where(eq(s.messageTemplates.ownerId, u.id));
        await tx.delete(s.employees).where(eq(s.employees.id, u.id));
      });
      removed++;
    } catch {
      await db.update(s.employees).set({ active: false }).where(eq(s.employees.id, u.id));
      await db.delete(s.sessions).where(eq(s.sessions.employeeId, u.id));
      kept.push(u.fullName);
    }
  }
  await db.delete(s.appSettings).where(eq(s.appSettings.key, 'demo_data'));
  return { removed, kept };
}

export async function removeDemo(db: DB, storage: Storage) {
  const demoLeads = await db.select({ id: s.leads.id }).from(s.leads).where(like(s.leads.externalRef, `${DEMO_REF}%`));
  const ids = demoLeads.map((l) => l.id);
  let paths: string[] = [];
  if (ids.length) {
    paths = (await db.select({ path: s.attachments.path }).from(s.attachments).where(inArray(s.attachments.leadId, ids))).map((a) => a.path);
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i += 500) await tx.delete(s.leads).where(inArray(s.leads.id, ids.slice(i, i + 500)));
    });
  }
  const filesFailed = await deleteFiles(storage, paths);
  const users = await dropDemoUsers(db);
  return { leads: ids.length, files: paths.length, filesFailed, users };
}

/** Wipes every lead (demo or not) and the demo users; restarts lead numbers at 1. */
export async function eraseAll(db: DB, storage: Storage) {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(s.leads);
  const paths = (await db.select({ path: s.attachments.path }).from(s.attachments)).map((a) => a.path);
  await db.transaction(async (tx) => {
    await tx.delete(s.inboundLeads);
    await tx.delete(s.notifications);
    await tx.delete(s.reminderLog);
    await tx.delete(s.leads); // everything hanging off a lead goes with it
    await tx.execute(sql`select setval(pg_get_serial_sequence('leads', 'number'), 1, false)`);
  });
  // anything left in the bucket under leads/ (orphans included)
  if (storage.ready) {
    const stray = await storage.list('leads/').catch(() => [] as string[]);
    for (const k of stray) if (!paths.includes(k)) paths.push(k);
  }
  const filesFailed = await deleteFiles(storage, paths);
  const users = await dropDemoUsers(db);
  return { leads: n?.n ?? 0, files: paths.length, filesFailed, users };
}
