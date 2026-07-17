'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser } from '@/lib/auth';
import {
  KpiResult,
  METRIC_ORDER,
  metricLabel,
  formatScore,
  formatKst,
  currentQuarterKey,
  OBJECTION_STATUS,
} from '@/lib/kpi';
import AiDraftView from '@/components/AiDraftView';

type PeriodType = 'quarterly' | 'daily';

// ── 외부 계정 연동 (D31 opt-in — /api/integrations) ─────────────────────────
interface Integration {
  provider: string;
  account: string;
  verified: boolean;
  has_token: boolean;
  last_synced_at: string | null;
  activity: Record<string, unknown> | null;
  connected_at: string | null;
}

const PROVIDERS: {
  id: 'github' | 'figma';
  label: string;
  accountPlaceholder: string;
  tokenHint: string;
}[] = [
  {
    id: 'github',
    label: 'GitHub',
    accountPlaceholder: 'GitHub 사용자명 (예: octocat)',
    tokenHint: '토큰(선택) — 없으면 공개 활동만 수집',
  },
  {
    id: 'figma',
    label: 'Figma',
    accountPlaceholder: '계정 표시명',
    tokenHint: '개인 액세스 토큰 — 검증·수집에 필요',
  },
];

function ActivitySummary({ provider, activity }: { provider: string; activity: Record<string, unknown> }) {
  if (provider === 'github') {
    const repos = Array.isArray(activity.recent_repos) ? (activity.recent_repos as string[]) : [];
    return (
      <div className="text-[11px] text-gray-500 space-y-0.5">
        <div>
          최근 공개 이벤트 {String(activity.sample_size ?? 0)}건 — push {String(activity.push_events ?? 0)} ·
          PR {String(activity.pull_request_events ?? 0)} · 리뷰 {String(activity.review_events ?? 0)}
        </div>
        {repos.length > 0 && <div className="truncate">저장소: {repos.join(', ')}</div>}
      </div>
    );
  }
  return (
    <div className="text-[11px] text-gray-500">
      {String(activity.handle ?? '')} {activity.email ? `(${String(activity.email)})` : ''}
    </div>
  );
}

