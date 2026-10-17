import type { ZodTypeAny, z } from 'zod';

/** Throw from any route to send a clean JSON error: { error: message }. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const forbidden = (m = 'You do not have access to this') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

/** Validate a request body/query with a Zod schema; the first issue becomes the error message. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    const field = i?.path.join('.');
    throw badRequest(field ? `${field}: ${i?.message}` : (i?.message ?? 'Invalid input'));
  }
  return r.data;
}
