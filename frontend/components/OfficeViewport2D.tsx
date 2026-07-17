'use client';

/**
 * OfficeViewport2D — 2.5D 고정 카메라 가상오피스 뷰포트.
 *
 * 렌더 = DOM 합성: 클린 플레이트(배경) + 방 라벨/글로우 + 아바타 스프라이트 레이어.
 * 아바타 위치는 realtime(Colyseus) 서버 권위 상태를 rAF 루프가 imperative하게 소비
 * (20Hz setState 재렌더 회피 — playersRef 패턴은 useOfficeRoom 참조).
 * 서버 미기동 시 로컬 이동 폴백(본인 아바타만, 동일 속도 모델 1.4m/s).
 *
 * 좌표계: 내부 시뮬레이션은 미터(서버와 동일), 화면 배치 직전에만 정규→px 변환.
 * 정본: lib/office2d.ts (씬), realtime/README.md (프로토콜).
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUser } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { useOfficeRoom } from '@/hooks/useOfficeRoom';
import type { MeetingEntryResult } from '@/lib/realtime';
import {
  ASSETS_READY,
  AVATAR_ANIM,
  AvatarState,
  CharacterId,
  LAYERS_BASE_URL,
  OBSTACLES,
  PLATE_URL,
  PLATE_W,
  PLATE_H,
  type SceneLayerSprite,
  ROOMS,
  type SceneRoom,
  SCENE_THEMES,
  type SceneThemeId,
  SPAWNS,
  themeForHour,
  avatarHeightFrac,
  characterForAvatar,
  clampToWalkable,
  findPath,
  isWalkable,
  nearestWalkableM,
  frameUrl,
  metersToNorm,
  normToMeters,
  pointInPolygon,
  polygonCentroid,
  setActiveFloorGeometry,
  typingBurstAt,
  WALK_AREA,
  type Vec2,
} from '@/lib/office2d';

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
}

export default function OfficeViewport2D({ onJoinMeeting }: OfficeViewport2DProps = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

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

  // 레이어 합성 팩(v2.1): 가구를 개별 스프라이트로 얹어 아바타와 y-기준 상호 가림.
  // manifest 없으면 null → 단일 플레이트 폴백.
  const [layerSprites, setLayerSprites] = useState<SceneLayerSprite[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${LAYERS_BASE_URL}/manifest.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { sprites?: SceneLayerSprite[] } | null) => {
        if (!cancelled && m?.sprites?.length) setLayerSprites(m.sprites);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ── 자율좌석(§3.11) ────────────────────────────────────────────────────
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  /** rAF 루프용 좌석 스냅샷(착석 렌더 판정) — setState와 함께 갱신. */
  const seatsRef = useRef<SeatInfo[]>([]);
  const [seatPrompt, setSeatPrompt] = useState<{ mode: 'sit' | 'release'; seat: SeatInfo } | null>(null);
  const [seatBusy, setSeatBusy] = useState(false);

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
  const activeRooms = useDeployed ? dynRooms : ROOMS;
  // rAF/interval 콜백에서 최신 방 목록 참조(의존성 없이).
  const roomsRef = useRef<SceneRoom[]>(ROOMS);
  roomsRef.current = activeRooms;

  // 배포 레이아웃 반영 시 이동 지오메트리도 교체 — 클릭-경로·충돌이 배포 경계(bounds 사각형)와
  // 벽을 따르게 해 realtime 서버 검증과 정합(아바타가 배포 벽을 통과하지 않음). 미배포면 HORIZON 복원.
  useEffect(() => {
    if (structure?.dimensions) {
      setActiveFloorGeometry({
        walkArea: rectToNormPoly(0, 0, structure.dimensions.width_m, structure.dimensions.height_m),
        obstacles: dynObstacles,
      });
    } else {
      setActiveFloorGeometry(null);
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
        setSeats(rows);
        seatsRef.current = rows;
      })
      .catch(() => {}); // 백엔드 미기동 등 — 좌석 레이어만 비표시(뷰포트는 계속 동작)
  }, []);
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
        if (isMine) setSeatPrompt({ mode: 'release', seat });
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

  /** 착석/반납 확정 — REST(§3.11). sit_request(realtime)는 이번 스코프 미사용. */
  const confirmSeatPrompt = useCallback(async () => {
    if (!seatPrompt || seatBusy) return;
    const { mode, seat } = seatPrompt;
    setSeatBusy(true);
    try {
      if (mode === 'sit') {
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
      } else {
        await api.post(`/api/seat-assignments/${seat.id}/release`, {});
        showToast(`${seatLabel(seat)} 좌석을 반납했습니다`);
      }
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

  // 프레임 프리로드(등장한 캐릭터만). 플레이스홀더 모드(D30)엔 로드할 에셋 없음.
  useEffect(() => {
    if (!ASSETS_READY) return;
    const chars = new Set(shells.map((s) => s.char));
    chars.forEach((c) => {
      (['idle', 'walk', 'sit', 'typing'] as AvatarState[]).forEach((st) => {
        for (let f = 0; f < AVATAR_ANIM[st].frames; f++) {
          const im = new Image();
          im.src = frameUrl(c, st, f);
        }
      });
    });
  }, [shells]);

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

          // 프레임 애니.
          const anim = AVATAR_ANIM[v.state];
          v.frameAcc += dt;
          const frameDur = 1 / anim.fps;
          if (v.frameAcc >= frameDur) {
            v.frameAcc %= frameDur;
            v.frame = (v.frame + 1) % anim.frames;
            if (ASSETS_READY) (v.img as HTMLImageElement).src = frameUrl(v.char, v.state, v.frame);
          }

          // 화면 배치. 높이는 깊이(원근) 기반 — 뒤쪽일수록 작게.
          const n = metersToNorm(v.disp);
          const px = n.x * sw;
          const py = n.y * sh;
          v.root.style.left = `${px}px`;
          v.root.style.top = `${py}px`;
          // 착석 시 +150 바이어스: 자기 의자 스프라이트(전면 모서리 baseline)가
          // 앉은 아바타를 덮지 않게 — 의자 반깊이(~0.25m ≈ 64) 이상, 남측 옆 가구(≥0.9m) 미만.
          const isSeatedState = v.state === 'sit' || v.state === 'typing';
          v.root.style.zIndex = String(Math.round(n.y * 10000) + (isSeatedState ? 150 : 0));
          v.img.style.height = `${avatarHeightFrac(n.y, v.state) * sh}px`;
          v.img.style.transform = `scaleX(${v.facing})`;
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
        {useDeployed ? (
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
        ) : ASSETS_READY ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={layerSprites ? `${LAYERS_BASE_URL}/background.webp` : PLATE_URL}
              alt="가상오피스 평면"
              draggable={false}
              className="absolute inset-0 w-full h-full"
            />
            {/* 가구 스프라이트(v2.1 오클루전) — 아바타와 동일 y-기준 zIndex로 상호 가림 */}
            {layerSprites?.map((sp) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={sp.src}
                src={`${LAYERS_BASE_URL}/${sp.src}`}
                alt=""
                draggable={false}
                className="absolute pointer-events-none"
                style={{
                  left: `${sp.x * 100}%`,
                  top: `${sp.y * 100}%`,
                  width: `${sp.w * 100}%`,
                  height: `${sp.h * 100}%`,
                  zIndex: Math.round(sp.z * 10000),
                }}
              />
            ))}
          </>
        ) : (
          /* D30 플레이스홀더 플레이트 — 좌표 계약(보행영역·방·장애물)만 시각화 */
          <div
            className="absolute inset-0 w-full h-full"
            style={{ background: 'linear-gradient(160deg,#1c2941 0%,#141f33 55%,#0f1828 100%)' }}
          >
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1 1" preserveAspectRatio="none">
              <polygon
                points={WALK_AREA.map((v) => `${v.x},${v.y}`).join(' ')}
                fill="rgba(46,123,255,.07)"
                stroke="rgba(120,150,200,.35)"
                strokeWidth={0.003}
              />
              {ROOMS.map((r) => (
                <polygon
                  key={r.id}
                  points={r.polygon.map((v) => `${v.x},${v.y}`).join(' ')}
                  fill="rgba(255,255,255,.03)"
                  stroke="rgba(160,180,220,.28)"
                  strokeWidth={0.002}
                />
              ))}
              {OBSTACLES.map((o, i) => (
                <polygon
                  key={i}
                  points={o.map((v) => `${v.x},${v.y}`).join(' ')}
                  fill="rgba(90,110,150,.18)"
                  stroke="rgba(90,110,150,.3)"
                  strokeWidth={0.0015}
                />
              ))}
            </svg>
            <div
              className="absolute left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-semibold"
              style={{ top: 10, background: 'rgba(7,16,29,.85)', color: '#8fa8cf', border: '1px solid rgba(120,150,200,.3)', zIndex: 5 }}
            >
              새 에셋 제작 중 — 플레이스홀더 플레이트 (D30)
            </div>
          </div>
        )}

        {/* 방 클릭 글로우 (overlay-tokens.activeGlow) */}
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

        {/* 방 라벨 (overlay-tokens.roomLabel) */}
        {activeRooms.map((room) => {
          const c = polygonCentroid(room.polygon);
          return (
            <button
              key={room.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setGlowRoom((cur) => (cur === room.id ? null : room.id));
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-[14px] text-[12px] font-bold text-white"
              style={{
                left: `${c.x * 100}%`,
                top: `${c.y * 100}%`,
                background: 'rgba(7,14,27,.88)',
                border: '1px solid rgba(255,255,255,.14)',
                zIndex: 21000,
              }}
            >
              {room.label}
            </button>
          );
        })}

        {/* 구역(zone) 라벨 — 배포 레이아웃에만 존재(팀 구역 배치 반영). */}
        {dynZones.map((z) => {
          const c = polygonCentroid(z.poly);
          return (
            <div
              key={z.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-[10px] text-[10px] font-semibold pointer-events-none"
              style={{
                left: `${c.x * 100}%`,
                top: `${c.y * 100}%`,
                background: 'rgba(7,14,27,.7)',
                color: z.color,
                border: `1px solid ${z.color}`,
                zIndex: 20500,
              }}
            >
              {z.label}
            </div>
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
              <button
                type="button"
                title={title}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSeatClick(seat);
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[3px]"
                style={{
                  left: `${n.x * 100}%`,
                  top: seatTop,
                  width: isMine ? 13 : 10,
                  height: isMine ? 13 : 10,
                  background: fill,
                  border: `2px solid ${border}`,
                  boxShadow: isMine
                    ? '0 0 10px rgba(59,91,254,.95)'
                    : occupied || unavailable || fixedUnassigned
                      ? 'none'
                      : '0 0 6px rgba(34,197,94,.55)',
                  zIndex: SEAT_Z,
                  cursor: unavailable || fixedUnassigned ? 'default' : 'pointer',
                }}
              />
            </Fragment>
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
            {/* 코드 모션 래퍼(바운스) 안에 프레임 이미지 — flip(scaleX)은 img, 바운스는 래퍼로 분리 */}
            <div className="vo-motion vo-anim-idle">
              {ASSETS_READY ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  className="vo-body"
                  src={frameUrl(s.char, 'idle', 0)}
                  alt={s.name}
                  draggable={false}
                  style={{ display: 'block', transformOrigin: '50% 100%' }}
                />
              ) : (
                /* D30 도트 아바타 — 높이는 rAF가 깊이 기반으로 설정 */
                <div
                  className="vo-body flex items-end justify-center"
                  style={{
                    aspectRatio: '0.46',
                    transformOrigin: '50% 100%',
                    borderRadius: '999px',
                    background: `linear-gradient(180deg, ${s.accent} 0%, rgba(20,32,52,.95) 90%)`,
                    border: '1px solid rgba(255,255,255,.25)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 12,
                    paddingBottom: 6,
                  }}
                >
                  {s.name.charAt(0)}
                </div>
              )}
            </div>
            {/* 이름표 (show_nameplate=false면 숨김, #6) */}
            {s.showNameplate && (
              <div
                className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-semibold text-white flex items-center gap-1"
                style={{
                  top: -20,
                  background: 'rgba(7,16,29,.92)',
                  border: `1px solid ${s.isSelf ? '#3B5BFE' : s.accent}`,
                  boxShadow: s.isSelf ? '0 0 0 1px #3B5BFE' : undefined,
                }}
              >
                {/* 본인은 이름표 점을 '프레즌스 상태색'으로 — 내가 업무중인지 즉시 식별 */}
                <span
                  className="w-1.5 h-1.5 rounded-full inline-block"
                  style={{ background: s.isSelf ? (PRESENCE_META[myStatus ?? ''] ?? PRESENCE_META.offline).color : s.accent }}
                />
                {s.name}
                {s.isSelf ? ' (나)' : ''}
                {s.isSelf && (
                  <span
                    className="ml-0.5 px-1 rounded-[4px] font-bold"
                    style={{
                      fontSize: 8,
                      lineHeight: '12px',
                      background: `${(PRESENCE_META[myStatus ?? ''] ?? PRESENCE_META.offline).color}2e`,
                      color: (PRESENCE_META[myStatus ?? ''] ?? PRESENCE_META.offline).color,
                    }}
                  >
                    {(PRESENCE_META[myStatus ?? ''] ?? PRESENCE_META.offline).label}
                  </span>
                )}
              </div>
            )}
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

        {/* 착석/반납 확인 프롬프트(§3.11) — 회의 프롬프트와 동일 스타일 상단 카드 */}
        {seatPrompt && (
          <div
            className={`absolute left-1/2 ${meetingPrompt ? 'top-16' : 'top-3'} -translate-x-1/2 flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[13px] text-white shadow-lg`}
            style={{ background: 'rgba(7,16,29,.96)', border: '1px solid #3B5BFE', zIndex: 23000 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span>
              {seatPrompt.mode === 'sit' ? (
                <>
                  이 자리에 앉기 (<b>{seatLabel(seatPrompt.seat)}</b>)
                </>
              ) : (
                <>
                  내 좌석 (<b>{seatLabel(seatPrompt.seat)}</b>)
                </>
              )}
            </span>
            {seatPrompt.mode === 'release' && (
              /* 내 좌석 클릭의 1차 의도는 착석 — 반납은 보조 액션(적색)으로 분리 */
              <button
                type="button"
                onClick={() => {
                  const s = seatPrompt.seat;
                  if (typeof s.coords?.x === 'number' && typeof s.coords?.y === 'number') {
                    moveTo(nearestWalkableM({ x: s.coords.x, y: s.coords.y }));
                  }
                  setSeatPrompt(null);
                }}
                className="px-3 py-1 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary-hover"
              >
                여기 앉기
              </button>
            )}
            <button
              type="button"
              disabled={seatBusy}
              onClick={() => void confirmSeatPrompt()}
              className={`px-3 py-1 rounded-md text-white text-xs font-semibold disabled:opacity-50 ${
                seatPrompt.mode === 'sit'
                  ? 'bg-primary hover:bg-primary-hover'
                  : 'bg-rose-600 hover:bg-rose-500' /* 반납은 적색 — 착석 확인과 오인 방지 */
              }`}
            >
              {seatPrompt.mode === 'sit' ? '앉기' : '비우기'}
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

        {/* 안내 토스트 — 사용 중 좌석/오류 메시지(§3.11) */}
        {toast && (
          <div
            className="absolute left-1/2 bottom-6 -translate-x-1/2 px-3.5 py-2 rounded-lg text-[12px] text-white pointer-events-none whitespace-nowrap"
            style={{ background: 'rgba(7,16,29,.94)', border: '1px solid rgba(255,255,255,.16)', zIndex: 23000 }}
          >
            {toast}
          </div>
        )}
        {/* 미니맵 (좌하단 오버레이, design-style §4) — 실시간 아바타 위치(#12) */}
        <div
          className="absolute left-3 bottom-3 rounded-lg overflow-hidden pointer-events-none"
          style={{
            width: 152,
            height: Math.round((152 * PLATE_H) / PLATE_W),
            background: 'rgba(7,16,29,.9)',
            border: '1px solid #273350',
            zIndex: 22000,
          }}
        >
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
        {/* 연결 상태 칩 + 다시 연결(§5.3) + 내 상태 버튼(§1.2) */}
        <div
          className="absolute left-3 top-3 flex items-center gap-1.5"
          style={{ zIndex: 22000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="px-2.5 py-1 rounded-lg text-[10px] font-medium tracking-wide flex items-center gap-1.5"
            style={{ background: 'rgba(13,27,54,.78)', backdropFilter: 'blur(6px)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: statusChip.color }} />
            <span className="text-text-secondary">{statusChip.text}</span>
          </div>
          {offline && (
            <button
              type="button"
              onClick={reconnect}
              className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-white hover:bg-primary/30"
              style={{ background: 'rgba(13,27,54,.78)', backdropFilter: 'blur(6px)', border: '1px solid #3B5BFE' }}
            >
              다시 연결
            </button>
          )}
          <button
            type="button"
            onClick={goMySeat}
            title={mySeat ? `내 좌석(${seatLabel(mySeat)})으로 걸어가 앉기` : '배정된 좌석 없음 — 초록 좌석을 클릭해 앉기'}
            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1.5"
            style={{
              background: 'rgba(13,27,54,.78)',
              backdropFilter: 'blur(6px)',
              border: `1px solid ${mySeat ? '#3B5BFE' : 'rgba(255,255,255,.12)'}`,
              color: mySeat ? '#fff' : 'rgba(255,255,255,.55)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-[2px] inline-block" style={{ background: mySeat ? '#3B5BFE' : '#64748B' }} />
            내 자리로
          </button>
          <button
            type="button"
            onClick={cycleTheme}
            title="씬 조명 테마 — 클릭해서 전환(자동→주간→석양→야간)"
            className="px-2.5 py-1 rounded-lg text-[10px] font-medium tracking-wide flex items-center gap-1.5"
            style={{
              background: 'rgba(13,27,54,.78)',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255,255,255,.12)',
            }}
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
              className="px-2.5 py-1 rounded-lg text-[10px] font-medium tracking-wide flex items-center gap-1.5 disabled:opacity-40"
              style={{
                background: 'rgba(13,27,54,.78)',
                backdropFilter: 'blur(6px)',
                border: '1px solid rgba(255,255,255,.12)',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: (PRESENCE_META[myStatus ?? ''] ?? PRESENCE_META.offline).color }}
              />
              <span className="text-text-secondary">
                {(PRESENCE_META[myStatus ?? ''] ?? PRESENCE_META.offline).label}
              </span>
              <span className="text-text-muted text-[8px]">▾</span>
            </button>
            {statusMenuOpen && status === 'connected' && (
              <div
                className="absolute left-0 top-full mt-1 rounded-lg py-1"
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
