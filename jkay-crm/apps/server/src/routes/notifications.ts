import type { FastifyPluginAsync } from 'fastify';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { notifications, leads } from '../db/schema.js';
import { requireUser } from '../auth/session.js';

/** The bell: your own notifications only. */
export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { filter?: string } }>('/', async (req) => {
    const u = requireUser(req);
    const conds = [eq(notifications.recipientId, u.id)];
    if (req.query.filter === 'unread') conds.push(isNull(notifications.readAt));
    if (req.query.filter === 'watch') conds.push(eq(notifications.viaWatch, true));
    const rows = await app.db
      .select({ n: notifications, customer: leads.customerName })
      .from(notifications)
      .leftJoin(leads, eq(leads.id, notifications.leadId))
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt))
      .limit(60);
    const [unread] = await app.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.recipientId, u.id), isNull(notifications.readAt)));
    return {
      unread: unread?.n ?? 0,
      notifications: rows.map(({ n, customer }) => ({
        id: n.id,
        kind: n.kind,
        leadId: n.leadId,
        customer,
        title: n.title,
        body: n.body,
        viaWatch: n.viaWatch,
        read: !!n.readAt,
        createdAt: n.createdAt,
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/:id/read', async (req) => {
    const u = requireUser(req);
    await app.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, Number(req.params.id)), eq(notifications.recipientId, u.id)));
    return { ok: true };
  });

  app.post('/read-all', async (req) => {
    const u = requireUser(req);
    await app.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.recipientId, u.id), isNull(notifications.readAt)));
    return { ok: true };
  });
};
