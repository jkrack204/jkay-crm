import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const { db, sql } = createDb(url);
const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
await migrate(db, { migrationsFolder: folder });
console.log('Migrations applied.');
await sql.end();
