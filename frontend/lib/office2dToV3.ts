/**
 * office2dToV3.ts — 현행 office2d 씬 데이터 → plate-v3 렌더러 레이아웃 스키마 어댑터.
 *
 * D35 "텍스처드 탑다운 V3"(docs/planning/21-visual-reset-strategy.md §P) Phase 1.
 * 순수 함수 buildV3Layout()이 lib/office2d.ts의 좌석·존·장애물 배치를
 * public/plate-v3/horizon-scene-v3.js(HorizonSceneV3.renderScene)가 소비하는
 * 레이아웃(world/room/windows/zones/furniture, 미터 단위)으로 변환한다.
 *
 * 좌표 계약(불변): world = 20 × 11.256m = SCENE_W_M × SCENE_H_M. v3 캔버스는 월드 미터를
 * 그대로 픽셀에 매핑하므로(S = min(w/world.w, h/world.h)), 스테이지(플레이트 1672×941 =
 * 20:11.256 비율)에서 한 점의 정규 좌표는 metersToNorm과 일치한다 → 아바타/좌석 마커의
 * 기존 배치 수학(metersToNorm)이 v3 캔버스 위에서도 그대로 정렬된다.
 *
 * 좌석 정합: 실제 좌석(office2d SEAT 앵커, 두 워크스테이션 클러스터 WS-A/WS-B)의 미터 중심에
 * v3 워크벤치(bench4)를 배치해, /api/seats 마커와 Colyseus 아바타가 데스크 위에 앉게 한다.
 * ⚠️ v3 renderScene이 반환하는 seats(렌더러 내부 좌석)는 이 배치와 별개다 — Phase 1에선
 * 사용하지 않는다(좌석 정본 = /api/seats). 렌더러 내부 좌석 레지스트리 연동은 Phase 1b.
 *
 * 이 파일은 순수 데이터 변환만 한다(DOM/canvas 접근 없음) — 유닛 테스트 가능.
 */

import { SCENE_W_M, SCENE_H_M, ROOMS, polygonCentroid, type Vec2 } from './office2d';

// ── v3 레이아웃 스키마(horizon-layouts-v3.js와 동형, 소비 측 필드만) ──
export interface V3Window {
  side: 'N' | 'S' | 'W' | 'E';
  a: number;
  b: number;
}
export interface V3Zone {
  id: string;
  label: string;
  kind: 'work' | 'meeting' | 'lounge' | 'pantry' | 'booth' | 'communal';
  x: number;
  y: number;
  w: number;
  h: number;
  floor?: 'tile' | 'carpet';
  glass?: ('N' | 'S' | 'W' | 'E')[];
  door?: { side: 'N' | 'S' | 'W' | 'E'; at: number; w: number };
  /** 라벨 앵커 override(미지정 시 존 상단). */
  lx?: number;
  ly?: number;
}
/** v3 furniture는 t별로 필드가 다르다(렌더러 PAINT 디스패치). 최소 계약만 타입화. */
export type V3Furniture = { t: string; x: number; y: number } & Record<string, unknown>;
export interface V3Layout {
  id: string;
  name: string;
  world: { w: number; h: number };
  room: { x: number; y: number; w: number; h: number };
  windows: V3Window[];
  entry?: { side: 'N' | 'S' | 'W' | 'E'; a: number; b: number };
  zones: V3Zone[];
  furniture: V3Furniture[];
  /** 실아바타는 Colyseus로 그리므로 항상 비움(renderScene에 people 레이어 제외). */
  people: never[];
}

/** office2d SEAT 앵커(seed_seats.py와 동일 — layout.json 정규 × [SCENE_W_M, SCENE_H_M]).
 *  두 워크스테이션 클러스터의 실제 좌석 미터 좌표. v3 데스크를 이 위에 얹는다. */
const SEAT_ANCHORS_NORM: Record<string, Vec2> = {
  'WS-A1': { x: 0.3993, y: 0.4662 },
  'WS-A2': { x: 0.4542, y: 0.515 },
  'WS-A3': { x: 0.3429, y: 0.5163 },
  'WS-A4': { x: 0.3978, y: 0.5651 },
  'WS-B1': { x: 0.4542, y: 0.6559 },
  'WS-B2': { x: 0.5092, y: 0.7047 },
  'WS-B3': { x: 0.3978, y: 0.706 },
  'WS-B4': { x: 0.4527, y: 0.7548 },
};

