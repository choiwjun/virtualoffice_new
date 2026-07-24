'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove, type User } from '@/lib/auth';
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
} from '@/components/ui/console';

const ICON = {
  chart: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M3 3v14h14" /><path d="M7 12l3-3 2 2 4-5" /></svg>,
  download: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M10 3v9" /><path d="M6.5 9.5 10 13l3.5-3.5" /><path d="M4 16h12" /></svg>,
  refresh: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M15.5 6.5A6 6 0 1 0 16 10" /><path d="M15.5 3v4h-4" /></svg>,
  trend: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M3 15l4-5 3 2 6-8" /><path d="M13 4h4v4" /></svg>,
  pie: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="10" cy="10" r="7" /><path d="M10 10V3M10 10l6 3.2" /></svg>,
  check: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="10" cy="10" r="7" /><path d="M6.8 10.2l2.2 2.2 4.2-4.6" /></svg>,
  list: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 6h12M4 10h12M4 14h8" /></svg>,
  play: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M7 5l8 5-8 5z" /></svg>,
  percent: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M5 15L15 5" /><circle cx="6.5" cy="6.5" r="1.6" /><circle cx="13.5" cy="13.5" r="1.6" /></svg>,
  clock: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.8 1.8" /></svg>,
};

interface SummaryPeriod {
  period: string;
  total_count: number;
  completed_count: number;
  started_count: number;
  total_est_minutes: number;
  total_actual_minutes: number;
  total_meeting_minutes?: number; // 회의 참석 분 (신규 필드 — 구버전 응답 대비 optional)
  categories: Record<string, number>;
  categories_minutes?: Record<string, number>; // 카테고리→actual 분 합 (신규 필드)
}

interface SummaryResponse {
  period_type: string;
  user_id: number | null;
  periods: SummaryPeriod[];
}

interface CompletedLog {
  id: string;
  user_id: number;
  work_date: string;
  category: string | null;
  title: string;
  actual_minutes: number | null;
  status: string;
  completed_at: string | null;
}

interface Employee {
  id: number;
  name: string;
}

type PeriodTab = 'week' | 'month';
type Scope = 'mine' | 'all';

const TAB_LABELS: Record<PeriodTab, string> = {
  week: '이번 주',
  month: '이번 달',
};

const SCOPE_LABELS: Record<Scope, string> = {
  mine: '내 현황',
  all: '전체 현황',
};

function getDateRange(tab: PeriodTab): { start: string; end: string } {
  const today = kstToday();
  if (tab === 'week') {
    const day = new Date(`${today}T00:00:00`).getDay(); // 0=Sun (KST 자정 기준)
    const monday = kstDateString(new Date(Date.now() - ((day + 6) % 7) * 86400000));
    return { start: monday, end: today };
  }
  // month: KST 기준 이번 달 1일
  return { start: `${today.slice(0, 7)}-01`, end: today };
}

function listDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cur <= last) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function formatDayLabel(iso: string): string {
  const parts = iso.split('-');
  return `${parts[1]}/${parts[2]}`;
}

