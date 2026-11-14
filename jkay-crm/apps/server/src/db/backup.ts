/**
 * Our own database backup, on top of Railway's.
 *
 * Format: gzipped JSON lines. Line 1 is a header; every other line is one row:
 *   {"jkayBackup":1,"at":"…","tables":{"leads":120,…}}
 *   {"t":"leads","r":{…row exactly as Postgres renders it to JSON…}}
 *
 * Postgres itself turns each row to JSON (row_to_json) and back (json_populate_recordset),
 * so every type — timestamps, numerics, jsonb, enums — round-trips without our code
 * knowing about it, and new tables are picked up automatically.
 * Login sessions are left out; everyone signs in again after a restore.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import type { DB } from './client.js';

type Exec = Pick<DB, 'execute'>;
const SKIP = new Set(['sessions']);

/** Public tables in an order where every table comes after the ones it points at. */
export async function tablesInOrder(q: Exec): Promise<string[]> {
  const tables = (
    await q.execute<{ name: string }>(sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)
  ).map((r) => r.name);
  const fks = await q.execute<{ child: string; parent: string }>(sql`
    select c.relname as child, p.relname as parent
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_class p on p.oid = k.confrelid
    join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f' and n.nspname = 'public' and c.relname <> p.relname`);
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const f of fks) deps.get(f.child)?.add(f.parent);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string) => {
    if (seen.has(t)) return;
    seen.add(t);
    for (const p of deps.get(t) ?? []) visit(p);
    out.push(t);
  };
  tables.forEach(visit);
  return out.filter((t) => !SKIP.has(t));
}

const ident = (t: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`Unexpected table name ${t}`);
  return sql.raw(`"${t}"`);
};

/** Dumps every table. Run it inside a REPEATABLE READ transaction for one consistent snapshot. */
export async function dumpDatabase(q: Exec, now = new Date()) {
  const tables = await tablesInOrder(q);
  const lines: string[] = [];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const rows = await q.execute<{ j: string }>(sql`select row_to_json(x)::text as j from ${ident(t)} x`);
    counts[t] = rows.length;
    for (const r of rows) lines.push(`{"t":${JSON.stringify(t)},"r":${r.j}}`);
  }
  const header = JSON.stringify({ jkayBackup: 1, at: now.toISOString(), tables: counts });
  const body = gzipSync(Buffer.from([header, ...lines].join('\n') + '\n', 'utf8'));
  return { body, counts, rows: lines.length };
}

/**
 * Loads a backup into a database that has been migrated but holds no data
 * (a fresh Railway Postgres after `npm start` with no SEED_ADMIN_* set — the
 * seeded defaults are wiped first). Refuses if there are any leads or employees.
 */
export async function restoreDatabase(db: DB, gz: Buffer) {
  const text = gunzipSync(gz).toString('utf8');
  const [first, ...rest] = text.split('\n').filter(Boolean);
  const header = JSON.parse(first ?? '{}') as { jkayBackup?: number; at?: string; tables?: Record<string, number> };
  if (header.jkayBackup !== 1) throw new Error('This is not a JK Racks CRM backup file');

  const rows = new Map<string, unknown[]>();
  for (const line of rest) {
    const { t, r } = JSON.parse(line) as { t: string; r: unknown };
    (rows.get(t) ?? rows.set(t, []).get(t)!).push(r);
  }

  await db.transaction(async (tx) => {
    const [busy] = await tx.execute<{ n: number }>(sql`select (select count(*) from leads) + (select count(*) from employees) as n`);
    if (Number(busy?.n) > 0) throw new Error('The target database already has leads or employees — restore only into an empty database');
    const order = await tablesInOrder(tx);
    // clear seeded defaults (children first), then load (parents first)
    for (const t of [...order].reverse()) await tx.execute(sql`delete from ${ident(t)}`);
    for (const t of order) {
      const list = rows.get(t) ?? [];
      for (let i = 0; i < list.length; i += 500) {
        const chunk = JSON.stringify(list.slice(i, i + 500));
        await tx.execute(sql`insert into ${ident(t)} select * from json_populate_recordset(null::${ident(t)}, ${chunk}::json)`);
      }
    }
    // move every serial counter past the restored ids
    const seqs = await tx.execute<{ tbl: string; col: string }>(sql`
      select table_name as tbl, column_name as col from information_schema.columns
      where table_schema = 'public' and column_default like 'nextval(%'`);
    for (const s of seqs)
      await tx.execute(
        sql`select setval(pg_get_serial_sequence(${'public.' + s.tbl}, ${s.col}), coalesce((select max(${ident(s.col)}) from ${ident(s.tbl)}), 0) + 1, false)`,
      );
  });
  return { at: header.at, tables: header.tables ?? {} };
}
