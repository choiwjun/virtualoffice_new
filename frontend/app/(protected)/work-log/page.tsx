'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { kstToday, kstDateString } from '@/lib/dates';
import {
  PageHeader,
  ToolbarButton,
  Segmented,
  StatCard,
  SectionCard,
  EmptyState,
  ErrorBanner,
  LoadingState,
  ProgressRow,
  CARD_SURFACE,
} from '@/components/ui/console';

const ICON = {
  log: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M6 3h8a2 2 0 0 1 2 2v12l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2z" /><path d="M7 7h6M7 10h6" /></svg>,
  plus: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M10 4v12M4 10h12" /></svg>,
  refresh: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M15.5 6.5A6 6 0 1 0 16 10" /><path d="M15.5 3v4h-4" /></svg>,
  copy: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><rect x="7" y="7" width="9" height="9" rx="1.5" /><path d="M4 13V5a1.5 1.5 0 0 1 1.5-1.5H13" /></svg>,
  summary: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M3 3v14h14" /><path d="M7 12l3-3 2 2 4-5" /></svg>,
  report: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M5 3h7l3 3v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M12 3v3h3M7 11h6M7 14h4" /></svg>,
  list: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 6h12M4 10h12M4 14h8" /></svg>,
};

interface WorkLog {
  id: string;
  user_id: number;
  work_date: string;
  category: string | null;
  title: string;
  goal: string | null;
  est_minutes: number | null;
  actual_minutes: number | null;
  status: string;
  result_url: string | null;
  next_action: string | null;
  result_description: string | null;
  related_project: string | null;
  url: string | null;
  issues: string[] | null;
  attachments: string[] | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SummaryPeriod {
  period: string;
  total_count: number;
  completed_count: number;
  started_count: number;
  total_est_minutes: number;
  total_actual_minutes: number;
  categories: Record<string, number>;
}

interface SummaryResponse {
  period_type: string;
  user_id: number | null;
  periods: SummaryPeriod[];
}

type DateTab = 'today' | 'week' | 'month';

const CATEGORIES = [
  '개발',
  '기획',
  '디자인',
  '회의',
  '문서',
  '운영',
  '분석',
  '교육',
  '기타',
] as const;

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  started: { label: '진행중', color: 'bg-[rgba(56,189,248,0.15)] text-accent-cyan' },
  completed: { label: '완료', color: 'bg-[rgba(34,197,94,0.16)] text-status-online' },
  aborted: { label: '중단', color: 'bg-[rgba(239,68,68,0.12)] text-red-300' },
};

function getDateRange(tab: DateTab): { start: string; end: string } {
  const today = kstToday();
  if (tab === 'today') {
    return { start: today, end: today };
  }
  if (tab === 'week') {
    const day = new Date(`${today}T00:00:00`).getDay(); // 0=Sun (KST 자정 기준)
    const monday = kstDateString(new Date(Date.now() - ((day + 6) % 7) * 86400000));
    return { start: monday, end: today };
  }
  // month: KST 기준 이번 달 1일
  return { start: `${today.slice(0, 7)}-01`, end: today };
}

