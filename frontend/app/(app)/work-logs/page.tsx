"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, WorkLog, WorkLogApi, WorkLogInput } from "@/lib/api";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  started: { label: "진행", cls: "bg-warn/20 text-warn" },
  completed: { label: "완료", cls: "bg-ok/20 text-ok" },
};

const EMPTY: WorkLogInput = { title: "", goal: "", result: "", result_url: "", next_action: "", category: "", status: "started" };

export default function WorkLogsPage() {
  const [rows, setRows] = useState<WorkLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState<WorkLogInput>({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await WorkLogApi.list();
      setRows(d.work_logs);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function reset() {
    setForm({ ...EMPTY });
    setEditing(null);
  }

  async function submit() {
    if (!form.title.trim()) {
      notify("제목을 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await WorkLogApi.update(editing, form);
        notify("수정되었습니다");
      } else {
        await WorkLogApi.create(form);
        notify("업무기록이 저장되었습니다");
      }
      reset();
      load();
    } catch (err) {
      notify(err instanceof ApiError ? `저장 실패: ${err.detail}` : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(w: WorkLog) {
    setEditing(w.work_log_id);
    setForm({
      title: w.title,
      goal: w.goal ?? "",
      result: w.result ?? "",
      result_url: w.result_url ?? "",
      next_action: w.next_action ?? "",
      category: w.category ?? "",
      status: w.status,
    });
  }

  async function remove(id: string) {
    if (!window.confirm("이 업무기록을 삭제하시겠습니까?")) return;
    try {
      await WorkLogApi.remove(id);
      notify("삭제되었습니다");
      if (editing === id) reset();
      load();
    } catch (err) {
      notify(err instanceof ApiError ? `삭제 실패: ${err.detail}` : "삭제 실패");
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">업무기록</h1>
        <p className="mt-1 text-sm text-sub">본인 업무 기록 작성·조회 (KPI 업무충실도 신호원)</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        {/* 작성 폼 */}
        <div className="card space-y-3">
          <h2 className="text-sm font-medium">{editing ? "업무기록 수정" : "새 업무기록"}</h2>
          <input className="input" placeholder="제목 *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className="input" rows={2} placeholder="목표(goal)" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
          <textarea className="input" rows={2} placeholder="결과(result)" value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} />
          <input className="input" placeholder="결과 링크(result_url)" value={form.result_url} onChange={(e) => setForm({ ...form, result_url: e.target.value })} />
          <input className="input" placeholder="다음 액션(next_action)" value={form.next_action} onChange={(e) => setForm({ ...form, next_action: e.target.value })} />
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="카테고리" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <select className="input w-32" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="started">진행</option>
              <option value="completed">완료</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button className="btn flex-1" onClick={submit} disabled={busy}>
              {editing ? "수정 저장" : "작성"}
            </button>
            {editing && (
              <button className="btn-ghost" onClick={reset} disabled={busy}>
                취소
              </button>
            )}
          </div>
        </div>

        {/* 목록 */}
        <div className="space-y-3">
          {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
          {loading && <div className="text-sub">불러오는 중…</div>}
          {!loading && rows.length === 0 && <div className="card text-sub">작성한 업무기록이 없습니다.</div>}
          {rows.map((w) => {
            const st = STATUS_LABEL[w.status] ?? STATUS_LABEL.started;
            return (
              <article key={w.work_log_id} className="card space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">{w.title}</div>
                    <div className="text-xs text-sub">
                      {w.work_date ?? "-"} {w.category ? `· ${w.category}` : ""}
                    </div>
                  </div>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                </div>
                {w.goal && <div className="text-sm text-sub">목표: {w.goal}</div>}
                {w.result && <div className="text-sm">결과: {w.result}</div>}
                {w.result_url && (
                  <a href={w.result_url} target="_blank" rel="noreferrer" className="text-xs text-brand underline">
                    {w.result_url}
                  </a>
                )}
                <div className="flex gap-2 pt-1">
                  <button className="btn-ghost" onClick={() => startEdit(w)}>
                    수정
                  </button>
                  <button className="btn-ghost text-danger" onClick={() => remove(w.work_log_id)}>
                    삭제
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>
      )}
    </div>
  );
}
