"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  EmployeeApi,
  KpiApi,
  MeetingApi,
  NotificationApi,
  WorkLogApi,
  type Employee,
  type KpiResult,
  type Meeting,
  type Notification as Notif,
  type WorkLog,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** 시안형 통합 대시보드: 중앙 3D 오피스(Godot WASM 임베드) + 직원/일정/알림 + 업무·KPI·화상 */
export default function DashboardPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [worklogs, setWorklogs] = useState<WorkLog[]>([]);
  const [kpiPct, setKpiPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      // 각 소스 독립 로딩 — 하나가 실패해도 대시보드는 유지
      const settle = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
        try {
          return await p;
        } catch {
          return fallback;
        }
      };
      try {
        const [emp, work, meet, noti, kpi] = await Promise.all([
          settle(EmployeeApi.list(), { items: [] as Employee[], total: 0 }),
          settle(WorkLogApi.list(), { work_logs: [] as WorkLog[] }),
          settle(MeetingApi.list(), { meetings: [] as Meeting[] }),
          settle(NotificationApi.list(), { items: [] as Notif[], unread_total: 0 }),
          settle(
            KpiApi.list(user ? { user_id: String(user.id) } : undefined),
            { kpi_results: [] as KpiResult[], total: 0 },
          ),
        ]);
        setEmployees(emp.items ?? []);
        setWorklogs(work.work_logs ?? []);
        setMeetings(meet.meetings ?? []);
        setNotifs(noti.items ?? []);
        const scores = (kpi.kpi_results ?? [])
          .map((r) => r.final_score ?? r.value)
          .filter((v): v is number => v != null);
        if (scores.length) {
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          // 5점 척도면 100 환산, 이미 100점 척도면 그대로
          setKpiPct(Math.round(avg <= 5 ? (avg / 5) * 100 : Math.min(100, avg)));
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.detail : "대시보드 로딩 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const today = new Date().toISOString().slice(0, 10);
  const todayMeetings = useMemo(
    () =>
      meetings
        .filter((m) => (m.scheduled_at ?? "").slice(0, 10) === today && m.status !== "cancelled")
        .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "")),
    [meetings, today],
  );
  const openTasks = useMemo(() => worklogs.filter((w) => w.status !== "completed").slice(0, 6), [worklogs]);
  const activeEmp = useMemo(() => employees.filter((e) => e.is_active), [employees]);

  if (loading) return <div className="text-sub">불러오는 중…</div>;

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">가상오피스 · 1F</h1>
          <p className="mt-0.5 text-sm text-sub">
            {user?.name}님 · 재직 {activeEmp.length}명 · 오늘 일정 {todayMeetings.length}건
          </p>
        </div>
        <span className="badge bg-ok/15 text-ok">● LIVE</span>
      </header>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {/* 상단: 3D 오피스(2/3) + 우측 패널(1/3) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <OfficeEmbed />
        </div>
        <div className="space-y-4">
          <PeoplePanel employees={activeEmp} />
          <SchedulePanel meetings={todayMeetings} />
        </div>
      </div>

      {/* 하단: 업무 + KPI 링 + 화상 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <TasksPanel tasks={openTasks} total={worklogs.length} />
        <KpiPanel pct={kpiPct} />
        <NoticePanel notifs={notifs} />
      </div>
    </div>
  );
}

/** Godot WASM 3D 오피스 임베드(지연 로드 — 최초 진입 시 사용자 클릭으로 로드). */
function OfficeEmbed() {
  const [entered, setEntered] = useState(false);
  return (
    <div className="card relative flex aspect-video flex-col overflow-hidden p-0">
      <div className="absolute left-3 top-3 z-10 rounded-md bg-bg/70 px-2 py-1 text-xs backdrop-blur">
        <span className="font-semibold">가상오피스 3D</span> <span className="text-sub">· Godot 실시간</span>
      </div>
      {entered ? (
        <iframe
          src="/office/index.html"
          title="가상오피스 3D"
          className="h-full w-full border-0"
          allow="autoplay; fullscreen"
        />
      ) : (
        <button
          onClick={() => setEntered(true)}
          className="group flex h-full w-full flex-col items-center justify-center gap-3
            bg-gradient-to-br from-panel to-bg text-center transition-colors hover:from-panel2/60"
        >
          <div className="grid h-16 w-16 place-items-center rounded-full bg-brand/20 text-2xl text-brand
            transition-transform group-hover:scale-110">▶</div>
          <div className="text-sm font-medium">3D 오피스 입장</div>
          <div className="max-w-xs text-xs text-sub">
            데이터 기반 실시간 3D(Godot 엔진). 좌석·조직 배치가 바뀌면 그대로 반영됩니다.
          </div>
        </button>
      )}
    </div>
  );
}

function PeoplePanel({ employees }: { employees: Employee[] }) {
  return (
    <div className="card">
      <PanelHead title="재직 직원" count={employees.length} />
      <ul className="space-y-2">
        {employees.slice(0, 6).map((e) => (
          <li key={e.id} className="flex items-center gap-2 text-sm">
            <Avatar name={e.name} />
            <span className="flex-1 truncate">{e.name}</span>
            <span className="text-xs text-sub">{e.position ?? e.role}</span>
          </li>
        ))}
        {employees.length === 0 && <Empty>재직 직원 없음</Empty>}
      </ul>
    </div>
  );
}

function SchedulePanel({ meetings }: { meetings: Meeting[] }) {
  return (
    <div className="card">
      <PanelHead title="오늘 일정" count={meetings.length} />
      <ul className="space-y-2">
        {meetings.slice(0, 5).map((m) => (
          <li key={m.meeting_id} className="flex items-center gap-2 text-sm">
            <span className="w-11 shrink-0 text-xs tabular-nums text-brand">
              {(m.scheduled_at ?? "").slice(11, 16) || "—"}
            </span>
            <span className="flex-1 truncate">{m.title}</span>
            <StatusDot status={m.status} />
          </li>
        ))}
        {meetings.length === 0 && <Empty>오늘 예정된 회의 없음</Empty>}
      </ul>
    </div>
  );
}

function TasksPanel({ tasks, total }: { tasks: WorkLog[]; total: number }) {
  return (
    <div className="card">
      <PanelHead title="진행 업무" count={total} />
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.work_log_id ?? t.title} className="flex items-center gap-2 text-sm">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
            <span className="flex-1 truncate">{t.title}</span>
            <span className="text-xs text-sub">{t.status}</span>
          </li>
        ))}
        {tasks.length === 0 && <Empty>진행 중 업무 없음</Empty>}
      </ul>
    </div>
  );
}