function formatMinutes(m: number | null): string {
  if (!m) return '—';
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

interface WorkFormData {
  title: string;
  work_date: string;
  category: string;
  goal: string;
  est_minutes: string;
  actual_minutes: string;
  status: string;
  result_url: string;
  related_project: string;
  url: string;
  next_action: string;
  result_description: string;
  issues: string;
  attachments: string;
}

const DEFAULT_FORM: WorkFormData = {
  title: '',
  work_date: '',
  category: '',
  goal: '',
  est_minutes: '',
  actual_minutes: '',
  status: 'started',
  result_url: '',
  related_project: '',
  url: '',
  next_action: '',
  result_description: '',
  issues: '',
  attachments: '',
};

/** textarea 줄 단위 입력 → string[] (빈 줄 제거), 없으면 null */
function linesToList(text: string): string[] | null {
  const list = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

export default function WorkLogPage() {
  const [activeTab, setActiveTab] = useState<DateTab>('today');
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [summary, setSummary] = useState<SummaryPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Category filter
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editLog, setEditLog] = useState<WorkLog | null>(null);
  const [form, setForm] = useState<WorkFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // 일일 상태 리포트 (daily_status_push, REQ-008)
  const [report, setReport] = useState({ today_plan: '', in_progress: '', blockers: '', tomorrow_plan: '' });
  const [reportSaving, setReportSaving] = useState(false);
  const [reportMsg, setReportMsg] = useState('');

  async function submitReport() {
    setReportSaving(true);
    setReportMsg('');
    try {
      await api.post('/api/daily-status-push', report);
      setReportMsg('✅ 일일 상태 리포트가 큐잉되었습니다.');
      setReport({ today_plan: '', in_progress: '', blockers: '', tomorrow_plan: '' });
    } catch (err) {
      setReportMsg(err instanceof ApiError ? `저장 실패 (${err.status})` : '저장 오류');
    } finally {
      setReportSaving(false);
    }
  }

  async function copyYesterday() {
    const y = kstDateString(new Date(Date.now() - 86400000));
    const today = kstToday();
    try {
      const prev = await api.get<WorkLog[]>(`/api/work-logs?start_date=${y}&end_date=${y}`);
      if (prev.length === 0) { setError('어제 복사할 업무가 없습니다.'); return; }
      for (const w of prev) {
        await api.post('/api/work-logs', {
          title: w.title,
          work_date: today,
          category: w.category,
          goal: w.goal,
          est_minutes: w.est_minutes,
          status: 'started',
        });
      }
      fetchData();
    } catch (err) {
      setError(err instanceof ApiError ? `복사 실패 (${err.status})` : '복사 오류');
    }
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    const { start, end } = getDateRange(activeTab);
    try {
      const params = new URLSearchParams({ start_date: start, end_date: end });
      if (categoryFilter) params.set('category', categoryFilter);
      if (statusFilter) params.set('status', statusFilter);

      const [logs, summaryData] = await Promise.all([
        api.get<WorkLog[]>(`/api/work-logs?${params}`),
        api.get<SummaryResponse>(
          `/api/work-logs/summary?period_type=${activeTab === 'today' ? 'daily' : activeTab === 'week' ? 'weekly' : 'monthly'}&start_date=${start}&end_date=${end}`,
        ),
      ]);

      setWorkLogs(logs);

      // Use the most recent period summary
      const periods = summaryData.periods;
      setSummary(periods.length > 0 ? periods[periods.length - 1] : null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`❌ 오류 — ${err.message}`);
      } else {
        setError('❌ 네트워크 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab, categoryFilter, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function openCreateModal() {
    setEditLog(null);
    setForm({ ...DEFAULT_FORM, work_date: kstToday() });
    setSaveError('');
    setModalOpen(true);
  }

  function openEditModal(log: WorkLog) {
    setEditLog(log);
    setForm({
      title: log.title,
      work_date: log.work_date,
      category: log.category ?? '',
      goal: log.goal ?? '',
      est_minutes: log.est_minutes != null ? String(log.est_minutes) : '',
      actual_minutes: log.actual_minutes != null ? String(log.actual_minutes) : '',
      status: log.status,
      result_url: log.result_url ?? '',
      related_project: log.related_project ?? '',
      url: log.url ?? '',
      next_action: log.next_action ?? '',
      result_description: log.result_description ?? '',
      issues: (log.issues ?? []).join('\n'),
      attachments: (log.attachments ?? []).join('\n'),
    });
    setSaveError('');
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        title: form.title,
        work_date: form.work_date,
        category: form.category || null,
        goal: form.goal || null,
        est_minutes: form.est_minutes ? parseInt(form.est_minutes) : null,
        actual_minutes: form.actual_minutes ? parseInt(form.actual_minutes) : null,
        status: form.status,
        result_url: form.result_url || null,
        related_project: form.related_project || null,
        url: form.url || null,
        next_action: form.next_action || null,
        result_description: form.result_description || null,
        issues: linesToList(form.issues),
        attachments: linesToList(form.attachments),
      };

      if (editLog) {
        await api.patch(`/api/work-logs/${editLog.id}`, payload);
      } else {
        await api.post('/api/work-logs', payload);
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

  async function handleDelete(log: WorkLog) {
    if (!confirm(`"${log.title}" 업무를 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/work-logs/${log.id}`);
      fetchData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '삭제 오류');
    }
  }

  async function handleStatusToggle(log: WorkLog) {
    const nextStatus = log.status === 'started' ? 'completed' : 'started';
    try {
      await api.patch(`/api/work-logs/${log.id}`, { status: nextStatus });
      fetchData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '상태 변경 오류');
    }
  }

  const TAB_LABELS: Record<DateTab, string> = {
    today: '오늘',
    week: '이번 주',
    month: '이번 달',
  };

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title="업무기록"
        subtitle="오늘·이번 주·이번 달 업무를 기록하고 상태를 관리합니다"
        icon={ICON.log}
        actions={
          <ToolbarButton onClick={openCreateModal} variant="primary" icon={ICON.plus}>
            업무 추가
          </ToolbarButton>
        }
      />

      {/* Date tabs */}
      <Segmented
        value={activeTab}
        onChange={setActiveTab}
        options={(Object.keys(TAB_LABELS) as DateTab[]).map((tab) => ({ value: tab, label: TAB_LABELS[tab] }))}
      />

      {/* Summary card */}
      {summary && (
        <SectionCard title="업무 요약" icon={ICON.summary}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <StatCard label="전체 업무" value={summary.total_count} accent="#B4C0D3" icon={ICON.list} />
            <StatCard label="완료" value={summary.completed_count} accent="#22C55E" />
            <StatCard label="진행중" value={summary.started_count} accent="#38BDF8" />
            <StatCard label="예상 시간" value={formatMinutes(summary.total_est_minutes)} accent="#93A9FF" />
          </div>

          {/* 완료도 진행바 (progress-bar) + 완료율 */}
          {summary.total_count > 0 && (
            <div className="mt-4">
              <ProgressRow
                label="완료율"
                meta={`${Math.round((summary.completed_count / summary.total_count) * 100)}% · 실제 ${formatMinutes(summary.total_actual_minutes)}`}
                pct={Math.round((summary.completed_count / summary.total_count) * 100)}
                accent="#22C55E"
              />
            </div>
          )}

          {/* Category distribution */}
          {Object.keys(summary.categories).length > 0 && (
            <div className="mt-4 pt-3 border-t border-border-subtle">
              <div className="text-xs text-text-muted mb-2">카테고리 분포</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(summary.categories)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, count]) => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-[rgba(59,91,254,0.2)] text-[#93A9FF] text-xs rounded-full"
                    >
                      {cat} <span className="font-bold">{count}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* 일일 상태 리포트 (daily-status-form → POST /api/daily-status-push) */}
      <SectionCard
        title="일일 상태 리포트"
        icon={ICON.report}
        action={<span className="text-xs text-text-muted">EOD ERP 전송 큐 (daily_status_push)</span>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(
            [
              ['today_plan', '오늘 할 일'],
              ['in_progress', '진행중 업무'],
              ['blockers', '블로커'],
              ['tomorrow_plan', '내일 계획'],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
              <textarea
                value={report[k]}
                onChange={(e) => setReport({ ...report, [k]: e.target.value })}
                rows={2}
                className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <ToolbarButton onClick={submitReport} disabled={reportSaving} variant="primary">
            {reportSaving ? '전송 중...' : '일일 리포트 제출'}
          </ToolbarButton>
          {reportMsg && <span className="text-xs text-text-muted">{reportMsg}</span>}
        </div>
      </SectionCard>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
        >
          <option value="">전체 카테고리</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
        >
          <option value="">전체 상태</option>
          <option value="started">진행중</option>
          <option value="completed">완료</option>
        </select>

        <ToolbarButton onClick={fetchData} disabled={loading} icon={ICON.refresh}>
          새로고침
        </ToolbarButton>
      </div>

      {/* Error */}
      {error && <ErrorBanner message={error} onRetry={fetchData} />}

      {/* Work log list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState />
        ) : workLogs.length === 0 ? (
          <EmptyState
            icon="📋"
            title="아직 등록된 업무가 없습니다."
            hint="새 업무를 추가하거나 어제 업무를 복사해 시작하세요."
            action={
              <div className="flex items-center gap-2">
                <ToolbarButton onClick={openCreateModal} variant="primary" icon={ICON.plus}>
                  업무 추가하기
                </ToolbarButton>
                <ToolbarButton onClick={copyYesterday} icon={ICON.copy}>
                  어제 복사하기
                </ToolbarButton>
              </div>
            }
          />
        ) : (
          <div className="space-y-2">
            {workLogs.map((log) => {
              const statusInfo = STATUS_LABELS[log.status] ?? {
                label: log.status,
                color: 'bg-bg-surface-raised text-text-muted',
              };
              return (
                <div
                  key={log.id}
                  className={`${CARD_SURFACE} p-4 hover:border-primary/50 transition-colors`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                        {log.category && (
                          <span className="text-xs px-2 py-0.5 bg-bg-surface-raised text-text-secondary rounded">
                            {log.category}
                          </span>
                        )}
                        {log.related_project && (
                          <span className="text-xs text-text-muted">📁 {log.related_project}</span>
                        )}
                        <span className="text-xs text-text-muted">{log.work_date}</span>
                      </div>

                      <button
                        onClick={() => openEditModal(log)}
                        className="mt-1 text-left w-full font-medium text-text-primary hover:text-accent-cyan truncate block"
                      >
                        {log.title}
                      </button>

                      {log.goal && (
                        <p className="text-xs text-text-muted mt-1 line-clamp-1">🎯 {log.goal}</p>
                      )}

                      {log.issues && log.issues.length > 0 && (
                        <p
                          className="text-xs text-red-300 mt-1 line-clamp-2"
                          title={log.issues.join('\n')}
                        >
                          ⚠ {log.issues.join(' · ')}
                        </p>
                      )}

                      <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
                        {log.est_minutes != null && (
                          <span>예상 {formatMinutes(log.est_minutes)}</span>
                        )}
                        {log.actual_minutes != null && (
                          <span>실제 {formatMinutes(log.actual_minutes)}</span>
                        )}
                        {log.attachments?.map((url, i) => (
                          <a
                            key={`${url}-${i}`}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-cyan hover:underline"
                          >
                            📎 첨부{log.attachments!.length > 1 ? ` ${i + 1}` : ''}
                          </a>
                        ))}
                        {log.result_url && (
                          <a
                            href={log.result_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-cyan hover:underline"
                          >
                            ✓ 결과물
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {log.status !== 'aborted' && (
                        <button
                          onClick={() => handleStatusToggle(log)}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${
                            log.status === 'started'
                              ? 'border-[rgba(34,197,94,0.4)] text-status-online hover:bg-[rgba(34,197,94,0.12)]'
                              : 'border-border-subtle text-text-muted hover:bg-bg-surface-raised'
                          }`}
                        >
                          {log.status === 'started' ? '✓ 완료' : '↩ 재개'}
                        </button>
                      )}
                      <button
                        onClick={() => openEditModal(log)}
                        className="text-xs px-2 py-1 border border-border-subtle rounded text-text-secondary hover:bg-bg-surface-raised"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => handleDelete(log)}
                        className="text-xs px-2 py-1 border border-[rgba(239,68,68,0.35)] rounded text-red-300 hover:bg-[rgba(239,68,68,0.12)]"
                      >
                        삭제
                      </button>
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
          <div className="rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-border-subtle" style={{ background: '#161F32' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
              <h2 className="font-semibold text-text-primary">
                {editLog ? '업무 수정' : '업무 추가'}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-text-muted hover:text-text-primary text-xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-4 space-y-4">
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
                  className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  placeholder="업무 제목을 입력하세요"
                />
              </div>

              {/* Date + Category row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">날짜</label>
                  <input
                    type="date"
                    value={form.work_date}
                    onChange={(e) => setForm({ ...form, work_date: e.target.value })}
                    required
                    className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">카테고리</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  >
                    <option value="">선택 안함</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">상태</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                >
                  <option value="started">진행중</option>
                  <option value="completed">완료</option>
                  <option value="aborted">중단</option>
                </select>
              </div>

              {/* Goal */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">목표</label>
                <input
                  type="text"
                  value={form.goal}
                  onChange={(e) => setForm({ ...form, goal: e.target.value })}
                  className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  placeholder="이 업무의 목표는?"
                />
              </div>

              {/* Minutes row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    예상 시간 (분)
                  </label>
                  <input
                    type="number"
                    value={form.est_minutes}
                    onChange={(e) => setForm({ ...form, est_minutes: e.target.value })}
                    min={0}
                    className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                    placeholder="60"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    실제 시간 (분)
                  </label>
                  <input
                    type="number"
                    value={form.actual_minutes}
                    onChange={(e) => setForm({ ...form, actual_minutes: e.target.value })}
                    min={0}
                    className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                    placeholder="90"
                  />
                </div>
              </div>

              {/* Project + URL */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    관련 프로젝트
                  </label>
                  <input
                    type="text"
                    value={form.related_project}
                    onChange={(e) => setForm({ ...form, related_project: e.target.value })}
                    className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                    placeholder="프로젝트명"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">참조 URL</label>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                    placeholder="https://"
                  />
                </div>
              </div>

              {/* Result URL */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">결과물 URL</label>
                <input
                  type="url"
                  value={form.result_url}
                  onChange={(e) => setForm({ ...form, result_url: e.target.value })}
                  className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  placeholder="https://"
                />
              </div>

              {/* Result description */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">결과 설명</label>
                <textarea
                  value={form.result_description}
                  onChange={(e) => setForm({ ...form, result_description: e.target.value })}
                  rows={2}
                  className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  placeholder="업무 결과를 간략히 설명하세요"
                />
              </div>

              {/* Issues / blockers */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  이슈/블로커
                </label>
                <textarea
                  value={form.issues}
                  onChange={(e) => setForm({ ...form, issues: e.target.value })}
                  rows={2}
                  className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  placeholder="한 줄에 하나씩 입력하세요"
                />
              </div>

              {/* Attachments */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">첨부 URL</label>
                <textarea
                  value={form.attachments}
                  onChange={(e) => setForm({ ...form, attachments: e.target.value })}
                  rows={2}
                  className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  placeholder={'https://... (한 줄에 하나씩)'}
                />
              </div>

              {/* Next action */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">다음 액션</label>
                <input
                  type="text"
                  value={form.next_action}
                  onChange={(e) => setForm({ ...form, next_action: e.target.value })}
                  className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  placeholder="다음에 할 일"
                />
              </div>

              {saveError && (
                <p className="text-sm text-red-400">✗ {saveError}</p>
              )}

              <div className="flex gap-2 pt-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 px-4 py-2 text-sm border border-border-subtle rounded-md text-text-secondary hover:bg-bg-surface-raised"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
