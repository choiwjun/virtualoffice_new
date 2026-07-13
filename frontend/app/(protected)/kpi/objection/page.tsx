'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { KpiResult, metricLabel, formatScore, formatKst, OBJECTION_STATUS } from '@/lib/kpi';

// 08 §3.3 제출 형식 — 백엔드 허용 카테고리 3종 (자유 한글 카테고리는 422)
const CATEGORY_OPTIONS = [
  { value: 'score_basis', label: '점수 근거 이의' },
  { value: 'missing_signal', label: '신호 누락' },
  { value: 'data_error', label: '데이터 오류' },
] as const;

type ObjectionCategory = (typeof CATEGORY_OPTIONS)[number]['value'];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((c) => [c.value, c.label]),
);

// objection_detail — 구/신 형식 모두 수용 (신: objection_category/objection_text/evidence[])
interface ObjectionDetailAny {
  category?: string;
  text?: string;
  objection_category?: string;
  objection_text?: string;
  evidence?: unknown;
}

// 이 화면 맥락에 맞춘 코드별 안내 (lib/apiErrors 공통 맵보다 우선)
const KNOWN_ERRORS: Record<string, string> = {
  already_finalized: '이미 확정된 결과입니다. 확정 후에는 이의신청을 접수할 수 없습니다.',
  objection_window_expired: '이의신청 기간(평가 공개 후 7일)이 만료되었습니다.',
  invalid_objection_category: '유효하지 않은 카테고리입니다.',
  not_finalized_yet: '아직 공개되지 않은 결과입니다.',
  forbidden: '본인 결과에만 이의신청할 수 있습니다.',
};

// ApiError.message 노출 (QA #7)
function errMsg(err: unknown, prefix: string): string {
  if (err instanceof ApiError) {
    const known = err.code ? KNOWN_ERRORS[err.code] : undefined;
    return known ?? `${prefix} (${err.status}): ${err.message}`;
  }
  return '서버 연결 오류';
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 7;

// 이의 가능 기한: 기준 = admin_reviewed_at ?? created_at, 마감 = 기준+7일
function objectionDeadline(r: KpiResult): number {
  const base = r.admin_reviewed_at ?? r.created_at;
  return new Date(base).getTime() + WINDOW_DAYS * DAY_MS;
}

function daysLeft(r: KpiResult): number {
  return Math.ceil((objectionDeadline(r) - Date.now()) / DAY_MS);
}

function DdayBadge({ r }: { r: KpiResult }) {
  const d = daysLeft(r);
  if (d <= 0) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">기한 만료</span>;
  }
  const cls = d <= 2 ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-indigo-700';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}>D-{d}</span>;
}

export default function KpiObjectionPage() {
  const me = getUser();
  const [results, setResults] = useState<KpiResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<KpiResult | null>(null);
  const [category, setCategory] = useState<ObjectionCategory>(CATEGORY_OPTIONS[0].value);
  const [text, setText] = useState('');
  const [evidence, setEvidence] = useState(''); // 여러 줄 = 여러 evidence 링크
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [toast, setToast] = useState('');

  const fetchResults = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    setError('');
    try {
      // 이의신청은 평가 공개(admin_reviewed_at ?? created_at) 후 7일 내, 확정 전에만 가능 —
      // 접수 이력 확인을 위해 본인 결과 전체를 표시한다.
      const data = await api.get<KpiResult[]>(`/api/kpi-results?user_id=${me.id}`);
      setResults(data);
    } catch (err) {
      setError(errMsg(err, '조회 실패'));
    } finally {
      setLoading(false);
    }
  }, [me?.id]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  };

  async function submit() {
    if (!target) return;
    if (text.trim().length < 10) {
      setSaveError('이의 내용은 10자 이상이어야 합니다.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      // 증거: 여러 줄 입력 → [{type:'link', url}] 배열 변환
      const evidenceList = evidence
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((url) => ({ type: 'link', url }));
      const updated = await api.post<KpiResult>(`/api/kpi-results/${target.id}/objections`, {
        category,
        text: text.trim(),
        ...(evidenceList.length ? { evidence: evidenceList } : {}),
      });
      setResults((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setTarget(null);
      setText('');
      setEvidence('');
      flash('이의신청이 접수되었습니다.');
    } catch (err) {
      setSaveError(errMsg(err, '접수 실패'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-1">KPI 이의신청</h1>
      <p className="text-xs text-gray-400 mb-5">
        본인 KPI에 대해 이의를 제기할 수 있습니다 — 평가 공개 후 7일 이내, 확정 전에만 접수됩니다.
      </p>

      {toast && (
        <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{toast}</div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">불러오는 중...</div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-600 text-sm mb-2">{error}</p>
          <button onClick={fetchResults} className="text-xs text-indigo-600 underline">재시도</button>
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">이의신청 가능한 KPI 결과가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {results.map((r) => {
            const obj = OBJECTION_STATUS[r.objection_status];
            const detail = r.objection_detail as ObjectionDetailAny | null;
            const detailText = detail?.objection_text ?? detail?.text;
            const detailCategory = detail?.objection_category ?? detail?.category;
            const expired = daysLeft(r) <= 0;
            const eligible = r.objection_status === 'none' && !r.finalized_at && !expired;
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800">{metricLabel(r.metric)}</span>
                    <span className="text-xs text-gray-400">{r.period_key}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${obj.color}`}>{obj.label}</span>
                    <DdayBadge r={r} />
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    점수 {formatScore(r.final_score ?? r.value)} · 공개 {formatKst(r.admin_reviewed_at ?? r.created_at)}
                    {r.finalized_at && <span className="text-green-600"> · 확정 {formatKst(r.finalized_at)}</span>}
                  </div>
                  {detailText && (
                    <div className="text-xs text-gray-400 mt-1">
                      내 사유{detailCategory ? ` [${CATEGORY_LABELS[detailCategory] ?? detailCategory}]` : ''}: {detailText}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setTarget(r);
                    setSaveError('');
                  }}
                  disabled={!eligible}
                  className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {r.objection_status !== 'none'
                    ? '접수됨'
                    : r.finalized_at
                      ? '확정됨'
                      : expired
                        ? '기한 만료'
                        : '이의신청'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">이의신청 — {metricLabel(target.metric)}</h2>
              <button onClick={() => setTarget(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="flex items-center justify-between text-xs bg-gray-50 rounded-md px-3 py-2">
                <span className="text-gray-500">이의 가능 기한 (공개 후 7일)</span>
                <DdayBadge r={target} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ObjectionCategory)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이의 내용 (10자 이상)</label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="점수에 이의를 제기하는 근거를 구체적으로 작성하세요."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">증거 링크 (선택 · 한 줄에 하나)</label>
                <textarea
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder={'https://...\nhttps://...'}
                />
                <p className="mt-1 text-xs text-gray-400">여러 줄 입력 시 각 줄이 별도 증거로 접수됩니다.</p>
              </div>
              {saveError && <p className="text-sm text-red-600">{saveError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setTarget(null)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  onClick={submit}
                  disabled={saving || text.trim().length < 10}
                  className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? '접수 중...' : '접수'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
