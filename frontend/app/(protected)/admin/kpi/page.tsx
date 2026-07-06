'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove } from '@/lib/auth';
import {
  KpiResult,
  METRIC_ORDER,
  metricLabel,
  formatScore,
  formatKst,
  currentQuarterKey,
} from '@/lib/kpi';

interface Employee {
  id: number;
  name: string;
  email: string;
  erp_team_id: number;
  role: string;
}

export default function AdminKpiPage() {
  const me = getUser();
  const allowed = isLeaderOrAbove(me);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [targetId, setTargetId] = useState<number | null>(me?.id ?? null);
  const [periodType, setPeriodType] = useState<'quarterly' | 'daily'>('quarterly');
  const [periodKey, setPeriodKey] = useState(currentQuarterKey());
  const [results, setResults] = useState<KpiResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!allowed) return;
    api.get<Employee[]>('/api/employees').then(setEmployees).catch(() => {});
  }, [allowed]);

  const fetchResults = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ user_id: String(targetId), period_type: periodType });
      if (periodKey) qs.set('period_key', periodKey);
      setResults(await api.get<KpiResult[]>(`/api/kpi-results?${qs.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? `조회 실패 (${err.status})` : '서버 연결 오류');
    } finally {
      setLoading(false);
    }
  }, [targetId, periodType, periodKey]);

  useEffect(() => {
    if (allowed) fetchResults();
  }, [fetchResults, allowed]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  };

  async function runCompute() {
    if (!targetId) return;
    setBusy('compute');
    setError('');
    try {
      const res = await api.post<{ computed: number; results: KpiResult[] }>(
        '/api/kpi-results/compute',
        { user_id: targetId, period_type: periodType, period_key: periodKey },
      );
      setResults(res.results);
      flash(`계산 완료: ${res.computed}개 metric`);
    } catch (err) {
      setError(err instanceof ApiError ? `계산 실패 (${err.status})` : '계산 오류');
    } finally {
      setBusy('');
    }
  }

  async function adjust(r: KpiResult) {
    const raw = window.prompt(`[${metricLabel(r.metric)}] 조정 점수 (현재 ${formatScore(r.value)})`, formatScore(r.value));
    if (raw === null) return;
    const score = Number(raw);
    if (Number.isNaN(score)) return flash('숫자를 입력하세요');
    const note = window.prompt('조정 사유 (필수)') || '';
    if (!note.trim()) return flash('사유는 필수입니다');
    setBusy(r.id);
    try {
      const updated = await api.post<KpiResult>(`/api/kpi-results/${r.id}/adjust`, {
        admin_adjusted_score: score,
        admin_note: note,
      });
      setResults((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
      flash('조정 저장됨');
    } catch (err) {
      flash(err instanceof ApiError ? `조정 실패 (${err.status})` : '오류');
    } finally {
      setBusy('');
    }
  }

  async function finalize(r: KpiResult) {
    if (!window.confirm(`[${metricLabel(r.metric)}] 확정하시겠습니까? 확정 후 이의신청 창(7일)이 열립니다.`)) return;
    setBusy(r.id);
    try {
      const updated = await api.post<KpiResult>(`/api/kpi-results/${r.id}/finalize`, {});
      setResults((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
      flash('확정 완료');
    } catch (err) {
      flash(err instanceof ApiError ? `확정 실패 (${err.status})` : '오류');
    } finally {
      setBusy('');
    }
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto mt-20 text-center bg-white border border-gray-200 rounded-xl p-8">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-gray-700 font-medium">관리자 전용 화면</p>
          <p className="text-sm text-gray-400 mt-1">KPI 관리는 관리자/리더만 접근할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  const sorted = [...results].sort(
    (a, b) => METRIC_ORDER.indexOf(a.metric) - METRIC_ORDER.indexOf(b.metric),
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-1">KPI 관리</h1>
      <p className="text-xs text-gray-400 mb-4">대상자 KPI 계산·조정·확정 (D16 관리자 라우팅)</p>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-gray-500 gap-1">
          대상 직원
          <select
            value={targetId ?? ''}
            onChange={(e) => setTargetId(Number(e.target.value))}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-800 min-w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.email})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-500 gap-1">
          기간 유형
          <select
            value={periodType}
            onChange={(e) => {
              const pt = e.target.value as 'quarterly' | 'daily';
              setPeriodType(pt);
              setPeriodKey(pt === 'quarterly' ? currentQuarterKey() : new Date().toISOString().split('T')[0]);
            }}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="quarterly">분기</option>
            <option value="daily">일별</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-500 gap-1">
          기간 키
          <input
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <button
          onClick={fetchResults}
          className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
        >
          조회
        </button>
        <button
          onClick={runCompute}
          disabled={busy === 'compute'}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === 'compute' ? '계산 중...' : 'KPI 계산 실행'}
        </button>
      </div>

      {toast && (
        <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{toast}</div>
      )}
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          결과가 없습니다. &quot;KPI 계산 실행&quot;으로 생성하세요.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Metric</th>
                <th className="text-right px-4 py-2.5 font-medium">원점수</th>
                <th className="text-right px-4 py-2.5 font-medium">조정</th>
                <th className="text-right px-4 py-2.5 font-medium">최종</th>
                <th className="text-center px-4 py-2.5 font-medium">상태</th>
                <th className="text-right px-4 py-2.5 font-medium">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((r) => (
                <tr key={r.id} className={r.metric === 'quarterly_total' ? 'bg-indigo-50/50' : ''}>
                  <td className="px-4 py-2.5 text-gray-800">{metricLabel(r.metric)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{formatScore(r.value)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{formatScore(r.admin_adjusted_score)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{formatScore(r.final_score)}</td>
                  <td className="px-4 py-2.5 text-center">
                    {r.finalized_at ? (
                      <span className="text-xs text-green-600" title={formatKst(r.finalized_at)}>확정</span>
                    ) : (
                      <span className="text-xs text-gray-400">미확정</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => adjust(r)}
                      disabled={busy === r.id || !!r.finalized_at}
                      className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40 mr-1"
                    >
                      조정
                    </button>
                    <button
                      onClick={() => finalize(r)}
                      disabled={busy === r.id || !!r.finalized_at}
                      className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40"
                    >
                      확정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
