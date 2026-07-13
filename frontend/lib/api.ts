import { mapApiError } from './apiErrors';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/login?expired=1';
    }
    throw new ApiError(401, 'Unauthorized');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let code: string | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed != null &&
        typeof parsed === 'object' &&
        typeof (parsed as { detail?: unknown }).detail === 'string'
      ) {
        code = (parsed as { detail: string }).detail;
      }
    } catch {
      // 본문이 JSON이 아니면 코드 없음 → statusText로 폴백
    }
    throw new ApiError(res.status, mapApiError(code) ?? code ?? res.statusText, code);
  }

  if (res.status === 204) return {} as T;

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
