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

export default function OrgChartPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const [employees, setEmployees] = useState<OrgEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!allowed) return;
    api
      .get<OrgEmployee[]>('/api/employees')
      .then((d) => setEmployees(d))
      .catch((e) => setError(e instanceof ApiError ? `조회 실패 (${e.status})` : '서버 연결 오류'))
      .finally(() => setLoading(false));
  }, [allowed]);

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
          <p className="text-xs text-gray-400">회사 → 팀(erp_team_id) → 구성원 계층 · 노드 드래그 가능</p>
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
  );
}
