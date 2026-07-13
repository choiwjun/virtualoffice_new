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

type PeriodType = 'quarterly' | 'daily';

// ai_draft 구조 (D17 배치, mock/nvidia 공통) — 분기(quarterly)에만 존재
interface AiDraft {
  강점?: string[] | string;
  개선?: string[] | string;
  근거?: string;
  _source?: string;
}

// ApiError.message 노출 (QA #7)
function errMsg(err: unknown, prefix: string): string {
  if (err instanceof ApiError) return `${prefix} (${err.status}): ${err.message}`;
  return '서버 연결 오류';
}

// AI 초안 필드별 렌더 (강점/개선/근거 — 배열이면 목록)
function AiDraftView({ draft }: { draft: unknown }) {
  if (typeof draft === 'string') {
    return <p className="whitespace-pre-wrap">{draft}</p>;
  }
  if (!draft || typeof draft !== 'object') return null;
  const d = draft as AiDraft;
  const renderVal = (v: string[] | string | undefined) => {
    if (Array.isArray(v)) {
      return (
        <ul className="list-disc list-inside space-y-0.5">
          {v.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      );
    }
    if (v) return <p className="whitespace-pre-wrap">{v}</p>;
    return null;
  };
  return (
    <div className="space-y-1.5">
      {d._source && (
        <span
          className={`inline-block text-[9px] px-1 py-0.5 rounded ${d._source === 'nvidia' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
        >
          {d._source === 'nvidia' ? 'NVIDIA 생성' : 'MOCK 생성'}
        </span>
      )}
      {d.강점 && (
        <div>
          <span className="font-semibold text-gray-500">강점</span>
          {renderVal(d.강점)}
        </div>
      )}
      {d.개선 && (
        <div>
          <span className="font-semibold text-gray-500">개선</span>
          {renderVal(d.개선)}
        </div>
      )}
      {d.근거 && (
        <div>
          <span className="font-semibold text-gray-500">근거</span>
          {renderVal(d.근거)}
        </div>
      )}
    </div>
  );
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
    </div>
  );
}
