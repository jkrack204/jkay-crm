/**
 * Background jobs, run inside the app process once a minute:
 * reminders/escalations → alert emails → nightly backup (when due).
 * Each job takes a Postgres advisory lock, so if Railway ever runs two copies
 * of the app only one does the work. Ticks never overlap.
 */
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { reminderTick, JOBS_LOCK } from './reminders.js';
import { emailEnabled, resendSender, sendPendingEmails } from './email.js';
import { backupDue, lastBackup, runBackup } from './backup.js';

const TICK_MS = 60_000;

export type JobsStatus = { lastTickAt: string | null; lastError: string | null; lastEmailError: string | null };

export function startScheduler(app: FastifyInstance) {
  const { db, env, storage, events, log } = app;
  const status: JobsStatus = { lastTickAt: null, lastError: null, lastEmailError: null };
  const send = emailEnabled(env) ? resendSender(env) : null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    const now = new Date();
    try {
      const counts = await reminderTick(db, now);
      if (counts && Object.values(counts).some((n) => n > 0)) {
        log.info({ counts }, 'reminders sent');
        events.changed(null);
      }

      if (send) {
        await db.transaction(async (tx) => {
          const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${JOBS_LOCK + 1}) as ok`);
          if (!lock?.ok) return;
          const n = await sendPendingEmails(tx, send, env.APP_URL, now, (e) => {
            status.lastEmailError = (e as Error).message;
            log.warn({ err: e }, 'alert email failed');
          });
          if (n) log.info({ emails: n }, 'alert emails sent');
        });
      }

      if (backupDue(now, await lastBackup(db))) {
        const r = await runBackup(db, storage, env.BACKUP_KEEP_DAYS, now);
        if (r.ok) log.info({ key: r.key, bytes: r.bytes }, 'nightly backup saved');
        else log.error({ error: r.error }, 'nightly backup failed');
      }
      status.lastError = null;
    } catch (e) {
      status.lastError = (e as Error).message;
      log.error({ err: e }, 'background jobs failed');
    } finally {
      status.lastTickAt = now.toISOString();
      running = false;
    }
  };

  const first = setTimeout(tick, 10_000);
  const every = setInterval(tick, TICK_MS);
  app.addHook('onClose', async () => {
    clearTimeout(first);
    clearInterval(every);
  });
  return status;
}
