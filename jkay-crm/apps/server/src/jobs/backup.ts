/**
 * Nightly database backup into the Storage Bucket (backups/YYYY-MM-DD.json.gz, IST date),
 * on top of Railway's own Postgres backups. Runs once a day after 02:30 IST, retries
 * hourly if it fails, and keeps the last BACKUP_KEEP_DAYS days.
 * The result is stored in app_settings.last_backup so Admin can see it in Settings.
 */
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { appSettings } from '../db/schema.js';
import { dumpDatabase } from '../db/backup.js';
import type { Storage } from '../storage.js';
import { addDays, istAt, istDate } from './time.js';
import { JOBS_LOCK } from './reminders.js';

export const BACKUP_AT = '02:30';
export const BACKUP_PREFIX = 'backups/';
const RETRY_MS = 60 * 60 * 1000;

export type BackupStatus = { ok: boolean; date: string; at: string; key?: string; bytes?: number; rows?: number; error?: string; kept?: number };

export async function lastBackup(db: Pick<DB, 'select'>): Promise<BackupStatus | null> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, 'last_backup'));
  return (r?.value as BackupStatus) ?? null;
}

async function saveStatus(db: DB, s: BackupStatus) {
  await db
    .insert(appSettings)
    .values({ key: 'last_backup', value: s })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: s, updatedAt: new Date() } });
}

/** Is a backup due at this tick? */
export function backupDue(now: Date, last: BackupStatus | null) {
  const today = istDate(now);
  if (now < istAt(today, BACKUP_AT)) return false;
  if (!last) return true;
  if (last.ok && last.date === today) return false;
  if (!last.ok && last.date === today && now.getTime() - Date.parse(last.at) < RETRY_MS) return false;
  return true;
}

export async function runBackup(db: DB, storage: Storage, keepDays: number, now = new Date()): Promise<BackupStatus> {
  const date = istDate(now);
  if (!storage.ready) {
    const s: BackupStatus = { ok: false, date, at: now.toISOString(), error: 'Storage bucket is not set up' };
    await saveStatus(db, s);
    return s;
  }
  try {
    const dump = await db.transaction(
      async (tx) => {
        const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${JOBS_LOCK + 2}) as ok`);
        if (!lock?.ok) return null;
        return dumpDatabase(tx, now);
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    if (!dump) return { ok: false, date, at: now.toISOString(), error: 'Another backup is running' };
    const key = `${BACKUP_PREFIX}${date}.json.gz`;
    await storage.put(key, dump.body, 'application/gzip');

    // retention: drop dated backups older than keepDays
    const oldest = addDays(date, -(keepDays - 1));
    const keys = await storage.list(BACKUP_PREFIX);
    let kept = 0;
    for (const k of keys) {
      const d = /(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(k)?.[1];
      if (!d) continue;
      if (d < oldest) await storage.remove(k);
      else kept++;
    }
    const s: BackupStatus = { ok: true, date, at: now.toISOString(), key, bytes: dump.body.length, rows: dump.rows, kept };
    await saveStatus(db, s);
    return s;
  } catch (e) {
    const s: BackupStatus = { ok: false, date, at: now.toISOString(), error: (e as Error).message.slice(0, 300) };
    await saveStatus(db, s);
    return s;
  }
}
