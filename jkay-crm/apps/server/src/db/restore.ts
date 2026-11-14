/**
 * Restore one of our nightly backups into an EMPTY database.
 *
 *   From a file you downloaded:
 *     npm run db:restore -w @jkay/server -- path/to/2026-11-10.json.gz
 *   Straight from the bucket (needs the BUCKET_* variables):
 *     npm run db:restore -w @jkay/server -- --key backups/2026-11-10.json.gz
 *
 * The target must be migrated and hold no employees or leads — create a new
 * Railway Postgres, point DATABASE_URL at it, run `npm start` once without
 * SEED_ADMIN_* (or just the migrate step), then run this.
 */
import { readFile } from 'node:fs/promises';
import { createDb } from './client.js';
import { restoreDatabase } from './backup.js';
import { loadEnv } from '../env.js';
import { createStorage } from '../storage.js';

const args = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

let gz: Buffer;
if (args[0] === '--key' && args[1]) {
  const storage = createStorage(loadEnv());
  gz = await storage.getBuffer(args[1]);
} else if (args[0]) {
  gz = await readFile(args[0]);
} else {
  console.error('Usage: db:restore -- <file.json.gz>   or   db:restore -- --key backups/<date>.json.gz');
  process.exit(1);
}

const { db, sql } = createDb(url);
try {
  const r = await restoreDatabase(db, gz);
  const total = Object.values(r.tables).reduce((a, b) => a + b, 0);
  console.log(`Restored the backup from ${r.at}: ${total} rows across ${Object.keys(r.tables).length} tables.`);
  console.log('Everyone signs in again with their old username and password.');
} finally {
  await sql.end();
}
