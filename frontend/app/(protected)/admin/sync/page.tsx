'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';

interface SyncLog {
  id: string;
  started_at: string;
  finished_at: string | null;
  created: number;
  updated: number;
  deactivated: number;
  status: string;
  trigger: string;
  error: string | null;
}
interface SyncStatus {
  last_run: SyncLog | null;
  total_runs: number;
  failure_count: number;
}
interface Attendance {
  user_id: number;
  attendance_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  work_type: string;
}
interface DailyPush {
  id: string;
  user_id: number;
  push_date: string;
  target: string;
  status: string;
  pushed_at: string | null;
  error: string | null;
}

export default function SyncMonitoringPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [failures, setFailures] = useState<SyncLog[]>([]);
  const [pushes, setPushes] = useState<DailyPush[]>([]);
  const [retrying, setRetrying] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');

  const today = new Date().toISOString().split('T')[0];
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attError, setAttError] = useState('');
  const [attLoaded, setAttLoaded] = useState(false);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const loadStatus = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [st, fl, ps] = await Promise.all([
        api.get<SyncStatus>('/api/erp-sync/status'),
        api.get<SyncLog[]>('/api/erp-sync/failures').catch(() => [] as SyncLog[]),
        api.get<DailyPush[]>('/api/daily-status-push').catch(() => [] as DailyPush[]),
      ]);
      setStatus(st);
      setFailures(fl);
      setPushes(ps);
    } catch {
      /* handled by empty state */
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function runSync() {
    setSyncing(true);
    try {
      await api.post('/api/erp/sync', {});
      flash('동기화 완료');
      await loadStatus();
    } catch (e) {
      flash(e instanceof ApiError ? (e.status === 403 ? '관리자 권한 필요' : `동기화 실패 (${e.status})`) : '서버 오류');
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  }

  async function retryPush(id: string) {
    setRetrying(id);
    try {
      await api.post(`/api/daily-status-push/${id}/retry`, {});
      flash('재시도 큐잉됨 (pending)');
      await loadStatus();
    } catch (e) {
      flash(e instanceof ApiError ? `재시도 실패 (${e.status})` : '서버 오류');
    } finally {
      setRetrying('');
    }
  }

  async function loadAttendances() {
    setAttLoading(true);
    setAttError('');
    try {
      const data = await api.get<Attendance[]>(`/api/attendances?start=${start}&end=${end}`);
      setAttendances(data);
      setAttLoaded(true);
    } catch (e) {
      setAttError(e instanceof ApiError ? `조회 실패 (${e.status})` : '서버 오류');
    } finally {
      setAttLoading(false);
    }
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto mt-20 text-center bg-white border border-gray-200 rounded-xl p-8">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-gray-700 font-medium">관리자 전용 화면</p>
          <p className="text-sm text-gray-400 mt-1">동기화 모니터링은 관리자만 접근할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  const last = status?.last_run ?? null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">동기화 모니터링</h1>
          <p className="text-xs text-gray-400">ERP → 플랫폼 사용자 동기화 로그 (erp_sync_log) 및 근태 read-through</p>
        </div>
        <button onClick={runSync} disabled={syncing} className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">
          {syncing ? '동기화 중...' : '지금 동기화'}
        </button>
      </div>
      {msg && <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{msg}</div>}

      {/* Status summary */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '총 실행', value: status?.total_runs ?? '—', color: 'text-gray-800' },
          { label: '실패', value: status?.failure_count ?? '—', color: (status?.failure_count ?? 0) > 0 ? 'text-red-600' : 'text-gray-800' },
          { label: '최근 결과', value: last ? (last.status === 'success' ? '성공' : '실패') : '—', color: last?.status === 'success' ? 'text-green-600' : 'text-gray-800' },
          { label: '최근 실행(KST)', value: last ? formatKst(last.started_at) : '—', color: 'text-gray-600', small: true },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-400">{c.label}</div>
            <div className={`mt-1 font-bold ${c.color} ${c.small ? 'text-xs' : 'text-2xl'}`}>{loading ? '…' : c.value}</div>
          </div>
        ))}
      </section>

      {/* Last run detail */}
      {last && (
        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="font-semibold text-gray-700 text-sm mb-2">최근 동기화 결과</h2>
          <div className="flex gap-6 text-sm">
            <span className="text-green-600">생성 +{last.created}</span>
            <span className="text-blue-600">갱신 {last.updated}</span>
            <span className="text-amber-600">비활성화 {last.deactivated}</span>
            <span className="text-gray-400">트리거 {last.trigger}</span>
          </div>
        </section>
      )}

      {/* Failures */}
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="font-semibold text-gray-700 text-sm mb-2">실패 이력 (erp_sync_log)</h2>
        {loading ? (
          <p className="text-xs text-gray-400">불러오는 중...</p>
        ) : failures.length === 0 ? (
          <p className="text-xs text-gray-400">실패 이력이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400">
              <tr><th className="text-left py-1.5">시각 (KST)</th><th className="text-left py-1.5">트리거</th><th className="text-left py-1.5">오류</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {failures.map((f) => (
                <tr key={f.id}>
                  <td className="py-2 text-gray-600">{formatKst(f.started_at)}</td>
                  <td className="py-2 text-gray-500">{f.trigger}</td>
                  <td className="py-2 text-red-600 text-xs">{f.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* EOD Push / KPI 배치 작업 상태 (job-status-table) */}
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-gray-700 text-sm">전송 작업 상태 (daily_status_push)</h2>
          <span className="text-xs text-gray-400">
            {pushes.length}건 · 대기 {pushes.filter((p) => p.status === 'pending').length} · 완료 {pushes.filter((p) => p.status === 'sent').length} · 실패 {pushes.filter((p) => p.status === 'failed').length}
          </span>
        </div>
        {loading ? (
          <p className="text-xs text-gray-400">불러오는 중...</p>
        ) : pushes.length === 0 ? (
          <p className="text-xs text-gray-400">전송 작업이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400">
              <tr>
                <th className="text-left py-1.5">날짜</th>
                <th className="text-left py-1.5">대상</th>
                <th className="text-left py-1.5">사용자</th>
                <th className="text-center py-1.5">상태</th>
                <th className="text-left py-1.5">오류</th>
                <th className="text-right py-1.5">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pushes.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 text-gray-600">{p.push_date}</td>
                  <td className="py-2 text-gray-500 text-xs">{p.target === 'erp_kpi_results' ? 'KPI' : '일일리포트'}</td>
                  <td className="py-2 text-gray-500">{p.user_id}</td>
                  <td className="py-2 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.status === 'sent' ? 'bg-green-100 text-green-700' : p.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                      {p.status === 'sent' ? '완료' : p.status === 'failed' ? '실패' : '대기'}
                    </span>
                  </td>
                  <td className="py-2 text-red-600 text-xs truncate max-w-xs">{p.error ?? '—'}</td>
                  <td className="py-2 text-right">
                    {p.status === 'failed' && (
                      <button
                        onClick={() => retryPush(p.id)}
                        disabled={retrying === p.id}
                        className="text-xs px-2 py-0.5 border border-indigo-300 text-indigo-600 rounded hover:bg-indigo-50 disabled:opacity-40"
                      >
                        {retrying === p.id ? '재시도 중...' : '재시도'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Attendances read-through */}
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold text-gray-700 text-sm">근태 read-through (ERP 원본)</h2>
          <div className="flex items-center gap-2">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1 text-sm" />
            <span className="text-gray-400 text-xs">~</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1 text-sm" />
            <button onClick={loadAttendances} disabled={attLoading} className="px-3 py-1 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {attLoading ? '조회 중...' : '조회'}
            </button>
          </div>
        </div>
        {attError && <p className="text-sm text-red-600 mb-2">{attError}</p>}
        {!attLoaded ? (
          <p className="text-xs text-gray-400">기간을 선택하고 조회하세요.</p>
        ) : attendances.length === 0 ? (
          <p className="text-xs text-gray-400">해당 기간 근태 기록이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400">
              <tr><th className="text-left py-1.5">user</th><th className="text-left py-1.5">일자</th><th className="text-left py-1.5">출근</th><th className="text-left py-1.5">퇴근</th><th className="text-left py-1.5">근무형태</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {attendances.map((a, i) => (
                <tr key={i}>
                  <td className="py-2 text-gray-700">user {a.user_id}</td>
                  <td className="py-2 text-gray-600">{a.attendance_date}</td>
                  <td className="py-2 text-gray-600">{a.check_in_at ? formatKst(a.check_in_at) : '—'}</td>
                  <td className="py-2 text-gray-600">{a.check_out_at ? formatKst(a.check_out_at) : '—'}</td>
                  <td className="py-2 text-gray-600">{a.work_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
