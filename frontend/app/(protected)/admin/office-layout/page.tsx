'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { useT } from '@/components/I18nProvider';
import type { SeatBox, ShapeBox, Selection } from '@/components/office/SeatCanvas';
import {
  SEAT_STYLE,
  SEAT_STATUS_LABEL,
  seatStatusLabel,
  seatTypeLabel,
  layoutStatusLabel,
} from '@/components/office/seatStyles';
import { buildOfficeLayout, DEFAULT_PX_PER_METER } from '@/lib/officeLayout';
import {
  PageHeader,
  ToolbarButton,
  SectionCard,
  EmptyState,
  LoadingState,
} from '@/components/ui/console';
import { useConfirm } from '@/components/ui/feedback';

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
  // 모듈 레벨이라 훅을 못 쓴다 — 한 단어라 로케일 무관 표기로 둔다(로딩 스피너와 같은 역할).
  loading: () => <div className="h-full flex items-center justify-center text-text-muted text-sm">…</div>,
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
/** 주인 후보 — 자리 주인 고르기 목록에 쓰는 최소 필드만 본다. */
interface Employee {
  id: number;
  name: string;
  position: string | null;
}
interface LayoutRow {
  id: string;
  version: number;
  status: string;
  deployed_at: string | null;
}

/**
 * 반영 절차의 한 단계. 번호·제목·설명·버튼을 한 덩어리로 묶어, 순서가 화면에 드러나게 한다.
 * 못 누르는 버튼에는 반드시 이유(hint)를 붙인다 — 이유 없이 회색인 버튼이 이 화면 최대의 벽이었다.
 */
function LayoutStep({
  n,
  title,
  desc,
  done,
  button,
}: {
  n: number;
  title: string;
  desc: string;
  done: boolean;
  button: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean; hint?: string };
}) {
  return (
    <li className="flex flex-col gap-2 p-3 rounded-xl border border-border-subtle bg-bg-surface-raised">
      <div className="flex items-center gap-2">
        <span
          className={`w-5 h-5 rounded-full grid place-items-center text-[11px] font-semibold flex-shrink-0 ${
            done ? 'bg-status-online text-bg-base' : 'bg-bg-surface text-text-muted border border-border-subtle'
          }`}
        >
          {done ? '✓' : n}
        </span>
        <span className="text-[13px] font-semibold text-text-primary">{title}</span>
      </div>
      <p className="text-[11.5px] leading-relaxed text-text-muted min-h-[2.6em]">{desc}</p>
      <button
        onClick={button.onClick}
        disabled={button.disabled}
        title={button.hint}
        className={`w-full px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed ${
          button.primary
            ? 'bg-primary text-white hover:bg-primary-hover disabled:opacity-40'
            : 'border border-border-subtle text-text-secondary hover:bg-bg-surface disabled:opacity-40'
        }`}
      >
        {button.label}
      </button>
      {button.disabled && button.hint && (
        <p className="text-[11px] text-text-muted -mt-0.5">{button.hint}</p>
      )}
    </li>
  );
}

function toBox(s: ApiSeat, i: number): SeatBox {
  const c = s.coords || {};
  // seat 테이블은 미터 → 편집기 캔버스 픽셀로 변환. 좌표 없으면 격자 폴백(픽셀).
  const x = typeof c.x === 'number' ? mToPx(c.x) : 40 + (i % 6) * 130;
  const y = typeof c.y === 'number' ? mToPx(c.y) : 40 + Math.floor(i / 6) * 90;
  return { id: s.id, label: s.seat_number || `좌석 ${i + 1}`, x, y, status: s.status, type: s.type };
}

