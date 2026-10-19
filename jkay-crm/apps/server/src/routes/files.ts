/**
 * Uploads and downloads.
 *
 *  POST   /api/files?leadId=&kind=   multipart, one file → { attachment }
 *  GET    /api/files/:id             permission check, then a redirect to a 15-minute
 *                                    signed bucket URL (so the download never passes
 *                                    through the app) — or the file itself in local mode
 *  DELETE /api/files/:id             site photos only (CAD and quotations are the audit trail)
 *
 * Site photos: the CRE who owns the open lead (or the BDE once handed over, or Admin).
 * CAD / quotation files: the BDE who owns the deal, or Admin. A CRE can only ever see photos.
 */
import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { ATTACHMENT_KINDS, UPLOAD_ACCEPT, UPLOAD_MAX_BYTES, type AttachmentKind } from '@jkay/shared';
import { attachments, leads } from '../db/schema.js';
import { badRequest, forbidden, notFound } from '../http.js';
import { requireUser, type SessionUser } from '../auth/session.js';
import { assertCanView, getLead, logActivity, type Lead } from '../services/leads.js';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
  '.dwg': 'application/acad',
  '.dxf': 'application/dxf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
};

/** Who may add a file of this kind to this lead right now. */
export function assertCanUpload(u: SessionUser, l: Lead, kind: AttachmentKind) {
  if (u.role === 'admin') return;
  if (l.lostAt) throw forbidden('This lead is closed');
  if (kind === 'photo') {
    if (u.role === 'cre' && l.desk === 'cre' && l.ownerId === u.id) return;
    if (u.role === 'bde' && l.desk === 'bd' && l.ownerId === u.id) return;
  } else if (u.role === 'bde' && l.desk === 'bd' && l.ownerId === u.id) return;
  throw forbidden('You can only add files to leads you own');
}

const safeName = (n: string) =>
  n
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(-120) || 'file';

export const fileRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Querystring: { leadId?: string; kind?: string } }>('/', async (req) => {
    const u = requireUser(req);
    const kind = req.query.kind as AttachmentKind;
    if (!(ATTACHMENT_KINDS as readonly string[]).includes(kind)) throw badRequest('Unknown file kind');
    if (!req.query.leadId) throw badRequest('Missing lead');
    const l = await getLead(app.db, req.query.leadId);
    assertCanUpload(u, l, kind);

    const file = await req.file();
    if (!file) throw badRequest('No file attached');
    const ext = extname(file.filename).toLowerCase();
    if (!UPLOAD_ACCEPT[kind].includes(ext)) throw badRequest(`Use one of: ${UPLOAD_ACCEPT[kind].join(', ')}`);
    const buf = await file.toBuffer().catch((e: Error & { code?: string }) => {
      if (e.code === 'FST_REQ_FILE_TOO_LARGE') throw badRequest(`Files can be up to ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
      throw e;
    });
    if (!buf.length) throw badRequest('That file is empty');

    const mime = MIME[ext] ?? 'application/octet-stream';
    const key = `leads/${l.id}/${kind}/${Date.now()}-${randomBytes(4).toString('hex')}-${safeName(file.filename)}`;
    await app.storage.put(key, buf, mime);

    const [a] = await app.db
      .insert(attachments)
      .values({ leadId: l.id, kind, bucket: app.storage.bucket, path: key, fileName: file.filename.slice(-200), mime, sizeBytes: buf.length, uploadedById: u.id })
      .returning();
    if (kind === 'photo') {
      await logActivity(app.db, { leadId: l.id, actorId: u.id, desk: l.desk, kind: 'photo', title: 'Site photo added', body: a!.fileName });
    }
    return { attachment: { id: a!.id, kind: a!.kind, fileName: a!.fileName, sizeBytes: a!.sizeBytes, createdAt: a!.createdAt } };
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>('/:id', async (req, reply) => {
    const u = requireUser(req);
    const [a] = await app.db.select().from(attachments).where(and(eq(attachments.id, Number(req.params.id)), isNull(attachments.deletedAt)));
    if (!a) throw notFound('File not found');
    const l = await getLead(app.db, a.leadId);
    await assertCanView(app.db, u, l);
    if (u.role === 'cre' && a.kind !== 'photo') throw forbidden('This file belongs to the BD desk');

    reply.header('Cache-Control', 'private, no-store');
    if (app.storage.mode === 'bucket') return reply.redirect(await app.storage.viewUrl(a.path, a.fileName, !!req.query.download), 302);
    reply.header('Content-Type', a.mime ?? 'application/octet-stream');
    reply.header('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${a.fileName.replace(/["\r\n]/g, '')}"`);
    return reply.send(app.storage.localStream(a.path));
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    const u = requireUser(req);
    const [a] = await app.db.select().from(attachments).where(and(eq(attachments.id, Number(req.params.id)), isNull(attachments.deletedAt)));
    if (!a) throw notFound('File not found');
    if (a.kind !== 'photo') throw forbidden('Drawings and quotations stay on the record');
    const [l] = await app.db.select().from(leads).where(eq(leads.id, a.leadId));
    if (!l) throw notFound();
    assertCanUpload(u, l, 'photo');
    if (u.role !== 'admin' && a.uploadedById !== u.id) throw forbidden('You can only remove photos you added');
    await app.db.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, a.id));
    await app.storage.remove(a.path).catch(() => undefined);
    await logActivity(app.db, { leadId: l.id, actorId: u.id, desk: l.desk, kind: 'photo', title: 'Site photo removed', body: a.fileName });
    return { ok: true };
  });
};

export const UPLOAD_LIMITS = { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 5 };
