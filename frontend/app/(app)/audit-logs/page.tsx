"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, AuditApi, AuditLog } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

const PAGE = 30;

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

export default function AuditLogsPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const [days, setDays] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { limit: String(PAGE), offset: String(offset) };
      if (action) params.action = action;
      if (days) params.days = days;
      const d = await AuditApi.list(params);
      setRows(d.logs);
      setTotal(d.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "감사 로그 로딩 실패");
    } finally {
      setLoading(false);
    }
  }, [offset, action, days]);

  useEffect(() => {
    if (admin) load();
    else setLoading(false);
  }, [admin, load]);

  if (!admin) {
    return <div className="card text-sub">감사 로그는 관리자 권한이 필요합니다. 현재 역할: {user?.role}</div>;
  }

  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">감사 로그</h1>
          <p className="mt-1 text-sm text-sub">주요 변경 이력 (좌석·회의·KPI·배포·이의신청) · 보존 5년(D20-e) · 총 {total}건</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-40" value={action} onChange={(e) => { setOffset(0); setAction(e.target.value); }}>
            <option value="">전체 액션</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input w-32" value={days} onChange={(e) => { setOffset(0); setDays(e.target.value); }}>
            <option value="">전체 기간</option>
            <option value="7">최근 7일</option>
            <option value="30">최근 30일</option>
            <option value="90">최근 90일</option>
          </select>
        </div>
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-panel2 text-left text-xs text-sub">
            <tr>
              <th className="px-4 py-2">시각</th>
              <th className="px-4 py-2">액션</th>
              <th className="px-4 py-2">행위자</th>
              <th className="px-4 py-2">리소스</th>
              <th className="px-4 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-sub">불러오는 중…</td></tr>}
            {!loading && rows.map((a) => (
              <tr key={a.id} className="border-b border-panel2/50">
                <td className="px-4 py-2 text-sub">{a.timestamp.replace("T", " ").slice(0, 19)}</td>
                <td className="px-4 py-2">{ACTION_LABEL[a.action] ?? a.action}</td>
                <td className="px-4 py-2 text-sub">{a.user_id != null ? `#${a.user_id}` : "system"}</td>
                <td className="px-4 py-2 text-sub">{a.resource_type} · {a.resource_id.slice(0, 8)}…</td>
                <td className="px-4 py-2 text-sub">{a.ip_address ?? "-"}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sub">기록이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-sub">
        <span>{page} / {pages} 페이지</span>
        <div className="flex gap-2">
          <button className="btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>이전</button>
          <button className="btn-ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>다음</button>
        </div>
      </div>
    </div>
  );
}
