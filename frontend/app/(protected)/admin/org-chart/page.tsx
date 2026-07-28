'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { useBranding } from '@/components/BrandingProvider';
import type { OrgEmployee } from '@/components/org/OrgChartFlow';
import {
  PageHeader,
  ToolbarButton,
  SectionCard,
  EmptyState,
  ErrorBanner,
  LoadingState,
} from '@/components/ui/console';

const ICON = {
  tree: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="7.5" y="2.5" width="5" height="4" rx="1" /><rect x="2.5" y="13.5" width="5" height="4" rx="1" /><rect x="12.5" y="13.5" width="5" height="4" rx="1" /><path d="M10 6.5v3M10 9.5H5v4M10 9.5h5v4" /></svg>,
  plus: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M10 4v12M4 10h12" /></svg>,
  check: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><circle cx="10" cy="10" r="7" /><path d="M6.8 10.2l2.2 2.2 4.2-4.6" /></svg>,
  rocket: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M10 2c3 1.5 4.5 4 4.5 7l-2 4h-5l-2-4C5.5 6 7 3.5 10 2z" /><circle cx="10" cy="8" r="1.5" /><path d="M7.5 15l-2 3M12.5 15l2 3" /></svg>,
  layers: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M10 3 3 6.5 10 10l7-3.5z" /><path d="M3 10.5 10 14l7-3.5M3 13.5 10 17l7-3.5" /></svg>,
  lock: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="4" y="9" width="12" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>,
};

const OrgChartFlow = dynamic(() => import('@/components/org/OrgChartFlow'), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-text-muted text-sm">그래프 로딩...</div>,
});

interface OrgGroup {
  id: string;
  name: string;
  type: string;
  parent_id: string | null;
  color: string | null;
  sort_order: number | null;
  /** 이 그룹이 대표하는 ERP 팀. null = 팀이 아닌 계층(본부·파트 등). */
  erp_team_id: number | null;
}

const TYPE_LABEL: Record<string, string> = { division: '본부', department: '부서', part: '파트' };

/** 연결 해제 센티널 — null은 "이 필드 안 건드림"이라 해제를 표현할 수 없다(백엔드 규약). */
const UNLINK = -1;

