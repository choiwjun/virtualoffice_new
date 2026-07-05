"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, KpiApi, KpiResult } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { Modal } from "@/components/Modal";

const OBJECTION_LABEL: Record<string, { label: string; cls: string }> = {
  none: { label: "이의 없음", cls: "bg-panel2 text-sub" },
  submitted: { label: "이의 접수", cls: "bg-warn/20 text-warn" },
  reviewing: { label: "재검토 중", cls: "bg-brand/20 text-brand" },
  resolved: { label: "해결됨", cls: "bg-ok/20 text-ok" },
};

function aiText(draft: unknown): string {
  if (draft == null) return "";
  if (typeof draft === "string") return draft;
  if (typeof draft === "object") {
    const d = draft as Record<string, unknown>;
    const parts = [d.summary, d.strengths, d.improvements, d.rationale, d.narrative].filter(
      (x) => typeof x === "string",
    );
    if (parts.length) return parts.join("\n");
    return JSON.stringify(draft, null, 2);
  }
  return String(draft);
}

export default function KpiReviewPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [rows, setRows] = useState<KpiResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 모달 상태
  const [adjustTarget, setAdjustTarget] = useState<KpiResult | null>(null);
  const [objectionTarget, setObjectionTarget] = useState<KpiResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await KpiApi.list();
      setRows(data.kpi_results);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<number, KpiResult[]>();
    for (const r of rows) {
      const arr = m.get(r.user_id) ?? [];
      arr.push(r);
      m.set(r.user_id, arr);
    }
    return Array.from(m.entries());
  }, [rows]);

  async function onConfirm(r: KpiResult) {
    if (!window.confirm(`user #${r.user_id} · ${r.metric} (${r.period_key}) 확정하시겠습니까?`)) return;
    try {
      await KpiApi.confirm(r.kpi_result_id);
      notify("확정되었습니다");
      load();
    } catch (err) {
      notify(err instanceof ApiError ? `확정 실패: ${err.detail}` : "확정 실패");
    }
  }

  if (loading) return <div className="text-sub">불러오는 중…</div>;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">KPI 검토</h1>
          <p className="mt-1 text-sm text-sub">
            결정론적 정량 점수 + AI 서술 초안(검토용). 총 {rows.length}건
            {admin ? " · 관리자 조정/확정 가능" : " · 본인 열람 및 이의신청"}
          </p>
        </div>
        <button className="btn-ghost" onClick={load}>
          새로고침
        </button>
      </header>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {grouped.length === 0 && <div className="card text-sub">표시할 KPI 결과가 없습니다.</div>}

      {grouped.map(([uid, items]) => (
        <section key={uid} className="space-y-2">
          <h2 className="text-sm font-medium text-sub">직원 #{uid}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((r) => {
              const obj = OBJECTION_LABEL[r.objection_status] ?? OBJECTION_LABEL.none;
              const finalized = r.finalized_at != null;
              const ai = aiText(r.ai_draft);
              const isOwner = user?.id === r.user_id;
              return (
                <article key={r.kpi_result_id} className="card space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-medium">{r.metric}</div>
                      <div className="text-xs text-sub">
                        {r.period_type} · {r.period_key}
                      </div>
                    </div>
                    <span className={`badge ${obj.cls}`}>{obj.label}</span>
                  </div>

                  <div className="flex items-baseline gap-3">
                    <div>
                      <div className="text-xs text-sub">산출값</div>
                      <div className="text-lg font-semibold">{r.value.toFixed(1)}</div>
                    </div>
                    {r.admin_adjusted_score != null && (
                      <div>
                        <div className="text-xs text-sub">조정</div>
                        <div className="text-lg font-semibold text-warn">
                          {r.admin_adjusted_score.toFixed(1)}
                        </div>
                      </div>
                    )}
                    {finalized && (
                      <div>
                        <div className="text-xs text-sub">확정</div>
                        <div className="text-lg font-semibold text-ok">
                          {r.final_score?.toFixed(1) ?? "-"}
                        </div>
                      </div>
                    )}
                  </div>

                  {ai && (
                    <details className="rounded-md bg-bg/60 p-2">
                      <summary className="cursor-pointer text-xs text-sub">AI 서술 초안</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-ink">{ai}</pre>
                    </details>
                  )}
                  {r.admin_note && (
                    <div className="text-xs text-sub">
                      <span className="text-sub">조정 사유:</span> {r.admin_note}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {admin && (
                      <>
                        <button
                          className="btn-ghost"
                          disabled={finalized}
                          onClick={() => setAdjustTarget(r)}
                        >
                          조정
                        </button>
                        <button className="btn" disabled={finalized} onClick={() => onConfirm(r)}>
                          {finalized ? "확정됨" : "확정"}
                        </button>
                      </>
                    )}
                    {isOwner && !finalized && r.objection_status === "none" && (
                      <button className="btn-ghost" onClick={() => setObjectionTarget(r)}>
                        이의신청
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <AdjustModal
        target={adjustTarget}
        onClose={() => setAdjustTarget(null)}
        onDone={(msg) => {
          setAdjustTarget(null);
          notify(msg);
          load();
        }}
      />
      <ObjectionModal
        target={objectionTarget}
        onClose={() => setObjectionTarget(null)}
        onDone={(msg) => {
          setObjectionTarget(null);
          notify(msg);
          load();
        }}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function AdjustModal({
  target,
  onClose,
  onDone,
}: {
  target: KpiResult | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [score, setScore] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setScore(target.admin_adjusted_score ?? target.value);
      setNote(target.admin_note ?? "");
      setErr(null);
    }
  }, [target]);

  async function submit() {
    if (!target) return;
    setBusy(true);
    setErr(null);
    try {
      await KpiApi.adjust(target.kpi_result_id, score, note || undefined);
      onDone("점수가 조정되었습니다");
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : "조정 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={target != null}
      title="KPI 점수 조정"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      {target && (
        <>
          <p className="text-sm text-sub">
            {target.metric} · {target.period_key} · 산출값 {target.value.toFixed(1)}
          </p>
          <div className="space-y-1">
            <label className="text-sm text-sub">조정 점수: {score.toFixed(1)}</label>
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              className="w-full"
            />
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              className="input"
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-sub">조정 사유(선택)</label>
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {err && <div className="text-sm text-danger">{err}</div>}
        </>
      )}
    </Modal>
  );
}

function ObjectionModal({
  target,
  onClose,
  onDone,
}: {
  target: KpiResult | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [category, setCategory] = useState("점수");
  const [text, setText] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setCategory("점수");
      setText("");
      setEvidence("");
      setErr(null);
    }
  }, [target]);

  async function submit() {
    if (!target) return;
    if (!text.trim()) {
      setErr("이의 사유를 입력하세요.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await KpiApi.objection(target.kpi_result_id, category, text, evidence || undefined);
      onDone("이의신청이 접수되었습니다 (7일 검토 창)");
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? e.status === 410
            ? "이의신청 기간(7일)이 만료되었습니다."
            : e.detail
          : "이의신청 실패",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={target != null}
      title="KPI 이의신청"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? "제출 중…" : "제출"}
          </button>
        </>
      }
    >
      {target && (
        <>
          <p className="text-sm text-sub">
            {target.metric} · {target.period_key} · 산출값 {target.value.toFixed(1)}
          </p>
          <div className="space-y-1">
            <label className="text-sm text-sub">유형</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="점수">점수</option>
              <option value="근거">근거</option>
              <option value="기타">기타</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm text-sub">사유</label>
            <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-sub">증빙(선택)</label>
            <input className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </div>
          {err && <div className="text-sm text-danger">{err}</div>}
        </>
      )}
    </Modal>
  );
}
