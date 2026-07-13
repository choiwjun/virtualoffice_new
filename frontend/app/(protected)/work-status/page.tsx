'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove, type User } from '@/lib/auth';
import { kstToday, kstDateString } from '@/lib/dates';

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
    }),
    { total: 0, completed: 0, started: 0 },
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

  const recentCompleted = [...completedLogs]
    .sort((a, b) =>
      (b.completed_at ?? b.work_date ?? '').localeCompare(a.completed_at ?? a.work_date ?? ''),
    )
    .slice(0, 10);

  const showAuthors = manager && scope === 'all';

  return (
    <div className="p-6 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">업무현황</h1>
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 text-gray-600"
        >
          🔄 새로고침
        </button>
      </div>

      {/* Scope toggle (관리자 전용) + Period tabs */}
      <div className="flex items-center gap-3 flex-wrap">
        {manager && (
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  scope === s
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                {SCOPE_LABELS[s]}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {(Object.keys(TAB_LABELS) as PeriodTab[]).map((tab) => (
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

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
          데이터를 불러오는 중...
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto flex flex-col gap-4">
          {/* 요약 카드 4개 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-2xl font-bold text-gray-800">{totals.total}</div>
              <div className="text-xs text-gray-500 mt-1">전체 업무</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-2xl font-bold text-green-600">{totals.completed}</div>
              <div className="text-xs text-gray-500 mt-1">완료</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-2xl font-bold text-blue-600">{totals.started}</div>
              <div className="text-xs text-gray-500 mt-1">진행중</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-2xl font-bold text-indigo-600">{completionRate}%</div>
              <div className="text-xs text-gray-500 mt-1">완료율</div>
            </div>
          </div>

          {/* 일별 완료 추이 바 차트 */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">일별 완료 추이</h2>
            {periods.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">기간 내 데이터 없음</div>
            ) : (
              <div className="flex items-end gap-1 sm:gap-2">
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
                          <span className="text-[10px] text-gray-500 leading-none mb-0.5">
                            {count}
                          </span>
                        )}
                        {count > 0 ? (
                          <div
                            className="w-full max-w-[28px] bg-indigo-500 rounded-t transition-all"
                            style={{ height: `${barPct}%` }}
                          />
                        ) : (
                          <div className="w-full max-w-[28px] h-0.5 bg-gray-200 rounded" />
                        )}
                      </div>
                      <span className="mt-1 text-[10px] text-gray-400">{formatDayLabel(d)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 카테고리 분포 */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">카테고리 분포</h2>
            {categoryEntries.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-400">기간 내 데이터 없음</div>
            ) : (
              <div className="space-y-3">
                {categoryEntries.map(([cat, count]) => {
                  const pct = categorySum > 0 ? Math.round((count / categorySum) * 100) : 0;
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium text-gray-600">{cat}</span>
                        <span className="text-gray-500">
                          {count}건 · {pct}%
                        </span>
                      </div>
                      <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 최근 완료 업무 */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">최근 완료 업무</h2>
            {recentCompleted.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-400">
                완료된 업무가 없습니다.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {recentCompleted.map((log) => (
                  <div key={log.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-800 truncate">
                          {log.title}
                        </span>
                        {log.category && (
                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                            {log.category}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                        {showAuthors && (
                          <span className="text-gray-500">
                            {employeeNames[log.user_id] ?? `user ${log.user_id}`}
                          </span>
                        )}
                        <span>{log.work_date}</span>
                        <span>소요 {formatMinutes(log.actual_minutes)}</span>
                      </div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded font-medium bg-green-100 text-green-700 flex-shrink-0">
                      완료
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
