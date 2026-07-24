'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
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
  users: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="7.5" cy="6.5" r="2.8" /><path d="M2.5 16c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" /><path d="M13.5 4.3a2.6 2.6 0 0 1 0 4.9" /><path d="M14 11.8c2.1.4 3.5 1.9 3.5 4.2" /></svg>,
  download: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M10 3v9" /><path d="M6.5 9.5 10 13l3.5-3.5" /><path d="M4 16h12" /></svg>,
  refresh: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M15.5 6.5A6 6 0 1 0 16 10" /><path d="M15.5 3v4h-4" /></svg>,
  list: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 6h12M4 10h12M4 14h8" /></svg>,
  search: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="8.5" cy="8.5" r="5" /><path d="m13 13 3.5 3.5" /></svg>,
};

interface Employee {
  id: number;
  email: string;
  name: string;
  erp_team_id: number;
  role: string;
  position: string | null;
  position_id: number | null;
  manager_id: number | null;
  work_type: string | null;
  is_active: boolean;
  presence_status: string | null;
  seat_number: string | null;
}

const TEAM_LABELS: Record<number, string> = {
  1: '개발팀',
  2: '기획팀',
  3: '디자인팀',
  4: '마케팅팀',
  5: '인사팀',
  6: '재무팀',
};

const ROLE_LABELS: Record<string, string> = {
  admin: '관리자',
  super_admin: '최고관리자',
  leader: '리더',
  employee: '직원',
};

const PRESENCE_LABELS: Record<string, { label: string; color: string }> = {
  online: { label: '온라인', color: 'bg-[rgba(34,197,94,0.16)] text-status-online' },
  working: { label: '업무중', color: 'bg-[rgba(34,197,94,0.16)] text-status-online' },
  meeting: { label: '회의중', color: 'bg-[rgba(56,189,248,0.15)] text-accent-cyan' },
  focus: { label: '집중', color: 'bg-[rgba(245,158,11,0.16)] text-status-external' },
  away: { label: '자리비움', color: 'bg-bg-surface-raised text-text-muted' },
  external: { label: '외근', color: 'bg-[rgba(139,92,246,0.18)] text-status-focus' },
  offline: { label: '오프라인', color: 'bg-bg-surface-raised text-text-muted' },
};