function anchorsM(prefix: string): Vec2[] {
  return Object.entries(SEAT_ANCHORS_NORM)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, n]) => ({ x: n.x * SCENE_W_M, y: n.y * SCENE_H_M }));
}
function centroidM(pts: Vec2[]): Vec2 {
  const c = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: c.x / pts.length, y: c.y / pts.length };
}
/** office2d ROOMS 폴리곤(정규) 중심 → 미터. 데코 가구 앵커로 사용. */
function roomCenterM(id: string): Vec2 | null {
  const r = ROOMS.find((rm) => rm.id === id);
  if (!r) return null;
  const c = polygonCentroid(r.polygon);
  return { x: c.x * SCENE_W_M, y: c.y * SCENE_H_M };
}

/**
 * 현행 office2d 씬 → v3 레이아웃.
 *
 * 존/가구 매핑(개요):
 *   워크스테이션 A·B(장애물 데스크 클러스터) → work 존 + bench4 2개(좌석 클러스터 중심)
 *   boardroom(회의 8인)                       → meeting 존(유리·카펫) + meetingTable(8석) + TV
 *   pantry/cafe                               → pantry 존(타일) + counter + fridge + cafeTable + waterCooler
 *   lounge                                    → lounge 존 + sofa + tubChair + coffeeTable + 러그
 *   booth(폰부스)                             → booth 존 + booth 가구
 *   reception(리셉션)                         → communal 존 + 다이닝/러그 + 화분
 * 화분·러그·트로프 등 데코는 톤(§5-0 3원칙)을 위해 존별로 살포한다.
 */
