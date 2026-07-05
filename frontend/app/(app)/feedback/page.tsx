"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, Feedback, FeedbackApi } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

const TYPE_LABEL: Record<string, string> = { bug: "버그", feature: "기능제안", general: "일반" };
const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "접수", cls: "bg-warn/20 text-warn" },
  reviewing: { label: "검토중", cls: "bg-brand/20 text-brand" },
  resolved: { label: "완료", cls: "bg-ok/20 text-ok" },
};

export default function FeedbackPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [rows, setRows] = useState<Feedback[]>([]);
  const [type, setType] = useState("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async () => {
    if (!admin) return;
    try {
      const d = await FeedbackApi.list();
      setRows(d.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "목록 로딩 실패");
    }
  }, [admin]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!title.trim()) { notify("제목을 입력하세요."); return; }
    setBusy(true);
    try {
      await FeedbackApi.create({ type, title, description: description || undefined });
      notify("피드백이 제출되었습니다. 감사합니다!");
      setTitle("");
      setDescription("");
      load();
    } catch (err) {
      notify(err instanceof ApiError ? `제출 실패: ${err.detail}` : "제출 실패");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(f: Feedback, status: string) {
    try {
      await FeedbackApi.updateStatus(f.feedback_id, status);
      notify("상태가 변경되었습니다");
      load();
    } catch (err) {
      notify(err instanceof ApiError ? `변경 실패: ${err.detail}` : "변경 실패");
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">피드백</h1>
        <p className="mt-1 text-sm text-sub">도그푸딩 버그·기능 제안 (주 1회 리뷰). {admin ? "관리자: 접수 목록 검토" : ""}</p>
      </header>

      <div className={admin ? "grid gap-5 lg:grid-cols-[360px_1fr]" : "max-w-lg"}>
        <div className="card space-y-3">
          <h2 className="text-sm font-medium">새 피드백</h2>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="bug">버그</option>
            <option value="feature">기능제안</option>
            <option value="general">일반</option>
          </select>
          <input className="input" placeholder="제목 *" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" rows={4} placeholder="상세 설명" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button className="btn w-full" onClick={submit} disabled={busy}>{busy ? "제출 중…" : "제출"}</button>
        </div>

        {admin && (
          <div className="space-y-3">
            {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
            {rows.length === 0 && <div className="card text-sub">접수된 피드백이 없습니다.</div>}
            {rows.map((f) => {
              const st = STATUS[f.status] ?? STATUS.open;
              return (
                <article key={f.feedback_id} className="card space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{f.title}</div>
                      <div className="text-xs text-sub">{TYPE_LABEL[f.type] ?? f.type} · 제출 #{f.user_id ?? "-"} · {(f.created_at ?? "").replace("T", " ").slice(0, 16)}</div>
                    </div>
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                  </div>
                  {f.description && <div className="text-sm text-sub">{f.description}</div>}
                  <div className="flex gap-2">
                    {["open", "reviewing", "resolved"].filter((s) => s !== f.status).map((s) => (
                      <button key={s} className="btn-ghost" onClick={() => setStatus(f, s)}>→ {STATUS[s].label}</button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>}
    </div>
  );
}