function IntegrationCard({
  meta,
  row,
  onChanged,
}: {
  meta: (typeof PROVIDERS)[number];
  row: Integration | undefined;
  onChanged: () => void;
}) {
  const [account, setAccount] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      setAccount('');
      setToken('');
      onChanged();
    } catch (err) {
      setMsg(errMsg(err, '실패'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">{meta.label}</span>
        {row ? (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${row.verified ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}
          >
            {row.verified ? '연동됨 · 검증완료' : '연동됨 · 미검증'}
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">미연동</span>
        )}
      </div>

      {row ? (
        <div className="mt-2 space-y-2">
          <div className="text-sm text-gray-800 font-medium">
            {row.account}
            {row.has_token && <span className="ml-1.5 text-[10px] text-gray-400">토큰 등록됨</span>}
          </div>
          {row.activity && <ActivitySummary provider={row.provider} activity={row.activity} />}
          <div className="text-[11px] text-gray-400">
            {row.last_synced_at ? `동기화 ${formatKst(row.last_synced_at)}` : '동기화 이력 없음'}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => run(() => api.post(`/api/integrations/${meta.id}/sync`, {}))}
              disabled={busy}
              className="px-2.5 py-1 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              동기화
            </button>
            <button
              onClick={() => run(() => api.delete(`/api/integrations/${meta.id}`))}
              disabled={busy}
              className="px-2.5 py-1 text-xs border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              연동 해제
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder={meta.accountPlaceholder}
            className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={meta.tokenHint}
            autoComplete="off"
            className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={() =>
              run(() =>
                api.put(`/api/integrations/${meta.id}`, {
                  account: account.trim(),
                  token: token.trim() || null,
                }),
              )
            }
            disabled={busy || !account.trim()}
            className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? '검증 중...' : '연동'}
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-[11px] text-red-600">{msg}</p>}
    </div>
  );
}

function IntegrationsPanel() {
  const [rows, setRows] = useState<Integration[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRows(await api.get<Integration[]>('/api/integrations'));
    } catch {
      // 목록 실패는 카드에서 개별 표기 — 섹션 자체는 유지
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="mt-10">
      <h2 className="text-base font-bold text-gray-800">외부 계정 연동</h2>
      <p className="text-xs text-gray-400 mb-3">
        본인 계정 자발 등록(opt-in, D31) · 활동 요약은 참고 표시용 — KPI 점수에는 반영되지 않습니다
      </p>
      {!loaded ? (
        <div className="text-sm text-gray-400 py-6">불러오는 중...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PROVIDERS.map((meta) => (
            <IntegrationCard
              key={meta.id}
              meta={meta}
              row={rows.find((r) => r.provider === meta.id)}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ApiError.message 노출 (QA #7)
function errMsg(err: unknown, prefix: string): string {
  if (err instanceof ApiError) return `${prefix} (${err.status}): ${err.message}`;
  return '서버 연결 오류';
}

export default function MyKpiPage() {
  const [results, setResults] = useState<KpiResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periodType, setPeriodType] = useState<PeriodType>('quarterly');
  const [periodKey, setPeriodKey] = useState(currentQuarterKey());

  const me = getUser();

  const fetchResults = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ user_id: String(me.id), period_type: periodType });
      if (periodKey) qs.set('period_key', periodKey);
      const data = await api.get<KpiResult[]>(`/api/kpi-results?${qs.toString()}`);
      setResults(data);
    } catch (err) {
      setError(errMsg(err, '조회 실패'));
    } finally {
      setLoading(false);
    }
  }, [me?.id, periodType, periodKey]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const sorted = [...results].sort(
    (a, b) => METRIC_ORDER.indexOf(a.metric) - METRIC_ORDER.indexOf(b.metric),
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-800">내 KPI</h1>
        <div className="flex items-center gap-2">
          <select
            value={periodType}
            onChange={(e) => {
              const pt = e.target.value as PeriodType;
              setPeriodType(pt);
              setPeriodKey(pt === 'quarterly' ? currentQuarterKey() : new Date().toISOString().split('T')[0]);
            }}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="quarterly">분기</option>
            <option value="daily">일별</option>
          </select>
          <input
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            placeholder={periodType === 'quarterly' ? '2026-Q3' : '2026-07-06'}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={fetchResults}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            조회
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-5">본인 KPI 열람 전용 · 정량 지표는 결정론 계산(감사 요건)</p>

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">불러오는 중...</div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-600 text-sm mb-2">{error}</p>
          <button onClick={fetchResults} className="text-xs text-indigo-600 underline">
            재시도
          </button>
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          해당 기간({periodKey})의 KPI 결과가 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((r) => {
            const highlight = r.metric === 'quarterly_total' || r.metric === 'collaboration_score';
            const obj = OBJECTION_STATUS[r.objection_status];
            return (
              <div
                key={r.id}
                className={`rounded-xl border p-4 ${highlight ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">{metricLabel(r.metric)}</span>
                  {r.objection_status !== 'none' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${obj.color}`}>{obj.label}</span>
                  )}
                </div>
                <div className={`mt-2 font-bold ${highlight ? 'text-3xl text-indigo-700' : 'text-2xl text-gray-800'}`}>
                  {formatScore(r.final_score ?? r.value)}
                  {r.unit && <span className="text-sm font-normal text-gray-400 ml-1">{r.unit}</span>}
                </div>
                <div className="mt-1 text-[11px] text-gray-400">
                  원점수 {formatScore(r.value)}
                  {r.final_score !== null && r.final_score !== r.value && ` · 최종 ${formatScore(r.final_score)}`}
                </div>
                <div className="mt-2 h-1.5 w-full bg-white/70 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${(() => { const pp = Math.max(0, Math.min(100, r.final_score ?? r.value ?? 0)); return pp >= 80 ? 'bg-green-500' : pp >= 50 ? 'bg-amber-400' : 'bg-red-400'; })()}`}
                    style={{ width: `${Math.max(0, Math.min(100, r.final_score ?? r.value ?? 0))}%` }}
                  />
                </div>
                {r.finalized_at && (
                  <div className="mt-2 text-[11px] text-green-600">확정 {formatKst(r.finalized_at)}</div>
                )}
                {/* AI 초안은 분기(quarterly) 데이터에만 존재 — daily 행에는 표시하지 않음 */}
                {periodType === 'quarterly' && r.ai_draft ? (
                  <div className="mt-2 text-[11px] text-gray-500 border-t border-gray-100 pt-1.5">
                    <div className="text-gray-400 mb-1">AI 초안</div>
                    <AiDraftView draft={r.ai_draft} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* 외부 계정 연동 (D31) — 조회 실패/데이터 없음과 무관하게 항상 노출 */}
      <IntegrationsPanel />
    </div>
  );
}
