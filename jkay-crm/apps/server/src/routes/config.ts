import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { appSettings, categories, messageTemplates, stages, tags } from '../db/schema.js';
import { requireUser } from '../auth/session.js';

/**
 * Everything the desks need to draw their screens: stages, the tag library,
 * categories, WhatsApp templates and a few settings. Admin-only tags are only
 * sent to Admins.
 */
export const configRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => {
    const u = requireUser(req);
    const [st, tg, cats, tpl, settings] = await Promise.all([
      app.db.select().from(stages).where(isNull(stages.archivedAt)).orderBy(asc(stages.desk), asc(stages.position)),
      app.db
        .select()
        .from(tags)
        .where(
          and(
            isNull(tags.archivedAt),
            u.role === 'admin' ? undefined : inArray(tags.scope, ['cre', 'bd', 'cre_lost', 'bd_lost']),
          ),
        )
        .orderBy(asc(tags.scope), asc(tags.position)),
      app.db.select().from(categories).where(isNull(categories.archivedAt)).orderBy(asc(categories.position)),
      app.db
        .select()
        .from(messageTemplates)
        .where(or(isNull(messageTemplates.ownerId), eq(messageTemplates.ownerId, u.id)))
        .orderBy(asc(messageTemplates.desk), asc(messageTemplates.position)),
      app.db.select().from(appSettings),
    ]);
    return {
      stages: st,
      tags: tg,
      categories: cats,
      templates: tpl,
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    };
  });
};
