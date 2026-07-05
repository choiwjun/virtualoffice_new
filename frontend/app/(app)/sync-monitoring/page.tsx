"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, SyncApi, SyncError, SyncStatus } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

const STATUS_CLS: Record<string, string> = {
  success: "bg-ok/20 text-ok",
  running: "bg-warn/20 text-warn",
  failed: "bg-danger/20 text-danger",
};

export default function SyncMonitoringPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [errors, setErrors] = useState<SyncError[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const loadErrors = useCallback(async () => {
    try {
      const d = await SyncApi.errors(10);
      setErrors(d.errors);
    } catch {
      /* 무시 */
    }
  }, []);

  useEffect(() => {
    if (admin) loadErrors();
  }, [admin, loadErrors]);

  async function trigger() {
    setBusy(true);
    try {
      const r = await SyncApi.trigger();
      setJobId(r.sync_job_id);
      notify(`동기화 트리거됨 (job ${r.sync_job_id.slice(0, 8)}…)`);
      await refreshStatus(r.sync_job_id);
      loadErrors();
    } catch (err) {
      notify(err instanceof ApiError ? `트리거 실패: ${err.detail}` : "트리거 실패");
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus(id: string) {
    try {
      const s = await SyncApi.status(id);
      setStatus(s);
    } catch (err) {
      notify(err instanceof ApiError ? `상태 조회 실패: ${err.detail}` : "상태 조회 실패");
    }
  }

  if (!admin) {
    return <div className="card text-sub">ERP 동기화 모니터링은 관리자 권한이 필요합니다. 현재 역할: {user?.role}</div>;
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">ERP 동기화 모니터링</h1>
          <p className="mt-1 text-sm text-sub">ERP read-only 동기화 수동 트리거 · 상태 · 실패 이력 (D18)</p>
        </div>
        <button className="btn" onClick={trigger} disabled={busy}>
          {busy ? "실행 중…" : "지금 동기화"}
        </button>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">최근 트리거 상태</h2>
            {jobId && (
              <button className="btn-ghost" onClick={() => refreshStatus(jobId)}>
                상태 갱신
              </button>
            )}
          </div>
          {!status && <p className="text-xs text-sub">[지금 동기화]를 눌러 트리거하세요.</p>}
          {status && (
            <>
              <div className="flex items-center gap-2">
                <span className={`badge ${STATUS_CLS[status.status] ?? "bg-panel2 text-sub"}`}>{status.status}</span>
                {jobId && <span className="text-xs text-sub">job {jobId.slice(0, 8)}…</span>}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="생성" v={status.created_count} />
                <Stat label="갱신" v={status.updated_count} />
                <Stat label="비활성" v={status.deactivated_count} />
                <Stat label="에러" v={status.error_count} danger={status.error_count > 0} />
              </dl>
              <div className="text-xs text-sub">동기화 시각: {status.synced_at ?? "-"}</div>
            </>
          )}
        </div>

        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">실패 이력</h2>
            <button className="btn-ghost" onClick={loadErrors}>
              새로고침
            </button>
          </div>
          {errors.length === 0 && <p className="text-xs text-ok">최근 실패 이력이 없습니다.</p>}
          <ul className="space-y-2">
            {errors.map((e) => (
              <li key={e.sync_job_id} className="rounded-md border border-danger/30 bg-danger/5 p-2 text-xs">
                <div className="text-danger">{e.error_message ?? "(메시지 없음)"}</div>
                <div className="mt-1 text-sub">
                  job {e.sync_job_id.slice(0, 8)}… · {e.attempted_at.replace("T", " ").slice(0, 19)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>}
    </div>
  );
}

function Stat({ label, v, danger }: { label: string; v: number; danger?: boolean }) {
  return (
    <div className="rounded-md bg-bg/60 px-3 py-2">
      <div className="text-xs text-sub">{label}</div>
      <div className={`text-lg font-semibold ${danger ? "text-danger" : ""}`}>{v}</div>
    </div>
  );
}
