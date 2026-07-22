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
 * 좌석 정합(Phase 1b, 탑다운 축정렬): 좌석 정본 = lib/officeV3.ts BENCHES(축정렬 워크벤치 2개,
 * 상하 2열로 겹침 해소). 벤치가 좌석 4점을 픽스드 오프셋으로 파생(가구가 좌석을 낳는다) →
 * /api/seats 마커·Colyseus 아바타가 v3 데스크 위에 정확히 앉는다. 좌석 미터 좌표 = officeV3.V3_SEATS,
 * seed_seats.py·마커·seat-reach QA·realtime floor가 같은 정본을 참조한다.
 * 데코 가구 앵커도 officeV3.V3_OBSTACLE_RECTS(충돌)와 정합하게 배치해 "가구 위 보행 거부"가
 * 실제 그려진 가구와 일치한다.
 *
 * 이 파일은 순수 데이터 변환만 한다(DOM/canvas 접근 없음) — 유닛 테스트 가능.
 */

import { SCENE_W_M, SCENE_H_M } from './office2d';
import { BENCHES } from './officeV3';

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

// (구 SEAT_ANCHORS_NORM 다이아 좌표·ROOMS 중심 파생 제거 — Phase 1b: 좌석 정본 = officeV3.BENCHES,
//  데코 앵커는 아래 V3 축정렬 고정 좌표(V3_OBSTACLE_RECTS 중심과 정합).)

/**
 * 현행 office2d 씬 → v3 레이아웃(탑다운 축정렬, Phase 1b).
 *
 * 존/가구 매핑(개요):
 *   워크스테이션 A·B → work 존 + bench4 2개(officeV3.BENCHES, 상하 2열·비겹침) → 좌석 8점 파생
 *   boardroom(회의 8인)                       → meeting 존(유리·카펫) + meetingTable(8석) + TV
 *   pantry/cafe                               → pantry 존(타일) + counter + fridge + cafeTable + waterCooler
 *   lounge                                    → lounge 존 + sofa + tubChair + coffeeTable + 러그
 *   booth(폰부스)                             → booth 존 + booth 가구
 *   reception(리셉션)                         → communal 존 + 다이닝/러그 + 화분
 * 데코 가구 앵커는 officeV3.V3_OBSTACLE_RECTS(충돌 사각)와 정합하게 고정 배치.
 * 화분·러그·트로프 등 데코는 톤(§5-0 3원칙)을 위해 존별로 살포한다.
 */
