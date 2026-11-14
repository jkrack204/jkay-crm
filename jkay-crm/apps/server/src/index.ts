/**
 * One process serves everything (single Railway service):
 *   /api/*        JSON API
 *   everything    the built React app (apps/web/dist), with SPA fallback
 *   + background jobs every minute (reminders, alert emails, nightly backup)
 */
import { loadEnv } from './env.js';
import { createDb } from './db/client.js';
import { buildApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL);
const app = await buildApp(env, db);
if (env.JOBS_ENABLED) app.jobs = startScheduler(app);

const close = async () => {
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on('SIGTERM', close);
process.on('SIGINT', close);

await app.listen({ port: env.PORT, host: '0.0.0.0' });
