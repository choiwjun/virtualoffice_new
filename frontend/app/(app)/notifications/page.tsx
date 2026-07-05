"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, Notification, NotificationApi } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

const CATEGORY_LABEL: Record<string, string> = {
  sync_failure: "ERP 동기화 실패",
  kpi_push_failure: "KPI Push 실패",
  daily_push_failure: "일일리포트 Push 실패",
  general: "일반",
};

const SEV: Record<string, string> = {
  info: "bg-brand/20 text-brand",
  warning: "bg-warn/20 text-warn",
  error: "bg-danger/20 text-danger",
  critical: "bg-danger/30 text-danger",
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [rows, setRows] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
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
      const d = await NotificationApi.list(onlyUnread ? { unread: "true" } : undefined);
      setRows(d.items);
      setUnread(d.unread_total);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "알림 로딩 실패");
    } finally {
      setLoading(false);
    }
  }, [onlyUnread]);

  useEffect(() => {
    if (admin) load();
    else setLoading(false);
  }, [admin, load]);

  async function markRead(n: Notification) {
    try {
      await NotificationApi.markRead(n.notification_id);
      load();
    } catch (err) {
      notify(err instanceof ApiError ? err.detail : "실패");
    }
  }
  async function markAll() {
    try {
      const r = await NotificationApi.markAllRead();
      notify(`${r.marked}건 읽음 처리`);
      load();
    } catch (err) {
      notify(err instanceof ApiError ? err.detail : "실패");
    }
  }

  if (!admin) {
    return <div className="card text-sub">알림은 관리자 권한이 필요합니다. 현재 역할: {user?.role}</div>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            알림 {unread > 0 && <span className="badge bg-danger/20 text-danger align-middle">미읽음 {unread}</span>}
          </h1>
          <p className="mt-1 text-sm text-sub">ERP 동기화·KPI push 실패 알림 (관리자 콘솔 채널)</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm text-sub">
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
            미읽음만
          </label>
          <button className="btn-ghost" onClick={load}>새로고침</button>
          <button className="btn-ghost" onClick={markAll} disabled={unread === 0}>전체 읽음</button>
        </div>
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {loading && <div className="text-sub">불러오는 중…</div>}
      {!loading && rows.length === 0 && <div className="card text-ok">알림이 없습니다. 시스템 정상.</div>}

      <ul className="space-y-2">
        {rows.map((n) => (
          <li key={n.notification_id} className={`card flex items-start justify-between gap-3 ${n.is_read ? "opacity-60" : ""}`}>
            <div>
              <div className="flex items-center gap-2">
                <span className={`badge ${SEV[n.severity] ?? "bg-panel2 text-sub"}`}>{n.severity}</span>
                <span className="text-sm font-medium">{n.title}</span>
                <span className="text-xs text-sub">· {CATEGORY_LABEL[n.category] ?? n.category}</span>
              </div>
              {n.message && <div className="mt-1 text-sm text-sub">{n.message}</div>}
              <div className="mt-1 text-xs text-sub">{(n.created_at ?? "").replace("T", " ").slice(0, 19)}</div>
            </div>
            {!n.is_read && <button className="btn-ghost" onClick={() => markRead(n)}>읽음</button>}
          </li>
        ))}
      </ul>

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>}
    </div>
  );
}