export function buildV3Layout(): V3Layout {
  const W = SCENE_W_M; // 20
  const H = SCENE_H_M; // ≈11.256
  const wallInset = 0.5;

  const clusterA = centroidM(anchorsM('WS-A')); // ≈(7.97, 5.80)
  const clusterB = centroidM(anchorsM('WS-B')); // ≈(9.07, 7.94)

  // 데코 앵커(없으면 폴백 좌표). 실제 상호작용(방 라벨/핫스팟) 좌표는 DOM 오버레이가
  // office2d ROOMS/HOTSPOTS로 별도 배치하므로, 여기 가구는 시각 배경 전용이다.
  const cReception = roomCenterM('reception') ?? { x: 9.27, y: 3.36 };
  const cLounge = roomCenterM('lounge') ?? { x: 12.35, y: 5.02 };
  const cBoard = roomCenterM('boardroom') ?? { x: 15.77, y: 6.97 };
  const cMeeting = roomCenterM('meeting-a') ?? { x: 12.62, y: 8.69 };
  const cPantry = roomCenterM('pantry') ?? { x: 5.21, y: 4.59 };
  const cCafe = roomCenterM('cafe') ?? { x: 3.44, y: 5.69 };
  const cBooth = roomCenterM('booth') ?? { x: 12.07, y: 10.31 };

  // ── zones: 탑다운 존(존 라벨은 v3 foreground가 아니라 DOM이 담당 — label은 빈 값으로
  //    두어 캔버스 중복 라벨을 피하고, floor/glass 텍스처만 사용) ──
  const zones: V3Zone[] = [
    { id: 'work', label: '', kind: 'work', x: 5.6, y: 4.2, w: 6.4, h: 5.4 },
    {
      id: 'meeting',
      label: '',
      kind: 'meeting',
      x: 13.0,
      y: 5.2,
      w: 6.0,
      h: 3.6,
      floor: 'carpet',
      glass: ['W', 'N'],
      door: { side: 'W', at: 2.4, w: 1.0 },
    },
    { id: 'pantry', label: '', kind: 'pantry', x: 1.2, y: 3.6, w: 4.8, h: 3.4, floor: 'tile' },
    { id: 'lounge', label: '', kind: 'lounge', x: 11.0, y: 3.6, w: 4.4, h: 2.6 },
    { id: 'reception', label: '', kind: 'communal', x: 7.6, y: 1.5, w: 4.4, h: 2.4 },
    { id: 'booth', label: '', kind: 'booth', x: 11.1, y: 9.3, w: 2.2, h: 1.7 },
  ];

  // ── furniture: 좌석 정합 벤치 + 존별 데코(러그는 renderer가 floor 레이어에서 먼저 그림) ──
  const furniture: V3Furniture[] = [
    // 러그(바닥층) — 리셉션/라운지 접지
    { t: 'rug', style: 'oriental', x: cReception.x, y: cReception.y + 0.2, w: 3.6, h: 2.4 },
    { t: 'rug', style: 'abstract', x: cLounge.x, y: cLounge.y, w: 3.4, h: 2.2 },

    // 워크스테이션 — 실제 좌석 클러스터 중심에 벤치(좌석 마커가 데스크 위에 앉음)
    { t: 'bench4', x: clusterA.x, y: clusterA.y },
    { t: 'bench4', x: clusterB.x, y: clusterB.y },
    { t: 'trough', x: (clusterA.x + clusterB.x) / 2 - 1.9, y: (clusterA.y + clusterB.y) / 2, len: 3.0, rot: 90 },
    { t: 'plant', x: clusterA.x - 1.7, y: clusterA.y - 1.5, s: 0.85, kind: 'fern' },
    { t: 'plant', x: clusterB.x + 1.7, y: clusterB.y + 0.9, s: 0.9, kind: 'monstera' },

    // 회의실(보드룸) — 8석 테이블 + TV(동측 벽)
    { t: 'meetingTable', x: cBoard.x, y: cBoard.y, w: 3.3, h: 1.15, seats: 8 },
    { t: 'tv', x: 18.9, y: cBoard.y, len: 1.7, rot: 90 },
    { t: 'plant', x: 13.5, y: 5.6, s: 0.8, kind: 'fern' },

    // 팬트리/카페 — 카운터·냉장고·워터쿨러·카페 테이블
    { t: 'counter', x: 1.05, y: cPantry.y, len: 2.6, side: 'W' },
    { t: 'fridge', x: 1.1, y: cPantry.y + 1.9, rot: 90 },
    { t: 'waterCooler', x: 4.9, y: cPantry.y - 1.1 },
    { t: 'rug', style: 'round', x: cCafe.x, y: cCafe.y, r: 0.95, base: '#C4553B' },
    { t: 'cafeTable', x: cCafe.x, y: cCafe.y, chairs: [70, 240] },
    { t: 'plant', x: 1.6, y: cCafe.y + 1.0, s: 0.7, kind: 'fern' },

    // 라운지 — 소파·터브체어·커피테이블·램프
    { t: 'sofa', x: cLounge.x, y: cLounge.y + 0.95, w: 2.5, rot: 180, color: '#E3B23C' },
    { t: 'tubChair', x: cLounge.x - 1.5, y: cLounge.y - 0.4, rot: 135, color: '#C4553B' },
    { t: 'tubChair', x: cLounge.x + 1.5, y: cLounge.y - 0.4, rot: 225, color: '#3E6FB0' },
    { t: 'coffeeTable', x: cLounge.x, y: cLounge.y + 0.05, r: 0.42 },
    { t: 'lamp', x: cLounge.x + 1.9, y: cLounge.y - 1.0 },

    // 리셉션(커뮤널) — 다이닝 테이블 + 화분
    { t: 'diningTable', x: cReception.x, y: cReception.y + 0.2, w: 2.6, h: 1.0 },
    { t: 'plant', x: cReception.x - 2.2, y: cReception.y - 1.0, s: 1.0, kind: 'monstera' },

    // 폰부스 + 회의실 앞 소품
    { t: 'booth', x: cBooth.x, y: cBooth.y - 0.15, w: 1.5, h: 1.6, door: 'N' },
    { t: 'plant', x: cMeeting.x - 2.0, y: cMeeting.y, s: 0.85, kind: 'fern' },
    { t: 'pouf', x: cMeeting.x + 0.6, y: cMeeting.y - 0.4, color: '#3E6FB0' },

    // 입구 매트
    { t: 'doormat', x: 10.0, y: H - wallInset - 0.2, w: 1.5, h: 0.45 },
  ];

  return {
    id: 'office2d-v3',
    name: 'HQ · V3',
    world: { w: W, h: H },
    room: { x: wallInset, y: wallInset, w: W - 2 * wallInset, h: H - 2 * wallInset },
    windows: [
      { side: 'N', a: 1.6, b: 5.4 },
      { side: 'N', a: 7.4, b: 11.2 },
      { side: 'N', a: 13.2, b: 16.4 },
      { side: 'W', a: 1.6, b: 4.2 },
      { side: 'E', a: 1.4, b: 4.4 },
      { side: 'S', a: 2.2, b: 4.6 },
    ],
    entry: { side: 'S', a: 9.3, b: 10.9 },
    zones,
    furniture,
    people: [],
  };
}
