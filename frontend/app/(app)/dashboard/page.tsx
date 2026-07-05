"use client";

import { useEffect, useState } from "react";
import { ApiError, KpiApi, MeetingApi, WorkLogApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Stats {
  kpiAvg: number | null;
  kpiCount: number;
  workTotal: number;
  workCompleted: number;
  meetingsUpcoming: number;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [kpi, work, meetings] = await Promise.all([
          KpiApi.list(user ? { user_id: String(user.id) } : undefined),
          WorkLogApi.list(),
          MeetingApi.list(),
        ]);
        const scores = kpi.kpi_results.map((r) => r.final_score ?? r.value).filter((v) => v != null);
        const kpiAvg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        setStats({
          kpiAvg,
          kpiCount: kpi.kpi_results.length,
          workTotal: work.work_logs.length,
          workCompleted: work.work_logs.filter((w) => w.status === "completed").length,
          meetingsUpcoming: meetings.meetings.filter((m) => m.status === "scheduled").length,
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.detail : "대시보드 로딩 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (loading) return <div className="text-sub">불러오는 중…</div>;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">대시보드</h1>
        <p className="mt-1 text-sm text-sub">{user?.name}님 · 개인 KPI·업무·회의 요약</p>
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card label="내 KPI 평균" value={stats.kpiAvg != null ? stats.kpiAvg.toFixed(1) : "-"} sub={`${stats.kpiCount}개 지표`} tone="brand" />
          <Card label="업무기록" value={String(stats.workTotal)} sub={`완료 ${stats.workCompleted}`} tone="ok" />
          <Card
            label="업무 완료율"
            value={stats.workTotal ? `${Math.round((stats.workCompleted / stats.workTotal) * 100)}%` : "-"}
            sub="완료/전체"
            tone="warn"
          />
          <Card label="예정 회의" value={String(stats.meetingsUpcoming)} sub="scheduled" tone="brand" />
        </div>
      )}

      <div className="card">
        <h2 className="mb-2 text-sm font-medium">바로가기</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <a className="btn-ghost" href="/work-logs">업무기록 작성</a>
          <a className="btn-ghost" href="/kpi-results">내 평가 열람</a>
          <a className="btn-ghost" href="/meetings">회의</a>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  const toneCls: Record<string, string> = { brand: "text-brand", ok: "text-ok", warn: "text-warn" };
  return (
    <div className="card">
      <div className="text-xs text-sub">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${toneCls[tone] ?? ""}`}>{value}</div>
      <div className="mt-1 text-xs text-sub">{sub}</div>
    </div>
  );
}
