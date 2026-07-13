'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove, type User } from '@/lib/auth';

type ReportType = 'daily' | 'weekly' | 'monthly';
type ReportStatus = 'draft' | 'submitted';
type StatusTab = '' | ReportStatus;

interface Report {
  id: number;
  user_id: number;
  report_type: ReportType;
  report_date: string;
  title: string;
  content: string;
  status: ReportStatus;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Employee {
  id: number;
  name: string;
}

const TYPE_LABELS: Record<ReportType, { label: string; color: string }> = {
  daily: { label: '일일', color: 'bg-blue-100 text-blue-700' },
  weekly: { label: '주간', color: 'bg-purple-100 text-purple-700' },
  monthly: { label: '월간', color: 'bg-indigo-100 text-indigo-700' },
};

const STATUS_LABELS: Record<ReportStatus, { label: string; color: string }> = {
  draft: { label: '작성중', color: 'bg-gray-100 text-gray-600' },
  submitted: { label: '제출됨', color: 'bg-green-100 text-green-700' },
};

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'draft', label: '작성중' },
  { value: 'submitted', label: '제출됨' },
];

interface ReportFormData {
  report_type: ReportType;
  report_date: string;
  title: string;
  content: string;
}

function defaultForm(): ReportFormData {
  return {
    report_type: 'daily',
    report_date: new Date().toISOString().split('T')[0],
    title: '',
    content: '',
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ReportsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [statusTab, setStatusTab] = useState<StatusTab>('');
  const [typeFilter, setTypeFilter] = useState<'' | ReportType>('');

  // Create/Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editReport, setEditReport] = useState<Report | null>(null);
  const [form, setForm] = useState<ReportFormData>(defaultForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Read-only view modal state
  const [viewReport, setViewReport] = useState<Report | null>(null);

  const isManager = isLeaderOrAbove(user);

  useEffect(() => {
    setUser(getUser());
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('report_type', typeFilter);
      if (statusTab) params.set('status', statusTab);
      const qs = params.toString();
      const data = await api.get<Report[]>(`/api/reports${qs ? `?${qs}` : ''}`);
      setReports(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`오류 — ${err.message}`);
      } else {
        setError('네트워크 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  }, [statusTab, typeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 관리자 화면: 작성자 이름 표시용 직원 목록
  useEffect(() => {
    if (!isManager) return;
    let cancelled = false;
    api
      .get<Employee[]>('/api/employees')
      .then((list) => {
        if (!cancelled) setEmployees(list);
      })
      .catch(() => {
        /* 이름 표시는 부가 기능이므로 실패해도 목록은 보여준다 */
      });
    return () => {
      cancelled = true;
    };
  }, [isManager]);

  function employeeName(userId: number): string {
    return employees.find((e) => e.id === userId)?.name ?? `#${userId}`;
  }

  function isOwnDraft(report: Report): boolean {
    return report.status === 'draft' && user != null && report.user_id === user.id;
  }

  function openCreateModal() {
    setEditReport(null);
    setForm(defaultForm());
    setSaveError('');
    setModalOpen(true);
  }

  function openEditModal(report: Report) {
    setEditReport(report);
    setForm({
      report_type: report.report_type,
      report_date: report.report_date,
      title: report.title,
      content: report.content,
    });
    setSaveError('');
    setModalOpen(true);
  }

  async function handleSave(targetStatus: ReportStatus) {
    if (!form.title.trim()) {
      setSaveError('제목을 입력해주세요.');
      return;
    }
    if (!form.report_date) {
      setSaveError('기준일을 선택해주세요.');
      return;
    }
    if (!form.content.trim()) {
      setSaveError('내용을 입력해주세요.');
      return;
    }
    if (
      targetStatus === 'submitted' &&
      !confirm('보고서를 제출하시겠습니까? 제출 후에는 수정할 수 없습니다.')
    ) {
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      if (editReport) {
        const payload: Record<string, unknown> = {
          report_type: form.report_type,
          report_date: form.report_date,
          title: form.title,
          content: form.content,
        };
        if (targetStatus === 'submitted') payload.status = 'submitted';
        await api.patch(`/api/reports/${editReport.id}`, payload);
      } else {
        await api.post('/api/reports', {
          report_type: form.report_type,
          report_date: form.report_date,
          title: form.title,
          content: form.content,
          status: targetStatus,
        });
      }
      setModalOpen(false);
      fetchData();
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveError(`저장 실패: ${err.message}`);
      } else {
        setSaveError('저장 중 오류가 발생했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(report: Report) {
    if (!confirm(`"${report.title}" 보고서를 제출하시겠습니까? 제출 후에는 수정할 수 없습니다.`))
      return;
    try {
      await api.patch(`/api/reports/${report.id}`, { status: 'submitted' });
      fetchData();
    } catch (err) {
      alert(err instanceof ApiError ? `제출 실패: ${err.message}` : '제출 중 오류가 발생했습니다.');
    }
  }

  async function handleDelete(report: Report) {
    if (!confirm(`"${report.title}" 보고서를 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/reports/${report.id}`);
      fetchData();
    } catch (err) {
      alert(err instanceof ApiError ? `삭제 실패: ${err.message}` : '삭제 중 오류가 발생했습니다.');
    }
  }

  return (
    <div className="p-6 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">보고서</h1>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          + 보고서 작성
        </button>
      </div>

      {/* Filters: status tabs + type select */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusTab(tab.value)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                statusTab === tab.value
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as '' | ReportType)}
          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">전체 유형</option>
          <option value="daily">일일</option>
          <option value="weekly">주간</option>
          <option value="monthly">월간</option>
        </select>

        <button
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 text-gray-600"
        >
          새로고침
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
          <button onClick={fetchData} className="ml-2 underline text-red-600">
            재시도
          </button>
        </div>
      )}

      {/* Report list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
            데이터를 불러오는 중...
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
            <span className="text-5xl">📄</span>
            <p className="text-sm">등록된 보고서가 없습니다.</p>
            <button
              onClick={openCreateModal}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 transition-colors"
            >
              보고서 작성하기
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => {
              const typeInfo = TYPE_LABELS[report.report_type] ?? {
                label: report.report_type,
                color: 'bg-gray-100 text-gray-600',
              };
              const statusInfo = STATUS_LABELS[report.status] ?? {
                label: report.status,
                color: 'bg-gray-100 text-gray-600',
              };
              const ownDraft = isOwnDraft(report);
              return (
                <div
                  key={report.id}
                  className="bg-white rounded-lg border border-gray-200 p-4 hover:border-indigo-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-medium ${typeInfo.color}`}
                        >
                          {typeInfo.label}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-medium ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                        <span className="text-xs text-gray-400">기준일 {report.report_date}</span>
                        {report.submitted_at && (
                          <span className="text-xs text-gray-400">
                            제출 {formatDateTime(report.submitted_at)}
                          </span>
                        )}
                        {isManager && (
                          <span className="text-xs text-gray-500">
                            👤 {employeeName(report.user_id)}
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() =>
                          ownDraft ? openEditModal(report) : setViewReport(report)
                        }
                        className="mt-1 text-left w-full font-medium text-gray-800 hover:text-indigo-600 truncate block"
                      >
                        {report.title}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {ownDraft ? (
                        <>
                          <button
                            onClick={() => openEditModal(report)}
                            className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-500 hover:bg-gray-50"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleSubmit(report)}
                            className="text-xs px-2 py-1 border border-green-300 rounded text-green-600 hover:bg-green-50"
                          >
                            제출
                          </button>
                          <button
                            onClick={() => handleDelete(report)}
                            className="text-xs px-2 py-1 border border-red-200 rounded text-red-500 hover:bg-red-50"
                          >
                            삭제
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setViewReport(report)}
                          className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-500 hover:bg-gray-50"
                        >
                          보기
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">
                {editReport ? '보고서 수정' : '보고서 작성'}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Type + Date row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
                  <select
                    value={form.report_type}
                    onChange={(e) =>
                      setForm({ ...form, report_type: e.target.value as ReportType })
                    }
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="daily">일일</option>
                    <option value="weekly">주간</option>
                    <option value="monthly">월간</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    기준일 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.report_date}
                    onChange={(e) => setForm({ ...form, report_date: e.target.value })}
                    required
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  제목 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="보고서 제목을 입력하세요"
                />
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  내용 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={10}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder={
                    '오늘 한 일:\n- \n\n이슈 / 블로커:\n- \n\n내일 할 일:\n- '
                  }
                />
              </div>

              {saveError && <p className="text-sm text-red-600">✗ {saveError}</p>}

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => handleSave('draft')}
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm border border-indigo-300 text-indigo-600 rounded-md hover:bg-indigo-50 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '임시저장'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSave('submitted')}
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '제출'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Read-only View Modal */}
      {viewReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">보고서 보기</h2>
              <button
                onClick={() => setViewReport(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    (TYPE_LABELS[viewReport.report_type] ?? {
                      color: 'bg-gray-100 text-gray-600',
                    }).color
                  }`}
                >
                  {TYPE_LABELS[viewReport.report_type]?.label ?? viewReport.report_type}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    (STATUS_LABELS[viewReport.status] ?? {
                      color: 'bg-gray-100 text-gray-600',
                    }).color
                  }`}
                >
                  {STATUS_LABELS[viewReport.status]?.label ?? viewReport.status}
                </span>
                <span className="text-xs text-gray-400">기준일 {viewReport.report_date}</span>
                {viewReport.submitted_at && (
                  <span className="text-xs text-gray-400">
                    제출 {formatDateTime(viewReport.submitted_at)}
                  </span>
                )}
                {isManager && (
                  <span className="text-xs text-gray-500">
                    👤 {employeeName(viewReport.user_id)}
                  </span>
                )}
              </div>

              <h3 className="font-medium text-gray-800">{viewReport.title}</h3>

              <div className="bg-gray-50 rounded-md border border-gray-100 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                {viewReport.content}
              </div>

              <div className="flex pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setViewReport(null)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
