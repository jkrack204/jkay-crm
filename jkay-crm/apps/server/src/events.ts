/**
 * Live updates over Server-Sent Events.
 *
 * Every signed-in browser keeps one GET /api/events open. Whenever anything is
 * written (any successful POST/PUT/PATCH/DELETE, or a background job sending
 * alerts) every browser gets a tiny "changed" message and refetches what it is
 * showing. The message carries no data — just who caused it — so nobody learns
 * anything they couldn't already see; the normal API still checks access.
 *
 * One app process serves everyone (single Railway service), so an in-memory
 * list of open streams is enough.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireUser } from './auth/session.js';

const HEARTBEAT_MS = 25_000;
/** Many writes in a burst (bulk claim, drag-reorder) become one message. */
const COALESCE_MS = 250;
/** Writes that don't change anything other people see. */
const QUIET = [/^\/api\/auth\//, /^\/api\/notifications\//, /^\/api\/events/, /^\/api\/admin\/rank$/, /^\/api\/admin\/records\/[^/]+\/watch$/];

type Client = { userId: string; reply: FastifyReply };

export function createEvents() {
  const clients = new Set<Client>();
  let pending: Set<string | null> | null = null;

  const send = (c: Client, event: string, data: unknown) => {
    try {
      c.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      clients.delete(c);
    }
  };

  return {
    get count() {
      return clients.size;
    },
    /** Tell every open browser something changed. `by` = who did it (null = the system). */
    changed(by: string | null) {
      if (!clients.size) return;
      if (!pending) {
        pending = new Set();
        setTimeout(() => {
          const who = [...pending!];
          pending = null;
          for (const c of clients) send(c, 'changed', { by: who.length === 1 ? who[0] : null });
        }, COALESCE_MS).unref();
      }
      pending.add(by);
    },
    add(c: Client) {
      clients.add(c);
      return () => clients.delete(c);
    },
    closeAll() {
      for (const c of clients) c.reply.raw.end();
      clients.clear();
    },
  };
}
export type Events = ReturnType<typeof createEvents>;

export async function eventRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const u = requireUser(req);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`retry: 5000\nevent: hello\ndata: {}\n\n`);
    const remove = app.events.add({ userId: u.id, reply });
    const beat = setInterval(() => reply.raw.write(`: ping\n\n`), HEARTBEAT_MS);
    req.raw.on('close', () => {
      clearInterval(beat);
      remove();
    });
  });
}

/** Registers the hook that announces every successful write. */
export function announceWrites(app: FastifyInstance) {
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (!req.url.startsWith('/api/') || reply.statusCode >= 400) return;
    const path = req.url.split('?')[0]!;
    if (QUIET.some((r) => r.test(path))) return;
    app.events.changed(req.user?.id ?? null);
  });
}
