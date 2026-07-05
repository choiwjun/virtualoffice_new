"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, AuditApi, AuditLog } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

const ACTION_LABEL: Record<string, string> = {
  seat_assigned: "좌석 배정",
  seat_unassigned: "좌석 해제",
  meeting_created: "회의 생성",
  meeting_cancelled: "회의 취소",
  kpi_adjusted: "KPI 조정",
  kpi_finalized: "KPI 확정",
  kpi_objection_submitted: "이의신청 접수",
  office_layout_deployed: "레이아웃 배포",
  erp_user_soft_deleted: "직원 비활성",
};

function icon(action: string): string {
  if (action.startsWith("seat")) return "🪑";
  if (action.startsWith("meeting")) return "📅";
  if (action.startsWith("kpi")) return "📊";
  if (action.includes("layout")) return "🗺️";
  return "•";
}

export default function ActivityFeedPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await AuditApi.list({ limit: "50" });
      setRows(d.logs);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "활동 로딩 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (admin) load();
    else setLoading(false);
  }, [admin, load]);

  if (!admin) {
    return <div className="card text-sub">활동 피드(감사 로그 기반)는 관리자 권한이 필요합니다. 현재 역할: {user?.role}</div>;
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">활동 피드</h1>
          <p className="mt-1 text-sm text-sub">주요 운영 활동 스트림 (감사 로그 기반, 최근 50건)</p>
        </div>
        <button className="btn-ghost" onClick={load}>새로고침</button>
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {loading && <div className="text-sub">불러오는 중…</div>}
      {!loading && rows.length === 0 && <div className="card text-sub">아직 기록된 활동이 없습니다.</div>}

      <ol className="space-y-2">
        {rows.map((a) => (
          <li key={a.id} className="card flex items-start gap-3 py-3">
            <div className="text-lg">{icon(a.action)}</div>
            <div className="flex-1">
              <div className="text-sm">
                <span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span>
                {a.user_id != null && <span className="text-sub"> · 사용자 #{a.user_id}</span>}
                <span className="text-sub"> · {a.resource_type}</span>
              </div>
              <div className="text-xs text-sub">{a.timestamp.replace("T", " ").slice(0, 19)}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
