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
      setError(err instanceof ApiError ? `조회 실패 (${err.status})` : '서버 연결 오류');
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
                {r.ai_draft ? (
                  <div className="mt-2 text-[11px] text-gray-500 border-t border-gray-100 pt-1 whitespace-pre-wrap line-clamp-3">
                    <span className="text-gray-400">AI 초안: </span>
                    {typeof r.ai_draft === 'string' ? r.ai_draft : JSON.stringify(r.ai_draft)}
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
