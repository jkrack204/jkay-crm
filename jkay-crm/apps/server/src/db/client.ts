import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type DB = ReturnType<typeof createDb>['db'];

/** Railway Postgres is reached directly over its private network URL — no pooler quirks. */
export function createDb(url: string) {
  const sql = postgres(url, { max: 10 });
  return { sql, db: drizzle(sql, { schema }) };
}
