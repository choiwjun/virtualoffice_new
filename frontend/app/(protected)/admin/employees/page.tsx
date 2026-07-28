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
import { useT } from '@/components/I18nProvider';
import { PRESENCE_BADGE_CLASS, PRESENCE_ORDER, presenceKey, roleKey } from '@/lib/i18n/vocab';

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

/** GET /api/org-groups — 팀 이름의 정본. erp_team_id가 있는 그룹만 팀이다.
 *
 * /api/teams가 아니라 조직도를 읽는 이유: /api/teams는 "사람이 한 명이라도 있는 팀"만
 * 돌려준다. 그러면 방금 만든 빈 팀에 **첫 사람을 넣을 수 없다** — 선택지에 없으니까.
 */
interface OrgGroupTeam {
  id: string;
  name: string;
  erp_team_id: number | null;
}

// 역할·프레즌스 문구는 여러 화면이 공유한다 → lib/i18n/vocab.ts 정본(화면마다 표를 두면
// 같은 값이 화면마다 다르게 번역된다).

const PAGE_SIZE = 15;

/** 팀 라벨 — 조직도에 이름을 이어 주면 그 이름, 아니면 번호 그대로.
 *
 * 번호를 그대로 보여 주는 게 임의의 이름을 지어내는 것보다 낫다. "팀 9"는 관리자가
 * 조직도에서 이어 주면 사라지지만, 화면이 지어낸 이름은 실제 조직과 어긋난 채로 남는다.
 * 0은 native 유저의 미할당 센티널이라 별도 표기한다.
 */
