'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import type { SeatBox, ShapeBox, Selection } from '@/components/office/SeatCanvas';
import { buildOfficeLayout, DEFAULT_PX_PER_METER } from '@/lib/officeLayout';
import {
  PageHeader,
  ToolbarButton,
  SectionCard,
  EmptyState,
  LoadingState,
} from '@/components/ui/console';

const ICON = {
  grid: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M3 8h14M3 13h14M8 3v14M13 3v14" /></svg>,
  seat: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M6 4v6h8V4" /><path d="M5 10h10l-1 6M6 16l-1-6" /></svg>,
  save: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M4 4h9l3 3v9H4z" /><path d="M7 4v4h6" /><path d="M7 16v-4h6v4" /></svg>,
  refresh: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M15.5 6.5A6 6 0 1 0 16 10" /><path d="M15.5 3v4h-4" /></svg>,
  info: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="10" cy="10" r="7" /><path d="M10 9v4M10 6.5h.01" /></svg>,
  layers: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M10 3l7 3.5-7 3.5-7-3.5z" /><path d="M3 10l7 3.5 7-3.5M3 13.5L10 17l7-3.5" /></svg>,
  versions: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="6" cy="6" r="2" /><circle cx="6" cy="14" r="2" /><circle cx="14" cy="10" r="2" /><path d="M6 8v4M8 6h2a2 2 0 0 1 2 2M8 14h2a2 2 0 0 0 2-2" /></svg>,
  lock: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="4.5" y="9" width="11" height="7" rx="1.5" /><path d="M7 9V7a3 3 0 0 1 6 0v2" /></svg>,
};

// 좌석 테이블 coords 정본 = 미터(top_left, D25) — seed_seats·뷰포트·buildOfficeLayout 공통.
// 편집기 내부(SeatBox/pending)는 캔버스 픽셀이므로 seat 테이블 경계에서 픽셀↔미터 변환한다.
// (변환 누락 시: 드래그한 좌석이 픽셀 좌표로 저장돼 뷰포트 metersToNorm에서 플레이트 밖으로
//  컬링되어 가상사무실에 안 나타남 — 2026-07-17 수리.)
const PX_PER_M = DEFAULT_PX_PER_METER;
const mToPx = (m: number) => m * PX_PER_M;
const pxToM = (px: number) => Math.round((px / PX_PER_M) * 1000) / 1000;

const SeatCanvas = dynamic(() => import('@/components/office/SeatCanvas'), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-text-muted text-sm">캔버스 로딩...</div>,
});

interface ApiSeat {
  id: string;
  floor_id: string;
  type: string;
  status: string;
  assigned_user_id: number | null;
  seat_number: string | null;
  coords: Record<string, unknown>;
}
interface Floor {
  id: string;
  office_id: string;
  level: number;
  name: string | null;
}
interface LayoutRow {
  id: string;
  version: number;
  status: string;
  deployed_at: string | null;
}

function toBox(s: ApiSeat, i: number): SeatBox {
  const c = s.coords || {};
  // seat 테이블은 미터 → 편집기 캔버스 픽셀로 변환. 좌표 없으면 격자 폴백(픽셀).
  const x = typeof c.x === 'number' ? mToPx(c.x) : 40 + (i % 6) * 130;
  const y = typeof c.y === 'number' ? mToPx(c.y) : 40 + Math.floor(i / 6) * 90;
  return { id: s.id, label: s.seat_number || `좌석 ${i + 1}`, x, y, status: s.status, type: s.type };
}

