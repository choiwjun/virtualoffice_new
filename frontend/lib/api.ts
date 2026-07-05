// 백엔드 FastAPI 클라이언트 (management-api 소비).
// - 라우터는 root prefix (예: /auth/login, /kpi-results, /seats, /layouts).
// - JWT 는 로컬(localStorage)에 저장, Authorization: Bearer 로 전송.
// - 401 시 refresh_token 으로 1회 재발급 시도 후 실패하면 세션 클리어.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "http://localhost:8000";

const TOKEN_KEY = "vo_token";
const REFRESH_KEY = "vo_refresh";
const USER_KEY = "vo_user";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, refresh: string | null, user: AuthUser | null) {
  window.localStorage.setItem(TOKEN_KEY, token);
  if (refresh) window.localStorage.setItem(REFRESH_KEY, refresh);
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail || `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
  } catch {
    /* non-json */
  }
  return new ApiError(res.status, detail);
}

async function tryRefresh(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const refresh = window.localStorage.getItem(REFRESH_KEY);
  if (!refresh) return false;
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  if (!data?.token) return false;
  window.localStorage.setItem(TOKEN_KEY, data.token);
  if (data.refresh_token) window.localStorage.setItem(REFRESH_KEY, data.refresh_token);
  return true;
}

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface RequestOptions {
  method?: Method;
  body?: unknown;
  auth?: boolean; // 기본 true
  _retried?: boolean;
}

export async function apiRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && !opts._retried) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiRequest<T>(path, { ...opts, _retried: true });
    clearSession();
    throw new ApiError(401, "unauthorized");
  }

  if (!res.ok) throw await parseError(res);

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// ── 도메인 API ────────────────────────────────────────────
export interface LoginResult {
  token: string;
  refresh_token: string;
  expires_in: number;
  user: AuthUser;
}

export const AuthApi = {
  login: (email: string, password: string) =>
    apiRequest<LoginResult>("/auth/login", { method: "POST", body: { email, password }, auth: false }),
  me: () => apiRequest<{ id: number; email: string; role: string; team_id: number | null }>("/auth/me"),
};

export interface KpiResult {
  kpi_result_id: string;
  user_id: number;
  period_type: string;
  period_key: string;
  metric: string;
  value: number;
  ai_draft: unknown;
  ai_model: string | null;
  admin_adjusted_score: number | null;
  admin_note: string | null;
  objection_status: string;
  objection_detail: unknown;
  final_score: number | null;
  finalized_at: string | null;
}

export const KpiApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiRequest<{ kpi_results: KpiResult[]; total: number }>(`/kpi-results${q}`);
  },
  adjust: (id: string, admin_adjusted_score: number, admin_note?: string) =>
    apiRequest<KpiResult>(`/kpi-results/${id}/adjust`, {
      method: "PUT",
      body: { admin_adjusted_score, admin_note },
    }),
  confirm: (id: string) => apiRequest<KpiResult>(`/kpi-results/${id}/confirm`, { method: "POST" }),
  objection: (id: string, category: string, text: string, evidence?: string) =>
    apiRequest<KpiResult>(`/kpi-results/${id}/objections`, {
      method: "POST",
      body: { category, text, evidence },
    }),
  aiDraft: (id: string) =>
    apiRequest<{ ai_draft: unknown; ai_draft_generated_at: string | null; ai_model: string | null }>(
      `/kpi-results/${id}/ai-draft`,
    ),
};

export interface Seat {
  id: string;
  seat_number: string | null;
  floor_id: string;
  type: string;
  status: string;
  assigned_user_id: number | null;
  coords: { x: number; y: number; facing?: number | null };
}

export interface OfficeLayout {
  layout_id: string;
  office_id: string;
  floor_id: string;
  version: number;
  status: string;
  json?: LayoutJson;
  layout_json?: LayoutJson;
  deployed_at: string | null;
}

// 정본 스키마(docs/data-model/office-layout-schema.json). 편집기는 이 형태를 보존한다.
export interface Coords {
  x: number;
  y: number;
}

export interface LayoutSeat {
  seat_id: string;
  seat_type: string; // fixed | free | temp | partner
  coords: Coords;
  facing: number;
  furniture_id: string;
  [k: string]: unknown;
}

export interface LayoutFurniture {
  furniture_id: string;
  asset_id?: string;
  type?: string;
  coords: Coords;
  dimension?: { width?: number; depth?: number; height?: number };
  collision?: boolean;
  [k: string]: unknown;
}

export interface LayoutDimensions {
  width_m?: number;
  height_m?: number;
  min_x?: number;
  max_x?: number;
  min_y?: number;
  max_y?: number;
  unit?: string;
}

export interface LayoutJson {
  metadata?: { floor_name?: string; [k: string]: unknown };
  dimensions?: LayoutDimensions;
  seats?: LayoutSeat[];
  rooms?: Array<Record<string, unknown>>;
  furniture?: LayoutFurniture[];
  spawn_points?: Array<Record<string, unknown>>;
  spawn_default?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ValidationIssue {
  code?: string;
  severity?: string;
  message?: string;
  path?: string;
  [k: string]: unknown;
}

export interface ValidationResult {
  is_deployable?: boolean;
  errors?: ValidationIssue[];
  warnings?: ValidationIssue[];
  issues?: ValidationIssue[];
  [k: string]: unknown;
}

export const SeatApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiRequest<{ seats: Seat[] }>(`/seats${q}`);
  },
};

// ── 조직도 (org-groups, prefix /org-groups) ──────────────
export interface OrgGroup {
  id: string;
  company_id: string;
  name: string;
  type: string; // division | department | part
  parent_id: string | null;
  color: string | null;
  sort_order: number | null;
}

export interface OrgGroupNode extends OrgGroup {
  children: OrgGroupNode[];
}

export const OrgApi = {
  tree: () => apiRequest<{ items: OrgGroupNode[] }>("/org-groups/tree"),
  create: (body: { name: string; type: string; parent_id?: string | null; color?: string | null; sort_order?: number }) =>
    apiRequest<OrgGroup>("/org-groups", { method: "POST", body }),
  update: (id: string, body: Partial<{ name: string; type: string; parent_id: string | null; color: string; sort_order: number }>) =>
    apiRequest<OrgGroup>(`/org-groups/${id}`, { method: "PUT", body }),
  remove: (id: string) => apiRequest<void>(`/org-groups/${id}`, { method: "DELETE" }),
};

// ── 업무기록 (work-logs) ──────────────────────────────────
export interface WorkLog {
  work_log_id: string;
  user_id: number;
  work_date: string | null;
  title: string;
  goal: string | null;
  result: string | null;
  result_url: string | null;
  next_action: string | null;
  category: string | null;
  related_project: string | null;
  url: string | null;
  est_minutes: number | null;
  actual_minutes: number | null;
  status: string; // started | completed
}

export interface WorkLogInput {
  title: string;
  goal?: string;
  result?: string;
  result_url?: string;
  next_action?: string;
  category?: string;
  related_project?: string;
  est_minutes?: number;
  status?: string;
  work_date?: string;
}

export const WorkLogApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiRequest<{ work_logs: WorkLog[] }>(`/work-logs${q}`);
  },
  create: (body: WorkLogInput) => apiRequest<WorkLog>("/work-logs", { method: "POST", body }),
  update: (id: string, body: Partial<WorkLogInput>) =>
    apiRequest<WorkLog>(`/work-logs/${id}`, { method: "PUT", body }),
  remove: (id: string) => apiRequest<void>(`/work-logs/${id}`, { method: "DELETE" }),
};

// ── 회의 (meetings) ───────────────────────────────────────
export interface Meeting {
  meeting_id: string;
  room_id: string;
  host_user_id: number;
  title: string;
  description: string | null;
  scheduled_at: string;
  scheduled_end: string | null;
  status: string; // scheduled | in_progress | completed | cancelled
}

export const MeetingApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiRequest<{ meetings: Meeting[] }>(`/meetings${q}`);
  },
  cancel: (id: string) => apiRequest<void>(`/meetings/${id}`, { method: "DELETE" }),
};

// ── ERP 동기화 모니터링 (sync) ────────────────────────────
export interface SyncStatus {
  status: string;
  synced_at: string | null;
  next_scheduled: string | null;
  error_count: number;
  created_count: number;
  updated_count: number;
  deactivated_count: number;
}

export interface SyncError {
  sync_job_id: string;
  error_message: string | null;
  error_count: number;
  attempted_at: string;
}

export const SyncApi = {
  trigger: () => apiRequest<{ sync_job_id: string; run_id: string; status: string }>("/sync/erp", { method: "POST" }),
  status: (jobId: string) => apiRequest<SyncStatus>(`/sync/status?job_id=${encodeURIComponent(jobId)}`),
  errors: (limit = 10) => apiRequest<{ errors: SyncError[] }>(`/sync/errors?limit=${limit}`),
};

export const LayoutApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiRequest<{ layouts: OfficeLayout[] }>(`/layouts${q}`);
  },
  current: () => apiRequest<OfficeLayout>("/layouts/current"),
  get: (id: string) => apiRequest<OfficeLayout>(`/layouts/${id}`),
  create: (office_id: string, floor_id: string, json: LayoutJson, deployment_notes?: string) =>
    apiRequest<OfficeLayout>("/layouts", { method: "POST", body: { office_id, floor_id, json, deployment_notes } }),
  update: (id: string, json: LayoutJson, deployment_notes?: string) =>
    apiRequest<OfficeLayout>(`/layouts/${id}`, { method: "PUT", body: { json, deployment_notes } }),
  // /layouts/validate 는 성공 200 / 검증실패 400 모두 결과 본문을 돌려준다 → 상태코드로 던지지 않고 파싱.
  validate: async (json: LayoutJson): Promise<ValidationResult> => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/layouts/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(json),
    });
    if (res.status === 401) throw new ApiError(401, "unauthorized");
    return (await res.json()) as ValidationResult;
  },
  deploy: (id: string) => apiRequest<OfficeLayout>(`/layouts/${id}/deploy`, { method: "POST" }),
};

// ── 직원 디렉터리 (erp, prefix /api) ──────────────────────
export interface Employee {
  id: number;
  email: string;
  name: string;
  erp_team_id: number;
  role: string;
  position: string | null;
  manager_id: number | null;
  work_type: string | null;
  is_active: boolean;
}

export const EmployeeApi = {
  list: () => apiRequest<{ items: Employee[]; total: number }>("/api/employees"),
};

// ── 감사 로그 (활동 피드 소스, admin) ─────────────────────
export interface AuditLog {
  id: string;
  timestamp: string;
  user_id: number | null;
  action: string;
  resource_type: string;
  resource_id: string;
  changes: { old: unknown; new: unknown };
  ip_address: string | null;
}

export const AuditApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiRequest<{ logs: AuditLog[]; total: number; limit: number; offset: number }>(`/audit-logs${q}`);
  },
};

// ── 피드백 (P7-R3-T4) ─────────────────────────────────────
export interface Feedback {
  feedback_id: string;
  user_id: number | null;
  type: string;
  title: string;
  description: string | null;
  screenshot_url: string | null;
  status: string;
  created_at: string | null;
}

export const FeedbackApi = {
  create: (body: { type: string; title: string; description?: string; screenshot_url?: string }) =>
    apiRequest<Feedback>("/feedback", { method: "POST", body }),
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiRequest<{ items: Feedback[]; total: number }>(`/feedback${q}`);
  },
  updateStatus: (id: string, status: string) =>
    apiRequest<Feedback>(`/feedback/${id}`, { method: "PUT", body: { status } }),
};

// ── 공간 관리 (offices/floors/rooms, P3-R1-T1) ────────────
export interface Office {
  office_id: string;
  name: string;
  description: string | null;
  address: string | null;
}
export interface Floor {
  floor_id: string;
  office_id: string;
  level: number;
  name: string;
}
export interface Room {
  room_id: string;
  floor_id: string;
  type: string;
  name: string;
  capacity: number;
  coords: Record<string, unknown>;
  status: string;
}

export const SpaceApi = {
  offices: () => apiRequest<{ offices: Office[] }>("/offices"),
  createOffice: (body: { name: string; description?: string; address?: string }) =>
    apiRequest<Office>("/offices", { method: "POST", body }),
  floors: (officeId: string) => apiRequest<{ floors: Floor[] }>(`/offices/${officeId}/floors`),
  createFloor: (body: { office_id: string; level: number; name: string }) =>
    apiRequest<Floor>("/floors", { method: "POST", body }),
  rooms: (floorId: string) => apiRequest<{ rooms: Room[] }>(`/floors/${floorId}/rooms`),
  createRoom: (body: { floor_id: string; type: string; name: string; capacity: number; coords: Record<string, unknown> }) =>
    apiRequest<Room>("/rooms", { method: "POST", body }),
};

// ── 회의록 (minutes, P5-R3-T2 / P5-R4-T3) ─────────────────
export interface MeetingMinute {
  meeting_id: string;
  minute_id?: string;
  title: string | null;
  summary: string | null;
  decisions: string | null;
  action_items_summary: string | null;
  stt_draft: string | null;
  ai_summary: string | null;
  status: string; // draft | finalized
}

export const MinuteApi = {
  get: (meetingId: string) => apiRequest<MeetingMinute>(`/meetings/${meetingId}/minutes`),
  sttDraft: (meetingId: string) =>
    apiRequest<{ meeting_id: string; stt_draft: string | null; status: string }>(
      `/meetings/${meetingId}/minutes/stt-draft`,
    ),
  update: (meetingId: string, body: { title?: string; content?: string; decisions?: string[]; action_items?: unknown[] }) =>
    apiRequest<MeetingMinute>(`/meetings/${meetingId}/minutes`, { method: "PUT", body }),
  confirm: (meetingId: string) =>
    apiRequest<MeetingMinute>(`/meetings/${meetingId}/minutes/confirm`, { method: "POST" }),
};

// ── 알림 (P7-R3-T3, admin) ────────────────────────────────
export interface Notification {
  notification_id: string;
  category: string;
  severity: string;
  title: string;
  message: string | null;
  context: unknown;
  is_read: boolean;
  created_at: string | null;
}

export const NotificationApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiRequest<{ items: Notification[]; unread_total: number }>(`/notifications${q}`);
  },
  markRead: (id: string) => apiRequest<Notification>(`/notifications/${id}/read`, { method: "PUT" }),
  markAllRead: () => apiRequest<{ marked: number }>("/notifications/read-all", { method: "POST" }),
};

// ── 회의 채팅 (P5-R3-T3) ──────────────────────────────────
export interface ChatMessage {
  message_id: string;
  meeting_id: string;
  user_id: number | null;
  content: string;
  created_at: string | null;
}

export const MessageApi = {
  list: (meetingId: string) => apiRequest<{ messages: ChatMessage[] }>(`/meetings/${meetingId}/messages`),
  send: (meetingId: string, content: string) =>
    apiRequest<ChatMessage>(`/meetings/${meetingId}/messages`, { method: "POST", body: { content } }),
};

// ── 클라이언트 버전 (P7-R3-T2) ────────────────────────────
export const ClientApi = {
  version: (current?: string) =>
    apiRequest<{ latest: string; min: string; current: string | null; url: string | null; required: boolean; up_to_date: boolean }>(
      `/api/client/version${current ? `?current=${encodeURIComponent(current)}` : ""}`,
    ),
};
