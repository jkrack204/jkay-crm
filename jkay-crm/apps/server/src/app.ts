/**
 * Builds the Fastify app (no listen) so tests can drive it with app.inject().
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql as dsql } from 'drizzle-orm';
import type { Env } from './env.js';
import type { DB } from './db/client.js';
import { HttpError } from './http.js';
import { loadSessionUser, type SessionUser } from './auth/session.js';
import { createStorage, type Storage } from './storage.js';
import { authRoutes } from './routes/auth.js';
import { employeeRoutes } from './routes/employees.js';
import { configRoutes } from './routes/config.js';
import { leadRoutes } from './routes/leads.js';
import { creRoutes } from './routes/cre.js';
import { notificationRoutes } from './routes/notifications.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    env: Env;
    storage: Storage;
  }
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function buildApp(env: Env, db: DB, opts: { logger?: boolean; serveWeb?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true, bodyLimit: 1_000_000 });

  app.decorate('db', db);
  app.decorate('env', env);
  app.decorate('storage', createStorage(env));
  app.decorateRequest('user', null);

  await app.register(fastifyCookie);

  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/')) req.user = await loadSessionUser(db, req);
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the server' });
  });

  app.get('/api/health', async () => {
    await db.execute(dsql`select 1`);
    return { ok: true, time: new Date().toISOString() };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(employeeRoutes, { prefix: '/api/employees' });
  await app.register(configRoutes, { prefix: '/api/config' });
  await app.register(leadRoutes, { prefix: '/api/leads' });
  await app.register(creRoutes, { prefix: '/api/cre' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });

  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (opts.serveWeb !== false && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }));
  }

  return app;
}