export default function OrgChartPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const { branding } = useBranding();
  const [employees, setEmployees] = useState<OrgEmployee[]>([]);
  const [orgGroups, setOrgGroups] = useState<OrgGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [banner, setBanner] = useState<{ valid: boolean; errors: { code: string; message: string }[]; warnings: unknown[] } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<OrgGroup | null>(null);
  const [busy, setBusy] = useState('');

  const reload = () => {
    api.get<{ items: OrgGroup[]; total: number }>('/api/org-groups').then((d) => setOrgGroups(d.items)).catch(() => {});
  };

  /** 팀 번호 → 이름. 그래프가 "팀 1" 대신 조직도의 이름을 쓰게 하는 유일한 통로다. */
  const teamNames = useMemo(
    () => new Map(orgGroups.filter((g) => g.erp_team_id !== null).map((g) => [g.erp_team_id as number, g.name])),
    [orgGroups],
  );

  /** 명부에는 있는데 아직 이름을 이어 주지 않은 팀 — 배포 전에 관리자가 알아야 한다. */
  const unmappedTeams = useMemo(() => {
    const ids = new Set<number>();
    employees.forEach((e) => { if (e.erp_team_id > 0 && !teamNames.has(e.erp_team_id)) ids.add(e.erp_team_id); });
    return Array.from(ids).sort((a, b) => a - b);
  }, [employees, teamNames]);

  async function validateOrg() {
    setBusy('validate');
    setBanner(null);
    try {
      const res = await api.post<{ valid: boolean; errors: { code: string; message: string }[]; warnings: unknown[] }>('/api/org-groups/validate', {});
      setBanner(res);
    } catch (e) {
      setToast(e instanceof ApiError ? `검증 실패 (${e.status})` : '오류');
    } finally {
      setBusy('');
    }
  }

  async function deployOrg() {
    setBusy('deploy');
    try {
      await api.post('/api/org-groups/deploy', {});
      setToast('배포 완료 (검증 통과)');
      setBanner({ valid: true, errors: [], warnings: [] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setToast('검증 실패로 배포 차단 — 오류를 먼저 해결하세요');
        validateOrg();
      } else {
        setToast(e instanceof ApiError ? `배포 실패 (${e.status})` : '오류');
      }
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    if (!allowed) return;
    Promise.all([
      api.get<OrgEmployee[]>('/api/employees'),
      api.get<{ items: OrgGroup[]; total: number }>('/api/org-groups').then((d) => d.items).catch(() => [] as OrgGroup[]),
    ])
      .then(([emps, groups]) => {
        setEmployees(emps);
        setOrgGroups(groups);
      })
      .catch((e) => setError(e instanceof ApiError ? `조회 실패 (${e.status})` : '서버 연결 오류'))
      .finally(() => setLoading(false));
  }, [allowed]);

  // depth(들여쓰기) 계산: parent_id 체인
  const depthOf = (g: OrgGroup): number => {
    let d = 0;
    let cur: OrgGroup | undefined = g;
    const byId = new Map(orgGroups.map((x) => [x.id, x]));
    while (cur?.parent_id) {
      cur = byId.get(cur.parent_id);
      d += 1;
      if (d > 8) break;
    }
    return d;
  };

  if (!allowed) {
    return (
      <div className="p-6 text-text-secondary">
        <div className="max-w-md mx-auto mt-20">
          <SectionCard>
            <EmptyState icon={ICON.lock} title="관리자 전용 화면" hint="조직도 편집은 관리자만 접근할 수 있습니다." />
          </SectionCard>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title="조직도 편집기"
        subtitle={`회사 → 팀(erp_team_id) → 구성원 계층 · 노드 드래그 가능 · 조직 그룹 ${orgGroups.length}개`}
        icon={ICON.tree}
        actions={
          <>
            <ToolbarButton onClick={() => setShowCreate(true)} icon={ICON.plus}>조직 그룹</ToolbarButton>
            <ToolbarButton onClick={validateOrg} disabled={busy === 'validate'} icon={ICON.check}>
              {busy === 'validate' ? '검증 중...' : '검증'}
            </ToolbarButton>
            <ToolbarButton onClick={deployOrg} disabled={busy === 'deploy'} variant="primary" icon={ICON.rocket}>
              {busy === 'deploy' ? '배포 중...' : '배포'}
            </ToolbarButton>
          </>
        }
      />

      {toast && (
        <div className="px-3 py-2 bg-[rgba(245,158,11,0.16)] border border-[rgba(245,158,11,0.4)] rounded-xl text-xs text-status-external">{toast}</div>
      )}
      {banner && (
        <div className={`px-3 py-2 rounded-xl text-xs border ${banner.valid ? 'bg-[rgba(34,197,94,0.16)] border-[rgba(34,197,94,0.4)] text-status-online' : 'bg-[rgba(239,68,68,0.12)] border-[rgba(239,68,68,0.3)] text-red-300'}`}>
          {banner.valid ? '✅ 검증 통과 — 순환참조·미매핑 오류 없음 (배포 가능)' : (
            <div>
              <div className="font-semibold mb-1">❌ 검증 실패 ({banner.errors.length}건)</div>
              <ul className="list-disc pl-4">{banner.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <SectionCard title="조직 구조" icon={ICON.layers} className="flex-1 min-h-0" bodyClassName="flex-1 min-h-0 flex gap-0 p-0">
        {/* 조직 그룹 계층 패널 (GET /api/org-groups) */}
        <aside className="w-64 flex-shrink-0 border-r border-border-subtle overflow-y-auto p-3">
          <div className="text-xs font-semibold text-text-muted mb-1">조직 그룹</div>
          <p className="text-[11px] text-text-muted leading-snug mb-2">
            그룹을 누르면 이름·상위·팀 연결을 고칩니다. <strong className="text-text-secondary">팀을 연결한 그룹의 이름이 곧 팀 이름</strong>이 되어 직원명부·그래프에 함께 쓰입니다.
          </p>
          {orgGroups.length === 0 ? (
            <p className="text-xs text-text-muted">등록된 조직 그룹이 없습니다. (팀 계층은 우측 그래프)</p>
          ) : (
            <ul className="space-y-0.5">
              {orgGroups.map((g) => (
                <li key={g.id} style={{ paddingLeft: depthOf(g) * 12 }}>
                  <button
                    onClick={() => setEditing(g)}
                    className="w-full text-left text-sm text-text-secondary flex items-center gap-1 rounded px-1 py-0.5 hover:bg-bg-surface-raised"
                  >
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: g.color || '#c7d2fe' }} />
                    <span className="truncate">{g.name}</span>
                    <span className="text-[10px] text-text-muted flex-shrink-0">{TYPE_LABEL[g.type] ?? g.type}</span>
                    {g.erp_team_id !== null && (
                      <span className="ml-auto text-[10px] text-accent-cyan flex-shrink-0">팀 {g.erp_team_id}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {unmappedTeams.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border-subtle">
              <div className="text-[11px] font-semibold text-status-external mb-1">이름 없는 팀 {unmappedTeams.length}개</div>
              <p className="text-[11px] text-text-muted leading-snug">
                {unmappedTeams.map((id) => `팀 ${id}`).join(' · ')} — 사람은 있는데 연결된 그룹이 없어 화면에 번호로 나옵니다.
              </p>
            </div>
          )}
        </aside>
        <div className="flex-1 min-h-0 m-4 border border-border-subtle rounded-xl overflow-hidden bg-bg-base">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <div className="h-full flex items-center justify-center p-6">
              <ErrorBanner message={error} />
            </div>
          ) : employees.length === 0 ? (
            <EmptyState icon={ICON.tree} title="조직 데이터가 없습니다." />
          ) : (
            <OrgChartFlow employees={employees} groups={orgGroups} companyName={branding?.brand_name || '회사'} />
          )}
        </div>
      </SectionCard>

      {showCreate && (
        <OrgGroupModal
          groups={orgGroups}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); reload(); setToast('조직 그룹이 생성되었습니다.'); }}
        />
      )}
      {editing && (
        <OrgGroupModal
          groups={orgGroups}
          group={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); setToast('조직 그룹이 수정되었습니다.'); }}
        />
      )}
    </div>
  );
}

function OrgGroupModal({ groups, group, onClose, onSaved }: { groups: OrgGroup[]; group?: OrgGroup; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!group;
  const [name, setName] = useState(group?.name ?? '');
  const [type, setType] = useState(group?.type ?? 'department');
  const [parentId, setParentId] = useState(group?.parent_id ?? '');
  const [color, setColor] = useState(group?.color ?? '#6366f1');
  /** 빈 문자열 = 팀 아님. 숫자면 그 팀의 이름을 이 그룹이 맡는다. */
  const [teamId, setTeamId] = useState(group?.erp_team_id != null ? String(group.erp_team_id) : '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  /** 자기 자신과 자손은 부모가 될 수 없다 — 고르게 두면 순환참조를 만들고 검증에서만 걸린다. */
  const parentOptions = groups.filter((g) => {
    if (!group) return true;
    if (g.id === group.id) return false;
    let cur: OrgGroup | undefined = g;
    const byId = new Map(groups.map((x) => [x.id, x]));
    for (let i = 0; cur?.parent_id && i < 8; i += 1) {
      if (cur.parent_id === group.id) return false;
      cur = byId.get(cur.parent_id);
    }
    return true;
  });

  async function save() {
    if (!name.trim()) { setErr('이름은 필수입니다.'); return; }
    const parsedTeam = teamId.trim() === '' ? null : Number(teamId);
    if (parsedTeam !== null && (!Number.isInteger(parsedTeam) || parsedTeam < 1)) {
      setErr('팀 번호는 1 이상의 정수입니다. (비우면 팀 아님)');
      return;
    }
    setSaving(true);
    setErr('');
    // 수정에서 비우면 "해제"라 센티널을 보낸다. 생성에서는 그냥 안 보낸다.
    const teamField = parsedTeam ?? (isEdit ? UNLINK : null);
    try {
      const body = { name: name.trim(), type, parent_id: parentId || null, color, erp_team_id: teamField };
      if (isEdit) await api.put(`/api/org-groups/${group!.id}`, body);
      else await api.post('/api/org-groups', body);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'team_already_mapped') {
        setErr(`팀 ${parsedTeam}은(는) 이미 "${e.detail?.group_name}"이 맡고 있습니다. 그쪽 연결을 먼저 푸세요.`);
      } else if (e instanceof ApiError && e.status === 409) {
        setErr('저장 실패 — 하위 그룹이 있거나 이미 사용 중인 값입니다.');
      } else {
        setErr(e instanceof ApiError ? `저장 실패 (${e.status})` : '서버 오류');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="rounded-2xl shadow-2xl w-full max-w-md border border-border-subtle" style={{ background: 'rgb(var(--color-bg-surface))' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="font-semibold text-text-primary">{isEdit ? '조직 그룹 수정' : '조직 그룹 생성'}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">이름 (필수)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">유형</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan">
                <option value="division">본부</option>
                <option value="department">부서</option>
                <option value="part">파트</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">색상</label>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-full h-9 border border-border-subtle bg-bg-base rounded-md" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">상위 그룹</label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan">
              <option value="">(최상위)</option>
              {parentOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">담당 팀 번호</label>
            <input
              type="number"
              min={1}
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              placeholder="비우면 팀 아님"
              className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
            />
            <p className="text-[11px] text-text-muted mt-1 leading-snug">
              직원의 팀 번호(<code>erp_team_id</code>)와 이어 주면 <strong className="text-text-secondary">이 그룹 이름이 그 팀의 이름</strong>이 됩니다.
              본부·파트처럼 사람이 직접 속하지 않는 계층은 비워 둡니다. 한 팀은 한 그룹만 맡습니다.
            </p>
          </div>
          {err && <p className="text-sm text-red-300">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-border-subtle rounded-md text-text-secondary hover:bg-bg-surface-raised">취소</button>
            <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50">{saving ? '저장 중...' : isEdit ? '저장' : '생성'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