function formatMinutes(m: number | null): string {
  if (!m) return '—';
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

// RFC4180: 쉼표·따옴표·줄바꿈 포함 필드는 큰따옴표로 감싸고 내부 따옴표는 두 번
function csvField(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function WorkStatusPage() {
  const [user, setUser] = useState<User | null>(null);
  const [userReady, setUserReady] = useState(false);
  const [scope, setScope] = useState<Scope>('mine');
  const [activeTab, setActiveTab] = useState<PeriodTab>('week');
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [completedLogs, setCompletedLogs] = useState<CompletedLog[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catMode, setCatMode] = useState<'count' | 'time'>('count'); // 카테고리 분포: 건수/시간 토글

  useEffect(() => {
    setUser(getUser());
    setUserReady(true);
  }, []);

  const manager = isLeaderOrAbove(user);

  const fetchData = useCallback(async () => {
    if (!userReady) return;
    setLoading(true);
    setError('');
    const { start, end } = getDateRange(activeTab);
    try {
      const summaryParams = new URLSearchParams({
        period_type: 'daily',
        start_date: start,
        end_date: end,
      });
      const logParams = new URLSearchParams({
        status: 'completed',
        start_date: start,
        end_date: end,
      });
      if (manager && scope === 'mine' && user) {
        summaryParams.set('user_id', String(user.id));
        logParams.set('user_id', String(user.id));
      }

      const [summaryData, logs, employees] = await Promise.all([
        api.get<SummaryResponse>(`/api/work-logs/summary?${summaryParams}`),
        api.get<CompletedLog[]>(`/api/work-logs?${logParams}`),
        manager && scope === 'all'
          ? api.get<Employee[]>('/api/employees').catch(() => [] as Employee[])
          : Promise.resolve([] as Employee[]),
      ]);

      setSummary(summaryData);
      setCompletedLogs(logs);
      if (employees.length > 0) {
        const map: Record<number, string> = {};
        for (const e of employees) map[e.id] = e.name;
        setEmployeeNames(map);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`❌ 오류 — ${err.message}`);
      } else {
        setError('❌ 네트워크 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  }, [userReady, manager, scope, user, activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── 파생 데이터 ──────────────────────────────────────────────
  const periods = summary?.periods ?? [];

  const totals = periods.reduce(
    (acc, p) => ({
      total: acc.total + p.total_count,
      completed: acc.completed + p.completed_count,
      started: acc.started + p.started_count,
      meeting: acc.meeting + (p.total_meeting_minutes ?? 0),
    }),
    { total: 0, completed: 0, started: 0, meeting: 0 },
  );
  const completionRate =
    totals.total > 0 ? Math.round((totals.completed / totals.total) * 100) : 0;

  const { start: rangeStart, end: rangeEnd } = getDateRange(activeTab);
  const days = listDates(rangeStart, rangeEnd);
  const completedByDate: Record<string, number> = {};
  for (const p of periods) completedByDate[p.period] = p.completed_count;
  const maxCompleted = Math.max(0, ...days.map((d) => completedByDate[d] ?? 0));

  const categoryTotals: Record<string, number> = {};
  for (const p of periods) {
    for (const [cat, count] of Object.entries(p.categories)) {
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + count;
    }
  }
  const categoryEntries = Object.entries(categoryTotals).sort(([, a], [, b]) => b - a);
  const categorySum = categoryEntries.reduce((s, [, n]) => s + n, 0);

  // 카테고리별 시간(actual 분) 합 — categories_minutes (신규 필드)
  const categoryMinuteTotals: Record<string, number> = {};
  for (const p of periods) {
    for (const [cat, mins] of Object.entries(p.categories_minutes ?? {})) {
      categoryMinuteTotals[cat] = (categoryMinuteTotals[cat] ?? 0) + mins;
    }
  }
  const categoryMinuteEntries = Object.entries(categoryMinuteTotals).sort(([, a], [, b]) => b - a);
  const categoryMinuteSum = categoryMinuteEntries.reduce((s, [, n]) => s + n, 0);

  // CSV 내보내기 — 현재 스코프·기간의 periods (RFC4180)
  function exportCsv() {
    if (periods.length === 0) return;
    const catCols = Array.from(
      new Set(periods.flatMap((p) => Object.keys(p.categories_minutes ?? {}))),
    ).sort();
    const header = [
      '기간',
      '전체',
      '완료',
      '진행',
      '예상(분)',
      '실제(분)',
      '회의(분)',
      ...catCols.map((c) => `${c} 시간(분)`),
    ];
    const rows = periods.map((p) => [
      p.period,
      p.total_count,
      p.completed_count,
      p.started_count,
      p.total_est_minutes,
      p.total_actual_minutes,
      p.total_meeting_minutes ?? 0,
      ...catCols.map((c) => p.categories_minutes?.[c] ?? 0),
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM: Excel 한글 호환
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `work-status_${scope}_${rangeStart}_${rangeEnd}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const recentCompleted = [...completedLogs]
    .sort((a, b) =>
      (b.completed_at ?? b.work_date ?? '').localeCompare(a.completed_at ?? a.work_date ?? ''),
    )
    .slice(0, 10);

  const showAuthors = manager && scope === 'all';

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title="업무현황"
        subtitle="완료·진행·회의 시간을 기간별로 집계합니다"
        icon={ICON.chart}
        actions={
          <>
            <ToolbarButton onClick={exportCsv} disabled={loading || periods.length === 0} icon={ICON.download} title="현재 스코프·기간의 집계를 CSV로 다운로드">
              CSV 내보내기
            </ToolbarButton>
            <ToolbarButton onClick={fetchData} disabled={loading} icon={ICON.refresh}>
              새로고침
            </ToolbarButton>
          </>
        }
      />

      <div className="flex items-center gap-2.5 flex-wrap">
        {manager && (
          <Segmented
            value={scope}
            onChange={setScope}
            options={(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => ({ value: s, label: SCOPE_LABELS[s] }))}
          />
        )}
        <Segmented
          value={activeTab}
          onChange={setActiveTab}
          options={(Object.keys(TAB_LABELS) as PeriodTab[]).map((t) => ({ value: t, label: TAB_LABELS[t] }))}
        />
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchData} />}

      {loading ? (
        <LoadingState />
      ) : (
        <div className="flex-1 overflow-y-auto flex flex-col gap-5 pr-0.5">
          {/* 요약 카드 5개 */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
            <StatCard label="전체 업무" value={totals.total} accent="#B4C0D3" icon={ICON.list} />
            <StatCard label="완료" value={totals.completed} accent="#22C55E" icon={ICON.check} />
            <StatCard label="진행중" value={totals.started} accent="#38BDF8" icon={ICON.play} />
            <StatCard label="완료율" value={`${completionRate}%`} accent="#93A9FF" icon={ICON.percent} />
            <StatCard
              label="회의 시간"
              value={totals.meeting > 0 ? formatMinutes(totals.meeting) : '0m'}
              accent="#8B5CF6"
              icon={ICON.clock}
            />
          </div>

          {/* 일별 완료 추이 바 차트 */}
          <SectionCard title="일별 완료 추이" icon={ICON.trend}>
            {periods.length === 0 ? (
              <EmptyState icon="📈" title="기간 내 데이터가 없어요" hint="이 기간에 완료된 업무가 아직 없습니다." compact />
            ) : (
              <div className="flex items-end gap-1 sm:gap-2 pt-1">
                {days.map((d) => {
                  const count = completedByDate[d] ?? 0;
                  const barPct =
                    count > 0 && maxCompleted > 0
                      ? Math.max(Math.round((count / maxCompleted) * 90), 4)
                      : 0;
                  return (
                    <div key={d} className="flex-1 flex flex-col items-center min-w-0">
                      <div className="flex flex-col items-center justify-end h-32 w-full">
                        {count > 0 && (
                          <span className="text-[10px] text-text-muted leading-none mb-0.5">
                            {count}
                          </span>
                        )}
                        {count > 0 ? (
                          <div
                            className="w-full max-w-[28px] bg-primary rounded-t transition-all"
                            style={{ height: `${barPct}%` }}
                          />
                        ) : (
                          <div className="w-full max-w-[28px] h-0.5 bg-bg-surface-raised rounded" />
                        )}
                      </div>
                      <span className="mt-1 text-[10px] text-text-muted">{formatDayLabel(d)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* 카테고리 분포 — 건수/시간 이중 표시 (토글) */}
          <SectionCard
            title="카테고리 분포"
            icon={ICON.pie}
            action={
              <Segmented
                size="sm"
                value={catMode}
                onChange={setCatMode}
                options={[
                  { value: 'count', label: '건수' },
                  { value: 'time', label: '시간' },
                ]}
              />
            }
          >
            {catMode === 'count' ? (
              categoryEntries.length === 0 ? (
                <EmptyState icon="🗂️" title="기간 내 데이터가 없어요" compact />
              ) : (
                <div className="space-y-3">
                  {categoryEntries.map(([cat, count]) => {
                    const pct = categorySum > 0 ? Math.round((count / categorySum) * 100) : 0;
                    return <ProgressRow key={cat} label={cat} meta={`${count}건 · ${pct}%`} pct={pct} accent="#3B5BFE" />;
                  })}
                </div>
              )
            ) : categoryMinuteEntries.length === 0 ? (
              <EmptyState icon="🗂️" title="기간 내 시간 데이터가 없어요" compact />
            ) : (
              <div className="space-y-3">
                {categoryMinuteEntries.map(([cat, mins]) => {
                  const pct = categoryMinuteSum > 0 ? Math.round((mins / categoryMinuteSum) * 100) : 0;
                  return (
                    <ProgressRow
                      key={cat}
                      label={cat}
                      meta={`${mins > 0 ? formatMinutes(mins) : '0m'} · ${pct}%`}
                      pct={pct}
                      accent="#22C55E"
                    />
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* 최근 완료 업무 */}
          <SectionCard title="최근 완료 업무" icon={ICON.check} bodyClassName="px-4 py-1">
            {recentCompleted.length === 0 ? (
              <EmptyState icon="✅" title="완료된 업무가 없습니다" hint="업무를 완료하면 여기에 표시됩니다." compact />
            ) : (
              <div className="divide-y divide-border-subtle">
                {recentCompleted.map((log) => (
                  <div key={log.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-text-primary truncate">
                          {log.title}
                        </span>
                        {log.category && (
                          <span className="text-xs px-2 py-0.5 bg-bg-surface-raised text-text-secondary rounded">
                            {log.category}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
                        {showAuthors && (
                          <span className="text-text-muted">
                            {employeeNames[log.user_id] ?? `user ${log.user_id}`}
                          </span>
                        )}
                        <span>{log.work_date}</span>
                        <span>소요 {formatMinutes(log.actual_minutes)}</span>
                      </div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded font-medium bg-[rgba(34,197,94,0.16)] text-status-online flex-shrink-0">
                      완료
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
