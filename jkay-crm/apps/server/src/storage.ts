/**
 * File storage.
 *
 * Production: a Railway Storage Bucket (S3-compatible, private). Files are uploaded
 * through the app (so the bucket never needs browser CORS rules) and viewed through
 * short-lived signed URLs, so downloads go straight from the bucket and never pass
 * through — or get billed as egress on — the app service.
 *
 * Local dev / tests: set STORAGE_LOCAL_DIR and files are kept on disk instead.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Env } from './env.js';
import { HttpError } from './http.js';

export type Storage = ReturnType<typeof createStorage>;

export function createStorage(env: Env) {
  const bucketReady = !!(env.BUCKET_ENDPOINT && env.BUCKET_NAME && env.BUCKET_ACCESS_KEY_ID && env.BUCKET_SECRET_ACCESS_KEY);
  const client = bucketReady
    ? new S3Client({
        region: env.BUCKET_REGION,
        endpoint: env.BUCKET_ENDPOINT,
        // Railway buckets use virtual-hosted URLs; older buckets may need path style (see the bucket's Credentials tab).
        forcePathStyle: env.BUCKET_PATH_STYLE,
        credentials: { accessKeyId: env.BUCKET_ACCESS_KEY_ID!, secretAccessKey: env.BUCKET_SECRET_ACCESS_KEY! },
      })
    : null;
  const localDir = !client && env.STORAGE_LOCAL_DIR ? resolve(env.STORAGE_LOCAL_DIR) : null;
  const bucket = client ? env.BUCKET_NAME! : localDir ? 'local' : '';

  const localPath = (key: string) => {
    const p = resolve(join(localDir!, key));
    if (!p.startsWith(localDir!)) throw new HttpError(400, 'Bad file path');
    return p;
  };
  const notSetUp = () => new HttpError(503, 'File storage is not set up yet — add the Railway Storage Bucket variables');

  return {
    ready: !!client || !!localDir,
    bucket,
    mode: client ? ('bucket' as const) : localDir ? ('local' as const) : ('none' as const),

    async put(key: string, body: Buffer, contentType: string) {
      if (client) {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
        return;
      }
      if (!localDir) throw notSetUp();
      const p = localPath(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },

    async remove(key: string) {
      if (client) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      else if (localDir) await rm(localPath(key), { force: true });
    },

    /** Bucket mode: a signed URL valid for 15 minutes. */
    viewUrl(key: string, fileName: string, download = false) {
      if (!client) throw notSetUp();
      const disp = `${download ? 'attachment' : 'inline'}; filename="${fileName.replace(/["\r\n]/g, '')}"`;
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: disp }), { expiresIn: 900 });
    },

    /** Local mode only: a stream of the file. */
    localStream(key: string) {
      if (!localDir) throw notSetUp();
      return createReadStream(localPath(key));
    },
  };
}