export function buildV3Layout(): V3Layout {
  const W = SCENE_W_M; // 20
  const H = SCENE_H_M; // ≈11.256
  const wallInset = 0.5;

  // 데코 앵커(V3 축정렬 고정 — V3_OBSTACLE_RECTS 중심과 정합). 방 라벨/핫스팟은 DOM 오버레이가
  // office2d ROOMS/HOTSPOTS로 별도 배치하므로, 여기 가구는 시각 배경 전용이다.
  const cReception = { x: 9.4, y: 2.55 }; // 다이닝 테이블 obstacle(8.0,1.9,2.8,2.0) 중심 — 벤치 A 상단 좌석과 이격
  const cLounge = { x: 12.4, y: 5.0 }; // 라운지 obstacle(10.9,4.0,3.0,2.0) 중심
  const cBoard = { x: 15.8, y: 6.95 }; // 회의실 1(보드룸) 테이블 obstacle(14.0,5.9,3.6,2.1) 중심
  const cMeeting2 = { x: 17.35, y: 2.35 }; // 회의실 2(미팅룸·4석, 북동) 테이블 obstacle(16.05,1.55,2.6,1.7) 중심
  const cPantry = { x: 3.2, y: 4.7 };
  const cCafe = { x: 3.4, y: 7.4 };
  const cBooth = { x: 14.3, y: 9.7 }; // 폰부스 obstacle(13.55,8.9,1.5,1.6) 중심(남동)

  // ── zones: 탑다운 존(존 라벨은 v3 foreground가 아니라 DOM이 담당 — label은 빈 값으로
  //    두어 캔버스 중복 라벨을 피하고, floor/glass 텍스처만 사용) ──
  const zones: V3Zone[] = [
    { id: 'work', label: '', kind: 'work', x: 4.6, y: 4.0, w: 7.2, h: 6.5 },
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
    {
      id: 'meeting-a',
      label: '',
      kind: 'meeting',
      x: 15.2,
      y: 0.8,
      w: 4.3,
      h: 3.4,
      floor: 'carpet',
      glass: ['W', 'S'],
      door: { side: 'S', at: 1.2, w: 1.0 },
    },
    { id: 'pantry', label: '', kind: 'pantry', x: 1.2, y: 3.6, w: 4.8, h: 3.4, floor: 'tile' },
    { id: 'lounge', label: '', kind: 'lounge', x: 11.0, y: 3.6, w: 4.0, h: 2.6 },
    { id: 'reception', label: '', kind: 'communal', x: 7.6, y: 1.5, w: 4.4, h: 2.4 },
    { id: 'booth', label: '', kind: 'booth', x: 13.5, y: 9.0, w: 2.0, h: 1.7 },
  ];

  // ── furniture: 좌석 정합 벤치 + 존별 데코(러그는 renderer가 floor 레이어에서 먼저 그림) ──
  const furniture: V3Furniture[] = [
    // 러그(바닥층) — 리셉션/라운지 접지
    { t: 'rug', style: 'oriental', x: cReception.x, y: cReception.y + 0.15, w: 3.4, h: 1.9 },
    { t: 'rug', style: 'abstract', x: cLounge.x, y: cLounge.y, w: 3.4, h: 2.2 },

    // 워크스테이션(10인) — officeV3.BENCHES(서측 2열 + 동측 1열). bench4가 좌석 4점씩 파생,
    //  WS-C3·C4는 시드 제외(게스트 의자). 세로 통로 x≈8.1은 비워 둔다.
    ...BENCHES.map((b) => ({ t: 'bench4', x: b.x, y: b.y })),
    { t: 'plant', x: 4.5, y: 4.5, s: 0.85, kind: 'fern' },
    { t: 'plant', x: 11.9, y: 8.7, s: 0.9, kind: 'monstera' },

    // 회의실 1(보드룸) — 8석 테이블 + TV(동측 벽)
    { t: 'meetingTable', x: cBoard.x, y: cBoard.y, w: 3.3, h: 1.15, seats: 8 },
    { t: 'tv', x: 18.9, y: cBoard.y, len: 1.7, rot: 90 },
    { t: 'plant', x: 13.7, y: 5.4, s: 0.8, kind: 'fern' },

    // 회의실 2(미팅룸·4석, 북동 신설) — 테이블 + TV(북측 벽)
    { t: 'meetingTable', x: cMeeting2.x, y: cMeeting2.y, w: 2.2, h: 1.05, seats: 4 },
    { t: 'tv', x: cMeeting2.x, y: 0.68, len: 1.5, rot: 0 },
    { t: 'plant', x: 18.95, y: 3.6, s: 0.75, kind: 'fern' },

    // 팬트리/카페 — 카운터(서측 벽, obstacle 0.7~1.8과 정합)·냉장고·워터쿨러·카페 테이블
    { t: 'counter', x: 1.05, y: cPantry.y, len: 2.6, side: 'W' },
    { t: 'fridge', x: 1.1, y: cPantry.y + 1.9, rot: 90 },
    { t: 'waterCooler', x: 4.6, y: cPantry.y - 1.1 },
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
    { t: 'diningTable', x: cReception.x, y: cReception.y + 0.15, w: 2.6, h: 1.0 },
    { t: 'plant', x: cReception.x - 2.2, y: cReception.y - 0.7, s: 1.0, kind: 'monstera' },

    // 폰부스(남동, obstacle 13.55,8.9,1.5,1.6과 정합)
    { t: 'booth', x: cBooth.x, y: cBooth.y - 0.15, w: 1.5, h: 1.6, door: 'N' },
    { t: 'plant', x: 13.1, y: 8.4, s: 0.8, kind: 'fern' },

    // 젠 코너(남동, 벤치마크 오마주 — 데코, 비장애물)
    { t: 'pebbles', x: 17.9, y: 9.3, w: 1.8, h: 1.7 },
    { t: 'rocks', x: 18.5, y: 9.9 },
    { t: 'plant', x: 19.0, y: 9.0, s: 0.9, kind: 'monstera' },
    { t: 'plant', x: 17.55, y: 10.3, s: 0.7, kind: 'fern' },

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
