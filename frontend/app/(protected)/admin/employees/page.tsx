'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin as checkAdmin } from '@/lib/auth';
import {
  PageHeader,
  ToolbarButton,
  SectionCard,
  EmptyState,
  ErrorBanner,
  LoadingState,
  CARD_SURFACE,
} from '@/components/ui/console';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { LabeledInput, Label, Select } from '@/components/ui/Field';
import { useToast, useConfirm } from '@/components/ui/feedback';

const ICON = {
  users: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="7.5" cy="6.5" r="2.8" /><path d="M2.5 16c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" /><path d="M13.5 4.3a2.6 2.6 0 0 1 0 4.9" /><path d="M14 11.8c2.1.4 3.5 1.9 3.5 4.2" /></svg>,
  download: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M10 3v9" /><path d="M6.5 9.5 10 13l3.5-3.5" /><path d="M4 16h12" /></svg>,
  refresh: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M15.5 6.5A6 6 0 1 0 16 10" /><path d="M15.5 3v4h-4" /></svg>,
  plus: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="w-full h-full"><path d="M10 4.5v11M4.5 10h11" /></svg>,
  link: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-1 1" /><path d="M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l1-1" /></svg>,
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
  /** 'erp' = ERP 동기화 정본(편집해도 다음 동기화가 덮어씀) / 'native' = 콘솔 직접 관리 */
  source: string;
  /** 비밀번호가 설정돼 실제 로그인 가능한 계정인지 (초대 전이면 false) */
  has_login: boolean;
  presence_status: string | null;
  seat_number: string | null;
}

