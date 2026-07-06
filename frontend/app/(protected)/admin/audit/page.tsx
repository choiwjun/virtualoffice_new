'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';

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
  kpi_finalized: 'bg-green-100 text-green-700',
  kpi_adjusted: 'bg-blue-100 text-blue-700',
  kpi_objection_submitted: 'bg-amber-100 text-amber-700',
  seat_assigned: 'bg-indigo-100 text-indigo-700',
  seat_unassigned: 'bg-gray-100 text-gray-600',
  meeting_created: 'bg-purple-100 text-purple-700',
  office_layout_deployed: 'bg-teal-100 text-teal-700',
};

const PAGE = 30;

export default function AuditLogPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [offset, setOffset] = useState(0);

  const fetchLogs = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (action) qs.set('action', action);
      if (entityType) qs.set('entity_type', entityType);
      const data = await api.get<AuditListResponse>(`/api/audit-logs?${qs.toString()}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? `조회 실패 (${err.status})` : '서버 연결 오류');
    } finally {
      setLoading(false);
    }
  }, [allowed, action, entityType, offset]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto mt-20 text-center bg-white border border-gray-200 rounded-xl p-8">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-gray-700 font-medium">관리자 전용 화면</p>
          <p className="text-sm text-gray-400 mt-1">감사 로그는 관리자만 접근할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const curPage = Math.floor(offset / PAGE) + 1;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-1">감사 로그</h1>
      <p className="text-xs text-gray-400 mb-4">중요 엔티티 변경 이력 (좌석·회의·KPI·레이아웃) · D20-e 5년 보존</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={action} onChange={(e) => { setOffset(0); setAction(e.target.value); }} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">전체 액션</option>
          <option value="kpi_finalized">KPI 확정</option>
          <option value="kpi_adjusted">KPI 조정</option>
          <option value="kpi_objection_submitted">이의신청 접수</option>
          <option value="seat_assigned">좌석 배정</option>
          <option value="meeting_created">회의 생성</option>
          <option value="office_layout_deployed">레이아웃 배포</option>
        </select>
        <select value={entityType} onChange={(e) => { setOffset(0); setEntityType(e.target.value); }} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">전체 엔티티</option>
          <option value="kpi_result">kpi_result</option>
          <option value="seat">seat</option>
          <option value="meeting">meeting</option>
          <option value="office_layout">office_layout</option>
        </select>
        <button onClick={fetchLogs} disabled={loading} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50">새로고침</button>
        <span className="text-xs text-gray-400 ml-auto">총 {total}건</span>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
      ) : error ? (
        <div className="text-center py-16"><p className="text-red-600 text-sm mb-2">{error}</p><button onClick={fetchLogs} className="text-xs text-indigo-600 underline">재시도</button></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">감사 로그가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">시각 (KST)</th>
                <th className="text-left px-4 py-2.5 font-medium">액션</th>
                <th className="text-left px-4 py-2.5 font-medium">엔티티</th>
                <th className="text-left px-4 py-2.5 font-medium">대상 ID</th>
                <th className="text-left px-4 py-2.5 font-medium">행위자</th>
                <th className="text-left px-4 py-2.5 font-medium">변경</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatKst(log.created_at)}</td>
                  <td className="px-4 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${ACTION_COLOR[log.action] ?? 'bg-gray-100 text-gray-600'}`}>{log.action}</span></td>
                  <td className="px-4 py-2 text-gray-600">{log.entity_type}</td>
                  <td className="px-4 py-2 text-gray-400 font-mono text-xs">{log.entity_id.slice(0, 12)}</td>
                  <td className="px-4 py-2 text-gray-600">{log.user_id ?? '시스템'}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs truncate max-w-xs">{log.new_value ? JSON.stringify(log.new_value) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4 text-sm">
          <button onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={curPage <= 1} className="px-2 py-1 border border-gray-300 rounded disabled:opacity-40">이전</button>
          <span className="text-gray-500">{curPage} / {totalPages}</span>
          <button onClick={() => setOffset(offset + PAGE)} disabled={curPage >= totalPages} className="px-2 py-1 border border-gray-300 rounded disabled:opacity-40">다음</button>
        </div>
      )}
    </div>
  );
}
