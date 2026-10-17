import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, ne, count } from 'drizzle-orm';
import { createEmployeeInput, resetPasswordInput, updateEmployeeInput, normalizePhone } from '@jkay/shared';
import { employees } from '../db/schema.js';
import { badRequest, conflict, notFound, parse } from '../http.js';
import { hashPassword } from '../auth/password.js';
import { endAllSessions, requireRole, requireUser } from '../auth/session.js';

const publicCols = {
  id: employees.id,
  username: employees.username,
  fullName: employees.fullName,
  role: employees.role,
  active: employees.active,
  territory: employees.territory,
  avatarPath: employees.avatarPath,
};
const adminCols = { ...publicCols, email: employees.email, phone: employees.phone, createdAt: employees.createdAt };

export const employeeRoutes: FastifyPluginAsync = async (app) => {
  /** Everyone gets the people list (names for pickers); only Admin sees emails/phones. */
  app.get('/', async (req) => {
    const u = requireUser(req);
    const cols = u.role === 'admin' ? adminCols : publicCols;
    const rows = await app.db.select(cols).from(employees).orderBy(asc(employees.role), asc(employees.fullName));
    return { employees: rows };
  });

  app.post('/', async (req) => {
    const admin = requireRole(req, 'admin');
    const input = parse(createEmployeeInput, req.body);
    const [dupe] = await app.db.select({ id: employees.id }).from(employees).where(eq(employees.username, input.username));
    if (dupe) throw conflict(`Username "${input.username}" is already taken`);
    const [row] = await app.db
      .insert(employees)
      .values({
        username: input.username,
        passwordHash: await hashPassword(input.password),
        fullName: input.fullName,
        role: input.role,
        email: input.email,
        phone: input.phone ? (normalizePhone(input.phone) ?? input.phone) : null,
        territory: input.territory || null,
        createdBy: admin.id,
      })
      .returning(adminCols);
    return { employee: row };
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const admin = requireRole(req, 'admin');
    const input = parse(updateEmployeeInput, req.body);
    const [target] = await app.db.select().from(employees).where(eq(employees.id, req.params.id));
    if (!target) throw notFound('Employee not found');

    // Never leave the CRM without an active Admin.
    const losingAdmin = target.role === 'admin' && ((input.role && input.role !== 'admin') || input.active === false);
    if (losingAdmin) {
      const [{ n } = { n: 0 }] = await app.db
        .select({ n: count() })
        .from(employees)
        .where(and(eq(employees.role, 'admin'), eq(employees.active, true), ne(employees.id, target.id)));
      if (n === 0) throw badRequest('This is the last active Admin — add another Admin first');
    }
    if (target.id === admin.id && input.active === false) throw badRequest("You can't disable your own account");

    const [row] = await app.db
      .update(employees)
      .set({
        ...input,
        phone: input.phone === undefined ? undefined : input.phone ? (normalizePhone(input.phone) ?? input.phone) : null,
      })
      .where(eq(employees.id, target.id))
      .returning(adminCols);
    if (input.active === false || (input.role && input.role !== target.role)) await endAllSessions(app.db, target.id);
    return { employee: row };
  });

  /** Admin sets a new password for someone (no email reset in v1). Signs them out everywhere. */
  app.post<{ Params: { id: string } }>('/:id/password', async (req) => {
    requireRole(req, 'admin');
    const { password } = parse(resetPasswordInput, req.body);
    const [row] = await app.db
      .update(employees)
      .set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date() })
      .where(eq(employees.id, req.params.id))
      .returning({ id: employees.id });
    if (!row) throw notFound('Employee not found');
    await endAllSessions(app.db, row.id);
    return { ok: true };
  });
};
