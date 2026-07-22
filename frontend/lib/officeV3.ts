/**
 * officeV3.ts — D35 Phase 1b "탑다운 축정렬" 좌표 정본.
 *
 * 문제(1b): 좌석·의자·마커·보행 영역이 구 아이소 다이아몬드 좌표(office2d.ts)에 묶여 있어
 * V3 텍스처드 탑다운 씬(축정렬 벤치)과 어긋난다 — 의자 뭉침·마커 오배치·클릭 이동 거부.
 *
 * 이 파일이 V3 모드의 **단일 지오메트리 정본**이다. 원칙:
 *   1) "가구가 좌석을 파생" — 벤치(bench4) 1개가 좌석 4점을 픽스드 오프셋으로 낳는다.
 *      오프셋 공식은 렌더러(public/plate-v3/horizon-scene-v3.js bench4)와 **바이트 정합**:
 *      벤치 중심 (bx,by) → 좌석 = (bx ± SEAT_DX, by ± SEAT_DY), SEAT_DX=0.725, SEAT_DY=d/2+0.42=1.17.
 *   2) 보행 영역 = 축정렬 room 사각형 − 가구 장애물(벤치 데스크 footprint 등).
 *   3) 좌석 id는 유지(WS-A1~A4·WS-B1~B4), 위치만 새 벤치 좌석점으로.
 *
 * 소비처:
 *   - lib/office2dToV3.ts   : buildV3Layout()이 여기 BENCHES로 bench4 furniture 생성
 *   - lib/office2d.ts       : V3_WALK_AREA / V3_OBSTACLES를 setActiveFloorGeometry로 주입(V3 모드)
 *   - components/*          : V3_SEATS(파생 좌석 미터)로 마커·"내 자리"·핫스팟 정렬
 *   - backend/scripts/seed_seats.py : 동일 좌석 미터 좌표를 DB에 시드(정본 복제 + 동기화 주석)
 *   - realtime/src/integration/FloorLayoutProvider.ts : 동일 room+장애물을 서버 floor로(SCENE_FLOOR=v3)
 *
 * ⚠️ 이동 불변식 상수(WAYPOINT_EPS·클리어런스·stillSec 등, office2d.ts)는 여기서 절대 건드리지 않는다.
 *    이 파일은 **지오메트리 데이터**만 제공한다.
 */

import { SCENE_W_M, SCENE_H_M, type Vec2 } from './office2d';

// ── 렌더러 bench4와 정합하는 좌석 파생 오프셋(미터, 절대 변경 금지) ──
//   horizon-scene-v3.js bench4(f): w=2.9,d=1.5; seatDefs sx∈{-0.725,0.725}, sy∈{-1,1};
//   cy = y + sy*(d/2 + 0.42) = y ± 1.17.
export const BENCH_SEAT_DX = 0.725;
export const BENCH_SEAT_DY = 1.5 / 2 + 0.42; // 1.17
/** 벤치 데스크 상판 footprint(충돌용) — 렌더러 bench4 상판 w×d. */
export const BENCH_DESK_W = 2.9;
export const BENCH_DESK_D = 1.5;

/** 워크벤치 배치(미터, 탑다운 축정렬) — 상하 2열로 분리해 겹침 해소.
 *  두 벤치 사이 통로 확보(A 하단석 y≈6.87, B 상단석 y≈7.73 → 0.86m).
 *  y+0.4 남하(2026-07-22): 리셉션 다이닝 의자(렌더러가 테이블 주위에 그림, 하단 ≈3.9)와
 *  A 상단석 의자 시각 겹침 + 리셉션 방 히트영역(y≤4.0)이 좌석 클릭을 삼키는 문제 해소. */
export interface BenchSpec {
  /** 클러스터 prefix(좌석 id 앞부분). */
  cluster: 'WS-A' | 'WS-B';
  x: number;
  y: number;
}
export const BENCHES: BenchSpec[] = [
  { cluster: 'WS-A', x: 8.4, y: 5.7 },
  { cluster: 'WS-B', x: 8.4, y: 8.9 },
];

