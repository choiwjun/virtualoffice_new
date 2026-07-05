"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  ApiError,
  LayoutApi,
  LayoutFurniture,
  LayoutJson,
  LayoutSeat,
  OfficeLayout,
  ValidationIssue,
  ValidationResult,
} from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

// Konva 는 window/canvas 의존 → SSR 비활성 동적 로드.
const LayoutCanvas = dynamic(() => import("@/components/editor/LayoutCanvas"), {
  ssr: false,
  loading: () => <div className="grid h-[520px] w-[720px] place-items-center text-sub">캔버스 로딩…</div>,
});

const SEAT_TYPES = ["fixed", "free", "temp", "partner"];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function issueList(result: ValidationResult): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const all = result.issues ?? [];
  const errors = [
    ...(result.errors ?? []),
    ...all.filter((i) => (i.severity ?? "").toLowerCase() === "error"),
  ];
  const warnings = [
    ...(result.warnings ?? []),
    ...all.filter((i) => (i.severity ?? "").toLowerCase() === "warning"),
  ];
  return { errors, warnings };
}

function findFurniture(d: LayoutJson, furnitureId: string | undefined): LayoutFurniture | undefined {
  if (!furnitureId) return undefined;
  return (d.furniture ?? []).find((f) => f.furniture_id === furnitureId);
}

