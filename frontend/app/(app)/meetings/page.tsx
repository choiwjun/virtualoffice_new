"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, Meeting, MeetingApi } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "예정", cls: "bg-brand/20 text-brand" },
  in_progress: { label: "진행 중", cls: "bg-ok/20 text-ok" },
  completed: { label: "완료", cls: "bg-panel2 text-sub" },
  cancelled: { label: "취소됨", cls: "bg-danger/20 text-danger" },
};

function fmt(iso: string | null): string {
  if (!iso) return "-";
  return iso.replace("T", " ").slice(0, 16);
}

export default function MeetingsPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [rows, setRows] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await MeetingApi.list();
      setRows(d.meetings);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel(m: Meeting) {
    if (!window.confirm(`"${m.title}" 회의를 취소하시겠습니까?`)) return;
    try {
      await MeetingApi.cancel(m.meeting_id);
      notify("취소되었습니다");
      load();
    } catch (err) {
      notify(err instanceof ApiError ? `취소 실패: ${err.detail}` : "취소 실패");
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">회의</h1>
          <p className="mt-1 text-sm text-sub">회의 일정·상태 · 예약/입장은 3D 클라이언트 및 LiveKit 연동(Phase 5)</p>
        </div>
        <button className="btn-ghost" onClick={load}>
          새로고침
        </button>
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {loading && <div className="text-sub">불러오는 중…</div>}
      {!loading && rows.length === 0 && (
        <div className="card text-sub">
          예정된 회의가 없습니다. 회의 예약은 회의실(Room)이 필요하며, 회의실은 레이아웃 배포 후 3D 클라이언트/회의 흐름에서
          생성됩니다.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((m) => {
          const st = STATUS[m.status] ?? STATUS.scheduled;
          const canCancel = (admin || user?.id === m.host_user_id) && (m.status === "scheduled" || m.status === "in_progress");
          return (
            <article key={m.meeting_id} className="card space-y-2">
              <div className="flex items-start justify-between">
                <div className="font-medium">{m.title}</div>
                <span className={`badge ${st.cls}`}>{st.label}</span>
              </div>
              {m.description && <div className="text-sm text-sub">{m.description}</div>}
              <div className="text-xs text-sub">
                시작 {fmt(m.scheduled_at)} · 종료 {fmt(m.scheduled_end)}
              </div>
              <div className="text-xs text-sub">호스트 #{m.host_user_id}</div>
              <div className="flex gap-2 pt-1">
                <Link className="btn-ghost" href={`/meetings/${m.meeting_id}/minutes`}>
                  회의록
                </Link>
                {canCancel && (
                  <button className="btn-ghost text-danger" onClick={() => cancel(m)}>
                    취소
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>}
    </div>
  );
}
