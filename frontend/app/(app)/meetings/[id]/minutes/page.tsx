"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, MeetingMinute, MinuteApi } from "@/lib/api";

export default function MeetingMinutesPage() {
  const params = useParams<{ id: string }>();
  const meetingId = params.id;
  const router = useRouter();

  const [minute, setMinute] = useState<MeetingMinute | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [decisions, setDecisions] = useState("");
  const [sttDraft, setSttDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await MinuteApi.get(meetingId);
      setMinute(m);
      setTitle(m.title ?? "");
      setContent(m.summary ?? "");
      setDecisions(m.decisions ?? "");
    } catch (err) {
      // 회의록이 아직 없음(404) → 신규 작성 모드
      if (err instanceof ApiError && err.status === 404) {
        setMinute(null);
      } else {
        setError(err instanceof ApiError ? err.detail : "회의록 로딩 실패");
      }
    }
    // STT 초안(있으면) 표시
    try {
      const s = await MinuteApi.sttDraft(meetingId);
      setSttDraft(s.stt_draft);
    } catch {
      setSttDraft(null);
    }
    setLoading(false);
  }, [meetingId]);

  useEffect(() => {
    load();
  }, [load]);

  const finalized = minute?.status === "finalized";

  async function save() {
    setBusy(true);
    try {
      const decisionList = decisions.split("\n").map((s) => s.trim()).filter(Boolean);
      const updated = await MinuteApi.update(meetingId, { title, content, decisions: decisionList });
      setMinute(updated);
      notify("회의록이 저장되었습니다");
    } catch (err) {
      notify(err instanceof ApiError ? (err.status === 403 ? "수정 권한이 없습니다(호스트/참석자/관리자)" : err.status === 409 ? "확정된 회의록은 수정할 수 없습니다" : err.detail) : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!window.confirm("회의록을 확정하시겠습니까? 확정 후에는 수정할 수 없습니다.")) return;
    setBusy(true);
    try {
      const c = await MinuteApi.confirm(meetingId);
      setMinute(c);
      notify("회의록이 확정되었습니다");
    } catch (err) {
      notify(err instanceof ApiError ? (err.status === 403 ? "확정 권한이 없습니다(호스트/관리자)" : err.detail) : "확정 실패");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-sub">불러오는 중…</div>;

  return (
    <div className="max-w-3xl space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <button className="text-sm text-sub hover:text-ink" onClick={() => router.push("/meetings")}>← 회의 목록</button>
          <h1 className="mt-1 text-xl font-semibold">회의록</h1>
          <p className="text-sm text-sub">
            상태: {finalized ? <span className="text-ok">확정</span> : <span className="text-warn">초안</span>} · 회의 {meetingId.slice(0, 8)}…
          </p>
        </div>
        {!finalized && <button className="btn" onClick={confirm} disabled={busy}>확정</button>}
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      {sttDraft && (
        <div className="card">
          <h2 className="mb-2 text-sm font-medium">STT 자동 초안</h2>
          <pre className="whitespace-pre-wrap break-words text-xs text-sub">{sttDraft}</pre>
        </div>
      )}

      <div className="card space-y-3">
        <div className="space-y-1">
          <label className="text-sm text-sub">제목</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={finalized} />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-sub">본문/요약</label>
          <textarea className="input" rows={6} value={content} onChange={(e) => setContent(e.target.value)} disabled={finalized} />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-sub">결정사항 (줄당 1개)</label>
          <textarea className="input" rows={4} value={decisions} onChange={(e) => setDecisions(e.target.value)} disabled={finalized} />
        </div>
        {minute?.action_items_summary && (
          <div className="space-y-1">
            <label className="text-sm text-sub">액션아이템</label>
            <pre className="whitespace-pre-wrap rounded-md bg-bg/60 p-2 text-xs">{minute.action_items_summary}</pre>
          </div>
        )}
        {!finalized && (
          <button className="btn" onClick={save} disabled={busy}>{busy ? "저장 중…" : minute ? "저장" : "회의록 작성"}</button>
        )}
      </div>

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>}
    </div>
  );
}