// ⚠ 임시 표기: 팀 이름의 정본이 아직 DB에 없다. erp_team_id는 숫자뿐이고 GET /api/teams도
// 인원 집계만 돌려준다(전용 team 테이블 부재). org_group 트리와 erp_team_id를 잇는 것은
// team_zone뿐인데 이 화면은 그걸 읽지 않는다. 그래서 여기 값이 실제 조직과 어긋나면
// "데이터팀장인데 소속은 디자인팀"처럼 읽힌다 — 조직도(org_group)와 반드시 함께 고친다.
const TEAM_LABELS: Record<number, string> = {
  1: '플랫폼개발팀',
  2: '디자인실',
  3: '데이터팀',
  4: '품질팀',
  5: '영업팀',
  6: '마케팅팀',
  7: '인사팀',
  8: '재무팀',
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

/** 팀 라벨(알려진 ERP 팀) — 0은 native 유저의 미할당 센티널. */
function teamLabel(id: number): string {
  if (id === 0) return '미배정';
  return TEAM_LABELS[id] ?? `팀 ${id}`;
}

const EMPTY_FORM = {
  email: '',
  name: '',
  role: 'employee',
  erp_team_id: '0',
  position: '',
  initial_password: '',
};

/** 관리자에게 돌려주는 1회용 비밀번호 설정 링크 (E4). 서버는 해시만 갖고 있어 재조회 불가. */
interface AccessLink {
  url: string;
  purpose: 'invitation' | 'password_reset' | string;
  expires_at: string;
  employee_id: number;
  employee_name: string;
  employee_email: string;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Filters
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);

  // Detail panel
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // 유저 관리 (E3)
  const me = useMemo(() => getUser(), []);
  const canManage = checkAdmin(me);
  const isSuperAdmin = me?.role === 'super_admin';
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  /** 행 단위 진행 중 표시 — 같은 행의 중복 클릭 차단. */
  const [busyId, setBusyId] = useState<number | null>(null);
  /** 발급된 링크 모달 (E4) — 이 화면을 닫으면 링크를 다시 볼 수 없다. */
  const [accessLink, setAccessLink] = useState<AccessLink | null>(null);
  const [copied, setCopied] = useState(false);

  const toast = useToast();
  const confirm = useConfirm();

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = includeInactive && canManage ? '?include_inactive=true' : '';
      const data = await api.get<Employee[]>(`/api/employees${qs}`);
      setEmployees(data);
      setLastSynced(new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`❌ 직원 목록을 불러오지 못했습니다 — ${err.message}`);
      } else {
        setError('❌ 네트워크 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  }, [includeInactive, canManage]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Derived: unique teams from data
  const teams = useMemo(() => {
    const ids = Array.from(new Set(employees.map((e) => e.erp_team_id))).sort((a, b) => a - b);
    return ids;
  }, [employees]);

  /** ERP 연동 회사인지 — 한 명이라도 ERP 동기화 유저가 있으면 연동으로 본다(23 E12 모드 표기). */
  const erpLinked = useMemo(() => employees.some((e) => e.source === 'erp'), [employees]);

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
  }, [teamFilter, searchQuery, statusFilter, includeInactive]);

  /** 목록/상세의 한 행을 서버 응답으로 교체 (전체 재조회 없이 즉시 반영). */
  function replaceRow(updated: Employee) {
    setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setSelectedEmployee((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  function apiMessage(err: unknown, fallback: string): string {
    return err instanceof ApiError ? err.message : fallback;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.email.trim() || !form.name.trim()) {
      setFormError('이메일과 이름은 필수입니다.');
      return;
    }
    if (form.initial_password && form.initial_password.length < 8) {
      setFormError('초기 비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    setCreating(true);
    try {
      const created = await api.post<Employee>('/api/employees', {
        email: form.email.trim(),
        name: form.name.trim(),
        role: form.role,
        erp_team_id: Number(form.erp_team_id) || 0,
        position: form.position.trim() || null,
        initial_password: form.initial_password || null,
      });
      setEmployees((prev) => [...prev, created].sort((a, b) => a.id - b.id));
      setShowCreate(false);
      setForm(EMPTY_FORM);
      toast.success(`${created.name} 님을 추가했습니다.`);

      // 비번을 안 정했다면 관리자의 다음 행동은 항상 "초대 링크 전달"이다 → 바로 발급해서 띄운다.
      if (!created.has_login) {
        try {
          const link = await api.post<AccessLink>(`/api/employees/${created.id}/access-link`, {});
          setAccessLink(link);
          setCopied(false);
        } catch (err) {
          toast.error(apiMessage(err, '초대 링크 발급에 실패했습니다. 목록에서 다시 시도하세요.'));
        }
      }
    } catch (err) {
      setFormError(apiMessage(err, '직원 추가에 실패했습니다.'));
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(emp: Employee, role: string) {
    if (role === emp.role) return;
    setBusyId(emp.id);
    try {
      const updated = await api.patch<Employee>(`/api/employees/${emp.id}`, { role });
      replaceRow(updated);
      toast.success(`${emp.name} 님의 역할을 ${ROLE_LABELS[role] ?? role}(으)로 변경했습니다.`);
    } catch (err) {
      toast.error(apiMessage(err, '역할 변경에 실패했습니다.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeactivate(emp: Employee) {
    const ok = await confirm({
      title: '직원 비활성',
      message: `${emp.name} 님을 비활성 처리할까요? 로그인이 차단되고 명부에서 숨겨집니다. (기록은 보존되며 다시 활성화할 수 있습니다.)`,
      confirmLabel: '비활성',
      danger: true,
    });
    if (!ok) return;
    setBusyId(emp.id);
    try {
      await api.delete(`/api/employees/${emp.id}`);
      if (includeInactive) {
        replaceRow({ ...emp, is_active: false });
      } else {
        setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
        setSelectedEmployee((prev) => (prev?.id === emp.id ? null : prev));
      }
      toast.success(`${emp.name} 님을 비활성 처리했습니다.`);
    } catch (err) {
      toast.error(apiMessage(err, '비활성 처리에 실패했습니다.'));
    } finally {
      setBusyId(null);
    }
  }

  /** 비밀번호 설정 링크 발급 (E4). 서버가 has_login으로 초대/재설정을 판단한다. */
  async function handleIssueLink(emp: Employee) {
    if (emp.has_login) {
      const ok = await confirm({
        title: '비밀번호 재설정 링크',
        message: `${emp.name} 님의 비밀번호 재설정 링크를 발급할까요? 발급하면 이전에 보낸 링크는 즉시 무효가 되며, 현재 비밀번호는 본인이 새로 설정할 때까지 그대로 유지됩니다.`,
        confirmLabel: '발급',
      });
      if (!ok) return;
    }
    setBusyId(emp.id);
    try {
      const link = await api.post<AccessLink>(`/api/employees/${emp.id}/access-link`, {});
      setAccessLink(link);
      setCopied(false);
    } catch (err) {
      toast.error(apiMessage(err, '링크 발급에 실패했습니다.'));
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('링크를 복사했습니다.');
    } catch {
      // clipboard 권한이 없거나 비보안 컨텍스트(http) — 사용자가 직접 선택해 복사하게 둔다.
      toast.error('자동 복사에 실패했습니다. 링크를 직접 선택해 복사해주세요.');
    }
  }

  async function handleRevokeLink(emp: Employee) {
    const ok = await confirm({
      title: '링크 회수',
      message: `${emp.name} 님에게 발급한 비밀번호 설정 링크를 무효화할까요?`,
      confirmLabel: '회수',
      danger: true,
    });
    if (!ok) return;
    setBusyId(emp.id);
    try {
      await api.delete(`/api/employees/${emp.id}/access-link`);
      toast.success('발급된 링크를 회수했습니다.');
    } catch (err) {
      toast.error(apiMessage(err, '링크 회수에 실패했습니다.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleActivate(emp: Employee) {
    setBusyId(emp.id);
    try {
      const updated = await api.post<Employee>(`/api/employees/${emp.id}/activate`, {});
      replaceRow(updated);
      toast.success(`${emp.name} 님을 다시 활성화했습니다.`);
    } catch (err) {
      toast.error(apiMessage(err, '활성화에 실패했습니다.'));
    } finally {
      setBusyId(null);
    }
  }

  // RFC 4180: 쉼표/따옴표/줄바꿈 포함 값은 큰따옴표로 감싸고 내부 " 는 "" 로 이스케이프
  function csvField(value: string | number): string {
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // CSV export
  function exportCsv() {
    const headers = ['ID', '이름', '이메일', '팀', '직급', '역할', '근무형태', '출처', '상태'];
    const rows = filtered.map((e) => [
      e.id,
      e.name,
      e.email,
      teamLabel(e.erp_team_id),
      e.position ?? '',
      ROLE_LABELS[e.role] ?? e.role,
      e.work_type ?? '',
      e.source === 'native' ? '직접등록' : 'ERP',
      e.is_active ? '재직중' : '비활성',
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvField).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employees_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const subtitle = canManage
    ? `${erpLinked ? '🔗 ERP 연동 + 직접 관리' : '✍️ 직접 관리 모드'} — 관리자가 직원을 추가·편집할 수 있습니다${lastSynced ? ` · 갱신: ${lastSynced}` : ''}`
    : `사내 직원 명부${lastSynced ? ` · 갱신: ${lastSynced}` : ''}`;

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      {/* Page header */}
      <PageHeader
        title="직원명부"
        subtitle={subtitle}
        icon={ICON.users}
        actions={
          <>
            <ToolbarButton onClick={exportCsv} icon={ICON.download} title="현재 필터 결과를 CSV로 다운로드">
              CSV
            </ToolbarButton>
            <ToolbarButton onClick={fetchEmployees} disabled={loading} icon={ICON.refresh}>
              새로고침
            </ToolbarButton>
            {canManage && (
              <ToolbarButton onClick={() => { setForm(EMPTY_FORM); setFormError(''); setShowCreate(true); }} icon={ICON.plus} variant="primary">
                직원 추가
              </ToolbarButton>
            )}
          </>
        }
      />

      {/* Filter toolbar */}
      <div className={`flex items-center gap-3 ${CARD_SURFACE} p-3`}>
        {/* Team filter */}
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          aria-label="팀 필터"
          className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
        >
          <option value="">전체 팀</option>
          {teams.map((id) => (
            <option key={id} value={String(id)}>
              {teamLabel(id)}
            </option>
          ))}
        </select>

        {/* Status filter (presence) */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="상태 필터"
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
            aria-label="이름 또는 이메일 검색"
            className="w-full pl-9 pr-3 py-1.5 border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
          />
        </div>

        {/* 비활성 포함 (admin) */}
        {canManage && (
          <label className="flex items-center gap-1.5 text-sm text-text-secondary whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="accent-primary"
            />
            비활성 포함
          </label>
        )}

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
                title={employees.length === 0 ? '아직 등록된 직원이 없습니다' : '조회 결과가 없습니다'}
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
                  ) : canManage ? (
                    <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setFormError(''); setShowCreate(true); }}>
                      첫 직원 추가
                    </Button>
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
                      {['이름', '팀', '직급', '좌석', '상태', '이메일', '역할', '출처'].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wide whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                      {canManage && (
                        <th className="px-4 py-2.5 text-right text-[11px] font-medium text-text-muted uppercase tracking-wide whitespace-nowrap">
                          관리
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {paginated.map((emp) => (
                      <tr
                        key={emp.id}
                        onClick={() => setSelectedEmployee(emp)}
                        className={`cursor-pointer hover:bg-bg-surface-raised transition-colors ${
                          selectedEmployee?.id === emp.id ? 'bg-primary/10' : ''
                        } ${emp.is_active ? '' : 'opacity-55'}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-text-primary whitespace-nowrap">
                          {emp.name}
                          {!emp.is_active && (
                            <span className="ml-1.5 text-[10px] text-text-muted">(비활성)</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">
                          {teamLabel(emp.erp_team_id)}
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
                        <td className="px-4 py-2.5">
                          <SourceBadge source={emp.source} hasLogin={emp.has_login} />
                        </td>
                        {canManage && (
                          <td
                            className="px-4 py-2.5 text-right whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center gap-2">
                              <Select
                                value={emp.role}
                                disabled={busyId === emp.id || !emp.is_active}
                                onChange={(e) => handleRoleChange(emp, e.target.value)}
                                aria-label={`${emp.name} 역할`}
                                className="!w-auto !py-1 !px-2 text-xs"
                              >
                                <option value="employee">직원</option>
                                <option value="leader">리더</option>
                                <option value="admin">관리자</option>
                                {isSuperAdmin && <option value="super_admin">최고관리자</option>}
                              </Select>
                              {emp.is_active && (
                                <Button
                                  size="sm"
                                  variant={emp.has_login ? 'ghost' : 'secondary'}
                                  disabled={busyId === emp.id}
                                  onClick={() => handleIssueLink(emp)}
                                  title={
                                    emp.has_login
                                      ? '비밀번호 재설정 링크를 발급합니다'
                                      : '최초 비밀번호 설정(초대) 링크를 발급합니다'
                                  }
                                >
                                  {ICON.link}
                                  {emp.has_login ? '재설정' : '초대'}
                                </Button>
                              )}
                              {emp.is_active ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  loading={busyId === emp.id}
                                  onClick={() => handleDeactivate(emp)}
                                  className="!text-danger hover:!bg-danger/10"
                                >
                                  비활성
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={busyId === emp.id}
                                  onClick={() => handleActivate(emp)}
                                >
                                  활성화
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
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
                aria-label="상세 닫기"
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

              {selectedEmployee.source === 'erp' ? (
                <div className="text-xs text-status-external bg-[rgba(245,158,11,0.16)] rounded px-2 py-1">
                  🔗 ERP에서 관리됨 — 이름·팀·직급은 다음 동기화가 정본으로 덮어씁니다
                </div>
              ) : (
                <div className="text-xs text-accent-cyan bg-[rgba(56,189,248,0.12)] rounded px-2 py-1">
                  ✍️ 콘솔에서 직접 등록된 계정 — ERP 동기화의 영향을 받지 않습니다
                </div>
              )}
              {!selectedEmployee.has_login && (
                <div className="text-xs text-text-muted bg-bg-surface-raised rounded px-2 py-1">
                  🔑 비밀번호 미설정 — 아직 로그인할 수 없습니다
                </div>
              )}

              {/* Fields */}
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">팀</dt>
                  <dd className="text-text-primary font-medium">
                    {teamLabel(selectedEmployee.erp_team_id)}
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

      {/* 발급된 비밀번호 설정 링크 (E4) — 이 창을 닫으면 다시 볼 수 없다 */}
      <Modal
        open={accessLink !== null}
        onClose={() => setAccessLink(null)}
        title={accessLink?.purpose === 'invitation' ? '초대 링크 발급됨' : '비밀번호 재설정 링크 발급됨'}
        size="md"
        footer={
          <>
            {accessLink && (
              <Button
                variant="ghost"
                className="!text-danger hover:!bg-danger/10 mr-auto"
                onClick={async () => {
                  const emp = employees.find((e) => e.id === accessLink.employee_id);
                  if (emp) await handleRevokeLink(emp);
                  setAccessLink(null);
                }}
              >
                회수
              </Button>
            )}
            <Button variant="secondary" onClick={() => setAccessLink(null)}>
              닫기
            </Button>
            {accessLink && (
              <Button onClick={() => copyLink(accessLink.url)}>{copied ? '복사됨' : '링크 복사'}</Button>
            )}
          </>
        }
      >
        {accessLink && (
          <div className="flex flex-col gap-3.5">
            <p className="text-[13px] text-text-secondary leading-relaxed">
              <span className="text-text-primary font-medium">{accessLink.employee_name}</span> (
              {accessLink.employee_email}) 님에게 아래 링크를 전달하세요. 본인이 직접 비밀번호를
              설정하므로 <strong className="text-text-primary">관리자는 비밀번호를 알 수 없습니다.</strong>
            </p>

            <div className="rounded-lg border border-border-subtle bg-bg-base p-3">
              <code className="block text-[12px] text-accent-cyan break-all leading-relaxed select-all">
                {accessLink.url}
              </code>
            </div>

            <ul className="text-xs text-text-muted space-y-1 leading-relaxed">
              <li>
                • 만료:{' '}
                <span className="text-text-secondary">
                  {new Date(accessLink.expires_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                </span>{' '}
                ({accessLink.purpose === 'invitation' ? '7일' : '24시간'})
              </li>
              <li>• 한 번 사용하면 즉시 무효화됩니다.</li>
              <li>• 새로 발급하면 이 링크는 자동으로 무효가 됩니다.</li>
              <li className="text-status-external">
                • 이 창을 닫으면 링크를 다시 볼 수 없습니다 — 지금 복사해 두세요.
              </li>
            </ul>
          </div>
        )}
      </Modal>

      {/* 직원 추가 (E3) */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="직원 추가"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={creating}>
              취소
            </Button>
            <Button type="submit" form="create-employee-form" loading={creating}>
              추가
            </Button>
          </>
        }
      >
        <form id="create-employee-form" onSubmit={handleCreate} className="flex flex-col gap-3.5">
          <p className="text-xs text-text-muted leading-relaxed">
            ERP를 쓰지 않는 회사에서 팀을 직접 채우는 경로입니다. 여기서 만든 계정은 ERP 동기화의
            영향을 받지 않습니다.
          </p>

          <LabeledInput
            label="이메일"
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="name@company.com"
            autoComplete="off"
          />
          <LabeledInput
            label="이름"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="홍길동"
          />

          <div className="grid grid-cols-2 gap-3">
            <Label label="역할" htmlFor="new-role">
              <Select
                id="new-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="employee">직원</option>
                <option value="leader">리더</option>
                <option value="admin">관리자</option>
                {isSuperAdmin && <option value="super_admin">최고관리자</option>}
              </Select>
            </Label>
            <LabeledInput
              label="팀 ID"
              type="number"
              min={0}
              value={form.erp_team_id}
              onChange={(e) => setForm({ ...form, erp_team_id: e.target.value })}
              hint="0 = 미배정"
            />
          </div>

          <LabeledInput
            label="직급"
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
            placeholder="사원 / 팀장 등 (선택)"
          />
          <LabeledInput
            label="초기 비밀번호"
            type="password"
            value={form.initial_password}
            onChange={(e) => setForm({ ...form, initial_password: e.target.value })}
            placeholder="8자 이상 (선택)"
            autoComplete="new-password"
            hint="비워두면 초대 링크가 발급됩니다 — 본인이 직접 설정하므로 관리자가 비밀번호를 알지 않아도 됩니다(권장)."
          />

          {formError && (
            <p role="alert" className="text-[13px] text-danger">
              {formError}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}

/** ERP 동기화 / 직접 관리 구분 배지 (23 E12 — 어느 경로로 관리되는지 오해 방지). */
function SourceBadge({ source, hasLogin }: { source: string; hasLogin: boolean }) {
  if (source === 'native') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[rgba(56,189,248,0.15)] text-accent-cyan whitespace-nowrap">
        직접 등록
        {!hasLogin && <span className="text-text-muted" title="비밀번호 미설정">🔑</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-bg-surface-raised text-text-muted whitespace-nowrap">
      ERP
    </span>
  );
}
