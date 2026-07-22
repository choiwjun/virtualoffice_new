'use client';

/**
 * OfficeViewport2D — 2.5D 고정 카메라 가상오피스 뷰포트.
 *
 * 렌더 = DOM 합성: V3 탑다운 캔버스(배경, D35) + 방 라벨/글로우 + 아바타 배지 레이어.
 * 아바타 위치는 realtime(Colyseus) 서버 권위 상태를 rAF 루프가 imperative하게 소비
 * (20Hz setState 재렌더 회피 — playersRef 패턴은 useOfficeRoom 참조).
 * 서버 미기동 시 로컬 이동 폴백(본인 아바타만, 동일 속도 모델 1.4m/s).
 *
 * 좌표계: 내부 시뮬레이션은 미터(서버와 동일), 화면 배치 직전에만 정규→px 변환.
 * 정본: lib/office2d.ts (씬), realtime/README.md (프로토콜).
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SceneV3Layer from '@/components/SceneV3Layer';
import { getUser } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { useOfficeRoom } from '@/hooks/useOfficeRoom';
import type { MeetingEntryResult } from '@/lib/realtime';
import {
  AvatarState,
  CharacterId,
  PLATE_W,
  PLATE_H,
  type SceneRoom,
  SCENE_THEMES,
  type SceneThemeId,
  SPAWNS,
  themeForHour,
  characterForAvatar,
  clampToWalkable,
  findPath,
  isWalkable,
  nearestWalkableM,
  metersToNorm,
  normToMeters,
  pointInPolygon,
  polygonCentroid,
  setActiveFloorGeometry,
  typingBurstAt,
  type Vec2,
} from '@/lib/office2d';
import { V3_WALK_AREA, V3_OBSTACLES, V3_SEAT_BY_NUMBER, V3_ROOMS, V3_HOTSPOTS_NORM } from '@/lib/officeV3';

const MAX_SPEED_MPS = 1.4; // realtime config와 동일(로컬 폴백용)
const LERP_RATE = 8; // 표시 위치가 서버 위치를 따라가는 속도(1/s)
const WALK_EPS_MPS = 0.08; // 이 속도 이상이면 walk 애니
// 착석 스냅 반경(m). 책상 단위 충돌 전환 후 의자는 보행 가능(도달 거리 ≈0) —
// 서버 정지 위치의 잔차·격자 오차 여유만 필요하지만, 자기 책상 옆 정지 시 자연 착석 UX를 겸한다.
const SEAT_SNAP_M = 1.0;

interface AvatarVisual {
  root: HTMLDivElement;
  /** 코드 모션(바운스/기울임) 래퍼 — 상태 전환 시 클래스만 교체. */
  motion: HTMLDivElement;
  /** 본체 — 에셋 모드=<img>(프레임), 플레이스홀더 모드=<div>(도트). */
  img: HTMLElement;
  /** 표시 위치(미터) — 서버 위치로 보간. */
  disp: Vec2;
  /** 마지막 표시 위치(속도/방향 추정용). */
  prev: Vec2;
  /** 마지막 서버 권위 위치 — 착석 스냅은 서버가 정지했을 때만(지나가다 자석처럼 끌리는 것 방지). */
  prevSrv: Vec2;
  /** 서버 위치 연속 정지 시간(초). 프레임 수 기반이면 고주사율(144/240Hz) 모니터에서
   *  50ms 패치 간격과 경합해 착석 스냅이 20Hz로 토글(=진동)된다 — 반드시 시간 기반. */
  stillSec: number;
  state: AvatarState;
  frame: number;
  frameAcc: number;
  facing: 1 | -1;
  char: CharacterId;
  /** 좌석 착석 판정용(점유 좌석 매칭). */
  userId: string;
}

/** 로스터 항목(React 셸 렌더용 최소 정보). */
interface ShellInfo {
  key: string;
  char: CharacterId;
  name: string;
  userId: string;
  isSelf: boolean;
  /** 이 아바타의 이름표 표시 여부(user_avatar.show_nameplate). */
  showNameplate: boolean;
  /** 이름표 강조색(user_avatar.top_color) — 2.5D 래스터 스프라이트 재염색 불가라 정체성 색으로 사용. */
  accent: string;
}

/** 아바타 외형 프리셋(공개 표시용, GET /api/avatars). */
interface AvatarPref {
  preset_id: string;
  top_color: string;
  show_nameplate: boolean;
}

/** 좌석(GET /api/seats, D10) — coords는 플레이트 top-left 기준 미터(뷰포트 좌표계 동일). */
interface SeatInfo {
  id: string;
  floor_id: string;
  type: 'fixed' | 'free' | 'temp' | 'partner';
  status: 'available' | 'occupied' | 'disabled' | 'reserved';
  assigned_user_id: number | null;
  seat_number: string | null;
  coords: { x: number; y: number; facing?: number };
}

/** 배포된 오피스 레이아웃 구조(GET /api/office-layouts/deployed/structure) — 좌표는 미터(top_left).
 *  deployed=true면 편집기 배치를 씬 대신 벡터로 렌더한다(좌석배치대로 반영). */
interface FloorStructure {
  deployed: boolean;
  dimensions?: { width_m: number; height_m: number };
  rooms: { id: string; label: string; type?: string; x: number; y: number; w: number; h: number }[];
  zones: { id: string; label: string; color: string; polygon: { x: number; y: number }[] }[];
  walls: { x: number; y: number; w: number; h: number }[];
}

/** 미터 사각형(x,y,w,h) → 정규(0~1) 4꼭짓점 폴리곤 — 좌석과 동일 metersToNorm으로 정렬. */
function rectToNormPoly(x: number, y: number, w: number, h: number): Vec2[] {
  return [
    metersToNorm({ x, y }),
    metersToNorm({ x: x + w, y }),
    metersToNorm({ x: x + w, y: y + h }),
    metersToNorm({ x, y: y + h }),
  ];
}

const SEATS_POLL_MS = 60_000; // 좌석 목록 폴링 주기(§3.11)
const SEAT_Z = 15000; // 방 라벨(21000)보다 아래, 아바타(≤10000)보다 위 — y-깊이 무관 고정

/** 프레즌스 7종 표시 메타(D13). meeting/offline은 자동 전환 — 수동 메뉴 제외. */
const PRESENCE_META: Record<string, { label: string; color: string }> = {
  online: { label: '온라인', color: '#22C55E' },
  working: { label: '업무 중', color: '#3B5BFE' },
  meeting: { label: '회의 중', color: '#F43F5E' },
  focus: { label: '집중', color: '#A855F7' },
  away: { label: '자리비움', color: '#F59E0B' },
  external: { label: '외근', color: '#14B8A6' },
  offline: { label: '오프라인', color: '#64748B' },
};
/** 수동 전환 가능 상태(06 §1.2). 서버 allowlist 밖 값은 서버가 무시(칩은 서버 상태 추종). */
const MANUAL_STATUSES = ['online', 'working', 'focus', 'external'] as const; // away는 자동 전이(D13) — 서버 allowlist 정합

interface OfficeViewport2DProps {
  /** 회의 명시입장(D24) 확인 시 호출 — 페이지가 LiveKit join 흐름을 실행. */
  onJoinMeeting?: (roomId: string) => void;
  /** D33 하단 통합 독(19-spec P0-2)의 셸 세그먼트(회의 LIVE 칩·MediaBar·입장 오류) —
   *  뷰포트 컨트롤 필 오른쪽에 나란히 렌더된다. */
  dockSlot?: React.ReactNode;
}

/** 층 선택(19-spec P0-3) — 미니맵 헤더로 흡수. 현재 콘텐츠는 2F뿐(타 층 시각 전환만). */
const FLOORS = ['4F', '3F', '2F', '1F', 'B1F'];

// ── D34 공간 진입점(20-spec): 씬 클릭 대상 → SpotCard 미니 카드. 폼/상세는 오버레이 창(D27). ──
type SpotKind = 'profile' | 'myseat' | 'room' | 'board' | 'cabinet' | 'zone';
interface SpotState {
  kind: SpotKind;
  title: string;
  /** profile: 대상 userId */
  userId?: string;
  /** room: SceneRoom.id + label */
  roomId?: string;
  roomLabel?: string;
}
interface SpotRow {
  key: string;
  primary: string;
  secondary?: string;
  color?: string;
}

/** 씬 모드 핫스팟(D34 W1-4·W2-1) — 기존 가구 위 아이콘 칩(좌석 마커와 동일 z 패턴). */
const HOTSPOTS: { id: string; kind: SpotKind; title: string; label: string; icon: string; n: Vec2 }[] = [
  { id: 'board', kind: 'board', title: '게시판 — 공지사항', label: '공지', icon: '📌', n: { x: 0.615, y: 0.27 } },
  { id: 'cabinet', kind: 'cabinet', title: '서류함 — 보고서', label: '보고서', icon: '🗂️', n: { x: 0.263, y: 0.35 } },
];