function KpiPanel({ pct }: { pct: number | null }) {
  return (
    <div className="card flex flex-col items-center justify-center">
      <div className="mb-2 self-start text-sm font-medium">내 KPI</div>
      <Ring pct={pct ?? 0} />
      <div className="mt-2 text-xs text-sub">{pct != null ? "종합 평가 점수" : "평가 데이터 없음"}</div>
    </div>
  );
}

function NoticePanel({ notifs }: { notifs: Notif[] }) {
  const unread = notifs.filter((n) => !n.is_read).length;
  return (
    <div className="card">
      <PanelHead title="알림" count={unread} />
      <ul className="space-y-2">
        {notifs.slice(0, 5).map((n) => (
          <li key={n.notification_id} className="flex items-start gap-2 text-sm">
            <StatusDot status={n.severity} />
            <span className={`flex-1 truncate ${n.is_read ? "text-sub" : ""}`}>{n.title}</span>
          </li>
        ))}
        {notifs.length === 0 && <Empty>새 알림 없음</Empty>}
      </ul>
    </div>
  );
}

/* ---------- 소품 ---------- */
function PanelHead({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-medium">{title}</h2>
      <span className="badge bg-panel2/60 text-sub">{count}</span>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const ch = name?.trim()?.[0] ?? "?";
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/25 text-xs font-medium text-brand">
      {ch}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: "bg-brand",
    in_progress: "bg-ok",
    completed: "bg-sub",
    critical: "bg-danger",
    error: "bg-danger",
    warning: "bg-warn",
    info: "bg-brand",
  };
  return <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${map[status] ?? "bg-sub"}`} />;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="py-2 text-center text-xs text-sub">{children}</li>;
}

/** KPI 원형 게이지(시안의 87/100 링). */
function Ring({ pct }: { pct: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const tone = pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      {/* 링만 -90° 회전(12시 시작), 텍스트는 정방향 유지 */}
      <g transform="rotate(-90 60 60)">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#334155" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
        />
      </g>
      <text x="60" y="60" textAnchor="middle" dominantBaseline="central" fill="#e2e8f0" fontSize="28" fontWeight="700">
        {Math.round(pct)}
      </text>
      <text x="60" y="80" textAnchor="middle" fill="#94a3b8" fontSize="11">
        / 100
      </text>
    </svg>
  );
}
