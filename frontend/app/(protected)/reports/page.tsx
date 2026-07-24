'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove, type User } from '@/lib/auth';
import { kstToday } from '@/lib/dates';
import {
  PageHeader,
  ToolbarButton,
  Segmented,
  EmptyState,
  ErrorBanner,
  LoadingState,
  CARD_SURFACE,
} from '@/components/ui/console';
import { useToast, useConfirm } from '@/components/ui/feedback';

const ICON = {
  doc: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M5 3h7l3 3v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M12 3v3h3M7 11h6M7 14h4" /></svg>,
  plus: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M10 4v12M4 10h12" /></svg>,
  refresh: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M15.5 6.5A6 6 0 1 0 16 10" /><path d="M15.5 3v4h-4" /></svg>,
};

type ReportType = 'daily' | 'weekly' | 'monthly';
type ReportStatus = 'draft' | 'submitted';
type StatusTab = '' | ReportStatus;

interface Report {
  id: string;
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
  daily: { label: '일일', color: 'bg-[rgba(56,189,248,0.15)] text-accent-cyan' },
  weekly: { label: '주간', color: 'bg-[rgba(139,92,246,0.18)] text-status-focus' },
  monthly: { label: '월간', color: 'bg-[rgba(59,91,254,0.2)] text-[#93A9FF]' },
};

const STATUS_LABELS: Record<ReportStatus, { label: string; color: string }> = {
  draft: { label: '작성중', color: 'bg-bg-surface-raised text-text-muted' },
  submitted: { label: '제출됨', color: 'bg-[rgba(34,197,94,0.16)] text-status-online' },
};