export default function OfficeViewport2D({ onJoinMeeting, dockSlot }: OfficeViewport2DProps = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  // D35 씬 V3 상시 — HORIZON legacy 스프라이트 레이어는 2026-07-22 제거(?scene=·NEXT_PUBLIC_SCENE_V3
  // 탈출구 폐기). 씬 모드 = 배포 레이아웃 없으면 항상 V3 탑다운 캔버스.
  // D33: 미니맵 접기 + 층 전환 흡수(P0-3).
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [activeFloor, setActiveFloor] = useState('2F');
  // D34 SpotCard — 공간 진입점 미니 카드(20-spec). rows=null이면 로딩.
  const router = useRouter();
  const [spot, setSpot] = useState<SpotState | null>(null);
  const [spotRows, setSpotRows] = useState<SpotRow[] | null>(null);
  const [spotLive, setSpotLive] = useState<{ meetingId?: string; sub?: string } | null>(null);

  // 회의 명시입장(D24) 프롬프트 — 서버 allowed 응답 시 표시.
  const [meetingPrompt, setMeetingPrompt] = useState<{ roomId: string; label: string } | null>(null);
  // 배포 레이아웃 재배포(D12 layout_updated) 수신 시 구조를 즉시 재조회 — loadStructure는
  // 아래에서 정의되므로 ref로 우회 연결(안정 콜백, 재연결 유발 없음).
  const loadStructureRef = useRef<() => void>(() => {});
  const onLayoutUpdated = useCallback(() => loadStructureRef.current(), []);
  const handleMeetingEntry = useCallback((r: MeetingEntryResult) => {
    if (!r.ok) return; // denied(too_far/full/unknown_room) → 무시
    const room = roomsRef.current.find((rm) => rm.id === r.roomId);
    setMeetingPrompt({ roomId: r.roomId, label: room?.label ?? r.roomId });
  }, []);
  const {
    status,
    roster,
    playersRef,
    selfIdRef,
    requestPath,
    enterMeeting,
    setStatus: setPresence,
    reconnect,
  } = useOfficeRoom(true, handleMeetingEntry, onLayoutUpdated);

  const me = useMemo(() => getUser(), []);
  const myName = me?.name ?? 'Guest';
  const myId = String(me?.id ?? 'guest');

  // 아바타 외형(프리셋/색상/이름표) — 로스터 전원 반영(#6). 본인 포함 batch 조회.
  const [avatarPrefs, setAvatarPrefs] = useState<Record<string, AvatarPref>>({});

  // 서버 오프라인 폴백(본인만 로컬 시뮬레이션). route = A* 경유지 큐(미터).
  const offline = status === 'error' || status === 'disconnected';
  const localRef = useRef<{ pos: Vec2; route: Vec2[] }>({
    pos: normToMeters(SPAWNS.lobby),
    route: [],
  });

  /** 현 위치 → 목표(미터) A* 경로 이동 — 유리벽 회의실은 문 개구부를 경유. */
  const moveTo = useCallback(
    (targetM: Vec2) => {
      const self = offlineRef.current
        ? { ...localRef.current.pos }
        : (() => {
            const p = playersRef.current.get(selfIdRef.current);
            return p ? { x: p.x, y: p.y } : null;
          })();
      const path = self ? findPath(self, targetM) : [targetM];
      if (offlineRef.current) localRef.current.route = path;
      else requestPath(path);
    },
    // playersRef/selfIdRef/offlineRef는 ref라 안정적.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestPath],
  );

  // 방 라벨 클릭 글로우.
  const [glowRoom, setGlowRoom] = useState<string | null>(null);

  // 커맨드 팔레트 방 포커스(셸 ⌘K, 1b §3) — 전체 플레이트 뷰(팬/줌 없음)라 "씬 카메라 이동"의
  // 등가물 = 방 글로우 + 라벨 표시(방 라벨 클릭과 동일 상태). 같은 라우트면 CustomEvent,
  // 타 라우트 진입이면 /office?focus=<roomId> 쿼리를 마운트 시 1회 반영.
  useEffect(() => {
    const focusRoom = (roomId: string) => {
      if (roomsRef.current.some((r) => r.id === roomId)) setGlowRoom(roomId);
    };
    try {
      const q = new URLSearchParams(window.location.search).get('focus');
      if (q) focusRoom(q);
    } catch {
      // URL 접근 불가 — 이벤트 경로만 사용
    }
    const onFocus = (e: Event) => {
      const roomId = (e as CustomEvent<{ roomId?: string }>).detail?.roomId;
      if (roomId) focusRoom(roomId);
    };
    window.addEventListener('office:focus-room', onFocus);
    return () => window.removeEventListener('office:focus-room', onFocus);
  }, []);

  // ── 씬 시간대 테마 — 자동(로컬 시각) 기본 + 수동 전환(자동→주간→석양→야간 순환) ──
  // autoTheme 초기값은 'day' 고정: SSR/hydration 시각차 방지 — 마운트 후 실제 시각으로 평가.
  const [themeMode, setThemeMode] = useState<'auto' | SceneThemeId>('auto');
  const [autoTheme, setAutoTheme] = useState<SceneThemeId>('day');
  useEffect(() => {
    const evalNow = () => setAutoTheme(themeForHour(new Date().getHours()));
    evalNow();
    const id = setInterval(evalNow, 60_000);
    return () => clearInterval(id);
  }, []);
  const sceneTheme = SCENE_THEMES[themeMode === 'auto' ? autoTheme : themeMode];
  const cycleTheme = useCallback(() => {
    setThemeMode((m) => (m === 'auto' ? 'day' : m === 'day' ? 'dusk' : m === 'dusk' ? 'night' : 'auto'));
  }, []);

  // ── 자율좌석(§3.11) ────────────────────────────────────────────────────
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  /** rAF 루프용 좌석 스냅샷(착석 렌더 판정) — setState와 함께 갱신. */
  const seatsRef = useRef<SeatInfo[]>([]);
  const [seatPrompt, setSeatPrompt] = useState<{ mode: 'sit' | 'release'; seat: SeatInfo } | null>(null);
  const [seatBusy, setSeatBusy] = useState(false);
  /** /api/seats 원본(서버 응답) — V3 override의 소스. */
  const rawSeatsRef = useRef<SeatInfo[]>([]);
  /** 좌석 좌표를 officeV3 정본(seat_number 매칭)으로 재정렬 — 백엔드 시드가 아직
   *  구 좌표여도 마커·착석 스냅이 v3 벤치 위에 정확히 얹힌다.
   *  (백엔드도 seed_seats.py로 같은 V3 좌표를 시드하지만, 프론트 override로 시드 시점과 무관하게 정합.) */
  const applySeatCoords = useCallback((rows: SeatInfo[]): SeatInfo[] => {
    return rows.map((s) => {
      const v = s.seat_number ? V3_SEAT_BY_NUMBER[s.seat_number] : undefined;
      return v ? { ...s, coords: { ...s.coords, x: v.x, y: v.y } } : s;
    });
  }, []);

  // ── 배포 레이아웃 구조(방/벽/구역) — 있으면 편집기 배치를 벡터로 반영, 없으면 데모 씬 ──────
  const [structure, setStructure] = useState<FloorStructure | null>(null);
  const dynRooms = useMemo<SceneRoom[]>(
    () => (structure ? structure.rooms.map((r) => ({ id: r.id, label: r.label, polygon: rectToNormPoly(r.x, r.y, r.w, r.h) })) : []),
    [structure],
  );
  const dynObstacles = useMemo<Vec2[][]>(
    () => (structure ? structure.walls.map((w) => rectToNormPoly(w.x, w.y, w.w, w.h)) : []),
    [structure],
  );
  const dynZones = useMemo(
    () => (structure ? structure.zones.map((z) => ({ id: z.id, label: z.label, color: z.color, poly: z.polygon.map((p) => metersToNorm(p)) })) : []),
    [structure],
  );
  const useDeployed = structure != null;
  // V3 방(축정렬 미터 사각) → 좌석과 동일 metersToNorm 폴리곤. 배포>V3 우선순위.
  const v3Rooms = useMemo<SceneRoom[]>(
    () => V3_ROOMS.map((r) => ({ id: r.id, label: r.label, polygon: rectToNormPoly(r.x, r.y, r.w, r.h) })),
    [],
  );
  const activeRooms = useDeployed ? dynRooms : v3Rooms;
  // rAF/interval 콜백에서 최신 방 목록 참조(의존성 없이).
  const roomsRef = useRef<SceneRoom[]>([]);
  roomsRef.current = activeRooms;

  // 이동 지오메트리 교체 — 우선순위: 배포 레이아웃 > V3 탑다운(축정렬).
  //  · 배포: 클릭-경로·충돌이 배포 경계(bounds 사각)와 벽을 따름(realtime 배포 floor와 정합).
  //  · V3: 축정렬 room 사각 − v3 가구 장애물(officeV3). realtime SCENE_FLOOR=v3와 정합.
  //    이동 불변식 상수는 불변.
  useEffect(() => {
    if (structure?.dimensions) {
      setActiveFloorGeometry({
        walkArea: rectToNormPoly(0, 0, structure.dimensions.width_m, structure.dimensions.height_m),
        obstacles: dynObstacles,
      });
    } else {
      setActiveFloorGeometry({ walkArea: V3_WALK_AREA, obstacles: V3_OBSTACLES });
    }
    return () => setActiveFloorGeometry(null);
  }, [structure, dynObstacles]);

  // 짧은 안내 토스트(사용 중 좌석, API 오류 등).
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // 내 프레즌스 상태(서버 권위 — 300ms 스냅샷 인터벌에서 추종) + 수동 전환 메뉴(§1.2).
  const [myStatus, setMyStatus] = useState<string | null>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  useEffect(() => {
    if (status !== 'connected') setStatusMenuOpen(false);
  }, [status]);

  // ── 스테이지 크기(contain fit) ─────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const scale = Math.min(cw / PLATE_W, ch / PLATE_H);
      setStage({ w: Math.round(PLATE_W * scale), h: Math.round(PLATE_H * scale) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 아바타 외형 batch 조회(로스터 userId + 본인) ─────────────────────────
  useEffect(() => {
    const players = playersRef.current;
    const ids = new Set<string>();
    if (me?.id != null) ids.add(String(me.id));
    for (const sid of roster) {
      const p = players.get(sid);
      if (p?.userId) ids.add(p.userId);
    }
    const list = Array.from(ids).filter((x) => /^-?\d+$/.test(x));
    if (list.length === 0) return;
    let cancelled = false;
    api
      .get<Array<{ user_id: number; preset_id: string; top_color: string; show_nameplate: boolean }>>(
        `/api/avatars?user_ids=${list.join(',')}`,
      )
      .then((rows) => {
        if (cancelled) return;
        setAvatarPrefs((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            next[String(r.user_id)] = {
              preset_id: r.preset_id,
              top_color: r.top_color,
              show_nameplate: r.show_nameplate,
            };
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // playersRef는 ref — roster 변경 시점에만 조회.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, me?.id]);

  // ── 좌석 로드(§3.11) — 마운트 시 + 60초 폴링, 착석/반납 후 재조회 ────────────
  const loadSeats = useCallback(() => {
    api
      .get<SeatInfo[]>('/api/seats')
      .then((rows) => {
        rawSeatsRef.current = rows;
        const mapped = applySeatCoords(rows);
        setSeats(mapped);
        seatsRef.current = mapped;
      })
      .catch(() => {}); // 백엔드 미기동 등 — 좌석 레이어만 비표시(뷰포트는 계속 동작)
  }, [applySeatCoords]);
  useEffect(() => {
    loadSeats();
    const id = setInterval(loadSeats, SEATS_POLL_MS);
    return () => clearInterval(id);
  }, [loadSeats]);

  // ── 배포 레이아웃 구조 로드 — 마운트 + 60초 폴링(관리자 배포/롤백 반영). 미배포/에러 → 데모 씬 유지 ──
  const loadStructure = useCallback(() => {
    api
      .get<FloorStructure>('/api/office-layouts/deployed/structure')
      .then((s) => setStructure(s && s.deployed ? s : null))
      .catch(() => {});
  }, []);
  loadStructureRef.current = loadStructure; // layout_updated 수신 시 즉시 재조회에 연결
  useEffect(() => {
    loadStructure();
    const id = setInterval(loadStructure, SEATS_POLL_MS);
    return () => clearInterval(id);
  }, [loadStructure]);

  const seatLabel = useCallback(
    (seat: SeatInfo) => seat.seat_number ?? `좌석 ${seat.id.slice(0, 8)}`,
    [],
  );

  /** 내 좌석(고정 배정 또는 내가 점유한 자율좌석). */
  const mySeat = useMemo(
    () => seats.find((s) => s.assigned_user_id != null && String(s.assigned_user_id) === myId) ?? null,
    [seats, myId],
  );

  /** "내 자리로" — 내 좌석까지 A* 경로로 걸어가 착석(도착 시 sit 렌더). */
  const goMySeat = useCallback(() => {
    if (!mySeat) {
      showToast('배정된 좌석이 없습니다 — 초록 좌석을 클릭해 앉으세요');
      return;
    }
    // clampToWalkable은 씬 중심 쪽으로 밀어내 좌석에서 멀어진다(실측 1.9m) — 최근접 보행점 사용.
    moveTo(nearestWalkableM({ x: mySeat.coords.x, y: mySeat.coords.y }));
    setGlowRoom(null);
  }, [mySeat, moveTo, showToast]);

  // ── D34 SpotCard 데이터 로더(20-spec §2) — 카드 열릴 때 on-demand 조회, 신규 API 없음 ──
  useEffect(() => {
    if (!spot) return;
    let cancelled = false;
    setSpotRows(null);
    setSpotLive(null);
    const fmtT = (iso: string) =>
      new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
    (async () => {
      const rows: SpotRow[] = [];
      let live: { meetingId?: string; sub?: string } | null = null;
      try {
        if (spot.kind === 'profile') {
          const emp = (
            await api.get<Array<{ id: number; name: string; team_name?: string; presence_status?: string | null }>>(
              '/api/employees?limit=100',
            )
          ).find((e) => String(e.id) === spot.userId);
          let liveStatus: string | null = null;
          playersRef.current.forEach((p) => {
            if (p.userId === spot.userId) liveStatus = p.status;
          });
          const meta = PRESENCE_META[liveStatus ?? emp?.presence_status ?? 'offline'] ?? PRESENCE_META.offline;
          rows.push({ key: 'team', primary: emp?.team_name ?? '팀 미지정', secondary: '소속' });
          rows.push({ key: 'status', primary: meta.label, secondary: '상태', color: meta.color });
        } else if (spot.kind === 'myseat') {
          const today = new Date().toISOString().slice(0, 10);
          const logs = await api.get<Array<{ id: number; title: string; status: string; logged_at: string }>>(
            `/api/work-logs?user_id=${myId}&date=${today}&limit=4`,
          );
          if (!Array.isArray(logs) || logs.length === 0) rows.push({ key: 'nolog', primary: '오늘 등록된 업무가 없습니다' });
          else for (const l of logs) rows.push({ key: `log-${l.id}`, primary: l.title, secondary: fmtT(l.logged_at), color: l.status === 'done' ? '#22C55E' : '#3B5BFE' });
          try {
            const kpi = await api.get<Array<{ metric: string; value: number | null; final_score: number | null }>>(
              `/api/kpi-results?user_id=${myId}&period_type=quarterly`,
            );
            const collab = Array.isArray(kpi) ? kpi.find((r) => r.metric === 'collaboration_score') : undefined;
            if (collab) live = { sub: `나의 KPI(협업) ${Math.round(collab.final_score ?? collab.value ?? 0)}점` };
          } catch {
            // KPI 미집계 — 부제 생략
          }
        } else if (spot.kind === 'room') {
          const roomsApi = await api.get<Array<{ id: string; name: string }>>('/api/rooms');
          const room = (Array.isArray(roomsApi) ? roomsApi : []).find(
            (r) => r.name?.toLowerCase() === (spot.roomLabel ?? '').toLowerCase(),
          );
          if (room) {
            const kstDay = new Date(Date.now() + 9 * 3600_000);
            kstDay.setUTCHours(0, 0, 0, 0);
            const from = new Date(kstDay.getTime() - 9 * 3600_000);
            const to = new Date(from.getTime() + 24 * 3600_000);
            const meetings = await api.get<Array<{ id: string; room_id?: string; title: string; scheduled_at: string; status: string }>>(
              `/api/meetings?scheduled_from=${encodeURIComponent(from.toISOString())}&scheduled_to=${encodeURIComponent(to.toISOString())}&limit=20`,
            );
            const mine = (Array.isArray(meetings) ? meetings : []).filter((m) => m.room_id === room.id && m.status !== 'cancelled');
            if (mine.length === 0) rows.push({ key: 'nomeet', primary: '오늘 이 방 일정이 없습니다' });
            for (const m of mine.slice(0, 4)) {
              rows.push({ key: `m-${m.id}`, primary: m.title, secondary: fmtT(m.scheduled_at), color: m.status === 'in_progress' ? '#EF4444' : undefined });
              if (m.status === 'in_progress' && !live?.meetingId) live = { ...(live ?? {}), meetingId: m.id };
            }
          } else {
            rows.push({ key: 'noroom', primary: '이 방의 회의실 정보가 없습니다' });
          }
          if (spot.roomId === 'lounge') {
            try {
              const msgs = await api.get<Array<{ id: string; user_name: string; content: string }>>(
                '/api/chat/messages?channel=general&limit=3',
              );
              for (const m of Array.isArray(msgs) ? msgs : []) rows.push({ key: `c-${m.id}`, primary: m.content.slice(0, 40), secondary: m.user_name, color: '#38BDF8' });
            } catch {
              // 채널 미가용 — 생략
            }
          }
        } else if (spot.kind === 'board') {
          const res = await api.get<{ items: Array<{ id: string; title: string; created_at: string; pinned?: boolean }> }>(
            '/api/notices?limit=5',
          );
          const items = Array.isArray(res?.items) ? res.items : [];
          if (items.length === 0) rows.push({ key: 'no', primary: '공지사항이 없습니다' });
          for (const n of items) rows.push({ key: `n-${n.id}`, primary: n.title, secondary: n.created_at?.slice(0, 10), color: n.pinned ? '#3B5BFE' : undefined });
        } else if (spot.kind === 'cabinet') {
          const reps = await api.get<Array<{ id: string; title: string; report_type: string; report_date: string; status: string }>>(
            '/api/reports?limit=5',
          );
          const list = Array.isArray(reps) ? reps.slice(0, 5) : [];
          if (list.length === 0) rows.push({ key: 'no', primary: '보고서가 없습니다' });
          for (const r of list) rows.push({ key: `r-${r.id}`, primary: r.title, secondary: `${r.report_date} · ${r.status}` });
        } else if (spot.kind === 'zone') {
          rows.push({ key: 'z', primary: spot.title, secondary: '팀 구역' });
        }
      } catch {
        rows.length = 0;
        rows.push({ key: 'err', primary: '불러오지 못했습니다' });
      }
      if (!cancelled) {
        setSpotRows(rows);
        setSpotLive(live);
      }
    })();
    return () => {
      cancelled = true;
    };
    // playersRef는 ref — spot 변경 시에만 조회.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, myId]);

  /** D34: 내 자율석 반납 — 구 seatPrompt release 모드를 myseat 카드 액션으로 흡수(20-spec §3). */
  const releaseSeat = useCallback(
    async (seat: SeatInfo) => {
      if (seatBusy) return;
      setSeatBusy(true);
      try {
        await api.post(`/api/seat-assignments/${seat.id}/release`, {});
        showToast(`${seatLabel(seat)} 좌석을 반납했습니다`);
        setSpot(null);
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : '좌석 요청에 실패했습니다');
      } finally {
        setSeatBusy(false);
        loadSeats();
      }
    },
    [seatBusy, seatLabel, showToast, loadSeats],
  );

  /** 점유자 표시용 이름 — 접속 중인 플레이어에서 userId 매칭(없으면 null). */
  const occupantName = useCallback(
    (userId: number | null) => {
      if (userId == null) return null;
      let found: string | null = null;
      playersRef.current.forEach((p) => {
        if (found == null && p.userId === String(userId)) found = p.name;
      });
      return found;
    },
    // playersRef는 ref라 안정적.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleSeatClick = useCallback(
    (seat: SeatInfo) => {
      const isMine = seat.assigned_user_id != null && String(seat.assigned_user_id) === myId;
      if (seat.status === 'occupied') {
        // D34: 내 좌석 클릭 = myseat 카드(오늘 업무·KPI·비우기 통합) — 구 release 프롬프트 흡수.
        if (isMine) setSpot({ kind: 'myseat', title: `${myName} — 내 자리` });
        else {
          const who = occupantName(seat.assigned_user_id);
          showToast(`${seatLabel(seat)} — ${who ? `${who} ` : ''}사용 중인 좌석입니다`);
        }
        return;
      }
      if (seat.status !== 'available') {
        showToast(`${seatLabel(seat)} — 사용할 수 없는 좌석입니다`);
        return;
      }
      if (seat.type !== 'free') {
        showToast(`${seatLabel(seat)} — 고정석입니다(관리자 배정 전용)`);
        return;
      }
      setSeatPrompt({ mode: 'sit', seat });
    },
    [myId, occupantName, seatLabel, showToast],
  );

  /** 착석 확정 — REST(§3.11). sit_request(realtime)는 이번 스코프 미사용.
   *  반납은 D34로 myseat 카드의 releaseSeat로 이동(프롬프트는 sit 전용). */
  const confirmSeatPrompt = useCallback(async () => {
    if (!seatPrompt || seatBusy) return;
    const { seat } = seatPrompt;
    setSeatBusy(true);
    try {
      await api.post('/api/seat-assignments', { seat_id: seat.id });
      // 자율석 이동: 이전에 점유한 다른 자율석은 반납(한 사람이 복수 좌석 점유 방지).
      const prevFree = seats.filter(
        (s) =>
          s.id !== seat.id &&
          s.type === 'free' &&
          s.status === 'occupied' &&
          s.assigned_user_id != null &&
          String(s.assigned_user_id) === myId,
      );
      for (const p of prevFree) {
        await api.post(`/api/seat-assignments/${p.id}/release`, {}).catch(() => {});
      }
      // 아바타를 좌석의 최근접 보행 지점으로 이동 — 도착하면 착석 렌더(SEAT_SNAP_M).
      moveTo(nearestWalkableM({ x: seat.coords.x, y: seat.coords.y }));
      showToast(`${seatLabel(seat)} 좌석을 점유했습니다`);
    } catch (err) {
      // 409 seat_already_occupied 등 — ApiError.message(한국어 매핑/코드) 표시.
      showToast(err instanceof ApiError ? err.message : '좌석 요청에 실패했습니다');
    } finally {
      setSeatBusy(false);
      setSeatPrompt(null);
      loadSeats(); // 성공/실패 모두 서버 상태 재동기화
    }
  }, [seatPrompt, seatBusy, seats, myId, moveTo, seatLabel, showToast, loadSeats]);

  // ── 회의실 근접(2m) → enter_meeting(D24) — 방 진입 전환 시 서버에 요청 ─────────
  const currentRoomRef = useRef<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const self = playersRef.current.get(selfIdRef.current);
      if (!self) {
        currentRoomRef.current = null;
        return;
      }
      const n = metersToNorm({ x: self.x, y: self.y });
      const room = roomsRef.current.find((rm) => pointInPolygon(n, rm.polygon));
      const rid = room?.id ?? null;
      if (rid !== currentRoomRef.current) {
        currentRoomRef.current = rid;
        setMeetingPrompt(null); // 방 전환 시 이전 프롬프트 정리
        if (rid) enterMeeting(rid); // 회의존 아니면 서버가 denied → 무시
      }
    }, 600);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 미니맵 실시간 아바타 위치(#12) — 300ms 스냅샷을 React state로 ────────────
  const [dots, setDots] = useState<Array<{ key: string; nx: number; ny: number; isSelf: boolean }>>([]);
  useEffect(() => {
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    const id = setInterval(() => {
      const players = playersRef.current;
      const selfId = selfIdRef.current;
      const next: Array<{ key: string; nx: number; ny: number; isSelf: boolean }> = [];
      players.forEach((p, key) => {
        const n = metersToNorm({ x: p.x, y: p.y });
        next.push({ key, nx: clamp01(n.x), ny: clamp01(n.y), isSelf: key === selfId });
      });
      if (next.length === 0 && offlineRef.current) {
        const n = metersToNorm(localRef.current.pos);
        next.push({ key: '__local__', nx: clamp01(n.x), ny: clamp01(n.y), isSelf: true });
      }
      setDots(next);
      // 내 프레즌스 상태(서버 권위) 추종 — 상태 버튼 표시용(§1.2).
      const selfPlayer = players.get(selfId);
      setMyStatus((prev) => {
        const s = selfPlayer?.status ?? null;
        return s === prev ? prev : s;
      });
    }, 300);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 아바타 셸 목록(React 렌더) ─────────────────────────────────────────
  const shells: ShellInfo[] = useMemo(() => {
    const build = (key: string, userId: string, name: string, isSelf: boolean): ShellInfo => {
      const pref = avatarPrefs[userId];
      return {
        key,
        char: characterForAvatar(userId, pref?.preset_id),
        name,
        userId,
        isSelf,
        showNameplate: pref?.show_nameplate ?? true,
        accent: pref?.top_color ?? (isSelf ? '#3B5BFE' : 'rgba(255,255,255,.32)'),
      };
    };
    if (offline || roster.length === 0) {
      // 오프라인(또는 아직 미접속): 본인 로컬 아바타만.
      return offline ? [build('__local__', myId, myName, true)] : [];
    }
    const players = playersRef.current;
    return roster.map((sid) => {
      const p = players.get(sid);
      return build(sid, p?.userId ?? sid, p?.name ?? '…', sid === selfIdRef.current);
    });
    // playersRef/selfIdRef는 ref — roster/prefs 변경 시점에만 재계산하면 충분.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, offline, myName, myId, avatarPrefs]);

  // 아바타 DOM 레지스트리(rAF 루프가 갱신).
  const visualsRef = useRef<Map<string, AvatarVisual>>(new Map());

  /** key별 ref 콜백 캐시 — 렌더마다 새 콜백을 주면 React가 300ms 리렌더(미니맵 등)마다
   *  ref를 detach/attach 하면서 비주얼 상태(disp·frame·facing·stillSec)를 리셋한다
   *  → 착석 스냅이 풀리며 스프링처럼 튕기고, 걷기 프레임이 0~2만 반복되는 원인. */
  const refCbCache = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());

  const registerAvatar = useCallback(
    (key: string, char: CharacterId, userId: string) => {
      const cacheKey = `${key}|${char}|${userId}`;
      const cached = refCbCache.current.get(cacheKey);
      if (cached) return cached;
      const cb = makeAvatarRef(key, char, userId);
      refCbCache.current.set(cacheKey, cb);
      return cb;
    },
    // makeAvatarRef는 ref들만 캡처 — 안정적.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const makeAvatarRef = useCallback(
    (key: string, char: CharacterId, userId: string) => (el: HTMLDivElement | null) => {
      const visuals = visualsRef.current;
      if (!el) {
        visuals.delete(key);
        refCbCache.current.delete(`${key}|${char}|${userId}`);
        return;
      }
      const motion = el.querySelector<HTMLDivElement>('.vo-motion');
      const img = el.querySelector<HTMLElement>('.vo-body');
      if (!motion || !img) return;
      const start =
        key === '__local__'
          ? { ...localRef.current.pos }
          : (() => {
              const p = playersRef.current.get(key);
              return p ? { x: p.x, y: p.y } : normToMeters(SPAWNS.lobby);
            })();
      visuals.set(key, {
        root: el,
        motion,
        img,
        disp: { ...start },
        prev: { ...start },
        prevSrv: { ...start },
        stillSec: 0,
        state: 'idle',
        frame: 0,
        frameAcc: 0,
        facing: 1,
        char,
        userId,
      });
    },
    // playersRef는 ref라 안정적.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── rAF 시뮬레이션/렌더 루프 ───────────────────────────────────────────
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { w: sw, h: sh } = stageRef.current;
      const visuals = visualsRef.current;

      // 로컬 폴백 이동 통합(서버와 동일 속도 모델) — A* 경유지 큐를 순서대로 소비.
      if (offlineRef.current) {
        const L = localRef.current;
        const wp = L.route[0];
        if (wp) {
          const dx = wp.x - L.pos.x;
          const dy = wp.y - L.pos.y;
          const d = Math.hypot(dx, dy);
          if (d < (L.route.length > 1 ? 0.12 : 0.05)) L.route.shift();
          else {
            const step = Math.min(d, MAX_SPEED_MPS * dt);
            const next = { x: L.pos.x + (dx / d) * step, y: L.pos.y + (dy / d) * step };
            // 경로는 보행 가능 셀만 지나지만 안전망으로 서버와 동일 규칙 유지.
            if (isWalkable(metersToNorm(next))) {
              L.pos = next;
            } else {
              L.route = [];
            }
          }
        }
      }

      if (sw > 0) {
        visuals.forEach((v, key) => {
          // 목표 위치(미터): 서버 권위 or 로컬.
          let target: Vec2 | null = null;
          if (key === '__local__') {
            target = localRef.current.pos;
          } else {
            const p = playersRef.current.get(key);
            if (p) target = { x: p.x, y: p.y };
          }
          if (!target) return;

          // 착석 판정(v1.1): 내게 배정/점유된 좌석(복수 가능 — 고정석+자율석) 중
          // **가장 가까운** 것에 스냅. 서버 위치가 0.35초 연속 정지했을 때만 발동 —
          // 시간 기반(프레임 수 기반은 고주사율 모니터에서 패치 간격과 경합해 진동).
          const srvMoved = Math.hypot(target.x - v.prevSrv.x, target.y - v.prevSrv.y) > 0.005;
          v.prevSrv = { ...target };
          v.stillSec = srvMoved ? 0 : v.stillSec + dt;
          let seated = false;
          if (v.stillSec >= 0.35) {
            let best = SEAT_SNAP_M;
            let bestSeat: SeatInfo | null = null;
            for (const s of seatsRef.current) {
              if (s.assigned_user_id == null || String(s.assigned_user_id) !== v.userId) continue;
              if (typeof s.coords?.x !== 'number' || typeof s.coords?.y !== 'number') continue;
              const dd = Math.hypot(target.x - s.coords.x, target.y - s.coords.y);
              if (dd < best) {
                best = dd;
                bestSeat = s;
              }
            }
            if (bestSeat) {
              target = { x: bestSeat.coords.x, y: bestSeat.coords.y };
              seated = true;
            }
          }

          // 표시 위치 보간.
          const k = Math.min(1, LERP_RATE * dt);
          v.disp.x += (target.x - v.disp.x) * k;
          v.disp.y += (target.y - v.disp.y) * k;

          // 속도로 idle/walk/sit + 방향 판정.
          const vx = (v.disp.x - v.prev.x) / Math.max(dt, 1e-4);
          const vy = (v.disp.y - v.prev.y) / Math.max(dt, 1e-4);
          const speed = Math.hypot(vx, vy);
          // 착석 중엔 타이핑 버스트(벽시계 위상 — 클라이언트 간 동일)로 sit ↔ typing 교대.
          const nextState: AvatarState =
            speed > WALK_EPS_MPS
              ? 'walk'
              : seated
                ? typingBurstAt(v.userId, Date.now())
                  ? 'typing'
                  : 'sit'
                : 'idle';
          // 좌우 플립은 히스테리시스(0.25m/s) — 수직 이동 시 vx 노이즈로 파닥이지 않게.
          if (Math.abs(vx) > 0.25) v.facing = vx < 0 ? -1 : 1;
          if (nextState !== v.state) {
            v.state = nextState;
            v.frame = 0;
            v.frameAcc = 0;
            v.motion.className = `vo-motion vo-anim-${nextState}`;
          }
          v.prev = { ...v.disp };

          // 화면 배치.
          const n = metersToNorm(v.disp);
          const px = n.x * sw;
          const py = n.y * sh;
          v.root.style.left = `${px}px`;
          v.root.style.top = `${py}px`;
          // 착석 시 +150 바이어스: 자기 의자 스프라이트(전면 모서리 baseline)가
          // 앉은 아바타를 덮지 않게 — 의자 반깊이(~0.25m ≈ 64) 이상, 남측 옆 가구(≥0.9m) 미만.
          const isSeatedState = v.state === 'sit' || v.state === 'typing';
          v.root.style.zIndex = String(Math.round(n.y * 10000) + (isSeatedState ? 150 : 0));
          // 배지 = 사진 T=0.58m 스케일(≈5.2% 스테이지 높이). flip 없음(이니셜 좌우 반전 방지).
          v.img.style.height = `${0.052 * sh}px`;
        });
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // playersRef/localRef는 ref — 루프는 마운트당 1회.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 클릭 이동 ──────────────────────────────────────────────────────────
  const handleStageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const n: Vec2 = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      const clamped = clampToWalkable(n);
      moveTo(normToMeters(clamped)); // A* 경로 — 유리벽 회의실도 문으로 진입
      setSpot(null); // D34: 빈 곳 클릭(이동) 시 스팟 카드 닫기
      // 방 폴리곤 안 클릭이면 글로우도.
      const room = roomsRef.current.find((rm) => pointInPolygon(n, rm.polygon));
      if (room) setGlowRoom(room.id);
    },
    [moveTo],
  );

  // ── 연결 상태 칩 ───────────────────────────────────────────────────────
  const statusChip =
    status === 'connected'
      ? { text: '실시간 연결됨', color: '#22C55E' }
      : status === 'reconnecting'
        ? { text: '재연결 중…', color: '#F59E0B' }
        : status === 'connecting'
          ? { text: '이동서버 연결 중…', color: '#F59E0B' }
          : { text: '오프라인 모드 (로컬 이동)', color: '#64748B' };

  const glowRect = useMemo(() => {
    const room = activeRooms.find((r) => r.id === glowRoom);
    if (!room) return null;
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }, [glowRoom, activeRooms]);

  // isolate: 내부의 큰 z-index(아바타·라벨 ≤23000)를 이 컴포넌트 안에 가둬 셸 오버레이(z-20)를 뚫지 않게 함
  return (
    <div ref={containerRef} className="absolute inset-0 isolate flex items-center justify-center overflow-hidden">
      {/* 스테이지 = 플레이트 비율 고정(contain) */}
      <div
        className="relative select-none"
        style={{ width: stage.w, height: stage.h, cursor: 'pointer' }}
        onClick={handleStageClick}
      >
        {/* 씬 톤 래퍼 — 시간대 테마 필터를 씬·아바타·씬내 오버레이에 일괄 적용(톤 정합, D29 교훈).
            프롬프트·미니맵·칩(z 22000+)은 래퍼 밖 형제라 테마와 무관하게 선명 유지. */}
        <div
          className="absolute inset-0"
          style={{
            filter: sceneTheme.filter === 'none' ? undefined : sceneTheme.filter,
            transition: 'filter 1000ms ease',
          }}
        >
        {!useDeployed ? (
          /* D35 씬 V3 — 텍스처드 탑다운 캔버스를 배경으로. 존 색면·핫스팟·좌석 마커·
             아바타는 아래 형제 레이어가 좌표(metersToNorm) 기반으로 그대로 얹힌다. */
          <div className="absolute inset-0 w-full h-full" style={{ background: '#EBE7E0' }}>
            <SceneV3Layer theme={sceneTheme.id} />
          </div>
        ) : (
          /* 배포된 편집기 레이아웃을 벡터로 렌더 — 좌석배치대로 반영(방/벽/구역). 좌표=좌석과 동일 metersToNorm(0~1). */
          <div
            className="absolute inset-0 w-full h-full"
            style={{ background: 'linear-gradient(160deg,#1c2941 0%,#141f33 55%,#0f1828 100%)' }}
          >
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1 1" preserveAspectRatio="none">
              {dynZones.map((z) => (
                <polygon
                  key={z.id}
                  points={z.poly.map((v) => `${v.x},${v.y}`).join(' ')}
                  fill={`${z.color}22`}
                  stroke={z.color}
                  strokeWidth={0.0022}
                  strokeDasharray="0.012 0.008"
                />
              ))}
              {activeRooms.map((r) => (
                <polygon
                  key={r.id}
                  points={r.polygon.map((v) => `${v.x},${v.y}`).join(' ')}
                  fill="rgba(124,58,237,.10)"
                  stroke="rgba(168,150,240,.6)"
                  strokeWidth={0.0028}
                />
              ))}
              {dynObstacles.map((o, i) => (
                <polygon
                  key={i}
                  points={o.map((v) => `${v.x},${v.y}`).join(' ')}
                  fill="rgba(120,53,15,.6)"
                  stroke="rgba(140,70,25,.85)"
                  strokeWidth={0.0015}
                />
              ))}
            </svg>
            <div
              className="absolute left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-semibold"
              style={{ top: 10, background: 'rgba(7,16,29,.85)', color: '#9fd0a8', border: '1px solid rgba(120,200,150,.35)', zIndex: 5 }}
            >
              배포된 좌석배치 반영 (편집기 레이아웃)
            </div>
          </div>
        )}

        {/* 방 클릭 글로우 (overlay-tokens.activeGlow) — 존 바닥 색면은 V3 캔버스가 자체 렌더(카펫/타일/유리) */}
        {glowRect && (
          <div
            className="absolute pointer-events-none transition-opacity duration-300"
            style={{
              left: `${glowRect.left * 100}%`,
              top: `${glowRect.top * 100}%`,
              width: `${glowRect.w * 100}%`,
              height: `${glowRect.h * 100}%`,
              border: '3px solid #2E7BFF',
              borderRadius: 10,
              boxShadow: '0 0 18px #2E7BFF, inset 0 0 18px rgba(46,123,255,.25)',
              zIndex: 20000,
            }}
          />
        )}

        {/* 방 라벨 (overlay-tokens.roomLabel) — D33(P0-5): 씬 모드에선 선택(글로우) 시에만 표시.
            배포 모드는 색면 존이 자체 렌더라 라벨 상시 유지. */}
        {activeRooms.map((room) => {
          const c = polygonCentroid(room.polygon);
          const visible = useDeployed || glowRoom === room.id;
          return (
            <button
              key={room.id}
              type="button"
              tabIndex={visible ? 0 : -1}
              aria-hidden={!visible}
              onClick={(e) => {
                e.stopPropagation();
                // D34 W1-3: 방 라벨 클릭 = 오늘 일정 카드(예약/입장 진입점)
                setGlowRoom(room.id);
                setSpot({ kind: 'room', title: room.label, roomId: room.id, roomLabel: room.label });
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 px-2.5 py-1 rounded-[12px] text-[11px] font-bold text-white transition-opacity duration-200"
              style={{
                left: `${c.x * 100}%`,
                top: `${c.y * 100}%`,
                background: 'rgba(7,14,27,.88)',
                border: '1px solid rgba(255,255,255,.14)',
                zIndex: 21000,
                opacity: visible ? 1 : 0,
                pointerEvents: visible ? 'auto' : 'none',
              }}
            >
              {room.label}
            </button>
          );
        })}

        {/* 구역(zone) 라벨 — 배포 레이아웃에만 존재(팀 구역 배치 반영). D34 W2-3: 클릭=팀 존 카드. */}
        {dynZones.map((z) => {
          const c = polygonCentroid(z.poly);
          return (
            <button
              key={z.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSpot({ kind: 'zone', title: z.label });
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-[10px] text-[10px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
              style={{
                left: `${c.x * 100}%`,
                top: `${c.y * 100}%`,
                background: 'rgba(7,14,27,.7)',
                color: z.color,
                border: `1px solid ${z.color}`,
                zIndex: 20500,
                cursor: 'pointer',
              }}
            >
              {z.label}
            </button>
          );
        })}

        {/* 자율좌석 마커(§3.11) — 미터→norm→% 배치. z 고정: 라벨(21000) 아래, 아바타(≤10000) 위.
            앵커는 바닥점이지만 마커는 방석 높이(0.45m)만큼 올려 그린다 — 바닥점은 이소메트릭에서
            앞줄 책상 상판에 가려/겹쳐 보여 어느 의자의 마커인지 오독된다(뒤 의자 클릭했는데 앞 의자 착석 사고). */}
        {seats.map((seat) => {
          if (typeof seat.coords?.x !== 'number' || typeof seat.coords?.y !== 'number') return null;
          const n = metersToNorm({ x: seat.coords.x, y: seat.coords.y });
          if (n.x < -0.02 || n.x > 1.02 || n.y < -0.02 || n.y > 1.02) return null; // 플레이트 밖 좌표 방어
          const cushionUpPx = 0.45 * 48 * (stage.w / PLATE_W); // 0.45m × ZPX(48px/m) × 플레이트→스테이지 배율
          const isMine = seat.assigned_user_id != null && String(seat.assigned_user_id) === myId;
          const occupied = seat.status === 'occupied';
          const unavailable = seat.status === 'disabled' || seat.status === 'reserved';
          // 미배정 고정석: 클릭해도 앉을 수 없음(관리자 배정 전용) — 초록(착석 가능)으로 위장 금지.
          const fixedUnassigned = !occupied && !unavailable && !isMine && seat.type !== 'free';
          const border = isMine
            ? '#3B5BFE'
            : occupied
              ? '#64748B'
              : unavailable || fixedUnassigned
                ? '#3A4763'
                : '#22C55E';
          const fill = isMine
            ? 'rgba(59,91,254,.9)'
            : occupied
              ? 'rgba(100,116,139,.85)'
              : unavailable || fixedUnassigned
                ? 'rgba(30,41,59,.6)'
                : 'rgba(7,16,29,.85)';
          const who = occupied ? occupantName(seat.assigned_user_id) : null;
          const title = isMine
            ? `${seatLabel(seat)} — 내 좌석 (클릭: 자리 비우기)`
            : occupied
              ? `${seatLabel(seat)} — ${who ? `${who} ` : ''}사용 중`
              : unavailable
                ? `${seatLabel(seat)} — 사용 불가`
                : fixedUnassigned
                  ? `${seatLabel(seat)} — 고정석(관리자 배정)`
                  : `${seatLabel(seat)} — 클릭해서 앉기`;
          const seatTop = `calc(${n.y * 100}% - ${cushionUpPx.toFixed(1)}px)`;
          return (
            <Fragment key={seat.id}>
              {isMine && (
                <>
                  {/* 내 자리 펄스 링 — 확실한 위치 강조 */}
                  <span
                    aria-hidden
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full animate-ping pointer-events-none"
                    style={{
                      left: `${n.x * 100}%`,
                      top: seatTop,
                      width: 22,
                      height: 22,
                      border: '2px solid rgba(59,91,254,.85)',
                      zIndex: SEAT_Z,
                    }}
                  />
                  {/* 내 자리 라벨 필 */}
                  <span
                    className="absolute -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 rounded-md text-[9px] font-bold text-white pointer-events-none"
                    style={{
                      left: `${n.x * 100}%`,
                      top: `calc(${n.y * 100}% - ${(cushionUpPx + 20).toFixed(1)}px)`,
                      background: '#3B5BFE',
                      boxShadow: '0 0 8px rgba(59,91,254,.7)',
                      zIndex: SEAT_Z + 1,
                    }}
                  >
                    ★ 내 자리
                  </span>
                </>
              )}
              {/* 히트영역(30px 투명)과 가시 점을 분리 — 의자 몸통 클릭이 방 폴리곤(z30)에
                  삼켜지지 않게 좌석 타깃을 넓힌다(마커 점은 기존 크기 유지). */}
              <button
                type="button"
                title={title}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSeatClick(seat);
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
                style={{
                  left: `${n.x * 100}%`,
                  top: seatTop,
                  width: 30,
                  height: 30,
                  background: 'transparent',
                  border: 'none',
                  zIndex: SEAT_Z,
                  cursor: unavailable || fixedUnassigned ? 'default' : 'pointer',
                }}
              >
                <span
                  className="rounded-[3px]"
                  style={{
                    width: isMine ? 13 : 10,
                    height: isMine ? 13 : 10,
                    background: fill,
                    border: `2px solid ${border}`,
                    boxShadow: isMine
                      ? '0 0 10px rgba(59,91,254,.95)'
                      : occupied || unavailable || fixedUnassigned
                        ? 'none'
                        : '0 0 6px rgba(34,197,94,.55)',
                  }}
                />
              </button>
            </Fragment>
          );
        })}

        {/* D34 핫스팟(씬 모드 한정) — 게시판(공지)/서류함(보고서) 아이콘 칩, 좌석 마커와 동일 z 패턴.
            위치 = V3_HOTSPOTS_NORM(축정렬 리셉션/팬트리 벽). */}
        {!useDeployed &&
          HOTSPOTS.map((h) => {
            const pos = V3_HOTSPOTS_NORM[h.id] ?? h.n;
            return (
            <button
              key={h.id}
              type="button"
              title={h.title}
              aria-label={h.title}
              onClick={(e) => {
                e.stopPropagation();
                setSpot({ kind: h.kind, title: h.title });
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-transform hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
              style={{
                left: `${pos.x * 100}%`,
                top: `${pos.y * 100}%`,
                width: 24,
                height: 24,
                fontSize: 12,
                background: 'rgba(7,16,29,.85)',
                border: '1px solid rgba(255,255,255,.28)',
                zIndex: SEAT_Z,
                cursor: 'pointer',
              }}
            >
              {h.icon}
            </button>
            );
          })}

        {/* 아바타 레이어 */}
        {shells.map((s) => (
          <div
            key={s.key}
            ref={registerAvatar(s.key, s.char, s.userId)}
            className="absolute pointer-events-none"
            style={{ transform: 'translate(-50%, -100%)', willChange: 'left, top' }}
          >
            {/* 접지 그림자 */}
            <div
              className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2"
              style={{
                width: '58%',
                height: 12,
                borderRadius: '50%',
                background: 'radial-gradient(ellipse, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 70%)',
              }}
            />
            {/* 본인 발밑 링(D33 P0-4) — "(나)" 텍스트 대신 링으로 본인 식별 */}
            {s.isSelf && (
              <div
                aria-hidden
                className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 pointer-events-none"
                style={{
                  width: '86%',
                  height: 15,
                  borderRadius: '50%',
                  border: '2px solid rgba(59,91,254,.8)',
                  boxShadow: '0 0 10px rgba(59,91,254,.55), inset 0 0 6px rgba(59,91,254,.35)',
                }}
              />
            )}
            {/* 코드 모션 래퍼(바운스) — 상태별 CSS 모션만, 프레임 스프라이트 없음 */}
            <div className="vo-motion vo-anim-idle">
              {/* D35 — 사진 배지 아바타(라운드 사각). 사진 필드 부재 시 이니셜+정체성 색.
                  높이는 rAF가 설정(.vo-body). 걷기 프레임 애니 없음(글라이드만). */}
              <div
                className="vo-body flex items-center justify-center relative"
                style={{
                  aspectRatio: '1',
                  transformOrigin: '50% 100%',
                  borderRadius: '22%',
                  background: `linear-gradient(150deg, ${s.accent} 0%, rgba(20,32,52,.96) 95%)`,
                  border: `2px solid ${s.isSelf ? 'rgba(59,91,254,.95)' : 'rgba(255,255,255,.55)'}`,
                  boxShadow: '0 3px 10px rgba(0,0,0,.35)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '42%',
                  letterSpacing: '.02em',
                }}
              >
                {s.name.length >= 3 ? s.name.slice(1) : s.name.slice(0, 2)}
                {/* 상태점 — 본인=프레즌스 색, 타인=정체성 색(nameplate와 동일 규칙) */}
                <span
                  aria-hidden
                  className="absolute rounded-full"
                  style={{
                    right: '-6%',
                    bottom: '-6%',
                    width: '26%',
                    height: '26%',
                    background: s.isSelf ? (PRESENCE_META[myStatus ?? ''] ?? PRESENCE_META.offline).color : s.accent,
                    border: '2px solid #fff',
                  }}
                />
              </div>
            </div>
            {/* 이름표 (show_nameplate=false면 숨김, #6) — D33 P0-4 다이어트:
                이름+상태점만(상태 텍스트·"(나)" 제거), 본인=파란 테두리+발밑 링으로 식별.
                본인 점=프레즌스 상태색(업무중 즉시 식별), 타인 점=정체성 색(accent). */}
            {s.showNameplate && (
              <div
                className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap px-1.5 py-[1px] rounded-full text-[10px] font-medium text-white flex items-center gap-1"
                style={{
                  top: -14,
                  background: 'rgba(7,16,29,.78)',
                  border: `1px solid ${s.isSelf ? 'rgba(59,91,254,.9)' : 'rgba(255,255,255,.16)'}`,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0"
                  style={{ background: s.isSelf ? (PRESENCE_META[myStatus ?? ''] ?? PRESENCE_META.offline).color : s.accent }}
                />
                {s.name}
              </div>
            )}
            {/* D34 W1-1/W1-2: 아바타 클릭 = 프로필(타인)/내 업무(본인) 카드 진입점 */}
            <button
              type="button"
              aria-label={s.isSelf ? '내 업무·자리 카드' : `${s.name} 프로필`}
              title={s.isSelf ? '내 업무·자리' : `${s.name} 프로필`}
              onClick={(e) => {
                e.stopPropagation();
                setSpot(
                  s.isSelf
                    ? { kind: 'myseat', title: `${s.name} — 내 자리` }
                    : { kind: 'profile', title: s.name, userId: s.userId },
                );
              }}
              className="absolute inset-0 pointer-events-auto"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
            />
          </div>
        ))}

        {/* 앰비언트 라이트 오버레이 — 가구·아바타(≤10150) 위, 좌석 마커(15000) 아래.
            테마별 개별 레이어의 opacity 크로스페이드로 석양↔야간 전환도 부드럽게. */}
        {(['dusk', 'night'] as SceneThemeId[]).map((t) => (
          <div
            key={t}
            className="absolute inset-0 pointer-events-none"
            style={{
              background: SCENE_THEMES[t].overlay,
              opacity: sceneTheme.id === t ? SCENE_THEMES[t].overlayOpacity : 0,
              transition: 'opacity 1000ms ease',
              zIndex: 12000,
            }}
          />
        ))}
        </div>

        {/* 회의 명시입장 프롬프트(D24) — 서버 2m 근접+정원 통과 시 표시 */}
        {meetingPrompt && (
          <div
            className="absolute left-1/2 top-3 -translate-x-1/2 flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[13px] text-white shadow-lg"
            style={{ background: 'rgba(7,16,29,.96)', border: '1px solid #3B5BFE', zIndex: 23000 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span>
              <b>{meetingPrompt.label}</b> 회의실에 입장하시겠어요?
            </span>
            <button
              type="button"
              onClick={() => {
                onJoinMeeting?.(meetingPrompt.roomId);
                setMeetingPrompt(null);
              }}
              className="px-3 py-1 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary-hover"
            >
              입장하기
            </button>
            <button
              type="button"
              onClick={() => setMeetingPrompt(null)}
              className="px-2 py-1 rounded-md text-text-muted text-xs hover:text-white"
            >
              취소
            </button>
          </div>
        )}

        {/* 착석 확인 프롬프트(§3.11, D34로 sit 전용) — 회의 프롬프트와 동일 스타일 상단 카드 */}
        {seatPrompt && (
          <div
            className={`absolute left-1/2 ${meetingPrompt ? 'top-16' : 'top-3'} -translate-x-1/2 flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[13px] text-white shadow-lg`}
            style={{ background: 'rgba(7,16,29,.96)', border: '1px solid #3B5BFE', zIndex: 23000 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span>
              이 자리에 앉기 (<b>{seatLabel(seatPrompt.seat)}</b>)
            </span>
            <button
              type="button"
              disabled={seatBusy}
              onClick={() => void confirmSeatPrompt()}
              className="px-3 py-1 rounded-md text-white text-xs font-semibold disabled:opacity-50 bg-primary hover:bg-primary-hover"
            >
              앉기
            </button>
            <button
              type="button"
              onClick={() => setSeatPrompt(null)}
              className="px-2 py-1 rounded-md text-text-muted text-xs hover:text-white"
            >
              취소
            </button>
          </div>
        )}

        {/* D34 SpotCard(20-spec) — 공간 진입점 미니 카드. 폼/상세는 오버레이 창 라우트로. */}
        {spot && (
          <div
            className={`absolute left-1/2 ${meetingPrompt || seatPrompt ? 'top-20' : 'top-3'} -translate-x-1/2 w-72 rounded-xl text-white shadow-2xl overflow-hidden`}
            style={{ background: 'rgba(7,16,29,.96)', border: '1px solid #273350', zIndex: 23000 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pl-3 pr-2 py-2 border-b border-border-subtle">
              <span className="text-[12px] font-semibold truncate">{spot.title}</span>
              <button
                type="button"
                onClick={() => setSpot(null)}
                aria-label="닫기"
                className="w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
            </div>
            {spotLive?.sub && (
              <div className="px-3 pt-2 text-[10px] font-medium" style={{ color: '#38BDF8' }}>
                {spotLive.sub}
              </div>
            )}
            <div className="py-1 max-h-44 overflow-y-auto">
              {spotRows === null ? (
                <div className="px-3 py-3 text-[11px] text-text-muted">불러오는 중…</div>
              ) : (
                spotRows.map((r) => (
                  <div key={r.key} className="px-3 py-1.5 flex items-start gap-2">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: r.color ?? 'rgba(255,255,255,.25)' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-white truncate">{r.primary}</div>
                      {r.secondary && <div className="text-[9px] text-text-muted">{r.secondary}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-1.5 px-2 py-2 border-t border-border-subtle flex-wrap">
              {spot.kind === 'profile' && (
                <button type="button" onClick={() => router.push('/chat')} className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-primary text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                  채팅 열기
                </button>
              )}
              {spot.kind === 'myseat' && (
                <>
                  <button type="button" onClick={() => router.push('/work-log')} className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-primary text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                    기록 추가
                  </button>
                  <button type="button" onClick={() => router.push('/kpi')} className="px-2.5 py-1 rounded-lg text-[10px] font-medium border border-border-subtle text-text-secondary hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                    KPI 상세
                  </button>
                  {mySeat && (
                    <button
                      type="button"
                      onClick={() => {
                        goMySeat();
                        setSpot(null);
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium border border-border-subtle text-text-secondary hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                    >
                      내 자리로 걷기
                    </button>
                  )}
                  {mySeat && mySeat.status === 'occupied' && (
                    <button
                      type="button"
                      disabled={seatBusy}
                      onClick={() => void releaseSeat(mySeat)}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                    >
                      자리 비우기
                    </button>
                  )}
                </>
              )}
              {spot.kind === 'room' && (
                <>
                  <button type="button" onClick={() => router.push('/meetings')} className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-primary text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                    예약
                  </button>
                  {spotLive?.meetingId && (
                    <button
                      type="button"
                      onClick={() => {
                        if (spot.roomId) onJoinMeeting?.(spot.roomId);
                        setSpot(null);
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-white bg-rose-600 hover:bg-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                    >
                      ● 입장하기
                    </button>
                  )}
                  {spot.roomId === 'lounge' && (
                    <button type="button" onClick={() => router.push('/chat')} className="px-2.5 py-1 rounded-lg text-[10px] font-medium border border-border-subtle text-text-secondary hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                      채팅 열기
                    </button>
                  )}
                </>
              )}
              {spot.kind === 'cabinet' && (
                <button type="button" onClick={() => router.push('/reports')} className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-primary text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                  보고서 열기
                </button>
              )}
              {spot.kind === 'zone' && (
                <>
                  <button type="button" onClick={() => router.push('/work-status')} className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-primary text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                    업무현황
                  </button>
                  <button type="button" onClick={() => router.push('/chat')} className="px-2.5 py-1 rounded-lg text-[10px] font-medium border border-border-subtle text-text-secondary hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                    팀 채팅
                  </button>
                </>
              )}
              {spot.kind === 'board' && (
                <span className="px-1 text-[9px] text-text-muted">최근 공지 5건 — 전체는 상단 알림에서</span>
              )}
            </div>
          </div>
        )}

        {/* 안내 토스트 — 사용 중 좌석/오류 메시지(§3.11). bottom-16: 하단 독(D33)과 겹침 방지 */}
        {toast && (
          <div
            className="absolute left-1/2 bottom-16 -translate-x-1/2 px-3.5 py-2 rounded-lg text-[12px] text-white pointer-events-none whitespace-nowrap"
            style={{ background: 'rgba(7,16,29,.94)', border: '1px solid rgba(255,255,255,.16)', zIndex: 23000 }}
          >
            {toast}
          </div>
        )}
        {/* 미니맵 (좌하단 오버레이, design-style §4) — 실시간 아바타 위치(#12).
            D33 P0-3: 층 전환을 헤더로 흡수(구 사이드바 도면 위젯 대체) + 접기 지원. */}
        {minimapOpen ? (
          <div
            className="absolute left-3 bottom-3 rounded-lg overflow-hidden"
            style={{
              width: 152,
              background: 'rgba(7,16,29,.9)',
              border: '1px solid #273350',
              zIndex: 22000,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-0.5 px-1 pt-1 pb-0.5">
              {FLOORS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setActiveFloor(f)}
                  aria-pressed={activeFloor === f}
                  title={f === '2F' ? '2F' : `${f} — 준비중`}
                  className={[
                    'flex-1 py-0.5 rounded text-[9px] font-semibold transition-colors leading-none',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
                    activeFloor === f ? 'bg-primary text-white' : 'text-text-muted hover:text-text-secondary',
                  ].join(' ')}
                >
                  {f}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMinimapOpen(false)}
                title="미니맵 접기"
                aria-label="미니맵 접기"
                className="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-2.5 h-2.5"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
            </div>
            <div style={{ height: Math.round((152 * PLATE_H) / PLATE_W) }} className="pointer-events-none">
              <svg viewBox="0 0 100 56.3" className="w-full h-full" preserveAspectRatio="none">
                {activeRooms.map((r) => (
                  <polygon
                    key={r.id}
                    points={r.polygon.map((p) => `${p.x * 100},${p.y * 56.3}`).join(' ')}
                    fill="#1E2940"
                    stroke="#38BDF8"
                    strokeWidth={0.4}
                    opacity={0.5}
                  />
                ))}
                {dots.map((d) => (
                  <circle
                    key={d.key}
                    cx={d.nx * 100}
                    cy={d.ny * 56.3}
                    r={d.isSelf ? 2 : 1.5}
                    fill={d.isSelf ? '#3B5BFE' : '#22C55E'}
                    stroke={d.isSelf ? '#ffffff' : 'none'}
                    strokeWidth={0.5}
                  />
                ))}
              </svg>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMinimapOpen(true);
            }}
            title="미니맵 열기"
            aria-label="미니맵 열기"
            className="absolute left-3 bottom-3 w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
            style={{ background: 'rgba(7,16,29,.9)', border: '1px solid #273350', zIndex: 22000 }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M12 1.586l-4 4v12.828l4-4V1.586zM3.707 3.293A1 1 0 002 4v10a1 1 0 00.293.707L6 18.414V5.586L3.707 3.293zM17.707 5.293L14 1.586v12.828l2.293 2.293A1 1 0 0018 16V6a1 1 0 00-.293-.707z" clipRule="evenodd" /></svg>
          </button>
        )}
        {/* D33 하단 통합 독(19-spec P0-2) — 컨트롤 필(연결 점·내자리로·테마·상태) + 셸 세그먼트(dockSlot).
            연결 상태는 점+툴팁만, 오프라인/재연결 시에만 문구·다시연결 노출. 상태 메뉴는 위로 열림. */}
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2"
          style={{ zIndex: 22000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center gap-0.5 pl-2.5 pr-1 py-1 rounded-full"
            style={{ background: 'rgba(22,20,18,0.84)', backdropFilter: 'blur(22px) saturate(1.15)', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 12px 32px rgba(0,0,0,0.42),inset 0 1px 0 rgba(255,255,255,0.06)' }}
          >
            <span
              title={statusChip.text}
              aria-label={`실시간 연결 상태: ${statusChip.text}`}
              className="flex items-center gap-1.5 pr-1.5"
            >
              <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ background: statusChip.color }} />
              {status !== 'connected' && (
                <span className="text-[10px] text-text-secondary whitespace-nowrap">{statusChip.text}</span>
              )}
            </span>
            {offline && (
              <button
                type="button"
                onClick={reconnect}
                className="px-2 py-1 rounded-full text-[10px] font-semibold text-white hover:bg-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                style={{ border: '1px solid #3B5BFE' }}
              >
                다시 연결
              </button>
            )}
            <span className="w-px h-4 bg-border-subtle mx-1" aria-hidden />
            <button
              type="button"
              onClick={goMySeat}
              title={mySeat ? `내 좌석(${seatLabel(mySeat)})으로 걸어가 앉기` : '배정된 좌석 없음 — 초록 좌석을 클릭해 앉기'}
              className="px-2 py-1 rounded-full text-[10px] font-semibold flex items-center gap-1.5 hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
              style={{ color: mySeat ? '#fff' : 'rgba(255,255,255,.55)' }}
            >
              <span className="w-1.5 h-1.5 rounded-[2px] inline-block" style={{ background: mySeat ? '#E3B23C' : '#64748B' }} />
              내 자리로
            </button>
            <button
              type="button"
              onClick={cycleTheme}
              title="씬 조명 테마 — 클릭해서 전환(자동→주간→석양→야간)"
              className="px-2 py-1 rounded-full text-[10px] font-medium flex items-center gap-1.5 hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
            >
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: sceneTheme.chip }} />
              <span className="text-text-secondary">
                {themeMode === 'auto' ? `자동 · ${sceneTheme.label}` : sceneTheme.label}
              </span>
            </button>
            <div className="relative">
              <button
                type="button"
                disabled={status !== 'connected'}
                onClick={() => setStatusMenuOpen((o) => !o)}
                title="내 상태 변경"
                className="px-2 py-1 rounded-full text-[10px] font-medium flex items-center gap-1.5 disabled:opacity-40 hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full inline-block"
                  style={{ background: (PRESENCE_META[myStatus ?? ''] ?? PRESENCE_META.offline).color }}
                />
                <span className="text-text-secondary">
                  {(PRESENCE_META[myStatus ?? ''] ?? PRESENCE_META.offline).label}
                </span>
                <span className="text-text-muted text-[8px]">▴</span>
              </button>
              {statusMenuOpen && status === 'connected' && (
                <div
                  className="absolute left-0 bottom-full mb-1 rounded-lg py-1"
                  style={{ background: 'rgba(7,16,29,.96)', border: '1px solid #273350', minWidth: 118 }}
                >
                  {MANUAL_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setPresence(s); // room.send('status_change') — 칩은 서버 상태를 추종
                        setStatusMenuOpen(false);
                      }}
                      className="w-full px-2.5 py-1.5 text-left text-[11px] text-white flex items-center gap-1.5 hover:bg-white/10"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full inline-block"
                        style={{ background: PRESENCE_META[s].color }}
                      />
                      {PRESENCE_META[s].label}
                      {myStatus === s && (
                        <span className="ml-auto text-[9px]" style={{ color: '#3B5BFE' }}>
                          ●
                        </span>
                      )}
                    </button>
                  ))}
                  <div className="px-2.5 pt-1 text-[9px] text-text-muted whitespace-nowrap">회의·오프라인은 자동 전환</div>
                </div>
              )}
            </div>
          </div>
          {dockSlot}
        </div>

        {/* WSS 재연결 오버레이(§5.3) — 반투명 + 클릭 통과 차단 */}
        {status === 'reconnecting' && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(7,16,29,.55)', backdropFilter: 'blur(2px)', zIndex: 24000, cursor: 'default' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center gap-3 px-5 py-3.5 rounded-xl text-[13px] font-medium text-white shadow-lg"
              style={{ background: 'rgba(7,16,29,.96)', border: '1px solid #3B5BFE' }}
            >
              <span
                className="w-4 h-4 rounded-full border-2 animate-spin inline-block"
                style={{ borderColor: 'rgba(255,255,255,.25)', borderTopColor: '#3B5BFE' }}
              />
              연결 끊김 — 재연결 중…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