export default function OfficeLayoutPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const [seats, setSeats] = useState<SeatBox[]>([]);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [floorName, setFloorName] = useState<string | null>(null);
  const [floorLevel, setFloorLevel] = useState<number | null>(null);
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [layouts, setLayouts] = useState<LayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [size, setSize] = useState({ w: 800, h: 520 });
  const wrapRef = useRef<HTMLDivElement>(null);

  // ── 저장 대기(pending) 버퍼 — 좌석 변경은 즉시 API 호출하지 않고 [모두 저장]에서 순차 적용 ──
  const [pendingMoves, setPendingMoves] = useState<Record<string, { x: number; y: number }>>({});
  const [pendingCreates, setPendingCreates] = useState<
    { tempId: string; seat_number: string; coords: { x: number; y: number } }[]
  >([]);
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const pendingCount =
    Object.keys(pendingMoves).length + pendingCreates.length + pendingDeletes.length;

  // 편집 요소 (방/구역/벽) + 선택 + undo/redo 히스토리
  const [rooms, setRooms] = useState<ShapeBox[]>([]);
  const [zones, setZones] = useState<ShapeBox[]>([]);
  const [walls, setWalls] = useState<ShapeBox[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [history, setHistory] = useState<{ rooms: ShapeBox[]; zones: ShapeBox[]; walls: ShapeBox[] }[]>([
    { rooms: [], zones: [], walls: [] },
  ]);
  const [histIdx, setHistIdx] = useState(0);

  const commit = (next: { rooms: ShapeBox[]; zones: ShapeBox[]; walls: ShapeBox[] }) => {
    setRooms(next.rooms);
    setZones(next.zones);
    setWalls(next.walls);
    const trimmed = history.slice(0, histIdx + 1);
    const nh = [...trimmed, next];
    setHistory(nh);
    setHistIdx(nh.length - 1);
  };
  const applyHist = (idx: number) => {
    const s = history[idx];
    setRooms(s.rooms);
    setZones(s.zones);
    setWalls(s.walls);
    setSelected(null);
  };
  const undo = () => { if (histIdx > 0) { const n = histIdx - 1; setHistIdx(n); applyHist(n); } };
  const redo = () => { if (histIdx < history.length - 1) { const n = histIdx + 1; setHistIdx(n); applyHist(n); } };

  let _sid = 0;
  const nid = () => `${Date.now()}-${_sid++}`;
  const addRoom = () => commit({ rooms: [...rooms, { id: nid(), x: 60 + rooms.length * 30, y: 60 + rooms.length * 30, w: 180, h: 140, label: `회의실 ${rooms.length + 1}` }], zones, walls });
  const addZone = () => commit({ rooms, zones: [...zones, { id: nid(), x: 80 + zones.length * 30, y: 80 + zones.length * 30, w: 220, h: 130, label: `구역 ${zones.length + 1}`, color: '#3498db' }], walls });
  const addWall = () => commit({ rooms, zones, walls: [...walls, { id: nid(), x: 40, y: 40 + walls.length * 30, w: 20, h: 220, label: '' }] });
  const moveShape = (kind: 'room' | 'zone' | 'wall', id: string, x: number, y: number) => {
    const upd = (arr: ShapeBox[]) => arr.map((s) => (s.id === id ? { ...s, x, y } : s));
    commit({ rooms: kind === 'room' ? upd(rooms) : rooms, zones: kind === 'zone' ? upd(zones) : zones, walls: kind === 'wall' ? upd(walls) : walls });
  };
  const deleteSelected = () => {
    if (!selected || selected.kind === 'seat') return;
    const rm = (arr: ShapeBox[]) => arr.filter((s) => s.id !== selected.id);
    commit({ rooms: selected.kind === 'room' ? rm(rooms) : rooms, zones: selected.kind === 'zone' ? rm(zones) : zones, walls: selected.kind === 'wall' ? rm(walls) : walls });
    setSelected(null);
  };
  const relabelSelected = (label: string) => {
    if (!selected || selected.kind === 'seat') return;
    const up = (arr: ShapeBox[]) => arr.map((s) => (s.id === selected.id ? { ...s, label } : s));
    setRooms(selected.kind === 'room' ? up(rooms) : rooms);
    setZones(selected.kind === 'zone' ? up(zones) : zones);
    setWalls(selected.kind === 'wall' ? up(walls) : walls);
  };
  const selectedShape = (): ShapeBox | null => {
    if (!selected || selected.kind === 'seat') return null;
    const arr = selected.kind === 'room' ? rooms : selected.kind === 'zone' ? zones : walls;
    return arr.find((s) => s.id === selected.id) ?? null;
  };

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const [floors, apiSeats, lays] = await Promise.all([
        api.get<Floor[]>('/api/floors').catch(() => [] as Floor[]),
        api.get<ApiSeat[]>('/api/seats'),
        api.get<LayoutRow[]>('/api/office-layouts').catch(() => [] as LayoutRow[]),
      ]);
      setFloorId(floors[0]?.id ?? null);
      setFloorName(floors[0]?.name ?? null);
      setFloorLevel(floors[0]?.level ?? null);
      setOfficeId(floors[0]?.office_id ?? null);
      setLayouts(lays);
      setSeats(apiSeats.filter((s) => s.status !== 'disabled').map(toBox));
      // 재로드 시 저장 대기 버퍼 초기화 (서버 상태와 동기화)
      setPendingMoves({});
      setPendingCreates([]);
      setPendingDeletes([]);
    } catch (e) {
      setError(e instanceof ApiError ? `조회 실패 (${e.status})` : '서버 연결 오류');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  // 레이아웃 버전 목록만 갱신 (좌석/pending 버퍼 유지)
  const refreshLayouts = useCallback(async () => {
    try {
      setLayouts(await api.get<LayoutRow[]>('/api/office-layouts'));
    } catch {
      /* 목록 갱신 실패는 무시 (기존 목록 유지) */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: Math.max(320, el.clientWidth - 2), h: Math.max(360, el.clientHeight - 2) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  // 드래그 종료 → 로컬 반영 + 저장 대기 버퍼 (같은 좌석은 마지막 좌표만 유지)
  const move = useCallback((id: string, x: number, y: number) => {
    setSeats((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s)));
    if (id.startsWith('temp-')) {
      // 아직 저장 전인 신규 좌석 → 생성 버퍼의 좌표만 갱신
      setPendingCreates((prev) => prev.map((c) => (c.tempId === id ? { ...c, coords: { x, y } } : c)));
    } else {
      setPendingMoves((prev) => ({ ...prev, [id]: { x, y } }));
    }
  }, []);

  // 좌석 생성 — 로컬 임시 좌석 추가 (저장 대기)
  const addSeat = () => {
    if (!floorId) { flash('층(floor) 데이터가 없어 생성할 수 없습니다.'); return; }
    const n = seats.length + 1;
    const coords = { x: 40 + ((n - 1) % 6) * 130, y: 40 + Math.floor((n - 1) / 6) * 90 };
    const seatNumber = `A-${String(n).padStart(2, '0')}`;
    const tempId = `temp-${Date.now()}-${n}`;
    setSeats((prev) => [...prev, { id: tempId, label: seatNumber, x: coords.x, y: coords.y, status: 'available', type: 'free' }]);
    setPendingCreates((prev) => [...prev, { tempId, seat_number: seatNumber, coords }]);
    flash('좌석 추가됨 (저장 대기)');
  };

  // 좌석 삭제 — 더블클릭. 임시 좌석은 버퍼에서 제거, 기존 좌석은 삭제 대기
  const removeSeat = (id: string) => {
    if (!window.confirm('이 좌석을 비활성화(삭제)하시겠습니까? [모두 저장] 시 반영됩니다.')) return;
    setSeats((prev) => prev.filter((s) => s.id !== id));
    if (id.startsWith('temp-')) {
      setPendingCreates((prev) => prev.filter((c) => c.tempId !== id));
    } else {
      setPendingDeletes((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setPendingMoves((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    flash('좌석 삭제 (저장 대기)');
  };

  // [모두 저장] — 삭제 → 이동 → 생성 순으로 순차 API 적용. 실패 시 중단, 남은 변경은 버퍼에 유지
  const saveAll = async () => {
    if (saving || pendingCount === 0) return;
    setSaving(true);
    try {
      for (const id of pendingDeletes) {
        await api.delete(`/api/seats/${id}`);
        setPendingDeletes((prev) => prev.filter((x) => x !== id));
      }
      for (const [id, coords] of Object.entries(pendingMoves)) {
        // 편집기 픽셀 → seat 테이블 미터(D25)
        await api.put(`/api/seats/${id}`, { coords: { x: pxToM(coords.x), y: pxToM(coords.y) } });
        setPendingMoves((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
      for (const c of pendingCreates) {
        const created = await api.post<ApiSeat>('/api/seats', {
          floor_id: floorId,
          type: 'free',
          coords: { x: pxToM(c.coords.x), y: pxToM(c.coords.y) },
          seat_number: c.seat_number,
        });
        setSeats((prev) => prev.map((s, i) => (s.id === c.tempId ? toBox(created, i) : s)));
        setPendingCreates((prev) => prev.filter((x) => x.tempId !== c.tempId));
      }
      flash('모든 변경 저장 완료');
    } catch (e) {
      flash(e instanceof ApiError ? `저장 실패: ${e.message} — 남은 변경은 유지됩니다` : '저장 중 오류 — 남은 변경은 유지됩니다');
    } finally {
      setSaving(false);
    }
  };

  // [변경 취소] — 저장 대기 변경을 버리고 서버 상태로 재로드
  const discardChanges = () => {
    if (!window.confirm(`저장되지 않은 변경 ${pendingCount}건을 취소하고 다시 불러올까요?`)) return;
    load();
  };

  // ── 오피스 레이아웃 버전 (D12) ──
  const createDraft = async () => {
    if (!officeId || !floorId) { flash('office/floor 없음'); return; }
    if (pendingCount > 0) { flash('저장되지 않은 변경이 있습니다. [모두 저장] 후 초안을 생성하세요.'); return; }
    try {

      const json = buildOfficeLayout({
        officeId,
        floorId,
        floorName: floorName ?? undefined,
        floorLevel: floorLevel ?? undefined,
        seats: seats.map((s) => ({ id: s.id, x: s.x, y: s.y, type: s.type })),
        rooms: rooms.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, name: r.label })),
        zones: zones.map((z) => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h, label: z.label, color: z.color })),
        walls: walls.map((w) => ({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h })),
        createdBy: me?.id ?? 0,
      });
      await api.post('/api/office-layouts', { office_id: officeId, floor_id: floorId, json });
      flash('스키마-유효 레이아웃 초안 생성됨 · 검증하세요');
      refreshLayouts();
    } catch (e) {
      flash(e instanceof ApiError ? `초안 생성 실패 (${e.status})` : '오류');
    }
  };

  const validateLayout = async (id: string) => {
    try {
      const res = await api.post<{ status: string; error_count: number; warning_count: number }>(`/api/office-layouts/${id}/validate`, {});
      flash(`검증: ${res.status} (오류 ${res.error_count} / 경고 ${res.warning_count})`);
      refreshLayouts();
    } catch (e) {
      flash(e instanceof ApiError ? `검증 실패 (${e.status})` : '오류');
    }
  };

  const deployLayout = async (id: string) => {
    try {
      await api.post(`/api/office-layouts/${id}/deploy`, {});
      flash('배포 완료');
      refreshLayouts();
    } catch (e) {
      flash(e instanceof ApiError ? (e.status === 409 ? '검증(validated) 후에만 배포 가능 (D12)' : `배포 실패 (${e.status})`) : '오류');
    }
  };

  // 롤백 — 백엔드 계약: POST /{deployed_id}/rollback → 현재 deployed는 archived,
  // 직전 archived(최고 버전)가 deployed로 복원됨. 버튼은 복원 대상(최신 archived) 행에 노출.
  const rollbackLayout = async (targetVersion: number) => {
    const deployed = layouts.find((l) => l.status === 'deployed');
    if (!deployed) { flash('배포된 버전이 없어 롤백할 수 없습니다.'); return; }
    if (!window.confirm(`v${targetVersion}(으)로 롤백하시겠습니까?\n현재 배포본 v${deployed.version}은 보관(archived) 처리됩니다.`)) return;
    try {
      const restored = await api.post<LayoutRow>(`/api/office-layouts/${deployed.id}/rollback`, {});
      flash(`롤백 완료 — v${restored.version} 재배포됨`);
      refreshLayouts();
    } catch (e) {
      flash(e instanceof ApiError ? `롤백 실패: ${e.message}` : '오류');
    }
  };

  if (!allowed) {
    return (
      <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
        <PageHeader title="좌석 배치 편집기" icon={ICON.grid} />
        <SectionCard>
          <EmptyState icon={ICON.lock} title="관리자 전용 화면" hint="좌석 배치 편집은 관리자만 접근할 수 있습니다." />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title="좌석 배치 편집기"
        subtitle={`2D 평면도 (D11) · 드래그=이동 · 더블클릭=삭제 · 좌석 ${seats.length}개${floorId ? '' : ' · 층 없음'}`}
        icon={ICON.grid}
        actions={
          <>
            {pendingCount > 0 && (
              <>
                <span className="text-xs px-2 py-1 bg-[rgba(245,158,11,0.16)] border border-[rgba(245,158,11,0.4)] text-status-external rounded-md whitespace-nowrap">
                  저장되지 않은 변경 {pendingCount}건
                </span>
                <ToolbarButton variant="primary" onClick={saveAll} disabled={saving} icon={ICON.save}>
                  {saving ? '저장 중...' : '모두 저장'}
                </ToolbarButton>
                <ToolbarButton onClick={discardChanges} disabled={saving}>
                  변경 취소
                </ToolbarButton>
              </>
            )}
            <ToolbarButton variant="primary" onClick={addSeat} disabled={!floorId} icon={ICON.seat}>+ 좌석</ToolbarButton>
            <ToolbarButton onClick={addRoom}>+ 방</ToolbarButton>
            <ToolbarButton onClick={addZone}>+ 구역</ToolbarButton>
            <ToolbarButton onClick={addWall}>+ 벽</ToolbarButton>
            <ToolbarButton onClick={undo} disabled={histIdx === 0} title="실행취소">↶</ToolbarButton>
            <ToolbarButton onClick={redo} disabled={histIdx >= history.length - 1} title="다시실행">↷</ToolbarButton>
            <ToolbarButton
              onClick={() => {
                if (pendingCount > 0 && !window.confirm(`저장되지 않은 변경 ${pendingCount}건이 사라집니다. 새로고침할까요?`)) return;
                load();
              }}
              icon={ICON.refresh}
            >새로고침</ToolbarButton>
          </>
        }
      />
      {pendingCount > 0 && (
        <p className="text-xs text-status-external -mt-2">저장 전 페이지를 벗어나면 변경이 사라집니다.</p>
      )}
      {toast && <div className="px-3 py-2 bg-[rgba(34,197,94,0.16)] border border-[rgba(34,197,94,0.4)] rounded-md text-xs text-status-online">{toast}</div>}
      <div className="flex-1 min-h-0 flex gap-3">
        <div ref={wrapRef} className="flex-1 min-h-0 border border-border-subtle rounded-2xl overflow-hidden bg-bg-surface relative">
          {loading ? (
            <LoadingState label="불러오는 중…" />
          ) : error ? (
            <div className="h-full flex items-center justify-center text-red-300 text-sm">{error}</div>
          ) : (
            <>
              {seats.length + rooms.length + zones.length + walls.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 text-text-muted text-sm">
                  좌석/방/구역/벽 도구로 배치를 시작하세요.
                </div>
              )}
              <SeatCanvas
                seats={seats}
                rooms={rooms}
                zones={zones}
                walls={walls}
                width={size.w}
                height={size.h}
                onMove={move}
                onDelete={removeSeat}
                onMoveShape={moveShape}
                onSelect={setSelected}
                selected={selected}
              />
            </>
          )}
        </div>
        {/* 속성 + 레이어 패널 */}
        <div className="w-60 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
          <SectionCard title="속성" icon={ICON.info} bodyClassName="p-3">
            {(() => {
              const sh = selectedShape();
              if (!selected) return <p className="text-xs text-text-muted">요소를 선택하세요.</p>;
              if (selected.kind === 'seat') return <p className="text-xs text-text-muted">좌석 선택됨 (더블클릭=삭제)</p>;
              if (!sh) return <p className="text-xs text-text-muted">—</p>;
              return (
                <div className="space-y-2">
                  <div className="text-xs text-text-muted">{selected.kind === 'room' ? '방' : selected.kind === 'zone' ? '구역' : '벽'}</div>
                  <input value={sh.label ?? ''} onChange={(e) => relabelSelected(e.target.value)} placeholder="이름" className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan" />
                  <div className="text-[11px] text-text-muted">위치 {sh.x},{sh.y} · 크기 {sh.w}×{sh.h}</div>
                  <button onClick={deleteSelected} className="w-full px-2 py-1 text-xs border border-[rgba(239,68,68,0.35)] text-red-300 rounded hover:bg-[rgba(239,68,68,0.12)]">삭제</button>
                </div>
              );
            })()}
          </SectionCard>
          <SectionCard
            title={`레이어 · 좌석 ${seats.length} / 방 ${rooms.length} / 구역 ${zones.length} / 벽 ${walls.length}`}
            icon={ICON.layers}
            bodyClassName="p-3"
          >
            <ul className="space-y-1 text-xs">
              {zones.map((z) => (
                <li key={z.id} className={`flex items-center gap-1 cursor-pointer ${selected?.id === z.id ? 'text-accent-cyan font-medium' : 'text-text-secondary'}`} onClick={() => setSelected({ kind: 'zone', id: z.id })}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: z.color ?? '#3498db' }} />{z.label}
                </li>
              ))}
              {rooms.map((r) => (
                <li key={r.id} className={`flex items-center gap-1 cursor-pointer ${selected?.id === r.id ? 'text-accent-cyan font-medium' : 'text-text-secondary'}`} onClick={() => setSelected({ kind: 'room', id: r.id })}>
                  <span className="w-2 h-2 rounded-sm bg-status-focus" />{r.label}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>
      {/* 오피스 레이아웃 버전 (D12 검증·배포) */}
      <SectionCard
        title={`레이아웃 버전 (D12) · ${layouts.length}개`}
        icon={ICON.versions}
        className="flex-shrink-0 max-h-52 overflow-y-auto"
        bodyClassName="p-3"
        action={
          <ToolbarButton onClick={createDraft} disabled={!officeId}>
            현재 배치로 초안 생성
          </ToolbarButton>
        }
      >
        {layouts.length === 0 ? (
          <EmptyState
            icon={ICON.versions}
            title="레이아웃 버전이 없습니다."
            hint="초안을 생성해 검증→배포하세요. (검증 ERROR 0건일 때만 배포 — D12)"
            compact
          />
        ) : (
          <table className="w-full text-xs">
            <thead className="text-text-muted"><tr><th className="text-left py-1">버전</th><th className="text-left py-1">상태</th><th className="text-right py-1">액션</th></tr></thead>
            <tbody className="divide-y divide-border-subtle">
              {(() => {
                // 롤백 계약(백엔드): deployed → archived, 직전 archived(최고 버전) → deployed 복원
                const hasDeployed = layouts.some((l) => l.status === 'deployed');
                const archived = layouts.filter((l) => l.status === 'archived');
                const rollbackTargetId =
                  hasDeployed && archived.length > 0
                    ? archived.reduce((a, b) => (a.version >= b.version ? a : b)).id
                    : null;
                return layouts.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5 text-text-secondary">v{l.version}</td>
                    <td className="py-1.5">
                      <span className={`px-1.5 py-0.5 rounded ${l.status === 'deployed' ? 'bg-[rgba(34,197,94,0.16)] text-status-online' : l.status === 'validated' ? 'bg-[rgba(56,189,248,0.15)] text-accent-cyan' : l.status === 'archived' ? 'bg-bg-surface-raised text-text-muted' : 'bg-[rgba(245,158,11,0.16)] text-status-external'}`}>{l.status}</span>
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {l.id === rollbackTargetId && (
                        <button
                          onClick={() => rollbackLayout(l.version)}
                          className="px-2 py-0.5 border border-[rgba(245,158,11,0.4)] text-status-external rounded hover:bg-[rgba(245,158,11,0.12)] mr-1"
                          title="현재 배포본을 보관 처리하고 이 버전을 재배포합니다"
                        >
                          이 버전으로 롤백
                        </button>
                      )}
                      <button onClick={() => validateLayout(l.id)} className="px-2 py-0.5 border border-border-subtle rounded text-text-secondary hover:bg-bg-surface-raised mr-1">검증</button>
                      <button onClick={() => deployLayout(l.id)} disabled={l.status !== 'validated'} className="px-2 py-0.5 bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-40">배포</button>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}
