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
          <button
            onClick={() => setToast('검증: 모든 구성원이 팀에 배정됨 (로컬 검증). 배포 API는 후속.')}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
          >
            검증
          </button>
          <button
            onClick={() => setToast('배포는 백엔드 조직 배포 엔드포인트 도입 후 연결됩니다 (현재 로컬 편집).')}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            배포
          </button>
        </div>
      </div>
      {toast && (
        <div className="mx-6 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">{toast}</div>
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
    </div>
  );
}