export default function SeatEditorPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);

  const [layouts, setLayouts] = useState<OfficeLayout[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LayoutJson | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const activeLayout = useMemo(
    () => layouts.find((l) => l.layout_id === activeId) ?? null,
    [layouts, activeId],
  );
  const isDraftStatus = (activeLayout?.status ?? "").toLowerCase() === "draft";

  function selectLayout(l: OfficeLayout) {
    setActiveId(l.layout_id);
    setDraft(clone(l.json ?? l.layout_json ?? { dimensions: { width_m: 20, height_m: 15 }, seats: [], furniture: [] }));
    setSelected(null);
    setDirty(false);
    setValidation(null);
  }

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { layouts } = await LayoutApi.list();
      setLayouts(layouts);
      if (layouts.length) {
        const deployed = layouts.find((l) => l.status.toLowerCase() === "deployed");
        selectLayout(deployed ?? layouts[0]);
      } else {
        setActiveId(null);
        setDraft(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "레이아웃 목록 로딩 실패");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateDraft(mut: (d: LayoutJson) => void) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = clone(prev);
      mut(next);
      return next;
    });
    setDirty(true);
    setValidation(null);
  }

  // 좌석 이동 → 좌석 coords + 연결 가구 coords 동시 갱신(SEAT_FURNITURE_DESYNC 방지).
  function moveSeat(index: number, x: number, y: number) {
    updateDraft((d) => {
      const seat = d.seats?.[index];
      if (!seat) return;
      seat.coords = { x, y };
      const furn = findFurniture(d, seat.furniture_id);
      if (furn) furn.coords = { x, y };
    });
  }

  function addSeat() {
    updateDraft((d) => {
      d.seats = d.seats ?? [];
      d.furniture = d.furniture ?? [];
      const n = d.seats.length + 1;
      const dim = d.dimensions ?? {};
      const cx = ((dim.min_x ?? 0) + (dim.max_x ?? dim.width_m ?? 20)) / 2;
      const cy = ((dim.min_y ?? 0) + (dim.max_y ?? dim.height_m ?? 15)) / 2;
      const seatId = `S_NEW${n}`;
      const furnId = `F_NEW${n}`;
      // 가구 원형: 기존 가구 클론(필수 필드 보존) 또는 기본 desk.
      const base = d.furniture[0];
      const furn: LayoutFurniture = base
        ? { ...clone(base), furniture_id: furnId, coords: { x: cx, y: cy } }
        : {
            furniture_id: furnId,
            asset_id: "desk-v1",
            type: "desk",
            coords: { x: cx, y: cy },
            dimension: { width: 1.4, depth: 0.8, height: 0.75 },
            collision: true,
          };
      d.furniture.push(furn);
      d.seats.push({ seat_id: seatId, seat_type: "fixed", coords: { x: cx, y: cy }, facing: 180, furniture_id: furnId });
    });
    setSelected(draft?.seats?.length ?? 0);
  }

  function deleteSeat(index: number) {
    updateDraft((d) => {
      const seat = d.seats?.[index];
      if (!seat) return;
      const fid = seat.furniture_id;
      d.seats?.splice(index, 1);
      if (fid && d.furniture) {
        const fi = d.furniture.findIndex((f) => f.furniture_id === fid);
        if (fi >= 0) d.furniture.splice(fi, 1);
      }
    });
    setSelected(null);
  }

  function updateSeat(index: number, patch: Partial<LayoutSeat>) {
    updateDraft((d) => {
      const seat = d.seats?.[index];
      if (!seat) return;
      Object.assign(seat, patch);
      if (patch.coords) {
        const furn = findFurniture(d, seat.furniture_id);
        if (furn) furn.coords = { ...patch.coords };
      }
    });
  }

  async function onValidate(): Promise<ValidationResult | null> {
    if (!draft) return null;
    setBusy(true);
    try {
      const result = await LayoutApi.validate(draft);
      setValidation(result);
      return result;
    } catch (err) {
      notify(err instanceof ApiError ? `검증 실패: ${err.detail}` : "검증 실패");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(): Promise<string | null> {
    if (!draft || !activeLayout) return null;
    setBusy(true);
    try {
      if (isDraftStatus) {
        const updated = await LayoutApi.update(activeLayout.layout_id, draft);
        await loadList();
        setActiveId(updated.layout_id);
        setDirty(false);
        notify("draft 저장됨");
        return updated.layout_id;
      }
      const created = await LayoutApi.create(activeLayout.office_id, activeLayout.floor_id, draft, "웹 편집기 draft");
      await loadList();
      setActiveId(created.layout_id);
      setDirty(false);
      notify(`새 draft v${created.version} 생성됨`);
      return created.layout_id;
    } catch (err) {
      notify(err instanceof ApiError ? `저장 실패: ${err.detail}` : "저장 실패");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onDeploy() {
    // D12: ERROR 0건일 때만 배포. 저장 안 된 변경은 먼저 저장.
    const result = await onValidate();
    if (!result || !result.is_deployable) {
      notify("검증 ERROR가 있어 배포할 수 없습니다 (D12).");
      return;
    }
    let targetId = activeLayout?.layout_id ?? null;
    if (dirty || !isDraftStatus) {
      targetId = await saveDraft();
    }
    if (!targetId) return;
    if (!window.confirm("이 레이아웃을 배포하시겠습니까? 기존 배포본은 archived 됩니다.")) return;
    setBusy(true);
    try {
      await LayoutApi.deploy(targetId);
      notify("배포되었습니다");
      await loadList();
    } catch (err) {
      notify(err instanceof ApiError ? `배포 실패: ${err.detail}` : "배포 실패");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-sub">불러오는 중…</div>;

  if (!admin) {
    return (
      <div className="card text-sub">
        좌석·배치 편집은 관리자 권한이 필요합니다. 현재 역할: {user?.role}
      </div>
    );
  }

  const seatCount = draft?.seats?.length ?? 0;
  const { errors, warnings } = validation ? issueList(validation) : { errors: [], warnings: [] };
  const deployable = validation?.is_deployable === true || validation?.deployable === true;
  const selSeat = selected != null ? draft?.seats?.[selected] : undefined;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">좌석·배치 편집기</h1>
          <p className="mt-1 text-sm text-sub">
            2D 평면(미터) 드래그 편집 · 서버 정밀 검증(D12) 통과 시에만 배포 · 좌석 {seatCount}개
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto"
            value={activeId ?? ""}
            onChange={(e) => {
              const l = layouts.find((x) => x.layout_id === e.target.value);
              if (l) selectLayout(l);
            }}
          >
            {layouts.map((l) => (
              <option key={l.layout_id} value={l.layout_id}>
                v{l.version} · {l.status}
              </option>
            ))}
          </select>
          <button className="btn-ghost" onClick={addSeat}>
            + 좌석
          </button>
          <button className="btn-ghost" onClick={onValidate} disabled={busy || !draft}>
            검증
          </button>
          <button className="btn-ghost" onClick={saveDraft} disabled={busy || !dirty}>
            draft 저장
          </button>
          <button className="btn" onClick={onDeploy} disabled={busy}>
            배포
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {layouts.length === 0 && (
        <div className="card text-sub">
          편집할 레이아웃이 없습니다. office/floor 및 초기 레이아웃은 백엔드(office/floor API·시드)에서 먼저
          생성해야 합니다.
        </div>
      )}

      {draft && (
        <div className="flex flex-wrap gap-4">
          <div className="shrink-0">
            <LayoutCanvas
              layout={draft}
              selectedIndex={selected}
              onSelect={setSelected}
              onMoveSeat={moveSeat}
            />
            <div className="mt-2 flex gap-3 text-xs text-sub">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-ok" />fixed</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: "#38bdf8" }} />free</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-warn" />temp</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: "#a78bfa" }} />partner</span>
            </div>
          </div>

          <div className="w-72 shrink-0 space-y-4">
            <div className="card space-y-3">
              <h2 className="text-sm font-medium">좌석 속성</h2>
              {selSeat && selected != null ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-sub">좌석 ID</label>
                    <input
                      className="input"
                      value={selSeat.seat_id}
                      onChange={(e) => updateSeat(selected, { seat_id: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-sub">타입</label>
                    <select
                      className="input"
                      value={selSeat.seat_type}
                      onChange={(e) => updateSeat(selected, { seat_type: e.target.value })}
                    >
                      {SEAT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-sub">x (m)</label>
                      <input
                        type="number"
                        step={0.5}
                        className="input"
                        value={selSeat.coords.x}
                        onChange={(e) => updateSeat(selected, { coords: { x: Number(e.target.value), y: selSeat.coords.y } })}
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-sub">y (m)</label>
                      <input
                        type="number"
                        step={0.5}
                        className="input"
                        value={selSeat.coords.y}
                        onChange={(e) => updateSeat(selected, { coords: { x: selSeat.coords.x, y: Number(e.target.value) } })}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-sub">가구 {selSeat.furniture_id} 와 좌표 동기화됨</p>
                  <button className="btn-ghost w-full text-danger" onClick={() => deleteSeat(selected)}>
                    좌석 삭제
                  </button>
                </>
              ) : (
                <p className="text-xs text-sub">캔버스에서 좌석을 클릭해 선택하세요.</p>
              )}
            </div>

            <div className="card space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">검증 결과</h2>
                {validation && (
                  <span className={`badge ${deployable ? "bg-ok/20 text-ok" : "bg-danger/20 text-danger"}`}>
                    {deployable ? "배포 가능" : "배포 불가"}
                  </span>
                )}
              </div>
              {!validation && <p className="text-xs text-sub">[검증]을 눌러 서버 정밀 검증을 실행하세요.</p>}
              {validation && errors.length === 0 && warnings.length === 0 && (
                <p className="text-xs text-ok">문제 없음 — 배포 가능합니다.</p>
              )}
              {errors.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-danger">ERROR {errors.length} (배포 차단)</div>
                  <ul className="mt-1 space-y-1">
                    {errors.map((e, i) => (
                      <li key={i} className="text-xs text-danger">
                        · {e.message ?? e.code ?? JSON.stringify(e)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-warn">WARNING {warnings.length} (무시 가능)</div>
                  <ul className="mt-1 space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i} className="text-xs text-warn">
                        · {w.message ?? w.code ?? JSON.stringify(w)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
