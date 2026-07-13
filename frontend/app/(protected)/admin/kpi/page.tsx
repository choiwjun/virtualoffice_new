'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove } from '@/lib/auth';
import AiDraftView from '@/components/AiDraftView';
import {
  KpiResult,
  METRIC_ORDER,
  metricLabel,
  formatScore,
  formatKst,
  currentQuarterKey,
  OBJECTION_STATUS,
} from '@/lib/kpi';

interface Employee {
  id: number;
  name: string;
  email: string;
  erp_team_id: number;
  role: string;
}

// lib/apiErrors 공통 맵에 없는 이 화면 전용 코드 보강 (08 §3.2/§3.3)
const KNOWN_ERRORS: Record<string, string> = {
  admin_required: '관리자 권한이 필요합니다.',
  forbidden: '권한이 없습니다.',
  not_found: '대상을 찾을 수 없습니다.',
};

// 이전 분기 키 계산 (예: 2026-Q3 → 2026-Q2, 2026-Q1 → 2025-Q4)
function prevQuarterKey(key: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const q = Number(m[2]);
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
}

// 조정 모달 보조 정보 (08 §3.2): 최근 4분기 추이 + 팀 평균 벤치마크 + ±30% 급변 경고
interface AdjustInsight {
  trend: { period: string; score: number }[]; // 오름차순, 최대 4분기
  teamAvg: number | null; // 동일 metric·period 전 직원(최대 10명) 평균
  deltaPct: number | null; // 이전 분기 대비 변화율(%)
}

// ApiError.message 노출 (QA #7)
function errMsg(err: unknown, prefix: string): string {
  if (err instanceof ApiError) {
    const known = err.code ? KNOWN_ERRORS[err.code] : undefined;
    return `${prefix} (${err.status}): ${known ?? err.message}`;
  }
  return '서버 연결 오류';
}