function teamNameMap(groups: OrgGroupTeam[]): Map<number, string> {
  return new Map(
    groups.filter((g) => g.erp_team_id !== null).map((g) => [g.erp_team_id as number, g.name]),
  );
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
  const { t } = useT();
  // 알 수 없는 값은 원본을 그대로 보여 준다 — 지어내지 않는다(vocab.ts 규약).
  const roleLabel = (r: string) => { const k = roleKey(r); return k ? t(k) : r; };
  const presenceLabel = (p: string | null) => { const k = presenceKey(p); return k ? t(k) : (p ?? ''); };
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
        setError(t('employees.loadFailed', { reason: err.message }));
      } else {
        setError(t('employees.err.network'));
      }
    } finally {
      setLoading(false);
    }
  }, [includeInactive, canManage]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  /** 팀 이름 카탈로그 — 실패해도 화면은 번호로 돌아간다(이름은 표기일 뿐 기능이 아니다). */
  const [orgTeams, setOrgTeams] = useState<OrgGroupTeam[]>([]);
  useEffect(() => {
    api
      .get<{ items: OrgGroupTeam[] }>('/api/org-groups')
      .then((d) => setOrgTeams(d.items))
      .catch(() => setOrgTeams([]));
  }, []);
  const teamNames = useMemo(() => teamNameMap(orgTeams), [orgTeams]);

  /** 팀 라벨 — 조직도에 이름을 이어 주면 그 이름, 아니면 번호 그대로.
   *
   * 번호를 그대로 보여 주는 게 임의의 이름을 지어내는 것보다 낫다. "팀 9"는 관리자가
   * 조직도에서 이어 주면 사라지지만, 화면이 지어낸 이름은 실제 조직과 어긋난 채로 남는다.
   * 0은 native 유저의 미할당 센티널이라 별도 표기한다.
   */
  const teamLabel = useCallback(
    (id: number) => (id === 0 ? t('employees.unassignedTeam') : teamNames.get(id) ?? t('employees.teamFallback', { id })),
    [teamNames],
  );

  /** 필터에 쓸 팀 번호 — 명부에 실제로 있는 팀만(빈 팀으로 거르면 결과가 항상 0건). */
  const teams = useMemo(() => {
    const ids = Array.from(new Set(employees.map((e) => e.erp_team_id))).sort((a, b) => a - b);
    return ids;
  }, [employees]);

  /** 배정 선택지 — 조직도에 이름이 있는 팀 + 명부에 남아 있는 미연결 번호.
   * 앞쪽만 쓰면 아직 이어 주지 않은 팀의 사람을 편집할 때 소속이 사라진 것처럼 보인다.
   */
  const assignableTeams = useMemo(() => {
    const ids = new Set<number>(teamNames.keys());
    employees.forEach((e) => { if (e.erp_team_id > 0) ids.add(e.erp_team_id); });
    return Array.from(ids).sort((a, b) => a - b);
  }, [teamNames, employees]);

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
      setFormError(t('employees.err.required'));
      return;
    }
    if (form.initial_password && form.initial_password.length < 8) {
      setFormError(t('employees.err.passwordShort'));
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
      toast.success(t('employees.created', { name: created.name }));

      // 비번을 안 정했다면 관리자의 다음 행동은 항상 "초대 링크 전달"이다 → 바로 발급해서 띄운다.
      if (!created.has_login) {
        try {
          const link = await api.post<AccessLink>(`/api/employees/${created.id}/access-link`, {});
          setAccessLink(link);
          setCopied(false);
        } catch (err) {
          toast.error(apiMessage(err, t('employees.err.inviteFailed')));
        }
      }
    } catch (err) {
      setFormError(apiMessage(err, t('employees.err.createFailed')));
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
      toast.success(t('employees.roleChanged', { name: emp.name, role: roleLabel(role) }));
    } catch (err) {
      toast.error(apiMessage(err, t('employees.err.roleFailed')));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeactivate(emp: Employee) {
    const ok = await confirm({
      title: t('employees.deactivate'),
      message: t('employees.confirmDeactivate', { name: emp.name }),
      confirmLabel: t('employees.statusInactive'),
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
      toast.success(t('employees.deactivated', { name: emp.name }));
    } catch (err) {
      toast.error(apiMessage(err, t('employees.err.deactivateFailed')));
    } finally {
      setBusyId(null);
    }
  }

  /** 비밀번호 설정 링크 발급 (E4). 서버가 has_login으로 초대/재설정을 판단한다. */
  async function handleIssueLink(emp: Employee) {
    if (emp.has_login) {
      const ok = await confirm({
        title: t('employees.link.issuedReset'),
        message: t('employees.confirmReset', { name: emp.name }),
        confirmLabel: t('employees.invite'),
      });
      if (!ok) return;
    }
    setBusyId(emp.id);
    try {
      const link = await api.post<AccessLink>(`/api/employees/${emp.id}/access-link`, {});
      setAccessLink(link);
      setCopied(false);
    } catch (err) {
      toast.error(apiMessage(err, t('employees.err.linkFailed')));
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('employees.link.copiedToast'));
    } catch {
      // clipboard 권한이 없거나 비보안 컨텍스트(http) — 사용자가 직접 선택해 복사하게 둔다.
      toast.error(t('employees.link.copyFailed'));
    }
  }

  async function handleRevokeLink(emp: Employee) {
    const ok = await confirm({
      title: t('employees.link.revoke'),
      message: t('employees.confirmRevoke', { name: emp.name }),
      confirmLabel: t('employees.link.revokeShort'),
      danger: true,
    });
    if (!ok) return;
    setBusyId(emp.id);
    try {
      await api.delete(`/api/employees/${emp.id}/access-link`);
      toast.success(t('employees.link.revoked'));
    } catch (err) {
      toast.error(apiMessage(err, t('employees.err.revokeFailed')));
    } finally {
      setBusyId(null);
    }
  }

  async function handleActivate(emp: Employee) {
    setBusyId(emp.id);
    try {
      const updated = await api.post<Employee>(`/api/employees/${emp.id}/activate`, {});
      replaceRow(updated);
      toast.success(t('employees.activated', { name: emp.name }));
    } catch (err) {
      toast.error(apiMessage(err, t('employees.err.activateFailed')));
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
    const headers = ['ID', t('employees.col.name'), t('employees.col.email'), t('employees.col.team'), t('employees.col.position'), t('employees.col.role'), t('employees.col.workType'), t('employees.col.source'), t('employees.col.status')];
    const rows = filtered.map((e) => [
      e.id,
      e.name,
      e.email,
      teamLabel(e.erp_team_id),
      e.position ?? '',
      roleLabel(e.role),
      e.work_type ?? '',
      e.source === 'native' ? t('employees.sourceNative') : 'ERP',
      e.is_active ? t('employees.statusActive') : t('employees.statusInactive'),
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
    ? `${erpLinked ? t('employees.modeErp') : t('employees.modeNative')} — ${t('employees.subtitleManaged')}${lastSynced ? ` · ${t('employees.updatedAt', { at: lastSynced })}` : ''}`
    : `${t('employees.subtitleReadonly')}${lastSynced ? ` · ${t('employees.updatedAt', { at: lastSynced })}` : ''}`;

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      {/* Page header */}
      <PageHeader
        title={t('employees.title')}
        subtitle={subtitle}
        icon={ICON.users}
        actions={
          <>
            <ToolbarButton onClick={exportCsv} icon={ICON.download} title={t('employees.csvHint')}>
              CSV
            </ToolbarButton>
            <ToolbarButton onClick={fetchEmployees} disabled={loading} icon={ICON.refresh}>{t('employees.refresh')}</ToolbarButton>
            {canManage && (
              <ToolbarButton onClick={() => { setForm(EMPTY_FORM); setFormError(''); setShowCreate(true); }} icon={ICON.plus} variant="primary">{t('employees.add')}</ToolbarButton>
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
          aria-label={t('employees.filterTeam')}
          className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
        >
          <option value="">{t('employees.allTeams')}</option>
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
          aria-label={t('employees.filterStatus')}
          className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
        >
          <option value="">{t('employees.allStatuses')}</option>
          {PRESENCE_ORDER.map((k) => (
            <option key={k} value={k}>{presenceLabel(k)}</option>
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
            placeholder={t('employees.searchPlaceholder')}
            aria-label={t('employees.searchAria')}
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
            />{t('employees.includeInactive')}</label>
        )}

        {/* Result count */}
        <span className="text-sm text-text-muted whitespace-nowrap">
          {t('employees.countSuffix', { count: filtered.length })}
        </span>

        {/* Reset */}
        {(teamFilter || searchQuery) && (
          <button
            onClick={() => {
              setTeamFilter('');
              setSearchQuery('');
            }}
            className="text-sm text-accent-cyan hover:underline whitespace-nowrap"
          >{t('employees.clearFilters')}</button>
        )}
      </div>

      {/* Error */}
      {error && <ErrorBanner message={error} onRetry={fetchEmployees} />}

      {/* Content area */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Table */}
        <SectionCard
          title={t('employees.listTitle')}
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
                title={employees.length === 0 ? t('employees.empty') : t('employees.noResults')}
                action={
                  (teamFilter || searchQuery) ? (
                    <button
                      onClick={() => {
                        setTeamFilter('');
                        setSearchQuery('');
                      }}
                      className="text-sm text-accent-cyan underline"
                    >{t('employees.clearFilters')}</button>
                  ) : canManage ? (
                    <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setFormError(''); setShowCreate(true); }}>{t('employees.add')}</Button>
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
                      {[t('employees.col.name'), t('employees.col.team'), t('employees.col.position'), t('employees.col.seat'), t('employees.col.status'), t('employees.col.email'), t('employees.col.role'), t('employees.col.source')].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wide whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                      {canManage && (
                        <th className="px-4 py-2.5 text-right text-[11px] font-medium text-text-muted uppercase tracking-wide whitespace-nowrap">{t('employees.col.manage')}</th>
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
                            <span className="ml-1.5 text-[10px] text-text-muted">{t('employees.inactiveSuffix')}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">
                          {teamLabel(emp.erp_team_id)}
                        </td>
                        <td className="px-4 py-2.5 text-text-secondary">{emp.position ?? '—'}</td>
                        <td className="px-4 py-2.5 text-text-secondary text-xs">{emp.seat_number ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          {emp.presence_status ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PRESENCE_BADGE_CLASS[emp.presence_status] ?? 'bg-bg-surface-raised text-text-muted'}`}>
                              {presenceLabel(emp.presence_status)}
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">{presenceLabel('offline')}</span>
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
                            {roleLabel(emp.role)}
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
                                aria-label={`${emp.name} ${t('employees.col.role')}`}
                                className="!w-auto !py-1 !px-2 text-xs"
                              >
                                <option value="employee">{roleLabel('employee')}</option>
                                <option value="leader">{roleLabel('leader')}</option>
                                <option value="admin">{roleLabel('admin')}</option>
                                {isSuperAdmin && <option value="super_admin">{roleLabel('super_admin')}</option>}
                              </Select>
                              {emp.is_active && (
                                <Button
                                  size="sm"
                                  variant={emp.has_login ? 'ghost' : 'secondary'}
                                  disabled={busyId === emp.id}
                                  onClick={() => handleIssueLink(emp)}
                                  title={
                                    emp.has_login
                                      ? t('employees.resetHint')
                                      : t('employees.inviteHint')
                                  }
                                >
                                  {ICON.link}
                                  {emp.has_login ? t('employees.reset') : t('employees.invite')}
                                </Button>
                              )}
                              {emp.is_active ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  loading={busyId === emp.id}
                                  onClick={() => handleDeactivate(emp)}
                                  className="!text-danger hover:!bg-danger/10"
                                >{t('employees.statusInactive')}</Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={busyId === emp.id}
                                  onClick={() => handleActivate(emp)}
                                >{t('employees.activate')}</Button>
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
                    {Math.min(currentPage * PAGE_SIZE, filtered.length)} / {t('employees.countSuffix', { count: filtered.length })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-2 py-1 text-xs border border-border-subtle rounded disabled:opacity-40 hover:bg-bg-surface-raised"
                    >{t('common.prev')}</button>
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
                    >{t('common.next')}</button>
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
              <h2 className="font-semibold text-text-primary text-sm">{t('employees.detailTitle')}</h2>
              <button
                onClick={() => setSelectedEmployee(null)}
                aria-label={t('employees.closeDetail')}
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
                <div className="text-xs text-status-external bg-[rgba(245,158,11,0.16)] rounded px-2 py-1">{t('employees.hint.erpManaged')}</div>
              ) : (
                <div className="text-xs text-accent-cyan bg-[rgba(56,189,248,0.12)] rounded px-2 py-1">{t('employees.hint.native')}</div>
              )}
              {!selectedEmployee.has_login && (
                <div className="text-xs text-text-muted bg-bg-surface-raised rounded px-2 py-1">{t('employees.hint.noPassword')}</div>
              )}

              {/* Fields */}
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t('employees.col.team')}</dt>
                  <dd className="text-text-primary font-medium">
                    {teamLabel(selectedEmployee.erp_team_id)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t('employees.col.position')}</dt>
                  <dd className="text-text-primary font-medium">
                    {selectedEmployee.position ?? '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t('employees.col.role')}</dt>
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
                      {roleLabel(selectedEmployee.role)}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t('employees.col.workType')}</dt>
                  <dd className="text-text-primary">{selectedEmployee.work_type ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t('employees.col.status')}</dt>
                  <dd>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        selectedEmployee.is_active
                          ? 'bg-[rgba(34,197,94,0.16)] text-status-online'
                          : 'bg-[rgba(239,68,68,0.12)] text-red-300'
                      }`}
                    >
                      {selectedEmployee.is_active ? t('employees.statusActive') : t('employees.statusInactive')}
                    </span>
                  </dd>
                </div>
                {selectedEmployee.manager_id && (
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t('employees.col.managerId')}</dt>
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
        title={accessLink?.purpose === 'invitation' ? t('employees.link.issuedInvite') : t('employees.link.issuedReset')}
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
              <Button onClick={() => copyLink(accessLink.url)}>{copied ? t('employees.link.copied') : t('employees.link.copy')}</Button>
            )}
          </>
        }
      >
        {accessLink && (
          <div className="flex flex-col gap-3.5">
            <p className="text-[13px] text-text-secondary leading-relaxed">
              <span className="text-text-primary font-medium">{accessLink.employee_name}</span> (
              {accessLink.employee_email}) 님에게 아래 링크를 전달하세요. 본인이 직접 비밀번호를
              설정하므로 <strong className="text-text-primary">{t('employees.link.adminCannotSeePassword')}</strong>
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
                ({accessLink.purpose === 'invitation' ? t('employees.link.expiry7d') : t('employees.link.expiry24h')})
              </li>
              <li>{t('employees.link.onceOnly')}</li>
              <li>{t('employees.link.reissueInvalidates')}</li>
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
        title={t('employees.add')}
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
            label={t('employees.col.email')}
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="name@company.com"
            autoComplete="off"
          />
          <LabeledInput
            label={t('employees.col.name')}
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('employees.form.namePlaceholder')}
          />

          <div className="grid grid-cols-2 gap-3">
            <Label label={t('employees.col.role')} htmlFor="new-role">
              <Select
                id="new-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="employee">{roleLabel('employee')}</option>
                <option value="leader">{roleLabel('leader')}</option>
                <option value="admin">{roleLabel('admin')}</option>
                {isSuperAdmin && <option value="super_admin">{roleLabel('super_admin')}</option>}
              </Select>
            </Label>
            <Label
              label={t('employees.col.team')}
              htmlFor="new-team"
              hint={
                teamNames.size === 0
                  ? t('employees.form.teamHint')
                  : undefined
              }
            >
              <Select
                id="new-team"
                value={form.erp_team_id}
                onChange={(e) => setForm({ ...form, erp_team_id: e.target.value })}
              >
                <option value="0">미배정</option>
                {assignableTeams.map((id) => (
                  <option key={id} value={String(id)}>
                    {teamLabel(id)}
                  </option>
                ))}
              </Select>
            </Label>
          </div>

          <LabeledInput
            label={t('employees.col.position')}
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
            placeholder={t('employees.form.positionPlaceholder')}
          />
          <LabeledInput
            label={t('employees.form.initialPassword')}
            type="password"
            value={form.initial_password}
            onChange={(e) => setForm({ ...form, initial_password: e.target.value })}
            placeholder={t('employees.form.passwordPlaceholder')}
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