const PAGE_SIZE = 15;

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Filters
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  // Detail panel
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<Employee[]>('/api/employees');
      setEmployees(data);
      setLastSynced(new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`❌ ERP 동기화 실패 — ${err.message}`);
      } else {
        setError('❌ 네트워크 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Derived: unique teams from data
  const teams = useMemo(() => {
    const ids = Array.from(new Set(employees.map((e) => e.erp_team_id))).sort((a, b) => a - b);
    return ids;
  }, [employees]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = employees;
    if (teamFilter) {
      list = list.filter((e) => String(e.erp_team_id) === teamFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (e) => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q),
      );
    }
    if (statusFilter) {
      list = list.filter((e) => (e.presence_status ?? 'offline') === statusFilter);
    }
    return list;
  }, [employees, teamFilter, searchQuery, statusFilter]);

  // Paginated
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [teamFilter, searchQuery, statusFilter]);

  // RFC 4180: 쉼표/따옴표/줄바꿈 포함 값은 큰따옴표로 감싸고 내부 " 는 "" 로 이스케이프
  function csvField(value: string | number): string {
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // CSV export
  function exportCsv() {
    const headers = ['ID', '이름', '이메일', '팀', '직급', '역할', '근무형태'];
    const rows = filtered.map((e) => [
      e.id,
      e.name,
      e.email,
      TEAM_LABELS[e.erp_team_id] ?? `팀 ${e.erp_team_id}`,
      e.position ?? '',
      ROLE_LABELS[e.role] ?? e.role,
      e.work_type ?? '',
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvField).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employees_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      {/* Page header */}
      <PageHeader
        title="직원명부"
        subtitle={`🔒 ERP 동기화 데이터 — 읽기 전용${lastSynced ? ` · 마지막 갱신: ${lastSynced}` : ''}`}
        icon={ICON.users}
        actions={
          <>
            <ToolbarButton onClick={exportCsv} icon={ICON.download} title="현재 필터 결과를 CSV로 다운로드">
              CSV
            </ToolbarButton>
            <ToolbarButton onClick={fetchEmployees} disabled={loading} icon={ICON.refresh} variant="primary">
              새로고침
            </ToolbarButton>
          </>
        }
      />

      {/* Filter toolbar */}
      <div className={`flex items-center gap-3 ${CARD_SURFACE} p-3`}>
        {/* Team filter */}
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
        >
          <option value="">전체 팀</option>
          {teams.map((id) => (
            <option key={id} value={String(id)}>
              {TEAM_LABELS[id] ?? `팀 ${id}`}
            </option>
          ))}
        </select>

        {/* Status filter (presence) */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
        >
          <option value="">전체 상태</option>
          {Object.entries(PRESENCE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {/* Search */}
        <div className="flex-1 relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted">
            {ICON.search}
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="이름 또는 이메일 검색..."
            className="w-full pl-9 pr-3 py-1.5 border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
          />
        </div>

        {/* Result count */}
        <span className="text-sm text-text-muted whitespace-nowrap">
          {filtered.length}명
        </span>

        {/* Reset */}
        {(teamFilter || searchQuery) && (
          <button
            onClick={() => {
              setTeamFilter('');
              setSearchQuery('');
            }}
            className="text-sm text-accent-cyan hover:underline whitespace-nowrap"
          >
            필터 초기화
          </button>
        )}
      </div>

      {/* Error */}
      {error && <ErrorBanner message={error} onRetry={fetchEmployees} />}

      {/* Content area */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Table */}
        <SectionCard
          title="직원 목록"
          icon={ICON.list}
          className="flex-1 overflow-hidden"
          bodyClassName="p-0 flex-1 flex flex-col overflow-hidden"
        >
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <LoadingState />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon="📭"
                title="조회 결과가 없습니다"
                action={
                  (teamFilter || searchQuery) ? (
                    <button
                      onClick={() => {
                        setTeamFilter('');
                        setSearchQuery('');
                      }}
                      className="text-sm text-accent-cyan underline"
                    >
                      필터 초기화
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-sm">
                  <thead className="border-b border-border-subtle">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wide w-1/5">
                        이름
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wide w-1/5">
                        팀
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wide w-1/6">
                        직급
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wide w-1/6">
                        좌석
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wide w-1/6">
                        상태
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wide w-1/5">
                        이메일
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wide w-1/6">
                        역할
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wide w-1/6">
                        근무형태
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {paginated.map((emp) => (
                      <tr
                        key={emp.id}
                        onClick={() => setSelectedEmployee(emp)}
                        className={`cursor-pointer hover:bg-bg-surface-raised transition-colors ${
                          selectedEmployee?.id === emp.id ? 'bg-primary/10' : ''
                        }`}
                      >
                        <td className="px-4 py-2.5 font-medium text-text-primary">{emp.name}</td>
                        <td className="px-4 py-2.5 text-text-secondary">
                          {TEAM_LABELS[emp.erp_team_id] ?? `팀 ${emp.erp_team_id}`}
                        </td>
                        <td className="px-4 py-2.5 text-text-secondary">{emp.position ?? '—'}</td>
                        <td className="px-4 py-2.5 text-text-secondary text-xs">{emp.seat_number ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          {emp.presence_status ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PRESENCE_LABELS[emp.presence_status]?.color ?? 'bg-bg-surface-raised text-text-muted'}`}>
                              {PRESENCE_LABELS[emp.presence_status]?.label ?? emp.presence_status}
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">오프라인</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-text-muted text-xs">{emp.email}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              emp.role === 'admin' || emp.role === 'super_admin'
                                ? 'bg-[rgba(139,92,246,0.18)] text-status-focus'
                                : emp.role === 'leader'
                                  ? 'bg-[rgba(56,189,248,0.15)] text-accent-cyan'
                                  : 'bg-bg-surface-raised text-text-secondary'
                            }`}
                          >
                            {ROLE_LABELS[emp.role] ?? emp.role}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-text-secondary text-xs">
                          {emp.work_type ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex-shrink-0 px-4 py-3 border-t border-border-subtle flex items-center justify-between">
                  <span className="text-xs text-text-muted">
                    {(currentPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(currentPage * PAGE_SIZE, filtered.length)} / {filtered.length}명
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-2 py-1 text-xs border border-border-subtle rounded disabled:opacity-40 hover:bg-bg-surface-raised"
                    >
                      이전
                    </button>
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      const pg =
                        totalPages <= 7
                          ? i + 1
                          : currentPage <= 4
                            ? i + 1
                            : currentPage >= totalPages - 3
                              ? totalPages - 6 + i
                              : currentPage - 3 + i;
                      return (
                        <button
                          key={pg}
                          onClick={() => setPage(pg)}
                          className={`px-2.5 py-1 text-xs rounded ${
                            pg === currentPage
                              ? 'bg-primary text-white'
                              : 'border border-border-subtle hover:bg-bg-surface-raised'
                          }`}
                        >
                          {pg}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-2 py-1 text-xs border border-border-subtle rounded disabled:opacity-40 hover:bg-bg-surface-raised"
                    >
                      다음
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </SectionCard>

        {/* Detail panel */}
        {selectedEmployee && (
          <div className={`w-72 flex-shrink-0 ${CARD_SURFACE} overflow-y-auto animate-in slide-in-from-right-4 duration-200`}>
            <div className="p-4 border-b border-border-subtle flex items-center justify-between">
              <h2 className="font-semibold text-text-primary text-sm">직원 상세</h2>
              <button
                onClick={() => setSelectedEmployee(null)}
                className="text-text-muted hover:text-text-primary text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Avatar */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[rgba(59,91,254,0.2)] flex items-center justify-center text-accent-cyan text-xl font-bold">
                  {selectedEmployee.name.charAt(0)}
                </div>
                <div>
                  <div className="font-semibold text-text-primary">{selectedEmployee.name}</div>
                  <div className="text-xs text-text-muted">{selectedEmployee.email}</div>
                </div>
              </div>

              <div className="text-xs text-status-external bg-[rgba(245,158,11,0.16)] rounded px-2 py-1">
                🔒 읽기 전용: ERP에서 자동 동기화됨
              </div>

              {/* Fields */}
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">팀</dt>
                  <dd className="text-text-primary font-medium">
                    {TEAM_LABELS[selectedEmployee.erp_team_id] ??
                      `팀 ${selectedEmployee.erp_team_id}`}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">직급</dt>
                  <dd className="text-text-primary font-medium">
                    {selectedEmployee.position ?? '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">역할</dt>
                  <dd>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        selectedEmployee.role === 'admin' ||
                        selectedEmployee.role === 'super_admin'
                          ? 'bg-[rgba(139,92,246,0.18)] text-status-focus'
                          : selectedEmployee.role === 'leader'
                            ? 'bg-[rgba(56,189,248,0.15)] text-accent-cyan'
                            : 'bg-bg-surface-raised text-text-secondary'
                      }`}
                    >
                      {ROLE_LABELS[selectedEmployee.role] ?? selectedEmployee.role}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">근무형태</dt>
                  <dd className="text-text-primary">{selectedEmployee.work_type ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">상태</dt>
                  <dd>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        selectedEmployee.is_active
                          ? 'bg-[rgba(34,197,94,0.16)] text-status-online'
                          : 'bg-[rgba(239,68,68,0.12)] text-red-300'
                      }`}
                    >
                      {selectedEmployee.is_active ? '재직중' : '비활성'}
                    </span>
                  </dd>
                </div>
                {selectedEmployee.manager_id && (
                  <div className="flex justify-between">
                    <dt className="text-text-muted">매니저 ID</dt>
                    <dd className="text-text-primary">{selectedEmployee.manager_id}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
