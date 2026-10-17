/**
 * File storage on a Railway Storage Bucket (S3-compatible, private).
 * The browser never gets bucket credentials: it uploads to a short-lived
 * signed PUT URL and views files through short-lived signed GET URLs.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from './env.js';

export type Storage = ReturnType<typeof createStorage>;

export function createStorage(env: Env) {
  const ready = !!(env.BUCKET_ENDPOINT && env.BUCKET_NAME && env.BUCKET_ACCESS_KEY_ID && env.BUCKET_SECRET_ACCESS_KEY);
  const client = ready
    ? new S3Client({
        region: env.BUCKET_REGION,
        endpoint: env.BUCKET_ENDPOINT,
        credentials: { accessKeyId: env.BUCKET_ACCESS_KEY_ID!, secretAccessKey: env.BUCKET_SECRET_ACCESS_KEY! },
      })
    : null;
  const bucket = env.BUCKET_NAME ?? '';

  const need = () => {
    if (!client) throw new Error('File storage is not configured (BUCKET_* variables missing)');
    return client;
  };

  return {
    ready,
    bucket,
    /** Signed URL the browser PUTs the file to (default 10 min). */
    uploadUrl: (key: string, contentType: string, seconds = 600) =>
      getSignedUrl(need(), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: seconds }),
    /** Signed URL to view/download a file (default 15 min). */
    viewUrl: (key: string, fileName?: string, seconds = 900) =>
      getSignedUrl(
        need(),
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: fileName ? `inline; filename="${fileName.replace(/"/g, '')}"` : undefined,
        }),
        { expiresIn: seconds },
      ),
    put: (key: string, body: Buffer | Uint8Array | string, contentType: string) =>
      need().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })),
    remove: (key: string) => need().send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
  };
}
