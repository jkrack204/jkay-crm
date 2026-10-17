/**
 * Cookie sessions. The cookie carries a random token; the DB keeps only its hash.
 * Sessions slide: each request within the window pushes expiry out (written at most
 * once an hour to keep writes low).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import type { Role } from '@jkay/shared';
import type { DB } from '../db/client.js';
import { employees, sessions } from '../db/schema.js';
import { forbidden, HttpError } from '../http.js';
import { hashToken, newSessionToken } from './password.js';

export const COOKIE = 'jkay_sid';
const DAYS = 30;
const TOUCH_MS = 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  email: string;
  phone: string | null;
  territory: string | null;
  avatarPath: string | null;
  prefs: Record<string, unknown>;
};

const expiry = () => new Date(Date.now() + DAYS * 24 * 3600 * 1000);

export async function createSession(db: DB, reply: FastifyReply, req: FastifyRequest, employeeId: string, secure: boolean) {
  const token = newSessionToken();
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    employeeId,
    expiresAt: expiry(),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    ip: req.ip,
  });
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: DAYS * 24 * 3600,
  });
}

export async function loadSessionUser(db: DB, req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ s: sessions, e: employees })
    .from(sessions)
    .innerJoin(employees, eq(employees.id, sessions.employeeId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())));
  if (!row || !row.e.active) return null;
  if (Date.now() - row.s.lastSeenAt.getTime() > TOUCH_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt: expiry() }).where(eq(sessions.tokenHash, tokenHash));
  }
  const { id, username, fullName, role, email, phone, territory, avatarPath, prefs } = row.e;
  return { id, username, fullName, role, email, phone, territory, avatarPath, prefs };
}

export async function endSession(db: DB, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[COOKIE];
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  reply.clearCookie(COOKIE, { path: '/' });
}

/** Sign someone out everywhere (password reset, disabled), optionally keeping the current session. */
export async function endAllSessions(db: DB, employeeId: string) {
  await db.delete(sessions).where(eq(sessions.employeeId, employeeId));
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Please log in');
  return req.user;
}
export function requireRole(req: FastifyRequest, ...roles: Role[]): SessionUser {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw forbidden();
  return u;
}
