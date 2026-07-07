'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';

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
  started: { label: '진행중', color: 'bg-blue-100 text-blue-700' },
  completed: { label: '완료', color: 'bg-green-100 text-green-700' },
  aborted: { label: '중단', color: 'bg-red-100 text-red-700' },
};

function getDateRange(tab: DateTab): { start: string; end: string } {
  const now = new Date();
  const toIso = (d: Date) => d.toISOString().split('T')[0];
  if (tab === 'today') {
    const s = toIso(now);
    return { start: s, end: s };
  }
  if (tab === 'week') {
    const day = now.getDay(); // 0=Sun
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    return { start: toIso(monday), end: toIso(now) };
  }
  // month
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: toIso(start), end: toIso(now) };
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
}

const DEFAULT_FORM: WorkFormData = {
  title: '',
  work_date: new Date().toISOString().split('T')[0],
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
};

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
    const y = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
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
    setForm({ ...DEFAULT_FORM, work_date: new Date().toISOString().split('T')[0] });
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
    <div className="p-6 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">업무기록</h1>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          + 업무 추가
        </button>
      </div>

      {/* Date tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(Object.keys(TAB_LABELS) as DateTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Summary card */}
      {summary && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">업무 요약</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-2xl font-bold text-gray-800">{summary.total_count}</div>
              <div className="text-xs text-gray-500">전체 업무</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{summary.completed_count}</div>
              <div className="text-xs text-gray-500">완료</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">{summary.started_count}</div>
              <div className="text-xs text-gray-500">진행중</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">
                {formatMinutes(summary.total_est_minutes)}
              </div>
              <div className="text-xs text-gray-500">예상 시간</div>
            </div>
          </div>

          {/* 완료도 진행바 (progress-bar) + 완료율 */}
          {summary.total_count > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>완료율</span>
                <span className="font-semibold text-gray-700">
                  {Math.round((summary.completed_count / summary.total_count) * 100)}% · 실제 {formatMinutes(summary.total_actual_minutes)}
                </span>
              </div>
              <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${Math.round((summary.completed_count / summary.total_count) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Category distribution */}
          {Object.keys(summary.categories).length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="text-xs text-gray-500 mb-2">카테고리 분포</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(summary.categories)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, count]) => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full"
                    >
                      {cat} <span className="font-bold">{count}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 일일 상태 리포트 (daily-status-form → POST /api/daily-status-push) */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">일일 상태 리포트</h2>
          <span className="text-xs text-gray-400">EOD ERP 전송 큐 (daily_status_push)</span>
        </div>
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
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <textarea
                value={report[k]}
                onChange={(e) => setReport({ ...report, [k]: e.target.value })}
                rows={2}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={submitReport}
            disabled={reportSaving}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {reportSaving ? '전송 중...' : '일일 리포트 제출'}
          </button>
          {reportMsg && <span className="text-xs text-gray-500">{reportMsg}</span>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">전체 상태</option>
          <option value="started">진행중</option>
          <option value="completed">완료</option>
        </select>

        <button
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 text-gray-600"
        >
          🔄 새로고침
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

      {/* Work log list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
            데이터를 불러오는 중...
          </div>
        ) : workLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
            <span className="text-5xl">📋</span>
            <p className="text-sm">아직 등록된 업무가 없습니다.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={openCreateModal}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 transition-colors"
              >
                업무 추가하기
              </button>
              <button
                onClick={copyYesterday}
                className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-md hover:bg-gray-50 transition-colors"
              >
                어제 복사하기
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {workLogs.map((log) => {
              const statusInfo = STATUS_LABELS[log.status] ?? {
                label: log.status,
                color: 'bg-gray-100 text-gray-600',
              };
              return (
                <div
                  key={log.id}
                  className="bg-white rounded-lg border border-gray-200 p-4 hover:border-indigo-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                        {log.category && (
                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                            {log.category}
                          </span>
                        )}
                        {log.related_project && (
                          <span className="text-xs text-gray-400">📁 {log.related_project}</span>
                        )}
                        <span className="text-xs text-gray-400">{log.work_date}</span>
                      </div>

                      <button
                        onClick={() => openEditModal(log)}
                        className="mt-1 text-left w-full font-medium text-gray-800 hover:text-indigo-600 truncate block"
                      >
                        {log.title}
                      </button>

                      {log.goal && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-1">🎯 {log.goal}</p>
                      )}

                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        {log.est_minutes != null && (
                          <span>예상 {formatMinutes(log.est_minutes)}</span>
                        )}
                        {log.actual_minutes != null && (
                          <span>실제 {formatMinutes(log.actual_minutes)}</span>
                        )}
                        {log.result_url && (
                          <a
                            href={log.result_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-500 hover:underline"
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
                              ? 'border-green-300 text-green-600 hover:bg-green-50'
                              : 'border-gray-300 text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {log.status === 'started' ? '✓ 완료' : '↩ 재개'}
                        </button>
                      )}
                      <button
                        onClick={() => openEditModal(log)}
                        className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-500 hover:bg-gray-50"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => handleDelete(log)}
                        className="text-xs px-2 py-1 border border-red-200 rounded text-red-500 hover:bg-red-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">
                {editLog ? '업무 수정' : '업무 추가'}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-4 space-y-4">
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
                  placeholder="업무 제목을 입력하세요"
                />
              </div>

              {/* Date + Category row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">날짜</label>
                  <input
                    type="date"
                    value={form.work_date}
                    onChange={(e) => setForm({ ...form, work_date: e.target.value })}
                    required
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="started">진행중</option>
                  <option value="completed">완료</option>
                  <option value="aborted">중단</option>
                </select>
              </div>

              {/* Goal */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">목표</label>
                <input
                  type="text"
                  value={form.goal}
                  onChange={(e) => setForm({ ...form, goal: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="이 업무의 목표는?"
                />
              </div>

              {/* Minutes row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    예상 시간 (분)
                  </label>
                  <input
                    type="number"
                    value={form.est_minutes}
                    onChange={(e) => setForm({ ...form, est_minutes: e.target.value })}
                    min={0}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="60"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    실제 시간 (분)
                  </label>
                  <input
                    type="number"
                    value={form.actual_minutes}
                    onChange={(e) => setForm({ ...form, actual_minutes: e.target.value })}
                    min={0}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="90"
                  />
                </div>
              </div>

              {/* Project + URL */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    관련 프로젝트
                  </label>
                  <input
                    type="text"
                    value={form.related_project}
                    onChange={(e) => setForm({ ...form, related_project: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="프로젝트명"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">참조 URL</label>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="https://"
                  />
                </div>
              </div>

              {/* Result URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">결과물 URL</label>
                <input
                  type="url"
                  value={form.result_url}
                  onChange={(e) => setForm({ ...form, result_url: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="https://"
                />
              </div>

              {/* Result description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">결과 설명</label>
                <textarea
                  value={form.result_description}
                  onChange={(e) => setForm({ ...form, result_description: e.target.value })}
                  rows={2}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="업무 결과를 간략히 설명하세요"
                />
              </div>

              {/* Next action */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">다음 액션</label>
                <input
                  type="text"
                  value={form.next_action}
                  onChange={(e) => setForm({ ...form, next_action: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="다음에 할 일"
                />
              </div>

              {saveError && (
                <p className="text-sm text-red-600">✗ {saveError}</p>
              )}

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
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
