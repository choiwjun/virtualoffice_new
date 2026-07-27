import { mapApiError } from './apiErrors';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

/** 백엔드가 서빙하는 정적 미디어(/media/*, 프로필 사진 등)의 절대 URL. null-경로면 null. */
export function mediaUrl(path: string | null | undefined): string | null {
  return path ? `${BASE_URL}${path}` : null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    /** 오류 본문의 `detail`이 객체일 때 그대로 실어 준다.
     *
     * 코드만으로는 못 쓰는 안내가 있다 — "이미 ○○이 쓰고 있다"의 ○○처럼 서버만 아는
     * 값. 문자열 detail은 지금까지대로 `code`로만 오므로 기존 호출부는 영향이 없다.
     */
    public readonly detail?: Record<string, unknown>,
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
    // FormData(파일 업로드)는 브라우저가 boundary 포함 Content-Type을 스스로 설정해야 한다.
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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
      // 세션 만료 복귀(06 §3.8): 로그인 후 원래 화면으로 돌아가도록 현재 경로를 returnTo로 전달
      const path = window.location.pathname;
      const returnTo =
        path && path !== '/login' ? `&returnTo=${encodeURIComponent(path)}` : '';
      window.location.href = `/login?expired=1${returnTo}`;
    }
    throw new ApiError(401, 'Unauthorized');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let code: string | undefined;
    let detail: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      const raw = (parsed as { detail?: unknown } | null)?.detail;
      if (typeof raw === 'string') {
        code = raw;
      } else if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
        // 구조화 detail: { code, ...맥락 }. code는 문자열 경로와 똑같이 취급한다.
        // 배열은 제외 — FastAPI 422 검증 오류가 배열이고, 그건 맥락이 아니라 필드 목록이다.
        detail = raw as Record<string, unknown>;
        const inner = detail.code;
        if (typeof inner === 'string') code = inner;
      }
    } catch {
      // 본문이 JSON이 아니면 코드 없음 → statusText로 폴백
    }
    throw new ApiError(res.status, mapApiError(code) ?? code ?? res.statusText, code, detail);
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
  /** multipart 업로드(파일) — body를 직렬화하지 않고 FormData 그대로 전송. */
  upload: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
