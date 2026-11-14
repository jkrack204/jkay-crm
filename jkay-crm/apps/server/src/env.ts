import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  SECRETS_KEY: z.string().min(40, 'SECRETS_KEY must be 32 random bytes, base64'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Railway Storage Bucket (S3-compatible). Optional at boot so the app can run
  // before the bucket exists; uploads fail with a clear error until it's set.
  BUCKET_ENDPOINT: z.string().url().optional(),
  BUCKET_NAME: z.string().optional(),
  BUCKET_ACCESS_KEY_ID: z.string().optional(),
  BUCKET_SECRET_ACCESS_KEY: z.string().optional(),
  BUCKET_REGION: z.string().default('us-east-1'),
  BUCKET_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Dev/tests only: keep uploaded files in this folder when no bucket is configured. */
  STORAGE_LOCAL_DIR: z.string().optional(),

  // Alert emails (Resend). Nothing is emailed until RESEND_API_KEY is set; EMAIL_FROM
  // must be on a domain verified in Resend.
  EMAIL_FROM: z.string().default('JK Racks CRM <alerts@jkayracks.in>'),
  RESEND_API_KEY: z.string().optional(),
  /** The app's public address, used for the link in alert emails (e.g. https://crm.jkayracks.in). */
  APP_URL: z.string().url().optional(),

  /** Background jobs (reminders, emails, nightly backup). Tests and one-off scripts turn them off. */
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  BACKUP_KEEP_DAYS: z.coerce.number().int().min(3).max(365).default(30),
});

export type Env = z.infer<typeof schema>;

/** Validated once at boot; the server refuses to start with a bad config. */
export function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
