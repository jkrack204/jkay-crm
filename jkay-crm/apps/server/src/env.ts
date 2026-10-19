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

  EMAIL_FROM: z.string().default('JKAY CRM <alerts@jkayracks.in>'),
  RESEND_API_KEY: z.string().optional(),
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