export default function OfficeLayoutPage() {
  const { t } = useT();
  const me = getUser();
  const allowed = isAdmin(me);
  const confirm = useConfirm();
  const [seats, setSeats] = useState<SeatBox[]>([]);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [floorName, setFloorName] = useState<string | null>(null);
  const [floorLevel, setFloorLevel] = useState<number | null>(null);
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [layouts, setLayouts] = useState<LayoutRow[]>([]);
  // 자리 주인 = seat.assigned_user_id. 배정은 DB 소유(D10)라 레이아웃 반영과 무관하게 즉시 적용되므로
  // 좌표처럼 저장 대기 버퍼에 넣지 않고 별도 맵으로 들고 있다가 서버 응답으로 갱신한다.
  const [owners, setOwners] = useState<Record<string, number | null>>({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 안내와 실패를 같은 초록 배너로 띄우면 실패가 성공처럼 읽힌다.
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'warn' } | null>(null);
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
  // 반영 3단계 패널 접힘. null = 자동(구조물이나 진행 중인 안이 있을 때만 펼침).
  // 자리 배치가 주 작업인데 이 패널이 상시 200px를 먹으면 도면이 그만큼 작아진다.
  const [deployOpen, setDeployOpen] = useState<boolean | null>(null);
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

  const say = (msg: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), tone === 'warn' ? 4200 : 2600);
  };
  const flash = (m: string) => say(m, 'ok');
  const warn = (m: string) => say(m, 'warn');

  const isEmpty = seats.length + rooms.length + zones.length + walls.length === 0;

  // 도면에 그릴 사무실 경계(m). buildOfficeLayout의 dimensions 계산과 같은 규칙(가장 바깥 요소 + 2m)이라
  // 여기 보이는 점선이 곧 반영될 사무실 크기다. 규칙이 갈리면 "편집기와 실제가 다르다"가 된다.
  const bounds = useMemo(() => {
    const xs = [
      ...seats.map((s) => s.x),
      ...rooms.map((r) => r.x + r.w),
      ...zones.map((z) => z.x + z.w),
      ...walls.map((w) => w.x + w.w),
    ];
    const ys = [
      ...seats.map((s) => s.y),
      ...rooms.map((r) => r.y + r.h),
      ...zones.map((z) => z.y + z.h),
      ...walls.map((w) => w.y + w.h),
    ];
    const w = Math.round(pxToM(Math.max(0, ...xs)) + 2) || 10;
    const h = Math.round(pxToM(Math.max(0, ...ys)) + 2) || 10;
    return { w, h };
  }, [seats, rooms, zones, walls]);

  // 아직 저장 안 된 좌석(새로 놓았거나 옮긴 것)을 점선으로 표시한다.
  // 범례에 "저장 전"을 써 놓고 도면에는 표시가 없으면 범례가 거짓말이 된다.
  const canvasSeats = useMemo(
    () => seats.map((s) => ({ ...s, local: s.id.startsWith('temp-') || s.id in pendingMoves })),
    [seats, pendingMoves],
  );

  // ── 도면 보기(확대·이동) ──
  // zoom=null 이면 "전체 보기": 사무실 전체가 화면에 들어오도록 자동 축소한다.
  // 기본값을 전체 보기로 두는 이유 — 아래쪽 자리가 화면 밖으로 잘리면 "자리가 사라졌다"로 읽힌다.
  const [zoom, setZoom] = useState<number | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const fitScale = useMemo(() => {
    const lw = bounds.w * PX_PER_M;
    const lh = bounds.h * PX_PER_M;
    if (lw <= 0 || lh <= 0) return 1;
    return Math.min(1.2, (size.w - 56) / lw, (size.h - 56) / lh);
  }, [bounds, size]);
  const scale = zoom ?? fitScale;
  const offset = pan ?? {
    x: Math.max(20, (size.w - bounds.w * PX_PER_M * scale) / 2),
    y: Math.max(20, (size.h - bounds.h * PX_PER_M * scale) / 2),
  };
  const setZoomCentered = (next: number) => {
    setZoom(Math.min(2, Math.max(0.25, Math.round(next * 100) / 100)));
    setPan(null); // 확대 배율이 바뀌면 다시 가운데로 — 어디를 보고 있는지 잃지 않게
  };
  const fitToView = () => { setZoom(null); setPan(null); };

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const [floors, apiSeats, lays, emps] = await Promise.all([
        api.get<Floor[]>('/api/floors').catch(() => [] as Floor[]),
        api.get<ApiSeat[]>('/api/seats'),
        api.get<LayoutRow[]>('/api/office-layouts').catch(() => [] as LayoutRow[]),
        // 주인 고르기 목록. 실패해도 자리 편집 자체는 계속 되어야 하므로 빈 목록으로 떨어뜨린다.
        api.get<Employee[]>('/api/employees').catch(() => [] as Employee[]),
      ]);
      setFloorId(floors[0]?.id ?? null);
      setFloorName(floors[0]?.name ?? null);
      setFloorLevel(floors[0]?.level ?? null);
      setOfficeId(floors[0]?.office_id ?? null);
      setLayouts(lays);
      setEmployees(emps);
      const live = apiSeats.filter((s) => s.status !== 'disabled');
      setSeats(live.map(toBox));
      setOwners(Object.fromEntries(live.map((s) => [s.id, s.assigned_user_id])));
      // 재로드 시 저장 대기 버퍼 초기화 (서버 상태와 동기화)
      setPendingMoves({});
      setPendingCreates([]);
      setPendingDeletes([]);
      // 선택도 함께 푼다. 안 그러면 사라진 좌석을 계속 가리켜 속성 패널이 "—"만 보여준다.
      setSelected(null);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? `자리 정보를 불러오지 못했습니다 (오류 ${e.status}).`
          : t('layout.err.server'),
      );
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

  /**
   * 새 자리를 놓을 빈 칸을 찾는다. 고정 격자에 그냥 놓으면 기존 자리와 겹쳐서,
   * 추가 버튼을 눌러도 "아무 일도 안 일어난 것처럼" 보인다(뒤에 가려짐).
   */
  const findFreeSpot = () => {
    const STEP = 75; // 1.5m
    const taken = (x: number, y: number) =>
      seats.some((s) => Math.abs(s.x - x) < 70 && Math.abs(s.y - y) < 50);
    const cols = Math.max(1, Math.floor((bounds.w * PX_PER_M - 40) / STEP));
    for (let i = 0; i < 400; i++) {
      const x = 40 + (i % cols) * STEP;
      const y = 40 + Math.floor(i / cols) * STEP;
      if (!taken(x, y)) return { x, y };
    }
    return { x: 40, y: 40 };
  };

  // 좌석 생성 — 로컬 임시 좌석 추가 (저장 대기)
  const addSeat = () => {
    if (!floorId) { warn(t('layout.err.noFloorSeat')); return; }
    const n = seats.length + 1;
    const coords = findFreeSpot();
    const seatNumber = `A-${String(n).padStart(2, '0')}`;
    const tempId = `temp-${Date.now()}-${n}`;
    setSeats((prev) => [...prev, { id: tempId, label: seatNumber, x: coords.x, y: coords.y, status: 'available', type: 'free' }]);
    setOwners((prev) => ({ ...prev, [tempId]: null }));
    setPendingCreates((prev) => [...prev, { tempId, seat_number: seatNumber, coords }]);
    setSelected({ kind: 'seat', id: tempId });
    flash(`${seatNumber} 자리를 놓았습니다. 원하는 곳으로 끌어다 놓고 [저장]하세요.`);
  };

  // 좌석 삭제 — 더블클릭. 임시 좌석은 버퍼에서 제거, 기존 좌석은 삭제 대기
  const removeSeat = async (id: string) => {
    const label = seats.find((s) => s.id === id)?.label ?? t('layout.thisSeat');
    if (!(await confirm({
      message: `${label} 자리를 없앨까요? [저장]을 눌러야 실제로 적용됩니다.`,
      danger: true,
    }))) return;
    setSeats((prev) => prev.filter((s) => s.id !== id));
    setOwners((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
    setSelected(null);
    flash(`${label} 자리를 지웠습니다. [저장]을 눌러야 적용됩니다.`);
  };

  // ── 자리 주인 (D10: 배정은 DB 소유 — 레이아웃 반영 없이 곧바로 적용된다) ──
  const employeeName = (uid: number | null | undefined) =>
    uid == null ? null : employees.find((e) => e.id === uid)?.name ?? `사원 ${uid}`;
  /** 이 사원이 지금 앉아 있는 자리 (자기 자신 제외) — 옮기면 그 자리가 빈다는 걸 미리 알려주기 위한 것. */
  const seatOfUser = (uid: number, exceptSeatId: string) =>
    seats.find((s) => s.id !== exceptSeatId && owners[s.id] === uid) ?? null;

  /**
   * 자리 주인을 정하거나(userId) 없앤다(null).
   * 좌표와 달리 저장 대기 버퍼를 거치지 않는다 — 배정은 레이아웃 반영과 무관하고(D10),
   * 두 경로를 섞으면 "저장 안 했는데 반영된 것"과 "저장했는데 안 된 것"이 한 화면에 공존한다.
   */
  const setSeatOwner = async (seatId: string, userId: number | null) => {
    if (assigning) return;
    const seat = seats.find((s) => s.id === seatId);
    if (!seat) return;
    if (seatId.startsWith('temp-')) {
      warn(t('layout.ownerNeedsSave'));
      return;
    }
    if ((owners[seatId] ?? null) === userId) return;

    // 한 사람 = 한 자리. 서버가 이전 자리를 비우므로, 그 사실을 누르기 전에 알린다.
    if (userId !== null) {
      const held = seatOfUser(userId, seatId);
      if (held && !(await confirm({
        message: `${employeeName(userId)}님은 지금 ${held.label} 자리에 있습니다. ${seat.label}(으)로 옮기면 ${held.label}은 빈 자리가 됩니다. 계속할까요?`,
      }))) return;
    }

    setAssigning(true);
    try {
      await api.put(`/api/seat-assignments/${seatId}`, { user_id: userId });
      setOwners((prev) => {
        const next = { ...prev };
        // 서버가 비운 이전 자리를 화면에서도 비운다 (재로드 없이 두면 두 자리에 같은 사람이 보인다).
        if (userId !== null) {
          for (const [sid, uid] of Object.entries(prev)) {
            if (sid !== seatId && uid === userId) next[sid] = null;
          }
        }
        next[seatId] = userId;
        return next;
      });
      setSeats((prev) =>
        prev.map((s) => {
          if (s.id === seatId) return { ...s, status: userId === null ? 'available' : 'occupied' };
          if (userId !== null && owners[s.id] === userId) return { ...s, status: 'available' };
          return s;
        }),
      );
      flash(
        userId === null
          ? `${seat.label} 자리의 주인을 없앴습니다. 가상사무실에 바로 반영됩니다.`
          : `${seat.label} 자리를 ${employeeName(userId)}님 자리로 정했습니다. 가상사무실에 바로 반영됩니다.`,
      );
    } catch (e) {
      warn(
        e instanceof ApiError && e.status === 404
          ? t('layout.err.memberMissing')
          : e instanceof ApiError
            ? `주인을 바꾸지 못했습니다 (${e.message}).`
            : t('layout.err.ownerChange'),
      );
    } finally {
      setAssigning(false);
    }
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
        // 임시 id → 서버 id로 갈아끼운다. 안 그러면 저장 직후 그 자리에 주인을 못 정한다(임시 id로 남음).
        setOwners((prev) => {
          const next = { ...prev };
          delete next[c.tempId];
          next[created.id] = created.assigned_user_id;
          return next;
        });
        if (selected?.kind === 'seat' && selected.id === c.tempId) {
          setSelected({ kind: 'seat', id: created.id });
        }
        setPendingCreates((prev) => prev.filter((x) => x.tempId !== c.tempId));
      }
      flash(t('layout.saved'));
    } catch (e) {
      warn(
        e instanceof ApiError
          ? `저장하지 못했습니다 (${e.message}). 아직 저장 안 된 변경은 그대로 남아 있으니 다시 시도해 보세요.`
          : t('layout.err.save'),
      );
    } finally {
      setSaving(false);
    }
  };

  // [변경 취소] — 저장 대기 변경을 버리고 서버 상태로 재로드
  const discardChanges = async () => {
    if (!(await confirm({ message: `저장하지 않은 변경 ${pendingCount}건을 버리고 저장된 상태로 되돌릴까요?`, danger: true }))) return;
    load();
  };

  // ── 오피스 레이아웃 버전 (D12) ──
  const createDraft = async () => {
    if (!officeId || !floorId) { warn(t('layout.err.noOffice')); return; }
    if (pendingCount > 0) { warn(t('layout.err.unsaved')); return; }
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
      flash(t('layout.draftCreated'));
      refreshLayouts();
    } catch (e) {
      warn(e instanceof ApiError ? `안을 만들지 못했습니다 (${e.status}).` : t('layout.err.draft'));
    }
  };

  const validateLayout = async (id: string) => {
    try {
      const res = await api.post<{ status: string; error_count: number; warning_count: number }>(`/api/office-layouts/${id}/validate`, {});
      if (res.error_count > 0) {
        // 검사 실패는 반영을 막는 사건이다. 성공과 같은 색으로 띄우면 통과한 줄 안다.
        warn(`문제 ${res.error_count}건이 발견되어 반영할 수 없습니다. 겹치거나 길을 막은 곳이 없는지 확인해 주세요.`);
      } else if (res.warning_count > 0) {
        flash(`검사를 통과했습니다. 확인해 볼 점 ${res.warning_count}건이 있지만 반영할 수 있습니다.`);
      } else {
        flash(t('layout.validated'));
      }
      refreshLayouts();
    } catch (e) {
      warn(e instanceof ApiError ? `검사하지 못했습니다 (${e.status}).` : t('layout.err.validate'));
    }
  };

  const deployLayout = async (id: string) => {
    try {
      await api.post(`/api/office-layouts/${id}/deploy`, {});
      // 반영하면 뷰포트가 기본 씬 대신 이 레이아웃 지오메트리를 그린다 — 눌러 보고서야 아는
      // 변화라 미리 알린다.
      flash(t('layout.deployed'));
      refreshLayouts();
    } catch (e) {
      warn(
        e instanceof ApiError
          ? e.status === 409
            ? t('layout.err.needValidate')
            : `반영하지 못했습니다 (${e.status}).`
          : t('layout.err.deploy'),
      );
    }
  };

  /** 배포 해제 — 배포본을 내려 기본 씬으로 되돌린다. rollback과 달리 이전 버전이 필요 없다. */
  const undeployLayout = async (id: string, version: number) => {
    if (!(await confirm({
      message: `${version}번째 배치를 내리고 기본 사무실 모습으로 되돌릴까요? 자리 위치는 그대로 유지되고, 이 배치는 검사 통과 상태로 남아 언제든 다시 반영할 수 있습니다.`,
    }))) return;
    try {
      await api.post(`/api/office-layouts/${id}/undeploy`, {});
      flash(t('layout.reverted'));
      refreshLayouts();
    } catch (e) {
      warn(e instanceof ApiError ? `되돌리지 못했습니다 (${e.message}).` : t('layout.err.revert'));
    }
  };

  // 롤백 — 백엔드 계약: POST /{deployed_id}/rollback → 현재 deployed는 archived,
  // 직전 archived(최고 버전)가 deployed로 복원됨. 버튼은 복원 대상(최신 archived) 행에 노출.
  const rollbackLayout = async (targetVersion: number) => {
    const deployed = layouts.find((l) => l.status === 'deployed');
    if (!deployed) { warn(t('layout.err.nothingDeployed')); return; }
    if (!(await confirm({
      message: `${targetVersion}번째 배치로 되돌릴까요? 지금 반영된 ${deployed.version}번째 배치는 지난 기록으로 넘어갑니다.`,
      danger: true,
    }))) return;
    try {
      const restored = await api.post<LayoutRow>(`/api/office-layouts/${deployed.id}/rollback`, {});
      flash(`${restored.version}번째 배치로 되돌렸습니다.`);
      refreshLayouts();
    } catch (e) {
      warn(e instanceof ApiError ? `되돌리지 못했습니다 (${e.message}).` : t('layout.err.revert'));
    }
  };

  // ── 3단계 진행 상태 ──
  // 작업 대상은 "아직 반영되지 않은 최신 안" 하나뿐이다. 여러 버전을 동시에 다루게 하면
  // 어느 줄의 버튼을 눌러야 하는지가 다시 문제가 된다.
  const deployedLayout = layouts.find((l) => l.status === 'deployed') ?? null;
  const workingStep =
    layouts
      .filter((l) => l.status === 'draft' || l.status === 'validated')
      .sort((a, b) => b.version - a.version)[0] ?? null;
  const step1Done = !!workingStep || !!deployedLayout;
  const step2Done = workingStep ? workingStep.status === 'validated' : !!deployedLayout;
  const step3Done = !!deployedLayout && !workingStep;

  // 롤백 계약(백엔드): deployed → archived, 직전 archived(최고 버전) → deployed 복원
  const archivedLayouts = layouts.filter((l) => l.status === 'archived');
  const rollbackTargetId =
    deployedLayout && archivedLayouts.length > 0
      ? archivedLayouts.reduce((a, b) => (a.version >= b.version ? a : b)).id
      : null;

  const showDeploy =
    deployOpen ?? (rooms.length + zones.length + walls.length > 0 || !!workingStep);

  const liveLine = deployedLayout
    ? `지금 직원들에게는 ${deployedLayout.version}번째 배치가 보입니다.`
    : t('layout.defaultShown');

  if (!allowed) {
    return (
      <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
        <PageHeader title={t('layout.title')} icon={ICON.grid} />
        <SectionCard>
          <EmptyState icon={ICON.lock} title={t('layout.adminOnly')} hint={t('layout.adminOnlyHint')} />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title={t('layout.title')}
        subtitle={
          floorId
            ? `자리를 끌어서 옮기고, 두 번 눌러 지웁니다 · 현재 ${seats.length}자리`
            : t('layout.noFloor')
        }
        icon={ICON.grid}
        actions={
          <>
            {/* 주 작업은 자리 놓기 — 이 화면 사용의 90%다. 나머지 도구와 시각 무게를 분리한다. */}
            <ToolbarButton variant="primary" onClick={addSeat} disabled={!floorId} icon={ICON.seat}>{t('layout.addSeat')}</ToolbarButton>
            <span className="mx-1 w-px h-5 bg-border-subtle" aria-hidden />
            <ToolbarButton onClick={addRoom} title={t('layout.tool.roomHint')}>{t('layout.tool.room')}</ToolbarButton>
            <ToolbarButton onClick={addZone} title={t('layout.tool.zoneHint')}>{t('layout.tool.zone')}</ToolbarButton>
            <ToolbarButton onClick={addWall} title={t('layout.tool.wallHint')}>{t('layout.tool.wall')}</ToolbarButton>
            <span className="mx-1 w-px h-5 bg-border-subtle" aria-hidden />
            <ToolbarButton onClick={undo} disabled={histIdx === 0} title={t('layout.undoTitle')}>↶</ToolbarButton>
            <ToolbarButton onClick={redo} disabled={histIdx >= history.length - 1} title={t('layout.redo')}>↷</ToolbarButton>
            <ToolbarButton
              onClick={async () => {
                if (pendingCount > 0 && !(await confirm({ message: `저장하지 않은 변경 ${pendingCount}건이 사라집니다. 계속할까요?`, danger: true }))) return;
                load();
              }}
              icon={ICON.refresh}
              title={t('layout.reloadTitle')}
            >
              새로고침
            </ToolbarButton>
          </>
        }
      />

      {/* 저장 바 — {t('layout.reloadHint')}를 화면에서 바로 답한다.
          이전엔 이 정보가 헤더 한 귀퉁이 칩이라 놓치기 쉬웠고, 저장 없이 나가면 조용히 사라졌다. */}
      {pendingCount > 0 ? (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.10)]">
          <span className="w-2 h-2 rounded-full bg-status-external animate-pulse" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-text-primary">
              저장하지 않은 변경 {pendingCount}건
            </div>
            <div className="text-[11.5px] text-text-muted">
              저장해야 가상사무실에 반영됩니다. 저장 전에 나가면 사라집니다.
            </div>
          </div>
          <ToolbarButton variant="primary" onClick={saveAll} disabled={saving} icon={ICON.save}>
            {saving ? t('layout.saving') : t('layout.save')}
          </ToolbarButton>
          <ToolbarButton onClick={discardChanges} disabled={saving}>{t('layout.undo')}</ToolbarButton>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-4 py-2 rounded-xl border border-border-subtle bg-bg-surface">
          <span className="w-2 h-2 rounded-full bg-status-online" aria-hidden />
          <span className="text-[12.5px] text-text-secondary">
            자리 배치가 모두 저장되어 가상사무실에 반영돼 있습니다.
          </span>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={`px-3 py-2 rounded-md text-xs ${
            toast.tone === 'warn'
              ? 'bg-[rgba(239,68,68,0.14)] border border-[rgba(239,68,68,0.4)] text-red-300'
              : 'bg-[rgba(34,197,94,0.16)] border border-[rgba(34,197,94,0.4)] text-status-online'
          }`}
        >
          {toast.msg}
        </div>
      )}
      <div className="flex-1 min-h-0 flex gap-3">
        <div ref={wrapRef} className="flex-1 min-h-0 border border-border-subtle rounded-2xl overflow-hidden bg-bg-surface relative">
          {loading ? (
            <LoadingState label="불러오는 중…" />
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-red-300">{error}</p>
              <p className="text-xs text-text-muted max-w-xs leading-relaxed">
                잠시 후 다시 시도해 보세요. 계속 같은 화면이면 시스템 담당자에게 알려 주세요.
              </p>
              <ToolbarButton onClick={load} icon={ICON.refresh}>다시 시도</ToolbarButton>
            </div>
          ) : (
            <>
              <SeatCanvas
                seats={canvasSeats}
                rooms={rooms}
                zones={zones}
                walls={walls}
                width={size.w}
                height={size.h}
                pxPerMeter={PX_PER_M}
                boundsW={bounds.w}
                boundsH={bounds.h}
                scale={scale}
                offsetX={offset.x}
                offsetY={offset.y}
                onPan={(x, y) => setPan({ x, y })}
                onMove={move}
                onDelete={removeSeat}
                onMoveShape={moveShape}
                onSelect={setSelected}
                selected={selected}
              />
              {isEmpty && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center max-w-[19rem] px-6">
                    <p className="text-[15px] font-semibold text-[#3B352C]">{t('layout.noSeats')}</p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#7A736A]">
                      위의 <b className="font-semibold text-[#3B352C]">{t('layout.addSeat')}</b>를 눌러 첫 자리를 놓아 보세요.
                      놓은 뒤에는 끌어서 원하는 위치로 옮길 수 있습니다.
                    </p>
                  </div>
                </div>
              )}

              {/* 범례 — 색이 무슨 뜻인지 도면 위에서 바로 답한다. 종이 위 요소라 밝은 계열. */}
              <div className="absolute left-3 bottom-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-3 py-2 rounded-lg bg-[#FFFFFFE6] border border-[#DFD9CE] shadow-sm text-[11px] text-[#4A443C]">
                {(['available', 'occupied', 'reserved'] as const).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <span
                      className="w-3.5 h-2.5 rounded-[3px] border"
                      style={{ background: SEAT_STYLE[s].fill, borderColor: SEAT_STYLE[s].stroke }}
                    />
                    {SEAT_STATUS_LABEL[s]}
                  </span>
                ))}
                {pendingCount > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3.5 h-2.5 rounded-[3px] border border-dashed border-[#8C8578] bg-white" />
                    저장 전
                  </span>
                )}
                <span className="w-px h-3 bg-[#DFD9CE]" aria-hidden />
                <span className="text-[#7A736A]">{t('layout.gridLegend')}</span>
                <span className="text-[#7A736A]">사무실 {bounds.w}m × {bounds.h}m</span>
              </div>

              {/* 확대·이동 — 빈 곳을 끌면 도면이 움직인다. 길을 잃으면 [전체 보기]로 돌아온다. */}
              <div className="absolute right-3 bottom-3 flex items-center gap-1 px-1 py-1 rounded-lg bg-[#FFFFFFE6] border border-[#DFD9CE] shadow-sm">
                <button
                  onClick={() => setZoomCentered(scale / 1.25)}
                  className="w-7 h-7 grid place-items-center rounded-md text-[15px] text-[#4A443C] hover:bg-[#EFEBE3]"
                  title={t('layout.zoomOut')}
                >
                  −
                </button>
                <span className="w-11 text-center text-[11px] tabular-nums text-[#7A736A]">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  onClick={() => setZoomCentered(scale * 1.25)}
                  className="w-7 h-7 grid place-items-center rounded-md text-[15px] text-[#4A443C] hover:bg-[#EFEBE3]"
                  title={t('layout.zoomIn')}
                >
                  +
                </button>
                <span className="w-px h-4 bg-[#DFD9CE] mx-0.5" aria-hidden />
                <button
                  onClick={fitToView}
                  className="px-2 h-7 rounded-md text-[11.5px] text-[#4A443C] hover:bg-[#EFEBE3]"
                  title={t('layout.fitHint')}
                >
                  전체 보기
                </button>
              </div>
            </>
          )}
        </div>

        {/* 오른쪽: 선택한 요소 편집 + 배치 요약 */}
        <div className="w-60 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
          <SectionCard title={t('layout.selected')} icon={ICON.info} bodyClassName="p-3">
            {(() => {
              if (!selected) {
                return (
                  <p className="text-xs leading-relaxed text-text-muted">
                    도면에서 자리나 방을 클릭하면 여기서 이름을 바꾸거나 지울 수 있습니다.
                  </p>
                );
              }
              if (selected.kind === 'seat') {
                const seat = seats.find((s) => s.id === selected.id);
                if (!seat) return <p className="text-xs text-text-muted">—</p>;
                const ownerId = owners[seat.id] ?? null;
                const unsaved = seat.id.startsWith('temp-');
                return (
                  <div className="space-y-2.5">
                    <div>
                      <div className="text-[15px] font-semibold text-text-primary">{seat.label}</div>
                      <div className="text-[11.5px] text-text-muted">
                        {seatTypeLabel(seat.type)} · {seatStatusLabel(seat.status)}
                      </div>
                    </div>
                    <div className="text-[11.5px] text-text-muted">
                      사무실 왼쪽 위에서 가로 {pxToM(seat.x).toFixed(1)}m, 세로 {pxToM(seat.y).toFixed(1)}m
                    </div>

                    {/* 자리 주인 — 좌표와 달리 고르는 즉시 반영된다(D10). 그래서 [저장] 안내를 붙이지 않는다. */}
                    <div className="pt-2.5 border-t border-border-subtle space-y-1.5">
                      <label htmlFor="seat-owner" className="block text-[11.5px] font-medium text-text-secondary">
                        이 자리의 주인
                      </label>
                      <select
                        id="seat-owner"
                        value={ownerId ?? ''}
                        disabled={unsaved || assigning}
                        onChange={(e) => setSeatOwner(seat.id, e.target.value === '' ? null : Number(e.target.value))}
                        className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <option value="">{t('layout.ownerNone')}</option>
                        {employees.map((emp) => {
                          const held = seatOfUser(emp.id, seat.id);
                          return (
                            <option key={emp.id} value={emp.id}>
                              {emp.name}
                              {emp.position ? ` · ${emp.position}` : ''}
                              {held ? ` (지금 ${held.label})` : ''}
                            </option>
                          );
                        })}
                      </select>
                      {/* 못 고르는 이유는 반드시 화면에 쓴다 (D37-b). */}
                      {unsaved ? (
                        <p className="text-[11px] leading-relaxed text-text-muted">
                          아직 저장 전인 자리입니다. [저장]을 누른 뒤에 주인을 정할 수 있습니다.
                        </p>
                      ) : employees.length === 0 ? (
                        <p className="text-[11px] leading-relaxed text-text-muted">
                          등록된 직원이 없어 주인을 정할 수 없습니다. [직원 관리]에서 먼저 추가하세요.
                        </p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-text-muted">
                          {ownerId !== null
                            ? `${employeeName(ownerId)}님의 자리입니다. 고르는 즉시 반영됩니다.`
                            : t('layout.ownerInstant')}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => removeSeat(seat.id)}
                      className="w-full px-2 py-1.5 text-xs border border-[rgba(239,68,68,0.35)] text-red-300 rounded-md hover:bg-[rgba(239,68,68,0.12)]"
                    >
                      이 자리 없애기
                    </button>
                  </div>
                );
              }
              const sh = selectedShape();
              if (!sh) return <p className="text-xs text-text-muted">—</p>;
              return (
                <div className="space-y-2.5">
                  <div className="text-[11.5px] text-text-muted">
                    {selected.kind === 'room' ? t('layout.tool.room') : selected.kind === 'zone' ? t('layout.tool.zone') : t('layout.tool.wall')}
                  </div>
                  <input
                    value={sh.label ?? ''}
                    onChange={(e) => relabelSelected(e.target.value)}
                    placeholder={t('layout.name')}
                    className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  />
                  <div className="text-[11.5px] text-text-muted">
                    크기 {pxToM(sh.w).toFixed(1)}m × {pxToM(sh.h).toFixed(1)}m
                  </div>
                  <button
                    onClick={deleteSelected}
                    className="w-full px-2 py-1.5 text-xs border border-[rgba(239,68,68,0.35)] text-red-300 rounded-md hover:bg-[rgba(239,68,68,0.12)]"
                  >
                    없애기
                  </button>
                </div>
              );
            })()}
          </SectionCard>

          <SectionCard title={t('layout.placedTitle')} icon={ICON.layers} bodyClassName="p-3">
            <dl className="space-y-1.5 text-[12.5px]">
              {[
                [t('layout.seat'), seats.length],
                // 주인 지정이 몇 자리까지 됐는지 — 자리마다 눌러 보지 않고도 진행 상황이 보이게.
                [t('layout.ownedSeats'), seats.filter((s) => owners[s.id] != null).length],
                [t('layout.tool.room'), rooms.length],
                [t('layout.tool.zone'), zones.length],
                [t('layout.tool.wall'), walls.length],
              ].map(([label, n]) => (
                <div key={label as string} className="flex items-baseline justify-between">
                  <dt className="text-text-muted">{label}</dt>
                  <dd className="text-text-primary tabular-nums">{n}개</dd>
                </div>
              ))}
            </dl>
            {(zones.length > 0 || rooms.length > 0) && (
              <ul className="mt-3 pt-3 border-t border-border-subtle space-y-1.5 text-xs">
                {zones.map((z) => (
                  <li
                    key={z.id}
                    className={`flex items-center gap-1.5 cursor-pointer truncate ${selected?.id === z.id ? 'text-accent-cyan font-medium' : 'text-text-secondary'}`}
                    onClick={() => setSelected({ kind: 'zone', id: z.id })}
                  >
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: z.color ?? '#3498db' }} />
                    {z.label}
                  </li>
                ))}
                {rooms.map((r) => (
                  <li
                    key={r.id}
                    className={`flex items-center gap-1.5 cursor-pointer truncate ${selected?.id === r.id ? 'text-accent-cyan font-medium' : 'text-text-secondary'}`}
                    onClick={() => setSelected({ kind: 'room', id: r.id })}
                  >
                    <span className="w-2 h-2 rounded-sm flex-shrink-0 bg-status-focus" />
                    {r.label}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
      {/* 방·구역·벽 반영 절차 (초안 → 검사 → 반영).
          이전엔 버전/상태/액션 표에 [검증][배포] 버튼만 있어, 순서도 의미도 화면에 없었다.
          {t('layout.notReflected')}는 오해가 바로 여기서 나왔다. */}
      <SectionCard
        title={t('layout.applyTitle')}
        icon={ICON.versions}
        className="flex-shrink-0"
        bodyClassName="p-4"
        action={
          <ToolbarButton onClick={() => setDeployOpen(!showDeploy)}>
            {showDeploy ? t('layout.collapse') : t('layout.expand')}
          </ToolbarButton>
        }
      >
        {/* 지금 직원들에게 무엇이 보이는가 — 접어도 이 한 줄은 남는다. */}
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-bg-surface-raised border border-border-subtle">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${deployedLayout ? 'bg-status-online' : 'bg-text-muted'}`}
            aria-hidden
          />
          <span className="text-[12.5px] text-text-secondary flex-1 min-w-0">{liveLine}</span>
          {deployedLayout && (
            <button
              onClick={() => undeployLayout(deployedLayout.id, deployedLayout.version)}
              className="px-2.5 py-1 text-[11.5px] border border-border-subtle text-text-secondary rounded-md hover:bg-bg-surface whitespace-nowrap"
              title={t('layout.revertHint')}
            >
              기본 모습으로 되돌리기
            </button>
          )}
        </div>

        {!showDeploy ? null : (
        <>
        <p className="mt-3 text-[12.5px] leading-relaxed text-text-muted">
          자리는 <b className="text-text-secondary font-medium">{t('layout.save')}</b>하면 바로 반영됩니다.
          방·구역·벽처럼 사무실 구조를 바꾸는 것은 실수로 길이 막히지 않도록 아래 3단계를 거칩니다.
        </p>

        <ol className="mt-3 grid gap-2.5 md:grid-cols-3">
          <LayoutStep
            n={1}
            title={t('layout.step1')}
            desc={t('layout.step1Hint')}
            done={step1Done}
            button={{
              label: workingStep ? t('layout.recreate') : t('layout.createDraft'),
              onClick: createDraft,
              disabled: !officeId || pendingCount > 0,
              primary: !step1Done,
              hint:
                pendingCount > 0
                  ? t('layout.err.unsavedShort')
                  : !officeId
                    ? t('layout.err.noOfficeShort')
                    : undefined,
            }}
          />
          <LayoutStep
            n={2}
            title={t('layout.step2')}
            desc={t('layout.step2Hint')}
            done={step2Done}
            button={{
              label: t('layout.runCheck'),
              onClick: () => workingStep && validateLayout(workingStep.id),
              disabled: !workingStep,
              primary: !!workingStep && !step2Done,
              hint: workingStep ? undefined : t('layout.needDraft'),
            }}
          />
          <LayoutStep
            n={3}
            title={t('layout.step3')}
            desc={t('layout.step3Hint')}
            done={step3Done}
            button={{
              label: t('layout.apply'),
              onClick: () => workingStep && deployLayout(workingStep.id),
              disabled: workingStep?.status !== 'validated',
              primary: workingStep?.status === 'validated',
              hint:
                workingStep?.status === 'validated'
                  ? undefined
                  : workingStep
                    ? t('layout.err.needValidate')
                    : step3Done
                      ? t('layout.alreadyApplied')
                      : t('layout.needDraft'),
            }}
          />
        </ol>

        {/* 지난 기록 — 평소엔 접어 둔다. 필요할 때만 펼쳐 되돌리기. */}
        {layouts.length > 0 && (
          <details className="mt-3 group">
            <summary className="cursor-pointer text-[12px] text-text-muted hover:text-text-secondary select-none">
              지난 기록 {layouts.length}건 보기
            </summary>
            <ul className="mt-2 space-y-1">
              {layouts.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-bg-surface-raised text-[12px]"
                >
                  <span className="text-text-secondary tabular-nums w-16 flex-shrink-0">
                    {l.version}번째
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] ${
                      l.status === 'deployed'
                        ? 'bg-[rgba(34,197,94,0.16)] text-status-online'
                        : l.status === 'validated'
                          ? 'bg-[rgba(56,189,248,0.15)] text-accent-cyan'
                          : l.status === 'archived'
                            ? 'bg-bg-surface text-text-muted'
                            : 'bg-[rgba(245,158,11,0.16)] text-status-external'
                    }`}
                  >
                    {layoutStatusLabel(l.status)}
                  </span>
                  <span className="flex-1" />
                  {l.id === rollbackTargetId && (
                    <button
                      onClick={() => rollbackLayout(l.version)}
                      className="px-2 py-0.5 border border-[rgba(245,158,11,0.4)] text-status-external rounded hover:bg-[rgba(245,158,11,0.12)]"
                      title={t('layout.revertToThis')}
                    >
                      이 배치로 되돌리기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        </>
        )}
      </SectionCard>
    </div>
  );
}