/** 좌석 id 파생 순서 — 렌더러 seatDefs 인덱스와 동일: 0=좌상,1=우상,2=좌하,3=우하.
 *  1-based 접미(A1..A4)로 매핑해 기존 id(WS-A1~A4) 유지. */
const SEAT_ORDER: Array<{ dx: number; dy: number }> = [
  { dx: -BENCH_SEAT_DX, dy: -BENCH_SEAT_DY }, // 1: 좌상
  { dx: +BENCH_SEAT_DX, dy: -BENCH_SEAT_DY }, // 2: 우상
  { dx: -BENCH_SEAT_DX, dy: +BENCH_SEAT_DY }, // 3: 좌하
  { dx: +BENCH_SEAT_DX, dy: +BENCH_SEAT_DY }, // 4: 우하
];

export interface V3Seat {
  /** 좌석 번호(WS-A1 등) — 기존 id 유지. */
  seatNumber: string;
  /** 미터 좌표(씬 top-left 기준, 뷰포트/서버 좌표계 동일). */
  x: number;
  y: number;
}

/** 벤치 → 좌석 4점 파생(가구가 좌석을 낳는다). 렌더러 bench4와 동일 오프셋. */
export function seatsForBench(b: BenchSpec): V3Seat[] {
  return SEAT_ORDER.map((o, i) => ({
    seatNumber: `${b.cluster}${i + 1}`,
    x: b.x + o.dx,
    y: b.y + o.dy,
  }));
}

/** 전 좌석(미터) — 정본. seed_seats.py·마커·seat-reach QA가 참조. */
export const V3_SEATS: V3Seat[] = BENCHES.flatMap(seatsForBench);

/** 좌석번호 → 미터 좌표 조회. */
export const V3_SEAT_BY_NUMBER: Record<string, Vec2> = Object.fromEntries(
  V3_SEATS.map((s) => [s.seatNumber, { x: s.x, y: s.y }]),
);

// ── 보행 영역(축정렬 room 사각형) ──
//   벽 여유(wallInset)만큼 안쪽. office2dToV3.buildV3Layout의 room과 동일 사각형.
export const V3_WALL_INSET = 0.5;
export const V3_ROOM = {
  x: V3_WALL_INSET,
  y: V3_WALL_INSET,
  w: SCENE_W_M - 2 * V3_WALL_INSET,
  h: SCENE_H_M - 2 * V3_WALL_INSET,
};

/** 미터 사각형(중심 x,y·크기 w,h) → 정규(0~1) 4꼭짓점 폴리곤(office2d isWalkable 계약). */
function rectCenterToNormPoly(cx: number, cy: number, w: number, h: number): Vec2[] {
  const x0 = (cx - w / 2) / SCENE_W_M;
  const x1 = (cx + w / 2) / SCENE_W_M;
  const y0 = (cy - h / 2) / SCENE_H_M;
  const y1 = (cy + h / 2) / SCENE_H_M;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}
/** 미터 사각형(top-left x,y·크기) → 정규 폴리곤. */
function rectTLToNormPoly(x: number, y: number, w: number, h: number): Vec2[] {
  return rectCenterToNormPoly(x + w / 2, y + h / 2, w, h);
}

/** V3 보행 폴리곤(정규) = room 사각형(축정렬). */
export const V3_WALK_AREA: Vec2[] = rectTLToNormPoly(V3_ROOM.x, V3_ROOM.y, V3_ROOM.w, V3_ROOM.h);

/**
 * V3 가구 장애물(정규 폴리곤) — 가구 위 보행 차단. 좌석(의자)은 앉을 수 있어야 하므로
 * 데스크 상판 footprint만 막고 의자 열(±SEAT_DY 바깥)은 열어 둔다.
 * 벤치 데스크는 상판 w×d에 좌석 접근 여유를 위해 y로 살짝 축소(SEAT_DY 안쪽 통로 유지).
 */