// 조정 모달 보조 뷰 — 데이터 없으면 조용히 생략 (CSS 인라인 바, 라이브러리 없음)
function AdjustInsightView({ insight }: { insight: AdjustInsight | null }) {
  if (!insight) return null;
  const { trend, teamAvg, deltaPct } = insight;
  if (trend.length === 0 && teamAvg == null && deltaPct == null) return null;
  const maxScore = Math.max(0, ...trend.map((t) => t.score));
  return (
    <div className="space-y-2">
      {deltaPct != null && Math.abs(deltaPct) >= 30 && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-300 rounded-md text-xs text-amber-800">
          ⚠️ 이전 분기 대비 {deltaPct > 0 ? '+' : ''}
          {deltaPct.toFixed(0)}% 급변 — 조정 전 원인 확인을 권장합니다.
        </div>
      )}
      {trend.length > 0 && (
        <div className="bg-gray-50 rounded-md px-3 py-2">
          <div className="text-[11px] text-gray-500 mb-1">최근 분기 추이</div>
          <div className="flex items-end gap-2">
            {trend.map((t) => (
              <div key={t.period} className="flex-1 flex flex-col items-center min-w-0">
                <span className="text-[10px] text-gray-600 leading-none mb-0.5">
                  {formatScore(t.score)}
                </span>
                <div className="w-full h-10 flex items-end">
                  <div
                    className="w-full bg-indigo-400 rounded-t"
                    style={{
                      height: `${maxScore > 0 ? Math.max(Math.round((t.score / maxScore) * 100), 4) : 4}%`,
                    }}
                  />
                </div>
                <span className="mt-0.5 text-[10px] text-gray-400">{t.period.slice(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {teamAvg != null && (
        <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 text-xs">
          <span className="text-gray-500">팀 평균 (동일 지표·기간)</span>
          <span className="font-semibold text-gray-700">{teamAvg.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

// 조정/이의 처리 공용 모달 — 원점수 ±10% 클라이언트 검증 (08 §3.2)
interface ScoreNoteModalProps {
  title: string;
  description?: string;
  origin: number; // 원점수(value)
  scoreLabel: string;
  scoreOptional?: boolean; // true면 비워두기 허용(점수 유지)
  scoreValue: string;
  onScoreChange: (v: string) => void;
  noteLabel: string;
  noteMinLen: number; // 0이면 선택 입력
  notePlaceholder: string;
  noteValue: string;
  onNoteChange: (v: string) => void;
  error: string;
  saving: boolean;
  submitLabel: string;
  savingLabel: string;
  onClose: () => void;
  onSubmit: () => void;
  extra?: ReactNode; // 보조 정보 (분기 추이·팀 평균·급변 경고 등)
}

function ScoreNoteModal(p: ScoreNoteModalProps) {
  const lo = Math.min(p.origin * 0.9, p.origin * 1.1);
  const hi = Math.max(p.origin * 0.9, p.origin * 1.1);
  const scoreEmpty = p.scoreValue.trim() === '';
  const scoreNum = Number(p.scoreValue);
  const scoreValid = scoreEmpty
    ? !!p.scoreOptional
    : !Number.isNaN(scoreNum) && scoreNum >= lo && scoreNum <= hi;
  const noteLen = p.noteValue.trim().length;
  const noteValid = noteLen >= p.noteMinLen;
  const canSubmit = scoreValid && noteValid && !p.saving;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">{p.title}</h2>
          <button onClick={p.onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-4 max-h-[80vh] overflow-y-auto">
          {p.description && <p className="text-xs text-gray-500">{p.description}</p>}
          <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 text-sm">
            <span className="text-gray-500">원점수</span>
            <span className="font-semibold text-gray-800">{formatScore(p.origin)}</span>
          </div>
          {p.extra}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{p.scoreLabel}</label>
            <input
              type="number"
              step="0.1"
              min={lo}
              max={hi}
              value={p.scoreValue}
              onChange={(e) => p.onScoreChange(e.target.value)}
              placeholder={p.scoreOptional ? '비워두면 점수 유지' : formatScore(p.origin)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              허용 범위 {lo.toFixed(1)} ~ {hi.toFixed(1)} (원점수 ±10%)
            </p>
            {!scoreEmpty && !scoreValid && (
              <p className="mt-1 text-xs text-red-600">
                {Number.isNaN(scoreNum) ? '숫자를 입력하세요.' : '±10% 범위를 벗어났습니다.'}
              </p>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">{p.noteLabel}</label>
              {p.noteMinLen > 0 && (
                <span className={`text-xs ${noteValid ? 'text-gray-400' : 'text-red-600'}`}>
                  {noteLen}/{p.noteMinLen}자
                </span>
              )}
            </div>
            <textarea
              value={p.noteValue}
              onChange={(e) => p.onNoteChange(e.target.value)}
              rows={4}
              placeholder={p.notePlaceholder}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {p.error && <p className="text-sm text-red-600">{p.error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={p.onClose}
              className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={p.onSubmit}
              disabled={!canSubmit}
              className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {p.saving ? p.savingLabel : p.submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
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
  const [warn, setWarn] = useState('');
  const [toast, setToast] = useState('');

  // 조정/이의 처리 모달 상태
  const [adjustTarget, setAdjustTarget] = useState<KpiResult | null>(null);
  const [resolveTarget, setResolveTarget] = useState<KpiResult | null>(null);
  const [modalScore, setModalScore] = useState('');
  const [modalNote, setModalNote] = useState('');
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);
  const [adjustInsight, setAdjustInsight] = useState<AdjustInsight | null>(null);

  // 조정 모달 보조 정보 (08 §3.2) — 분기 결과만. 실패/데이터 없음이면 조용히 생략
  useEffect(() => {
    setAdjustInsight(null);
    if (!adjustTarget || adjustTarget.period_type !== 'quarterly') return;
    let cancelled = false;
    (async () => {
      try {
        // 1) 대상 사용자의 분기 전체 결과 → 동일 metric 최근 4분기 추이 + 직전 분기 대비 변화율
        const mine = await api
          .get<KpiResult[]>(`/api/kpi-results?user_id=${adjustTarget.user_id}&period_type=quarterly`)
          .catch(() => [] as KpiResult[]);
        const byPeriod = new Map<string, number>();
        for (const r of mine) {
          if (r.metric !== adjustTarget.metric || r.period_key > adjustTarget.period_key) continue;
          const s = r.final_score ?? r.value;
          if (s != null) byPeriod.set(r.period_key, s);
        }
        const trend = Array.from(byPeriod.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-4)
          .map(([period, score]) => ({ period, score }));
        const prevKey = prevQuarterKey(adjustTarget.period_key);
        const prev = prevKey ? byPeriod.get(prevKey) : undefined;
        const deltaPct =
          prev != null && prev !== 0
            ? ((adjustTarget.value - prev) / Math.abs(prev)) * 100
            : null;

        // 2) 팀(전체) 평균 벤치마크 — /api/employees 목록으로 개별 조회 (최대 10명, 실패 시 생략)
        let teamAvg: number | null = null;
        const sample = employees.slice(0, 10);
        if (sample.length > 0) {
          const qs = `period_type=quarterly&period_key=${encodeURIComponent(adjustTarget.period_key)}`;
          const rows = await Promise.all(
            sample.map((emp) =>
              api
                .get<KpiResult[]>(`/api/kpi-results?user_id=${emp.id}&${qs}`)
                .catch(() => [] as KpiResult[]),
            ),
          );
          const scores = rows
            .flat()
            .filter((r) => r.metric === adjustTarget.metric)
            .map((r) => r.final_score ?? r.value)
            .filter((s): s is number => s != null);
          if (scores.length > 0) teamAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
        }

        if (!cancelled) setAdjustInsight({ trend, teamAvg, deltaPct });
      } catch {
        if (!cancelled) setAdjustInsight(null); // 계산 불가 시 조용히 생략
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adjustTarget, employees]);

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
      setError(errMsg(err, '조회 실패'));
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
      setError(errMsg(err, '계산 실패'));
    } finally {
      setBusy('');
    }
  }

  // 조정 모달 열기 (window.prompt 제거 — QA #4)
  function openAdjust(r: KpiResult) {
    setAdjustTarget(r);
    setResolveTarget(null);
    setModalScore(String(r.value ?? ''));
    setModalNote('');
    setModalError('');
  }

  async function submitAdjust() {
    if (!adjustTarget) return;
    setModalSaving(true);
    setModalError('');
    try {
      const updated = await api.post<KpiResult>(`/api/kpi-results/${adjustTarget.id}/adjust`, {
        admin_adjusted_score: Number(modalScore),
        admin_note: modalNote.trim(),
      });
      setResults((prev) => prev.map((x) => (x.id === adjustTarget.id ? updated : x)));
      setAdjustTarget(null);
      flash('조정 저장됨');
    } catch (err) {
      setModalError(errMsg(err, '조정 실패'));
    } finally {
      setModalSaving(false);
    }
  }

  // 이의 검토 시작 (submitted → reviewing)
  async function advanceObjection(r: KpiResult) {
    if (!window.confirm(`[${metricLabel(r.metric)}] 이의신청 검토를 시작하시겠습니까? (submitted → reviewing)`)) return;
    setBusy(r.id);
    try {
      const updated = await api.post<KpiResult>(`/api/kpi-results/${r.id}/objections/review`, { action: 'advance' });
      setResults((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
      flash('검토 시작(reviewing)');
    } catch (err) {
      setError(errMsg(err, '검토 시작 실패'));
    } finally {
      setBusy('');
    }
  }

  // 이의 처리(resolve) 모달 열기 — revised_score도 ±10% 동일 검증 (QA #4)
  function openResolve(r: KpiResult) {
    setResolveTarget(r);
    setAdjustTarget(null);
    setModalScore('');
    setModalNote('');
    setModalError('');
  }

  async function submitResolve() {
    if (!resolveTarget) return;
    setModalSaving(true);
    setModalError('');
    try {
      const body: Record<string, unknown> = { action: 'resolve' };
      if (modalNote.trim()) body.note = modalNote.trim();
      if (modalScore.trim() !== '') body.revised_score = Number(modalScore);
      const updated = await api.post<KpiResult>(
        `/api/kpi-results/${resolveTarget.id}/objections/review`,
        body,
      );
      setResults((prev) => prev.map((x) => (x.id === resolveTarget.id ? updated : x)));
      setResolveTarget(null);
      flash('이의 처리 완료(resolved) — 최종 점수 확정');
    } catch (err) {
      setModalError(errMsg(err, '이의 처리 실패'));
    } finally {
      setModalSaving(false);
    }
  }

  async function finalize(r: KpiResult) {
    if (!window.confirm(`[${metricLabel(r.metric)}] 확정하시겠습니까? 확정 후에는 이의신청을 접수할 수 없습니다.`)) return;
    setBusy(r.id);
    try {
      const updated = await api.post<KpiResult>(`/api/kpi-results/${r.id}/finalize`, {});
      setResults((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
      flash('확정 완료');
    } catch (err) {
      setError(errMsg(err, '확정 실패'));
    } finally {
      setBusy('');
    }
  }

  const [tab, setTab] = useState<'detail' | 'ranking'>('detail');
  const [ranking, setRanking] = useState<{ name: string; email: string; score: number | null }[]>([]);
  const [rankLoading, setRankLoading] = useState(false);
  const [pushing, setPushing] = useState(false);

  async function exportErp() {
    // 이의신청 진행 중(submitted/reviewing)인 행은 push 대상에서 제외 (QA #4)
    const candidates = results.filter((r) => r.finalized_at && r.metric === 'quarterly_total');
    const excluded = candidates.filter(
      (r) => r.objection_status === 'submitted' || r.objection_status === 'reviewing',
    );
    const finals = candidates.filter(
      (r) => r.objection_status !== 'submitted' && r.objection_status !== 'reviewing',
    );
    setWarn(
      excluded.length
        ? `이의신청 진행 중(접수/검토중)인 ${excluded.length}건은 ERP 전송 대상에서 제외되었습니다.`
        : '',
    );
    if (finals.length === 0) {
      flash(excluded.length ? '전송 가능한 행이 없습니다 (이의 진행 중 제외)' : '확정된 종합 점수가 없습니다');
      return;
    }
    setPushing(true);
    try {
      for (const r of finals) {
        await api.post('/api/daily-status-push', {
          user_id: r.user_id,
          target: 'erp_kpi_results',
          payload: { metric: r.metric, final_score: r.final_score, period_key: r.period_key },
        });
      }
      flash(`ERP 전송 큐잉 완료 ${finals.length}건 (erp_kpi_results)`);
    } catch (e) {
      setError(errMsg(e, '푸시 실패'));
    } finally {
      setPushing(false);
    }
  }

  const loadRanking = useCallback(async () => {
    if (!employees.length) return;
    setRankLoading(true);
    try {
      const target = employees.find((e) => e.id === targetId);
      const mates = employees.filter((e) => e.erp_team_id === target?.erp_team_id);
      const rows = await Promise.all(
        mates.map(async (e) => {
          const rs = await api
            .get<KpiResult[]>(`/api/kpi-results?user_id=${e.id}&period_type=${periodType}&period_key=${periodKey}`)
            .catch(() => [] as KpiResult[]);
          const total = rs.find((x) => x.metric === 'quarterly_total');
          return { name: e.name, email: e.email, score: total?.final_score ?? total?.value ?? null };
        }),
      );
      rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      setRanking(rows);
    } finally {
      setRankLoading(false);
    }
  }, [employees, targetId, periodType, periodKey]);

  useEffect(() => {
    if (allowed && tab === 'ranking') loadRanking();
  }, [tab, loadRanking, allowed]);

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
        <button
          onClick={exportErp}
          disabled={pushing}
          className="px-4 py-2 text-sm border border-indigo-300 text-indigo-600 rounded-md hover:bg-indigo-50 disabled:opacity-50"
        >
          {pushing ? '전송 중...' : '내보내기 (ERP 푸시)'}
        </button>
      </div>

      {toast && (
        <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{toast}</div>
      )}
      {warn && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-700">{warn}</div>
      )}
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">{error}</div>
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-4">
        {([['detail', '지표 상세'], ['ranking', '팀 랭킹']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md ${tab === k ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* AI 초안 (ai-draft-display) — 분기(quarterly)에만 존재 */}
      {tab === 'detail' && periodType === 'quarterly' && sorted.length > 0 && (() => {
        const withDraft = sorted.find((r) => r.ai_draft);
        return (
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <div className="text-sm font-semibold text-gray-700 mb-2">AI 평가 초안</div>
            {withDraft ? (
              <AiDraftView draft={withDraft.ai_draft} />
            ) : (
              <p className="text-xs text-gray-400">AI 초안이 아직 없습니다. 21:00 야간 배치(D17)에서 생성됩니다.</p>
            )}
          </div>
        );
      })()}

      {/* 팀 랭킹 (team-summary-section) */}
      {tab === 'ranking' && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">팀 랭킹 (종합점수)</div>
          {rankLoading ? (
            <p className="text-xs text-gray-400">불러오는 중...</p>
          ) : ranking.length === 0 ? (
            <p className="text-xs text-gray-400">팀 데이터가 없습니다.</p>
          ) : (
            <ol className="space-y-1">
              {ranking.map((m, i) => (
                <li key={m.email} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                  <span className="flex items-center gap-2">
                    <span className={`w-5 text-center text-xs font-bold ${i < 3 ? 'text-indigo-600' : 'text-gray-400'}`}>{i + 1}</span>
                    <span className="text-gray-800">{m.name}</span>
                    <span className="text-xs text-gray-400">{m.email}</span>
                  </span>
                  <span className="font-semibold text-gray-800">{m.score != null ? m.score.toFixed(1) : '—'}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === 'detail' && (loading ? (
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
                <th className="px-4 py-2.5 font-medium">진행도</th>
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
                  <td className="px-4 py-2.5 w-40">
                    {(() => {
                      const pct = Math.max(0, Math.min(100, r.final_score ?? r.value ?? 0));
                      const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-center whitespace-nowrap">
                    {r.finalized_at ? (
                      <span className="text-xs text-green-600" title={formatKst(r.finalized_at)}>확정</span>
                    ) : (
                      <span className="text-xs text-gray-400">미확정</span>
                    )}
                    {r.objection_status !== 'none' && (
                      <span className={`ml-1 text-[10px] px-1 py-0.5 rounded ${OBJECTION_STATUS[r.objection_status].color}`}>
                        {OBJECTION_STATUS[r.objection_status].label}
                      </span>
                    )}
                    {r.pushed_to_erp && (
                      <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-blue-100 text-blue-600" title={formatKst(r.pushed_at)}>ERP↑</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {r.objection_status === 'submitted' && (
                      <button
                        onClick={() => advanceObjection(r)}
                        disabled={busy === r.id}
                        className="text-xs px-2 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-40 mr-1"
                      >
                        검토 시작
                      </button>
                    )}
                    {r.objection_status === 'reviewing' && (
                      <button
                        onClick={() => openResolve(r)}
                        disabled={busy === r.id}
                        className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40 mr-1"
                      >
                        이의 처리
                      </button>
                    )}
                    <button
                      onClick={() => openAdjust(r)}
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
      ))}

      {/* 조정 모달 (window.prompt 대체) */}
      {adjustTarget && (
        <ScoreNoteModal
          title={`점수 조정 — ${metricLabel(adjustTarget.metric)}`}
          description="관리자 조정은 원점수 ±10% 이내에서만 허용됩니다 (08 §3.2)."
          origin={adjustTarget.value}
          scoreLabel="조정 점수"
          scoreValue={modalScore}
          onScoreChange={setModalScore}
          noteLabel="조정 사유 (30자 이상 필수)"
          noteMinLen={30}
          notePlaceholder="조정 근거를 30자 이상 구체적으로 작성하세요."
          noteValue={modalNote}
          onNoteChange={setModalNote}
          error={modalError}
          saving={modalSaving}
          submitLabel="조정 저장"
          savingLabel="저장 중..."
          onClose={() => setAdjustTarget(null)}
          onSubmit={submitAdjust}
          extra={<AdjustInsightView insight={adjustInsight} />}
        />
      )}

      {/* 이의 처리(resolve) 모달 — revised_score도 ±10% 동일 검증 */}
      {resolveTarget && (
        <ScoreNoteModal
          title={`이의 처리 — ${metricLabel(resolveTarget.metric)}`}
          description="처리(resolve) 시 final_score와 finalized_at이 확정됩니다. 재조정 점수는 원점수 ±10% 이내."
          origin={resolveTarget.value}
          scoreLabel="재조정 점수 (선택)"
          scoreOptional
          scoreValue={modalScore}
          onScoreChange={setModalScore}
          noteLabel="처리 메모 (선택)"
          noteMinLen={0}
          notePlaceholder="처리 결과 메모 (선택)"
          noteValue={modalNote}
          onNoteChange={setModalNote}
          error={modalError}
          saving={modalSaving}
          submitLabel="처리 완료 (확정)"
          savingLabel="처리 중..."
          onClose={() => setResolveTarget(null)}
          onSubmit={submitResolve}
        />
      )}
    </div>
  );
}
