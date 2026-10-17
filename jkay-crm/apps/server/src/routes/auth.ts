import type { FastifyPluginAsync } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import { changePasswordInput, loginInput } from '@jkay/shared';
import { employees, sessions } from '../db/schema.js';
import { HttpError, parse } from '../http.js';
import { hashPassword, hashToken, verifyPassword } from '../auth/password.js';
import { COOKIE, createSession, endSession, requireUser } from '../auth/session.js';

/* A dummy hash so a wrong username takes as long as a wrong password. */
const DUMMY = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

// Simple in-memory brake on password guessing: 10 failures per username+IP per 15 min.
const fails = new Map<string, { n: number; until: number }>();
const WINDOW = 15 * 60 * 1000;

// Forget expired entries every 15 minutes so the map can't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of fails) if (v.until <= now) fails.delete(k);
}, WINDOW).unref();

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (req, reply) => {
    const { username, password } = parse(loginInput, req.body);
    const key = `${username}|${req.ip}`;
    const f = fails.get(key);
    if (f && f.n >= 10 && f.until > Date.now()) throw new HttpError(429, 'Too many attempts — try again in 15 minutes');

    const [emp] = await app.db.select().from(employees).where(eq(employees.username, username));
    const ok = await verifyPassword(password, emp?.passwordHash ?? DUMMY);
    if (!emp || !ok || !emp.active) {
      const cur = f && f.until > Date.now() ? f : { n: 0, until: Date.now() + WINDOW };
      fails.set(key, { n: cur.n + 1, until: cur.until });
      throw new HttpError(401, emp && ok && !emp.active ? 'This account has been disabled' : 'Wrong username or password');
    }
    fails.delete(key);
    await createSession(app.db, reply, req, emp.id, app.env.COOKIE_SECURE);
    return { ok: true, role: emp.role };
  });

  app.post('/logout', async (req, reply) => {
    await endSession(app.db, req, reply);
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const u = requireUser(req);
    return { user: u };
  });

  /** Change your own password. Signs out every other session. */
  app.post('/password', async (req) => {
    const u = requireUser(req);
    const { current, next } = parse(changePasswordInput, req.body);
    const [emp] = await app.db.select().from(employees).where(eq(employees.id, u.id));
    if (!emp || !(await verifyPassword(current, emp.passwordHash))) throw new HttpError(400, 'Current password is wrong');
    await app.db.update(employees).set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date() }).where(eq(employees.id, u.id));
    const mine = hashToken(req.cookies[COOKIE] ?? '');
    await app.db.delete(sessions).where(and(eq(sessions.employeeId, u.id), ne(sessions.tokenHash, mine)));
    return { ok: true };
  });

  /** Your own active sessions (for Settings › Security). */
  app.get('/sessions', async (req) => {
    const u = requireUser(req);
    const mine = hashToken(req.cookies[COOKIE] ?? '');
    const rows = await app.db.select().from(sessions).where(eq(sessions.employeeId, u.id));
    return {
      sessions: rows.map((s) => ({
        id: s.tokenHash.slice(0, 16),
        current: s.tokenHash === mine,
        userAgent: s.userAgent,
        ip: s.ip,
        lastSeenAt: s.lastSeenAt,
        createdAt: s.createdAt,
      })),
    };
  });
};
