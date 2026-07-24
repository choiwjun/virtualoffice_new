'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
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
}

const TYPE_LABEL: Record<string, string> = { division: '본부', department: '부서', part: '파트' };

export default function OrgChartPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const [employees, setEmployees] = useState<OrgEmployee[]>([]);
  const [orgGroups, setOrgGroups] = useState<OrgGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [banner, setBanner] = useState<{ valid: boolean; errors: { code: string; message: string }[]; warnings: unknown[] } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState('');

  const reload = () => {
    api.get<{ items: OrgGroup[]; total: number }>('/api/org-groups').then((d) => setOrgGroups(d.items)).catch(() => {});
  };

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
        <aside className="w-56 flex-shrink-0 border-r border-border-subtle overflow-y-auto p-3">
          <div className="text-xs font-semibold text-text-muted mb-2">조직 그룹 (org_group)</div>
          {orgGroups.length === 0 ? (
            <p className="text-xs text-text-muted">등록된 조직 그룹이 없습니다. (팀 계층은 우측 그래프)</p>
          ) : (
            <ul className="space-y-1">
              {orgGroups.map((g) => (
                <li key={g.id} className="text-sm text-text-secondary flex items-center gap-1" style={{ paddingLeft: depthOf(g) * 12 }}>
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: g.color || '#c7d2fe' }} />
                  <span>{g.name}</span>
                  <span className="text-[10px] text-text-muted">{TYPE_LABEL[g.type] ?? g.type}</span>
                </li>
              ))}
            </ul>
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
            <OrgChartFlow employees={employees} />
          )}
        </div>
      </SectionCard>

      {showCreate && (
        <CreateOrgGroupModal
          groups={orgGroups}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); reload(); setToast('조직 그룹이 생성되었습니다.'); }}
        />
      )}
    </div>
  );
}

function CreateOrgGroupModal({ groups, onClose, onCreated }: { groups: { id: string; name: string }[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('department');
  const [parentId, setParentId] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!name.trim()) { setErr('이름은 필수입니다.'); return; }
    setSaving(true);
    setErr('');
    try {
      await api.post('/api/org-groups', { name: name.trim(), type, parent_id: parentId || null, color });
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? `생성 실패 (${e.status})` : '서버 오류');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="rounded-2xl shadow-2xl w-full max-w-md border border-border-subtle" style={{ background: '#161F32' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="font-semibold text-text-primary">조직 그룹 생성</h2>
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
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          {err && <p className="text-sm text-red-300">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-border-subtle rounded-md text-text-secondary hover:bg-bg-surface-raised">취소</button>
            <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50">{saving ? '생성 중...' : '생성'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
