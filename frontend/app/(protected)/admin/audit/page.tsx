'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';
import {
  PageHeader,
  ToolbarButton,
  SectionCard,
  EmptyState,
  ErrorBanner,
  LoadingState,
  CARD_SURFACE,
} from '@/components/ui/console';

const ICON = {
  shield: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M10 2.5 4 5v4.2c0 3.6 2.4 6.4 6 8.3 3.6-1.9 6-4.7 6-8.3V5z" /><path d="M7.4 10.2 9.2 12l3.4-3.8" /></svg>,
  refresh: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M15.5 6.5A6 6 0 1 0 16 10" /><path d="M15.5 3v4h-4" /></svg>,
  list: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 6h12M4 10h12M4 14h8" /></svg>,
  lock: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="4.5" y="9" width="11" height="7.5" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>,
};

interface AuditLog {
  id: string;
  user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

interface AuditListResponse {
  items: AuditLog[];
  total: number;
}

const ACTION_COLOR: Record<string, string> = {
  kpi_finalized: 'bg-[rgba(34,197,94,0.16)] text-status-online',
  kpi_adjusted: 'bg-[rgba(56,189,248,0.15)] text-accent-cyan',
  kpi_objection_submitted: 'bg-[rgba(245,158,11,0.16)] text-status-external',
  seat_assigned: 'bg-[rgba(59,91,254,0.2)] text-[#93A9FF]',
  seat_unassigned: 'bg-bg-surface-raised text-text-secondary',
  meeting_created: 'bg-[rgba(139,92,246,0.18)] text-status-focus',
  office_layout_deployed: 'bg-[rgba(56,189,248,0.15)] text-accent-cyan',
};

const PAGE = 30;

// ApiError.message 노출 (QA #7)
function errMsg(err: unknown, prefix: string): string {
  if (err instanceof ApiError) return `${prefix} (${err.status}): ${err.message}`;
  return '서버 연결 오류';
}

// '변경' 열: old_value가 있으면 `old → new` 형식으로 표시
function formatChange(log: AuditLog): string {
  if (log.old_value) {
    return `${JSON.stringify(log.old_value)} → ${log.new_value ? JSON.stringify(log.new_value) : '—'}`;
  }
  return log.new_value ? JSON.stringify(log.new_value) : '—';
}

export default function AuditLogPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [startDate, setStartDate] = useState(''); // YYYY-MM-DD (포함)
  const [endDate, setEndDate] = useState(''); // YYYY-MM-DD (포함)
  const [offset, setOffset] = useState(0);

  const fetchLogs = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (action) qs.set('action', action);
      if (entityType) qs.set('entity_type', entityType);
      // audit.py: start/end — ISO8601 포함 비교. 종료일은 그날 전체 포함되도록 23:59:59 부여.
      if (startDate) qs.set('start', startDate);
      if (endDate) qs.set('end', `${endDate}T23:59:59`);
      const data = await api.get<AuditListResponse>(`/api/audit-logs?${qs.toString()}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(errMsg(err, '조회 실패'));
    } finally {
      setLoading(false);
    }
  }, [allowed, action, entityType, startDate, endDate, offset]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (!allowed) {
    return (
      <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
        <div className={`max-w-md mx-auto mt-20 w-full ${CARD_SURFACE} p-4`}>
          <EmptyState
            icon="🔒"
            title="관리자 전용 화면"
            hint="감사 로그는 관리자만 접근할 수 있습니다."
          />
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const curPage = Math.floor(offset / PAGE) + 1;

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title="감사 로그"
        subtitle="중요 엔티티 변경 이력 (좌석·회의·KPI·레이아웃) · D20-e 5년 보존"
        icon={ICON.shield}
        actions={
          <ToolbarButton onClick={fetchLogs} disabled={loading} icon={ICON.refresh}>
            새로고침
          </ToolbarButton>
        }
      />

      <div className={`flex flex-wrap items-center gap-2 ${CARD_SURFACE} p-3`}>
        <select value={action} onChange={(e) => { setOffset(0); setAction(e.target.value); }} className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan">
          <option value="">전체 액션</option>
          <option value="kpi_finalized">KPI 확정</option>
          <option value="kpi_adjusted">KPI 조정</option>
          <option value="kpi_objection_submitted">이의신청 접수</option>
          <option value="seat_assigned">좌석 배정</option>
          <option value="meeting_created">회의 생성</option>
          <option value="office_layout_deployed">레이아웃 배포</option>
        </select>
        <select value={entityType} onChange={(e) => { setOffset(0); setEntityType(e.target.value); }} className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan">
          <option value="">전체 엔티티</option>
          <option value="kpi_result">kpi_result</option>
          <option value="seat">seat</option>
          <option value="meeting">meeting</option>
          <option value="office_layout">office_layout</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-text-muted">
          시작일
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setOffset(0); setStartDate(e.target.value); }}
            className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan [color-scheme:dark]"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-text-muted">
          종료일
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setOffset(0); setEndDate(e.target.value); }}
            className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan [color-scheme:dark]"
          />
        </label>
        {(startDate || endDate) && (
          <button
            onClick={() => { setOffset(0); setStartDate(''); setEndDate(''); }}
            className="text-xs text-accent-cyan hover:underline"
          >
            기간 초기화
          </button>
        )}
        <span className="text-xs text-text-muted ml-auto">총 {total}건</span>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchLogs} />}

      {loading ? (
        <LoadingState label="불러오는 중…" />
      ) : !error && items.length === 0 ? (
        <SectionCard title="변경 이력" icon={ICON.list}>
          <EmptyState icon={ICON.lock} title="감사 로그가 없습니다" hint="선택한 조건에 해당하는 변경 이력이 없습니다." compact />
        </SectionCard>
      ) : !error ? (
        <SectionCard title="변경 이력" icon={ICON.list} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border-subtle text-text-muted text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">시각 (KST)</th>
                  <th className="text-left px-4 py-2.5 font-medium">액션</th>
                  <th className="text-left px-4 py-2.5 font-medium">엔티티</th>
                  <th className="text-left px-4 py-2.5 font-medium">대상 ID</th>
                  <th className="text-left px-4 py-2.5 font-medium">행위자</th>
                  <th className="text-left px-4 py-2.5 font-medium">변경</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {items.map((log) => (
                  <tr key={log.id} className="hover:bg-bg-surface-raised transition-colors">
                    <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{formatKst(log.created_at)}</td>
                    <td className="px-4 py-2.5"><span className={`text-[10px] px-1.5 py-0.5 rounded ${ACTION_COLOR[log.action] ?? 'bg-bg-surface-raised text-text-secondary'}`}>{log.action}</span></td>
                    <td className="px-4 py-2.5 text-text-secondary">{log.entity_type}</td>
                    <td className="px-4 py-2.5 text-text-muted font-mono text-xs">{log.entity_id.slice(0, 12)}</td>
                    <td className="px-4 py-2.5 text-text-secondary">{log.user_id ?? '시스템'}</td>
                    <td className="px-4 py-2.5 text-text-muted text-xs max-w-xs">
                      <span className="block truncate" title={formatChange(log)}>{formatChange(log)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={curPage <= 1} className="px-2 py-1 border border-border-subtle rounded disabled:opacity-40">이전</button>
          <span className="text-text-muted">{curPage} / {totalPages}</span>
          <button onClick={() => setOffset(offset + PAGE)} disabled={curPage >= totalPages} className="px-2 py-1 border border-border-subtle rounded disabled:opacity-40">다음</button>
        </div>
      )}
    </div>
  );
}
