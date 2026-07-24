'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';
import {
  PageHeader,
  ToolbarButton,
  StatCard,
  SectionCard,
  EmptyState,
} from '@/components/ui/console';

const ICON = {
  sync: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M15.5 6.5A6 6 0 1 0 16 10" /><path d="M15.5 3v4h-4" /></svg>,
  refresh: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M15.5 6.5A6 6 0 1 0 16 10" /><path d="M15.5 3v4h-4" /></svg>,
  play: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M7 5l8 5-8 5z" /></svg>,
  runs: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 6h12M4 10h12M4 14h8" /></svg>,
  alert: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M10 3 2.5 16.5h15z" /><path d="M10 8v3.5M10 14h.01" /></svg>,
  check: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="10" cy="10" r="7" /><path d="M6.8 10.2l2.2 2.2 4.2-4.6" /></svg>,
  clock: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.8 1.8" /></svg>,
  detail: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M6 8h8M6 11h5" /></svg>,
  push: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M10 3v9" /><path d="M6.5 6.5 10 3l3.5 3.5" /><path d="M4 16h12" /></svg>,
  calendar: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="4" width="14" height="13" rx="2" /><path d="M3 8h14M7 3v3M13 3v3" /></svg>,
  lock: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="4" y="9" width="12" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>,
};

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
      <div className="p-6 text-text-secondary">
        <div className="max-w-md mx-auto mt-20">
          <SectionCard>
            <EmptyState icon={ICON.lock} title="관리자 전용 화면" hint="동기화 모니터링은 관리자만 접근할 수 있습니다." />
          </SectionCard>
        </div>
      </div>
    );
  }

  const last = status?.last_run ?? null;

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title="동기화 모니터링"
        subtitle="ERP → 플랫폼 사용자 동기화 로그 (erp_sync_log) 및 근태 read-through"
        icon={ICON.sync}
        actions={
          <>
            <ToolbarButton onClick={loadStatus} disabled={loading} icon={ICON.refresh}>
              새로고침
            </ToolbarButton>
            <ToolbarButton onClick={runSync} disabled={syncing} variant="primary" icon={ICON.play}>
              {syncing ? '동기화 중...' : '지금 동기화'}
            </ToolbarButton>
          </>
        }
      />

      {msg && (
        <div className="px-3 py-2 bg-[rgba(34,197,94,0.16)] border border-[rgba(34,197,94,0.4)] rounded-xl text-sm text-status-online">{msg}</div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col gap-5 pr-0.5">
        {/* Status summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <StatCard
            label="총 실행"
            value={loading ? '…' : (status?.total_runs ?? '—')}
            accent="#93A9FF"
            icon={ICON.runs}
          />
          <StatCard
            label="실패"
            value={loading ? '…' : (status?.failure_count ?? '—')}
            accent={(status?.failure_count ?? 0) > 0 ? '#EF4444' : '#B4C0D3'}
            icon={ICON.alert}
          />
          <StatCard
            label="최근 결과"
            value={loading ? '…' : (last ? (last.status === 'success' ? '성공' : '실패') : '—')}
            accent={last?.status === 'success' ? '#22C55E' : '#B4C0D3'}
            icon={ICON.check}
          />
          <StatCard
            label="최근 실행(KST)"
            value={loading ? '…' : (last ? formatKst(last.started_at) : '—')}
            accent="#38BDF8"
            icon={ICON.clock}
          />
        </div>

        {/* Last run detail */}
        {last && (
          <SectionCard title="최근 동기화 결과" icon={ICON.detail}>
            <div className="flex gap-6 text-sm flex-wrap">
              <span className="text-status-online">생성 +{last.created}</span>
              <span className="text-accent-cyan">갱신 {last.updated}</span>
              <span className="text-status-external">비활성화 {last.deactivated}</span>
              <span className="text-text-muted">트리거 {last.trigger}</span>
            </div>
          </SectionCard>
        )}

        {/* Failures */}
        <SectionCard title="실패 이력 (erp_sync_log)" icon={ICON.alert} bodyClassName="p-0">
          {loading ? (
            <p className="text-xs text-text-muted px-4 py-4">불러오는 중...</p>
          ) : failures.length === 0 ? (
            <EmptyState icon={ICON.check} title="실패 이력이 없습니다." compact />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-text-muted">
                <tr><th className="text-left px-4 py-2">시각 (KST)</th><th className="text-left px-4 py-2">트리거</th><th className="text-left px-4 py-2">오류</th></tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {failures.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-2 text-text-secondary">{formatKst(f.started_at)}</td>
                    <td className="px-4 py-2 text-text-muted">{f.trigger}</td>
                    <td className="px-4 py-2 text-red-300 text-xs">{f.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* EOD Push / KPI 배치 작업 상태 (job-status-table) */}
        <SectionCard
          title="전송 작업 상태 (daily_status_push)"
          icon={ICON.push}
          action={
            <span className="text-xs text-text-muted">
              {pushes.length}건 · 대기 {pushes.filter((p) => p.status === 'pending').length} · 완료 {pushes.filter((p) => p.status === 'sent').length} · 실패 {pushes.filter((p) => p.status === 'failed').length}
            </span>
          }
          bodyClassName="p-0"
        >
          {loading ? (
            <p className="text-xs text-text-muted px-4 py-4">불러오는 중...</p>
          ) : pushes.length === 0 ? (
            <EmptyState icon={ICON.push} title="전송 작업이 없습니다." compact />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-text-muted">
                <tr>
                  <th className="text-left px-4 py-2">날짜</th>
                  <th className="text-left px-4 py-2">대상</th>
                  <th className="text-left px-4 py-2">사용자</th>
                  <th className="text-center px-4 py-2">상태</th>
                  <th className="text-left px-4 py-2">오류</th>
                  <th className="text-right px-4 py-2">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {pushes.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-text-secondary">{p.push_date}</td>
                    <td className="px-4 py-2 text-text-muted text-xs">{p.target === 'erp_kpi_results' ? 'KPI' : '일일리포트'}</td>
                    <td className="px-4 py-2 text-text-muted">{p.user_id}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.status === 'sent' ? 'bg-[rgba(34,197,94,0.16)] text-status-online' : p.status === 'failed' ? 'bg-[rgba(239,68,68,0.12)] text-red-300' : 'bg-[rgba(245,158,11,0.16)] text-status-external'}`}>
                        {p.status === 'sent' ? '완료' : p.status === 'failed' ? '실패' : '대기'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-red-300 text-xs truncate max-w-xs">{p.error ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      {p.status === 'failed' && (
                        <button
                          onClick={() => retryPush(p.id)}
                          disabled={retrying === p.id}
                          className="text-xs px-2 py-0.5 border border-primary/50 text-accent-cyan rounded hover:bg-primary/10 disabled:opacity-40"
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
        </SectionCard>

        {/* Attendances read-through */}
        <SectionCard
          title="근태 read-through (ERP 원본)"
          icon={ICON.calendar}
          action={
            <div className="flex items-center gap-2">
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-2 py-1 text-sm [color-scheme:dark]" />
              <span className="text-text-muted text-xs">~</span>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-2 py-1 text-sm [color-scheme:dark]" />
              <button onClick={loadAttendances} disabled={attLoading} className="px-3 py-1 text-sm border border-border-subtle rounded-md text-text-secondary hover:bg-bg-surface-raised disabled:opacity-50">
                {attLoading ? '조회 중...' : '조회'}
              </button>
            </div>
          }
          bodyClassName="p-0"
        >
          {attError && <p className="text-sm text-red-300 px-4 pt-3">{attError}</p>}
          {!attLoaded ? (
            <EmptyState icon={ICON.calendar} title="기간을 선택하고 조회하세요." compact />
          ) : attendances.length === 0 ? (
            <EmptyState icon={ICON.calendar} title="해당 기간 근태 기록이 없습니다." compact />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-text-muted">
                <tr><th className="text-left px-4 py-2">user</th><th className="text-left px-4 py-2">일자</th><th className="text-left px-4 py-2">출근</th><th className="text-left px-4 py-2">퇴근</th><th className="text-left px-4 py-2">근무형태</th></tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {attendances.map((a, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-text-secondary">user {a.user_id}</td>
                    <td className="px-4 py-2 text-text-secondary">{a.attendance_date}</td>
                    <td className="px-4 py-2 text-text-secondary">{a.check_in_at ? formatKst(a.check_in_at) : '—'}</td>
                    <td className="px-4 py-2 text-text-secondary">{a.check_out_at ? formatKst(a.check_out_at) : '—'}</td>
                    <td className="px-4 py-2 text-text-secondary">{a.work_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
