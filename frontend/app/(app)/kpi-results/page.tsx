"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, KpiApi, KpiResult } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Modal } from "@/components/Modal";

const OBJ: Record<string, { label: string; cls: string }> = {
  none: { label: "이의 없음", cls: "bg-panel2 text-sub" },
  submitted: { label: "이의 접수(검토 대기)", cls: "bg-warn/20 text-warn" },
  reviewing: { label: "재검토 중", cls: "bg-brand/20 text-brand" },
  resolved: { label: "해결됨", cls: "bg-ok/20 text-ok" },
};

function aiText(draft: unknown): string {
  if (draft == null) return "";
  if (typeof draft === "string") return draft;
  if (typeof draft === "object") {
    const d = draft as Record<string, unknown>;
    const parts = [d.strength, d.improvement, d.note, d["강점"], d["개선"], d["근거"]].filter((x) => typeof x === "string");
    return parts.length ? parts.join("\n") : JSON.stringify(draft, null, 2);
  }
  return String(draft);
}

export default function MyKpiResultsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<KpiResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [target, setTarget] = useState<KpiResult | null>(null);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const d = await KpiApi.list({ user_id: String(user.id) });
      setRows(d.kpi_results);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="text-sub">불러오는 중…</div>;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">내 평가</h1>
        <p className="mt-1 text-sm text-sub">본인 KPI 결과 열람 · 이의신청은 평가 공개 후 7일 이내(D15)</p>
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {rows.length === 0 && <div className="card text-sub">아직 공개된 평가가 없습니다.</div>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const obj = OBJ[r.objection_status] ?? OBJ.none;
          const ai = aiText(r.ai_draft);
          const finalized = r.finalized_at != null;
          const detail = r.objection_detail as Record<string, unknown> | null;
          return (
            <article key={r.kpi_result_id} className="card space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium">{r.metric}</div>
                  <div className="text-xs text-sub">{r.period_type} · {r.period_key}</div>
                </div>
                <span className={`badge ${obj.cls}`}>{obj.label}</span>
              </div>
              <div className="flex items-baseline gap-3">
                <div><div className="text-xs text-sub">산출값</div><div className="text-lg font-semibold">{r.value.toFixed(1)}</div></div>
                {finalized && <div><div className="text-xs text-sub">확정</div><div className="text-lg font-semibold text-ok">{r.final_score?.toFixed(1) ?? "-"}</div></div>}
              </div>
              {ai && (
                <details className="rounded-md bg-bg/60 p-2">
                  <summary className="cursor-pointer text-xs text-sub">AI 서술 초안</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-ink">{ai}</pre>
                </details>
              )}
              {r.admin_note && <div className="text-xs text-sub">관리자 메모: {r.admin_note}</div>}
              {detail?.text != null && (
                <div className="rounded-md border border-warn/30 bg-warn/5 p-2 text-xs">
                  <span className="text-warn">내 이의:</span> {String(detail.text)} {detail.category ? `(${String(detail.category)})` : ""}
                </div>
              )}
              {r.objection_status === "none" && !finalized && (
                <button className="btn-ghost" onClick={() => setTarget(r)}>이의신청</button>
              )}
            </article>
          );
        })}
      </div>

      <ObjectionModal target={target} onClose={() => setTarget(null)} onDone={(m) => { setTarget(null); notify(m); load(); }} />
      {toast && <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>}
    </div>
  );
}

function ObjectionModal({ target, onClose, onDone }: { target: KpiResult | null; onClose: () => void; onDone: (m: string) => void }) {
  const [category, setCategory] = useState("점수");
  const [text, setText] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (target) { setCategory("점수"); setText(""); setEvidence(""); setErr(null); }
  }, [target]);

  async function submit() {
    if (!target) return;
    if (!text.trim()) { setErr("사유를 입력하세요."); return; }
    setBusy(true);
    setErr(null);
    try {
      await KpiApi.objection(target.kpi_result_id, category, text, evidence || undefined);
      onDone("이의신청이 접수되었습니다 (7일 검토 창 시작)");
    } catch (e) {
      setErr(e instanceof ApiError ? (e.status === 410 ? "이의신청 기간(7일)이 만료되었습니다." : e.status === 409 ? "이미 이의신청이 접수되었습니다." : e.detail) : "실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={target != null} title="KPI 이의신청" onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>취소</button>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? "제출 중…" : "제출"}</button>
      </>}>
      {target && (
        <>
          <p className="text-sm text-sub">{target.metric} · {target.period_key} · 산출값 {target.value.toFixed(1)}</p>
          <div className="space-y-1">
            <label className="text-sm text-sub">유형</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="점수">점수</option><option value="근거">근거</option><option value="기타">기타</option>
            </select>
          </div>
          <div className="space-y-1"><label className="text-sm text-sub">사유</label>
            <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm text-sub">증빙(선택)</label>
            <input className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)} /></div>
          {err && <div className="text-sm text-danger">{err}</div>}
        </>
      )}
    </Modal>
  );
}