interface ObstacleSpec {
  x: number; // top-left 미터
  y: number;
  w: number;
  h: number;
}
/** 축정렬 장애물 정본(미터, top-left). 렌더러 가구 위치와 정합. */
export const V3_OBSTACLE_RECTS: ObstacleSpec[] = [
  // 워크벤치 데스크 상판(2개) — 좌석은 상판 밖(±1.17)이라 앉기 가능, 상판만 차단.
  ...BENCHES.map((b) => ({
    x: b.x - BENCH_DESK_W / 2,
    y: b.y - BENCH_DESK_D / 2,
    w: BENCH_DESK_W,
    h: BENCH_DESK_D,
  })),
  // 회의실(보드룸) 테이블 — office2dToV3 meetingTable x≈15.77 y≈6.97 w3.3 h1.15 + 의자 여유.
  { x: 14.0, y: 5.9, w: 3.6, h: 2.1 },
  // 팬트리 카운터(서측 벽) — counter x1.05 len2.6.
  { x: 0.7, y: 3.2, w: 1.1, h: 3.0 },
  // 라운지 소파/커피테이블 클러스터.
  { x: 10.9, y: 4.0, w: 3.0, h: 2.0 },
  // 리셉션 다이닝 테이블(의자 포함 footprint) — 벤치 A 상단 좌석(y4.13)과 이격 유지.
  { x: 8.0, y: 1.9, w: 2.8, h: 2.0 },
  // 폰부스.
  { x: 11.1, y: 9.1, w: 1.7, h: 1.5 },
];

export const V3_OBSTACLES: Vec2[][] = V3_OBSTACLE_RECTS.map((o) =>
  rectTLToNormPoly(o.x, o.y, o.w, o.h),
);

/** V3 스폰(로비 개활지, 미터) — work 존 위쪽 리셉션 앞 통로. */
export const V3_SPAWN_M: Vec2 = { x: 6.0, y: 3.0 };

// ── V3 방(축정렬) — 라벨·글로우·회의 근접 판정용. id는 legacy와 동일해야 한다
//    (realtime meetingZones·백엔드 room이 boardroom/meeting-a를 참조). 좌표만 v3 존/가구와 정합. ──
export interface V3Room {
  id: string;
  label: string;
  /** top-left 미터 사각형. */
  x: number;
  y: number;
  w: number;
  h: number;
}
export const V3_ROOMS: V3Room[] = [
  { id: 'reception', label: 'Reception', x: 7.4, y: 1.6, w: 4.4, h: 2.4 },
  { id: 'lounge', label: 'Lounge', x: 10.6, y: 3.6, w: 4.2, h: 2.8 },
  { id: 'boardroom', label: 'Board Room', x: 13.4, y: 5.4, w: 5.0, h: 3.2 },
  { id: 'meeting-a', label: 'Meeting Room', x: 13.2, y: 8.0, w: 3.6, h: 2.2 },
  { id: 'pantry', label: 'Pantry', x: 1.0, y: 3.2, w: 4.2, h: 3.2 },
  { id: 'cafe', label: 'Cafe', x: 1.4, y: 6.6, w: 3.6, h: 2.6 },
  { id: 'booth', label: 'Phone Booth', x: 11.0, y: 9.0, w: 2.0, h: 1.7 },
];

/** V3 핫스팟(D34, 정규 0~1) — 게시판(리셉션 벽)·서류함(팬트리 벽). legacy HOTSPOTS와 동일 kind/id. */
export const V3_HOTSPOTS_NORM: Record<string, Vec2> = {
  board: { x: 9.6 / SCENE_W_M, y: 1.5 / SCENE_H_M }, // 리셉션 상단 벽
  cabinet: { x: 3.1 / SCENE_W_M, y: 3.0 / SCENE_H_M }, // 팬트리 상단
};