// 다크 셸 통일 — 밝은 유형/상태 폴백 배지
const FALLBACK_BADGE = 'bg-bg-surface-raised text-text-muted';

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
    report_date: kstToday(),
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
  const toast = useToast();
  const confirm = useConfirm();
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
      !(await confirm({
        message: '보고서를 제출하시겠습니까? 제출 후에는 수정할 수 없습니다.',
      }))
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
      toast.success(targetStatus === 'submitted' ? '보고서를 제출했습니다.' : '보고서를 저장했습니다.');
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
    if (
      !(await confirm({
        message: `"${report.title}" 보고서를 제출하시겠습니까? 제출 후에는 수정할 수 없습니다.`,
      }))
    )
      return;
    try {
      await api.patch(`/api/reports/${report.id}`, { status: 'submitted' });
      toast.success('보고서를 제출했습니다.');
      fetchData();
    } catch (err) {
      toast.error(err instanceof ApiError ? `제출 실패: ${err.message}` : '제출 중 오류가 발생했습니다.');
    }
  }

  async function handleDelete(report: Report) {
    if (!(await confirm({ message: `"${report.title}" 보고서를 삭제하시겠습니까?`, danger: true }))) return;
    try {
      await api.delete(`/api/reports/${report.id}`);
      toast.success('보고서를 삭제했습니다.');
      fetchData();
    } catch (err) {
      toast.error(err instanceof ApiError ? `삭제 실패: ${err.message}` : '삭제 중 오류가 발생했습니다.');
    }
  }

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title="보고서"
        subtitle="일일·주간·월간 보고서를 작성하고 제출합니다"
        icon={ICON.doc}
        actions={
          <ToolbarButton onClick={openCreateModal} variant="primary" icon={ICON.plus}>
            보고서 작성
          </ToolbarButton>
        }
      />

      {/* Filters: status tabs + type select */}
      <div className="flex items-center gap-3 flex-wrap">
        <Segmented value={statusTab} onChange={setStatusTab} options={STATUS_TABS} />

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as '' | ReportType)}
          className="border border-border-subtle bg-bg-surface text-text-secondary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
        >
          <option value="">전체 유형</option>
          <option value="daily">일일</option>
          <option value="weekly">주간</option>
          <option value="monthly">월간</option>
        </select>

        <ToolbarButton onClick={fetchData} disabled={loading} icon={ICON.refresh}>
          새로고침
        </ToolbarButton>
      </div>

      {/* Error */}
      {error && <ErrorBanner message={error} onRetry={fetchData} />}

      {/* Report list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState />
        ) : reports.length === 0 ? (
          <EmptyState
            icon="📄"
            title="등록된 보고서가 없습니다."
            hint="새 보고서를 작성해 첫 기록을 남겨보세요."
            action={
              <ToolbarButton onClick={openCreateModal} variant="primary" icon={ICON.plus}>
                보고서 작성하기
              </ToolbarButton>
            }
          />
        ) : (
          <div className="space-y-2">
            {reports.map((report) => {
              const typeInfo = TYPE_LABELS[report.report_type] ?? {
                label: report.report_type,
                color: FALLBACK_BADGE,
              };
              const statusInfo = STATUS_LABELS[report.status] ?? {
                label: report.status,
                color: FALLBACK_BADGE,
              };
              const ownDraft = isOwnDraft(report);
              return (
                <div
                  key={report.id}
                  className={`${CARD_SURFACE} p-4 hover:border-primary/50 transition-colors`}
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
                        <span className="text-xs text-text-muted">기준일 {report.report_date}</span>
                        {report.submitted_at && (
                          <span className="text-xs text-text-muted">
                            제출 {formatDateTime(report.submitted_at)}
                          </span>
                        )}
                        {isManager && (
                          <span className="text-xs text-text-secondary">
                            👤 {employeeName(report.user_id)}
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() =>
                          ownDraft ? openEditModal(report) : setViewReport(report)
                        }
                        className="mt-1 text-left w-full font-medium text-text-primary hover:text-accent-cyan truncate block"
                      >
                        {report.title}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {ownDraft ? (
                        <>
                          <button
                            onClick={() => openEditModal(report)}
                            className="text-xs px-2 py-1 border border-border-subtle rounded text-text-secondary hover:bg-bg-surface-raised"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleSubmit(report)}
                            className="text-xs px-2 py-1 border border-[rgba(34,197,94,0.4)] rounded text-status-online hover:bg-[rgba(34,197,94,0.12)]"
                          >
                            제출
                          </button>
                          <button
                            onClick={() => handleDelete(report)}
                            className="text-xs px-2 py-1 border border-[rgba(239,68,68,0.35)] rounded text-red-300 hover:bg-[rgba(239,68,68,0.12)]"
                          >
                            삭제
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setViewReport(report)}
                          className="text-xs px-2 py-1 border border-border-subtle rounded text-text-secondary hover:bg-bg-surface-raised"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div role="dialog" aria-modal="true" className="rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-border-subtle" style={{ background: '#161F32' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
              <h2 className="font-semibold text-text-primary">
                {editReport ? '보고서 수정' : '보고서 작성'}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                aria-label="닫기"
                className="text-text-muted hover:text-text-primary text-xl"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Type + Date row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">유형</label>
                  <select
                    value={form.report_type}
                    onChange={(e) =>
                      setForm({ ...form, report_type: e.target.value as ReportType })
                    }
                    className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  >
                    <option value="daily">일일</option>
                    <option value="weekly">주간</option>
                    <option value="monthly">월간</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    기준일 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.report_date}
                    onChange={(e) => setForm({ ...form, report_date: e.target.value })}
                    required
                    className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan [color-scheme:dark]"
                  />
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  제목 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan placeholder:text-text-muted"
                  placeholder="보고서 제목을 입력하세요"
                />
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  내용 <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={10}
                  required
                  className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan placeholder:text-text-muted"
                  placeholder={
                    '오늘 한 일:\n- \n\n이슈 / 블로커:\n- \n\n내일 할 일:\n- '
                  }
                />
              </div>

              {saveError && <p className="text-sm text-red-400">✗ {saveError}</p>}

              <div className="flex gap-2 pt-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 px-4 py-2 text-sm border border-border-subtle rounded-md text-text-secondary hover:bg-bg-surface-raised"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => handleSave('draft')}
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm border border-primary/50 text-accent-cyan rounded-md hover:bg-primary/10 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '임시저장'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSave('submitted')}
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div role="dialog" aria-modal="true" className="rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-border-subtle" style={{ background: '#161F32' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
              <h2 className="font-semibold text-text-primary">보고서 보기</h2>
              <button
                onClick={() => setViewReport(null)}
                aria-label="닫기"
                className="text-text-muted hover:text-text-primary text-xl"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    (TYPE_LABELS[viewReport.report_type] ?? {
                      color: FALLBACK_BADGE,
                    }).color
                  }`}
                >
                  {TYPE_LABELS[viewReport.report_type]?.label ?? viewReport.report_type}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    (STATUS_LABELS[viewReport.status] ?? {
                      color: FALLBACK_BADGE,
                    }).color
                  }`}
                >
                  {STATUS_LABELS[viewReport.status]?.label ?? viewReport.status}
                </span>
                <span className="text-xs text-text-muted">기준일 {viewReport.report_date}</span>
                {viewReport.submitted_at && (
                  <span className="text-xs text-text-muted">
                    제출 {formatDateTime(viewReport.submitted_at)}
                  </span>
                )}
                {isManager && (
                  <span className="text-xs text-text-secondary">
                    👤 {employeeName(viewReport.user_id)}
                  </span>
                )}
              </div>

              <h3 className="font-medium text-text-primary">{viewReport.title}</h3>

              <div className="bg-bg-base rounded-md border border-border-subtle p-3 text-sm text-text-secondary whitespace-pre-wrap">
                {viewReport.content}
              </div>

              <div className="flex pt-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setViewReport(null)}
                  className="flex-1 px-4 py-2 text-sm border border-border-subtle rounded-md text-text-secondary hover:bg-bg-surface-raised"
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
