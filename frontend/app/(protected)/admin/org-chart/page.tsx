'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import type { OrgEmployee } from '@/components/org/OrgChartFlow';

const OrgChartFlow = dynamic(() => import('@/components/org/OrgChartFlow'), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-gray-400 text-sm">그래프 로딩...</div>,
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
      <div className="p-6">
        <div className="max-w-md mx-auto mt-20 text-center bg-white border border-gray-200 rounded-xl p-8">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-gray-700 font-medium">관리자 전용 화면</p>
          <p className="text-sm text-gray-400 mt-1">조직도 편집은 관리자만 접근할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-gray-200 bg-white flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-800">조직도 편집기</h1>
          <p className="text-xs text-gray-400">
            회사 → 팀(erp_team_id) → 구성원 계층 · 노드 드래그 가능 · 조직 그룹 {orgGroups.length}개
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm border border-indigo-300 text-indigo-600 rounded-md hover:bg-indigo-50">+ 조직 그룹</button>
          <button onClick={validateOrg} disabled={busy === 'validate'} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {busy === 'validate' ? '검증 중...' : '검증'}
          </button>
          <button onClick={deployOrg} disabled={busy === 'deploy'} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">
            {busy === 'deploy' ? '배포 중...' : '배포'}
          </button>
        </div>
      </div>
      {toast && (
        <div className="mx-6 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">{toast}</div>
      )}
      {banner && (
        <div className={`mx-6 mt-3 px-3 py-2 rounded-md text-xs border ${banner.valid ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {banner.valid ? '✅ 검증 통과 — 순환참조·미매핑 오류 없음 (배포 가능)' : (
            <div>
              <div className="font-semibold mb-1">❌ 검증 실패 ({banner.errors.length}건)</div>
              <ul className="list-disc pl-4">{banner.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 flex gap-0">
        {/* 조직 그룹 계층 패널 (GET /api/org-groups) */}
        <aside className="w-56 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto p-3">
          <div className="text-xs font-semibold text-gray-500 mb-2">조직 그룹 (org_group)</div>
          {orgGroups.length === 0 ? (
            <p className="text-xs text-gray-400">등록된 조직 그룹이 없습니다. (팀 계층은 우측 그래프)</p>
          ) : (
            <ul className="space-y-1">
              {orgGroups.map((g) => (
                <li key={g.id} className="text-sm text-gray-700 flex items-center gap-1" style={{ paddingLeft: depthOf(g) * 12 }}>
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: g.color || '#c7d2fe' }} />
                  <span>{g.name}</span>
                  <span className="text-[10px] text-gray-400">{TYPE_LABEL[g.type] ?? g.type}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className="flex-1 min-h-0 m-4 border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
          {loading ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">불러오는 중...</div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-red-600 text-sm">{error}</div>
          ) : employees.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">조직 데이터가 없습니다.</div>
          ) : (
            <OrgChartFlow employees={employees} />
          )}
        </div>
      </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">조직 그룹 생성</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이름 (필수)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="division">본부</option>
                <option value="department">부서</option>
                <option value="part">파트</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">색상</label>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-full h-9 border border-gray-300 rounded-md" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">상위 그룹</label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">(최상위)</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">취소</button>
            <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">{saving ? '생성 중...' : '생성'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
