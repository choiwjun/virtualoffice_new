'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';

interface SyncResult {
  created: number;
  updated: number;
  deactivated: number;
}
interface Attendance {
  user_id: number;
  attendance_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  work_type: string;
}

interface SyncRun extends SyncResult {
  at: string;
}

export default function SyncMonitoringPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  const today = new Date().toISOString().split('T')[0];
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attError, setAttError] = useState('');
  const [attLoaded, setAttLoaded] = useState(false);

  async function runSync() {
    setSyncing(true);
    setSyncError('');
    try {
      const res = await api.post<SyncResult>('/api/erp/sync', {});
      setRuns((prev) => [{ ...res, at: new Date().toISOString() }, ...prev]);
    } catch (e) {
      setSyncError(e instanceof ApiError ? (e.status === 403 ? '관리자 권한이 필요합니다.' : `동기화 실패 (${e.status})`) : '서버 오류');
    } finally {
      setSyncing(false);
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

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-800">동기화 모니터링</h1>
        <p className="text-xs text-gray-400">ERP → 플랫폼 사용자 동기화 및 근태 read-through</p>
      </div>

      {/* Sync trigger */}
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700 text-sm">ERP 사용자 동기화</h2>
          <button
            onClick={runSync}
            disabled={syncing}
            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {syncing ? '동기화 중...' : '지금 동기화'}
          </button>
        </div>
        {syncError && <p className="text-sm text-red-600 mb-2">{syncError}</p>}
        {runs.length === 0 ? (
          <p className="text-xs text-gray-400">아직 실행된 동기화가 없습니다. &quot;지금 동기화&quot;를 눌러 트리거하세요.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400">
              <tr>
                <th className="text-left py-1.5 font-medium">실행 시각 (KST)</th>
                <th className="text-right py-1.5 font-medium">생성</th>
                <th className="text-right py-1.5 font-medium">갱신</th>
                <th className="text-right py-1.5 font-medium">비활성화</th>
                <th className="text-center py-1.5 font-medium">결과</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((r, i) => (
                <tr key={i}>
                  <td className="py-2 text-gray-700">{formatKst(r.at)}</td>
                  <td className="py-2 text-right text-green-600">+{r.created}</td>
                  <td className="py-2 text-right text-blue-600">{r.updated}</td>
                  <td className="py-2 text-right text-amber-600">{r.deactivated}</td>
                  <td className="py-2 text-center"><span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">성공</span></td>
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
              <tr>
                <th className="text-left py-1.5 font-medium">user</th>
                <th className="text-left py-1.5 font-medium">일자</th>
                <th className="text-left py-1.5 font-medium">출근</th>
                <th className="text-left py-1.5 font-medium">퇴근</th>
                <th className="text-left py-1.5 font-medium">근무형태</th>
              </tr>
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

      {/* Stub: sync log / daily_status_push (no GET endpoint yet) */}
      <section className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-4">
        <h2 className="font-semibold text-gray-500 text-sm mb-1">동기화 로그 · ERP 전송 큐 (erp_sync_log / daily_status_push)</h2>
        <p className="text-xs text-gray-400">
          상세 실패 이력·재시도 큐 테이블은 백엔드 조회 엔드포인트(GET /api/erp/sync-logs, /api/daily-status-push)가 도입되면 연결됩니다.
          현재 백엔드는 동기화 트리거 결과(생성/갱신/비활성화 카운트)와 KPI 확정 시 daily_status_push 적재만 지원합니다. (스텁)
        </p>
      </section>
    </div>
  );
}
