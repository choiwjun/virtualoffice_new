// KPI 도메인 상수 (04 §2.5 metric 8종 정본, D15 이의신청 상태머신). 신규 파일 — 기존 lib 무수정.

export interface KpiResult {
  id: string;
  user_id: number;
  period_type: string;
  period_key: string;
  metric: string;
  value: number;
  unit: string | null;
  source: string;
  ai_draft: unknown | null;
  admin_adjusted_score: number | null;
  admin_note: string | null;
  admin_user_id: number | null;
  admin_reviewed_at: string | null;
  objection_status: ObjectionStatus;
  objection_detail: ObjectionDetail | null;
  objection_submitted_at: string | null;
  objection_resolved_at: string | null;
  final_score: number | null;
  finalized_at: string | null;
  note: string | null;
  pushed_to_erp: boolean;
  pushed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ObjectionDetail {
  category?: string;
  text?: string;
  evidence?: string | null;
  submitted_at?: string;
}

export type ObjectionStatus = 'none' | 'submitted' | 'reviewing' | 'resolved';

// 04 §2.5 정본 metric 어휘 8종 (이 외 금지)
export const METRIC_LABELS: Record<string, string> = {
  work_completed_count: '완료 업무 수',
  work_quality_score: '업무 품질 점수',
  minutes_authored_count: '작성 회의록 수',
  action_items_completed: '완료 액션아이템',
  action_items_ontime_rate: '액션 정시 완료율',
  report_fidelity_score: '보고 충실도',
  collaboration_score: '협업 종합 점수',
  quarterly_total: '분기 종합 점수',
};

export const METRIC_ORDER = [
  'quarterly_total',
  'collaboration_score',
  'work_completed_count',
  'work_quality_score',
  'minutes_authored_count',
  'action_items_completed',
  'action_items_ontime_rate',
  'report_fidelity_score',
];

export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric;
}

// D15 이의신청 상태머신: none → submitted → reviewing → resolved
export const OBJECTION_STATUS: Record<ObjectionStatus, { label: string; color: string }> = {
  none: { label: '이의 없음', color: 'bg-gray-100 text-gray-500' },
  submitted: { label: '접수됨', color: 'bg-amber-100 text-amber-700' },
  reviewing: { label: '검토중', color: 'bg-blue-100 text-blue-700' },
  resolved: { label: '처리완료', color: 'bg-green-100 text-green-700' },
};

export function formatScore(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function formatKst(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  } catch {
    return iso;
  }
}

// 현재 분기 키 (예: 2026-Q3)
export function currentQuarterKey(d = new Date()): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

export function todayKey(d = new Date()): string {
  return d.toISOString().split('T')[0];
}
