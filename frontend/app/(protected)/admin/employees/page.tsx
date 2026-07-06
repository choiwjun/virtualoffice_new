'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';

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

const PAGE_SIZE = 15;

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Filters
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
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
    return list;
  }, [employees, teamFilter, searchQuery]);

  // Paginated
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [teamFilter, searchQuery]);

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
    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employees_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 h-full flex flex-col gap-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">직원명부</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            🔒 ERP 동기화 데이터 — 읽기 전용
            {lastSynced && <span className="ml-2">마지막 갱신: {lastSynced}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 text-gray-600 transition-colors"
          >
            📥 CSV
          </button>
          <button
            onClick={fetchEmployees}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 p-3">
        {/* Team filter */}
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">전체 팀</option>
          {teams.map((id) => (
            <option key={id} value={String(id)}>
              {TEAM_LABELS[id] ?? `팀 ${id}`}
            </option>
          ))}
        </select>

        {/* Search */}
        <div className="flex-1 relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            🔍
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="이름 또는 이메일 검색..."
            className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Result count */}
        <span className="text-sm text-gray-500 whitespace-nowrap">
          {filtered.length}명
        </span>

        {/* Reset */}
        {(teamFilter || searchQuery) && (
          <button
            onClick={() => {
              setTeamFilter('');
              setSearchQuery('');
            }}
            className="text-sm text-indigo-600 hover:underline whitespace-nowrap"
          >
            필터 초기화
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={fetchEmployees}
              className="text-xs text-red-600 underline"
            >
              재시도
            </button>
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Table */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-lg border border-gray-200">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              <span>데이터를 불러오는 중...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
              <span className="text-4xl">📭</span>
              <p className="text-sm">조회 결과가 없습니다.</p>
              {(teamFilter || searchQuery) && (
                <button
                  onClick={() => {
                    setTeamFilter('');
                    setSearchQuery('');
                  }}
                  className="text-sm text-indigo-600 underline"
                >
                  필터 초기화
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">
                        이름
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">
                        팀
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/6">
                        직급
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">
                        이메일
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/6">
                        역할
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/6">
                        근무형태
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginated.map((emp) => (
                      <tr
                        key={emp.id}
                        onClick={() => setSelectedEmployee(emp)}
                        className={`cursor-pointer hover:bg-indigo-50 transition-colors ${
                          selectedEmployee?.id === emp.id ? 'bg-indigo-50' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-gray-800">{emp.name}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {TEAM_LABELS[emp.erp_team_id] ?? `팀 ${emp.erp_team_id}`}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{emp.position ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{emp.email}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              emp.role === 'admin' || emp.role === 'super_admin'
                                ? 'bg-purple-100 text-purple-700'
                                : emp.role === 'leader'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {ROLE_LABELS[emp.role] ?? emp.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {emp.work_type ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex-shrink-0 px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    {(currentPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(currentPage * PAGE_SIZE, filtered.length)} / {filtered.length}명
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50"
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
                              ? 'bg-indigo-600 text-white'
                              : 'border border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {pg}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50"
                    >
                      다음
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail panel */}
        {selectedEmployee && (
          <div className="w-72 flex-shrink-0 bg-white rounded-lg border border-gray-200 overflow-y-auto animate-in slide-in-from-right-4 duration-200">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">직원 상세</h2>
              <button
                onClick={() => setSelectedEmployee(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Avatar */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xl font-bold">
                  {selectedEmployee.name.charAt(0)}
                </div>
                <div>
                  <div className="font-semibold text-gray-800">{selectedEmployee.name}</div>
                  <div className="text-xs text-gray-500">{selectedEmployee.email}</div>
                </div>
              </div>

              <div className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1">
                🔒 읽기 전용: ERP에서 자동 동기화됨
              </div>

              {/* Fields */}
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">팀</dt>
                  <dd className="text-gray-800 font-medium">
                    {TEAM_LABELS[selectedEmployee.erp_team_id] ??
                      `팀 ${selectedEmployee.erp_team_id}`}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">직급</dt>
                  <dd className="text-gray-800 font-medium">
                    {selectedEmployee.position ?? '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">역할</dt>
                  <dd>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        selectedEmployee.role === 'admin' ||
                        selectedEmployee.role === 'super_admin'
                          ? 'bg-purple-100 text-purple-700'
                          : selectedEmployee.role === 'leader'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {ROLE_LABELS[selectedEmployee.role] ?? selectedEmployee.role}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">근무형태</dt>
                  <dd className="text-gray-800">{selectedEmployee.work_type ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">상태</dt>
                  <dd>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        selectedEmployee.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {selectedEmployee.is_active ? '재직중' : '비활성'}
                    </span>
                  </dd>
                </div>
                {selectedEmployee.manager_id && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">매니저 ID</dt>
                    <dd className="text-gray-800">{selectedEmployee.manager_id}</dd>
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
