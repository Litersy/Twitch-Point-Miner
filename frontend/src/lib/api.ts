const TOKEN_KEY = 'twf_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(typeof body === 'object' && body && 'error' in body ? String((body as any).error) : `HTTP ${status}`);
  }
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const hasBody = options.body != null;

  // Only advertise a JSON content-type when there's actually a body — Fastify rejects
  // empty-body requests that still declare application/json.
  const headers: Record<string, string> = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined ?? {}),
  };

  const res = await fetch(path, { ...options, headers });

  let body: unknown = null;
  const ct = res.headers.get('content-type');
  if (ct?.includes('application/json')) body = await res.json();
  else if (res.status !== 204) body = await res.text();

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    throw new ApiError(res.status, body);
  }
  return body as T;
}
