/** Tiny JSON client. Same origin as the API, so the session cookie just rides along. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('jkay:signed-out'));
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
};
