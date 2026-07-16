/**
 * office2d.ts — 2.5D 가상오피스 씬 설정 + 좌표계 (정본).
 *
 * D30 v1 팩 (2026-07-13): 에셋·지오메트리 정본 = tools/asset-gen (프로시저럴 생성).
 * 아래 WALK_AREA/ROOMS/OBSTACLES/SPAWNS는 tools/asset-gen/out/layout.json에서 주입 —
 * 수정은 tools/asset-gen/src/plate.js에서 하고 `node generate.js all --final` 후 재동기.
 * 요구 스펙 = docs/planning/17-asset-rework-spec.md.
 *
 * 좌표계(유지): 플레이트 1672×941px 비율. 서버(realtime)와 미터 단위 공유 — 가로 20m 스케일.
 * realtime/src/integration/FloorLayoutProvider.ts 의 SCENE_W_M/SCENE_H_M 과 동일해야 한다.
 * 보행영역·방·장애물 폴리곤은 이동서버 검증 계약이므로 에셋과 독립적으로 유지.
 */

/** 에셋 존재 여부 — 신규 팩 납품 후 true로 전환 (D30). */
export const ASSETS_READY = true; // v1 신규 팩 납품(2026-07-13, tools/asset-gen 생성)

export const PLATE_URL = '/office2d/plates/horizon.png';
export const PLATE_W = 1672;
export const PLATE_H = 941;

/** 레이어 합성 팩(v2.1 오클루전): 배경 + 가구 스프라이트(manifest) — 없으면 단일 플레이트 폴백. */
export const LAYERS_BASE_URL = '/office2d/layers';

/** manifest.json 스프라이트 항목 — 좌표는 플레이트 정규(0~1), z = 바닥 접점 y(아바타 zIndex와 동일 규칙). */
export interface SceneLayerSprite {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export const SCENE_W_M = 20;
export const SCENE_H_M = (PLATE_H / PLATE_W) * SCENE_W_M; // ≈ 11.256

export interface Vec2 {
  x: number;
  y: number;
}

/** 정규(0~1) → 미터. */
export function normToMeters(p: Vec2): Vec2 {
  return { x: p.x * SCENE_W_M, y: p.y * SCENE_H_M };
}

/** 미터 → 정규(0~1). */
export function metersToNorm(p: Vec2): Vec2 {
  return { x: p.x / SCENE_W_M, y: p.y / SCENE_H_M };
}

/** 보행 가능 폴리곤(정규 좌표) — HORIZON_OPEN_PLAN walkArea. */
export const WALK_AREA: Vec2[] = [
  { x: 0.4085, y: 0.1762 },
  { x: 0.9362, y: 0.6451 },
  { x: 0.5915, y: 0.9513 },
  { x: 0.0638, y: 0.4825 },
];

export interface SceneRoom {
  id: string;
  label: string;
  /** 정규 좌표 폴리곤. */
  polygon: Vec2[];
}

export const ROOMS: SceneRoom[] = [
  { id: 'reception', label: 'Reception', polygon: [{ x: 0.439, y: 0.1952 }, { x: 0.5793, y: 0.3199 }, { x: 0.4878, y: 0.4012 }, { x: 0.3475, y: 0.2765 }] },
  { id: 'lounge', label: 'Lounge', polygon: [{ x: 0.5976, y: 0.3416 }, { x: 0.7349, y: 0.4635 }, { x: 0.6373, y: 0.5502 }, { x: 0.5, y: 0.4283 }] },
  { id: 'boardroom', label: 'Board Room', polygon: [{ x: 0.7715, y: 0.4906 }, { x: 0.9331, y: 0.6342 }, { x: 0.805, y: 0.748 }, { x: 0.6434, y: 0.6044 }] },
  { id: 'meeting-a', label: 'Meeting Room', polygon: [{ x: 0.622, y: 0.683 }, { x: 0.7318, y: 0.7806 }, { x: 0.6403, y: 0.8618 }, { x: 0.5305, y: 0.7643 }] },
  { id: 'pantry', label: 'Pantry', polygon: [{ x: 0.259, y: 0.3117 }, { x: 0.3688, y: 0.4093 }, { x: 0.2621, y: 0.5041 }, { x: 0.1523, y: 0.4066 }] },
  { id: 'cafe', label: 'Cafe', polygon: [{ x: 0.1645, y: 0.4228 }, { x: 0.2651, y: 0.5123 }, { x: 0.1797, y: 0.5882 }, { x: 0.0791, y: 0.4987 }] },
  { id: 'booth', label: 'Phone Booth', polygon: [{ x: 0.6098, y: 0.8727 }, { x: 0.6525, y: 0.9106 }, { x: 0.5976, y: 0.9594 }, { x: 0.5549, y: 0.9215 }] },
];

/** 스폰 포인트(정규) — HORIZON_OPEN_PLAN spawnPoints. */
export const SPAWNS: Record<string, Vec2> = {
  lobby: { x: 0.4176, y: 0.3768 },
  work: { x: 0.4908, y: 0.5502 },
  meeting: { x: 0.7227, y: 0.7236 },
  cafe: { x: 0.2621, y: 0.5475 },
};

/**
 * 가구 충돌 폴리곤(정규) — 플레이트에 구워진 가구 위로 걷지 못하게 막는다.
 * 플레이트 그리드 실측(눈대중 ±2%). realtime SceneFloorLayoutProvider의
 * HORIZON_OBSTACLES와 반드시 동일해야 한다(서버는 이 변을 벽으로 등록).
 */
export const OBSTACLES: Vec2[][] = [
  [{ x: 0.442, y: 0.2413 }, { x: 0.5275, y: 0.3172 }, { x: 0.4954, y: 0.3456 }, { x: 0.41, y: 0.2697 }],
  [{ x: 0.5946, y: 0.3605 }, { x: 0.6739, y: 0.431 }, { x: 0.6373, y: 0.4635 }, { x: 0.558, y: 0.393 }],
  [{ x: 0.5427, y: 0.4066 }, { x: 0.622, y: 0.477 }, { x: 0.5885, y: 0.5069 }, { x: 0.5092, y: 0.4364 }],
  [{ x: 0.6556, y: 0.4581 }, { x: 0.6922, y: 0.4906 }, { x: 0.6617, y: 0.5177 }, { x: 0.6251, y: 0.4852 }],
  [{ x: 0.7654, y: 0.5448 }, { x: 0.8752, y: 0.6423 }, { x: 0.8294, y: 0.683 }, { x: 0.7196, y: 0.5854 }],
  [{ x: 0.7654, y: 0.4852 }, { x: 0.773, y: 0.492 }, { x: 0.6449, y: 0.6058 }, { x: 0.6373, y: 0.599 }],
  [{ x: 0.6434, y: 0.599 }, { x: 0.7349, y: 0.6803 }, { x: 0.7288, y: 0.6857 }, { x: 0.6373, y: 0.6044 }],
  [{ x: 0.7715, y: 0.7128 }, { x: 0.8081, y: 0.7453 }, { x: 0.802, y: 0.7507 }, { x: 0.7654, y: 0.7182 }],
  // 워크스테이션 A/B — 책상 단위 4개씩(의자 통로는 보행 가능)
  [{ x: 0.4115, y: 0.4066 }, { x: 0.4664, y: 0.4554 }, { x: 0.439, y: 0.4798 }, { x: 0.3841, y: 0.431 }],
  [{ x: 0.4664, y: 0.4554 }, { x: 0.5214, y: 0.5041 }, { x: 0.4939, y: 0.5285 }, { x: 0.439, y: 0.4798 }],
  [{ x: 0.3582, y: 0.454 }, { x: 0.4131, y: 0.5028 }, { x: 0.3856, y: 0.5272 }, { x: 0.3307, y: 0.4784 }],
  [{ x: 0.4131, y: 0.5028 }, { x: 0.468, y: 0.5516 }, { x: 0.4405, y: 0.576 }, { x: 0.3856, y: 0.5272 }],
  [{ x: 0.6281, y: 0.7264 }, { x: 0.683, y: 0.7751 }, { x: 0.6373, y: 0.8158 }, { x: 0.5824, y: 0.767 }],
  [{ x: 0.622, y: 0.6776 }, { x: 0.7379, y: 0.7806 }, { x: 0.7303, y: 0.7873 }, { x: 0.6144, y: 0.6844 }],
  [{ x: 0.619, y: 0.6803 }, { x: 0.6266, y: 0.6871 }, { x: 0.5351, y: 0.7684 }, { x: 0.5275, y: 0.7616 }],
  [{ x: 0.5336, y: 0.7616 }, { x: 0.5702, y: 0.7941 }, { x: 0.5625, y: 0.8009 }, { x: 0.5259, y: 0.7684 }],
  [{ x: 0.6068, y: 0.8266 }, { x: 0.6434, y: 0.8591 }, { x: 0.6357, y: 0.8659 }, { x: 0.5991, y: 0.8334 }],
  [{ x: 0.2621, y: 0.347 }, { x: 0.3353, y: 0.412 }, { x: 0.2804, y: 0.4608 }, { x: 0.2072, y: 0.3957 }],
  [{ x: 0.2438, y: 0.309 }, { x: 0.259, y: 0.3226 }, { x: 0.1797, y: 0.393 }, { x: 0.1645, y: 0.3795 }],
  [{ x: 0.4664, y: 0.5963 }, { x: 0.5214, y: 0.6451 }, { x: 0.4939, y: 0.6694 }, { x: 0.439, y: 0.6207 }],
  [{ x: 0.5214, y: 0.6451 }, { x: 0.5763, y: 0.6938 }, { x: 0.5488, y: 0.7182 }, { x: 0.4939, y: 0.6694 }],
  [{ x: 0.4131, y: 0.6437 }, { x: 0.468, y: 0.6925 }, { x: 0.4405, y: 0.7169 }, { x: 0.3856, y: 0.6681 }],
  [{ x: 0.468, y: 0.6925 }, { x: 0.5229, y: 0.7413 }, { x: 0.4954, y: 0.7656 }, { x: 0.4405, y: 0.7169 }],
  [{ x: 0.1706, y: 0.477 }, { x: 0.2102, y: 0.5123 }, { x: 0.1736, y: 0.5448 }, { x: 0.134, y: 0.5096 }],
  [{ x: 0.6098, y: 0.8727 }, { x: 0.6525, y: 0.9106 }, { x: 0.6418, y: 0.9201 }, { x: 0.5991, y: 0.8822 }],
  [{ x: 0.6052, y: 0.874 }, { x: 0.6129, y: 0.8808 }, { x: 0.5641, y: 0.9242 }, { x: 0.5564, y: 0.9174 }],
  [{ x: 0.6449, y: 0.9093 }, { x: 0.6525, y: 0.916 }, { x: 0.6037, y: 0.9594 }, { x: 0.5961, y: 0.9526 }],
];

// ---------------------------------------------------------------------------
// 캐릭터
// ---------------------------------------------------------------------------

export const CHARACTER_IDS = [
  'CEO', 'MANAGER', 'DEVELOPER', 'DESIGNER', 'SALES', 'HR', 'MARKETER', 'INTERN',
] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

export type AvatarState = 'idle' | 'walk' | 'sit' | 'typing';

/** 상태별 프레임 애니 스펙(v1.1 frames). 표시 높이는 avatarHeightFrac()이 깊이 기반으로 계산. */
export const AVATAR_ANIM: Record<AvatarState, { frames: number; fps: number; heightScale: number }> = {
  idle: { frames: 6, fps: 6, heightScale: 1 },
  walk: { frames: 8, fps: 10, heightScale: 1 }, // v1 팩: 상태 공통 220×460 캔버스
  sit: { frames: 6, fps: 4, heightScale: 1 }, // v1.1: 착석(호흡) — 좌석 점유 시 좌석 앵커에 표시
  typing: { frames: 6, fps: 10, heightScale: 1 }, // v2.2: 착석 타건 — 착석 중 버스트로 전환(뷰포트 판정)
};

/**
 * 착석 중 타이핑 버스트 사이클 — 벽시계(Date.now) 기반 결정적 위상이라
 * 모든 클라이언트가 같은 아바타의 같은 타이밍을 본다. userId 해시로 위상을 분산해
 * 여러 착석자가 동시에 일제히 타건하지 않게 한다.
 */
const TYPING_CYCLE_S = 9.5;
const TYPING_ON_S = 4.0;

export function typingBurstAt(userId: string, nowMs: number): boolean {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const offset = ((Math.abs(h) % 97) / 97) * TYPING_CYCLE_S;
  return (nowMs / 1000 + offset) % TYPING_CYCLE_S < TYPING_ON_S;
}

/**
 * 깊이(원근) 기반 아바타 표시 높이 — 씬에 구워져 있던 인물 실측 캘리브레이션:
 * 화면 위쪽(멀리) 발 y≈0.36에서 신장 ≈ 화면높이 0.14, 아래쪽(가까이) y≈0.80에서 ≈0.17.
 * 보행영역 상단(0.22)~하단(0.86)에 선형 매핑.
 */
// v2 씬 미터 계약: 인물 1.7m × ZPX 48px/m ÷ 캔버스 신체비 353/460 → 0.113 (책상 0.72m 대비 42%).
// 이전 0.088~0.102는 씬 대비 16% 작아 "사람이 책상보다 작은" 체감의 원인.
const HEIGHT_FRAC_BACK = 0.108;
const HEIGHT_FRAC_FRONT = 0.118;
const WALK_TOP = 0.18;
const WALK_BOTTOM = 0.95;

export function avatarHeightFrac(ny: number, state: AvatarState): number {
  const t = Math.min(1, Math.max(0, (ny - WALK_TOP) / (WALK_BOTTOM - WALK_TOP)));
  return (HEIGHT_FRAC_BACK + (HEIGHT_FRAC_FRONT - HEIGHT_FRAC_BACK) * t) * AVATAR_ANIM[state].heightScale;
}

export function frameUrl(id: CharacterId, state: AvatarState, frame: number): string {
  return `/office2d/characters/${id}/${state}_${String(frame).padStart(2, '0')}.png`;
}

/** userId → 캐릭터 결정(안정 해시). 같은 사용자는 항상 같은 캐릭터. */
export function characterFor(userId: string): CharacterId {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return CHARACTER_IDS[Math.abs(h) % CHARACTER_IDS.length];
}

/** 2.5D 스프라이트 캐릭터 표시 라벨(아바타 설정 프리셋용). */
export const CHARACTER_LABELS: Record<CharacterId, string> = {
  CEO: 'CEO', MANAGER: '매니저', DEVELOPER: '개발자', DESIGNER: '디자이너',
  SALES: '영업', HR: '인사', MARKETER: '마케터', INTERN: '인턴',
};

const _CHAR_SET: ReadonlySet<string> = new Set(CHARACTER_IDS);

/** 문자열이 유효한 2.5D 스프라이트 캐릭터 id인지. */
export function isCharacterId(v: string | null | undefined): v is CharacterId {
  return !!v && _CHAR_SET.has(v);
}

/**
 * 아바타 프리셋(preset_id)이 2.5D 스프라이트 캐릭터면 그걸 사용, 아니면 userId 해시 폴백.
 * (구 preset humanoid_a/b 등 스프라이트 아닌 값은 해시로 안정 배정 — 하위호환.)
 */
export function characterForAvatar(userId: string, presetId?: string | null): CharacterId {
  return isCharacterId(presetId) ? presetId : characterFor(userId);
}

// ---------------------------------------------------------------------------
// 씬 시간대 테마(17-spec §2 "시간대 변형은 후속" 이행) — 에셋 재굽기 없이
// 스테이지 필터로 배경·가구·아바타를 일괄 톤 변환(톤 정합 유지, D29 교훈)
// + 아바타 위(마커 아래)에 앰비언트 오버레이.
// ---------------------------------------------------------------------------

export type SceneThemeId = 'day' | 'dusk' | 'night';

export interface SceneTheme {
  id: SceneThemeId;
  label: string;
  /** 씬(플레이트+가구+아바타) 래퍼에 걸리는 CSS filter. */
  filter: string;
  /** 씬 위에 얹는 앰비언트 라이트 오버레이(CSS background). */
  overlay: string;
  overlayOpacity: number;
  /** 테마 토글 칩의 인디케이터 색. */
  chip: string;
}

export const SCENE_THEMES: Record<SceneThemeId, SceneTheme> = {
  day: {
    id: 'day',
    label: '주간',
    filter: 'none',
    overlay: 'none',
    overlayOpacity: 0,
    chip: '#F5C64B',
  },
  dusk: {
    id: 'dusk',
    label: '석양',
    filter: 'brightness(0.97) saturate(1.06) sepia(0.16) hue-rotate(-9deg)',
    overlay:
      'linear-gradient(205deg, rgba(255,146,82,0.15) 0%, rgba(255,120,90,0.07) 45%, rgba(72,60,110,0.16) 100%)',
    overlayOpacity: 1,
    chip: '#F08A4B',
  },
  night: {
    id: 'night',
    label: '야간',
    filter: 'brightness(0.84) saturate(0.84) contrast(1.04) hue-rotate(8deg)',
    overlay:
      'linear-gradient(195deg, rgba(24,38,82,0.26) 0%, rgba(12,20,48,0.30) 55%, rgba(8,14,34,0.36) 100%)',
    overlayOpacity: 1,
    chip: '#3E4E8E',
  },
};

/** 로컬 시각 → 자동 테마(주간 07–17, 석양 17–20, 야간 20–07). */
export function themeForHour(hour: number): SceneThemeId {
  if (hour >= 7 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

// ---------------------------------------------------------------------------
// 지오메트리 유틸
// ---------------------------------------------------------------------------

/** 점이 폴리곤 안인가(ray casting). */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/** 보행 가능 판정 = 보행 폴리곤 안 + 모든 가구 폴리곤 밖. */
export function isWalkable(p: Vec2): boolean {
  if (!pointInPolygon(p, WALK_AREA)) return false;
  return !OBSTACLES.some((ob) => pointInPolygon(p, ob));
}

/**
 * 클릭점을 보행 가능한 지점으로 보정: 보행영역 중심→클릭점 선분을 클릭점에서부터
 * 역방향 샘플링해 첫 보행 가능 점을 찾는다(가구/경계 살짝 바깥에서 멈춤).
 */
export function clampToWalkable(p: Vec2): Vec2 {
  if (isWalkable(p)) return p;
  const c = polygonCentroid(WALK_AREA);
  const STEPS = 120;
  for (let i = 1; i <= STEPS; i++) {
    const t = 1 - i / STEPS;
    const q = { x: c.x + (p.x - c.x) * t, y: c.y + (p.y - c.y) * t };
    if (isWalkable(q)) {
      // 경계에서 한 스텝 더 안쪽(서버 wall 교차 거부 방지 여유).
      const t2 = Math.max(0, t - 1.5 / STEPS);
      return { x: c.x + (p.x - c.x) * t2, y: c.y + (p.y - c.y) * t2 };
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// 경로탐색 (그리드 A*) — 유리벽 회의실은 문 개구부로만 진입 가능한데,
// 이동 walker는 직선 스텝만 스트리밍하므로 클릭 → 경유지 경로로 변환해 준다.
// 좌표는 전부 미터(서버 좌표계). 지오메트리가 정적이라 그리드는 1회 계산 후 캐시.
// ---------------------------------------------------------------------------

const PATH_CELL_M = 0.1; // 그리드 해상도(문 개구부 1.2m ≫ 셀 크기)
const PATH_CLEAR_M = 0.07; // 장애물 여유 — 서버 벽 세그먼트를 스치는 스텝 방지
const GRID_COLS = Math.round(SCENE_W_M / PATH_CELL_M);
const GRID_ROWS = Math.round(SCENE_H_M / PATH_CELL_M);

let walkGrid: Uint8Array | null = null;

function pathGrid(): Uint8Array {
  if (walkGrid) return walkGrid;
  const g = new Uint8Array(GRID_COLS * GRID_ROWS);
  for (let cy = 0; cy < GRID_ROWS; cy++) {
    for (let cx = 0; cx < GRID_COLS; cx++) {
      const mx = (cx + 0.5) * PATH_CELL_M;
      const my = (cy + 0.5) * PATH_CELL_M;
      // 셀 중심 + 상하좌우 여유점 모두 보행 가능해야 통과 셀(장애물 인플레이션).
      const ok = [
        { x: mx, y: my },
        { x: mx - PATH_CLEAR_M, y: my },
        { x: mx + PATH_CLEAR_M, y: my },
        { x: mx, y: my - PATH_CLEAR_M },
        { x: mx, y: my + PATH_CLEAR_M },
      ].every((p) => isWalkable(metersToNorm(p)));
      g[cy * GRID_COLS + cx] = ok ? 1 : 0;
    }
  }
  // 장애물 변 래스터라이즈: 변이 지나는 셀을 폐쇄(이웃 확장 없음 — 확장하면 통로가 봉쇄됨).
  // 효과: 열린 셀 내부에는 어떤 벽(변)도 존재하지 않음이 보장 → 열린 셀만 지나는
  // A* 스텝은 서버 벽 교차가 원천 불가(중심점 샘플이 놓치는 꼭짓점 슬리버 커버).
  const closeCell = (mx: number, my: number) => {
    const x = Math.floor(mx / PATH_CELL_M);
    const y = Math.floor(my / PATH_CELL_M);
    if (x >= 0 && y >= 0 && x < GRID_COLS && y < GRID_ROWS) g[y * GRID_COLS + x] = 0;
  };
  for (const ob of OBSTACLES) {
    for (let i = 0; i < ob.length; i++) {
      const a = normToMeters(ob[i]);
      const b = normToMeters(ob[(i + 1) % ob.length]);
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (PATH_CELL_M / 3)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        closeCell(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }
  }
  walkGrid = g;
  return g;
}

/** 장애물 변 목록(미터) — 스무딩의 정확 교차 검증용(서버 wall 판정과 동일 기하). */
let obstacleEdgesM: Array<[Vec2, Vec2]> | null = null;
function edgesM(): Array<[Vec2, Vec2]> {
  if (obstacleEdgesM) return obstacleEdgesM;
  const out: Array<[Vec2, Vec2]> = [];
  for (const ob of OBSTACLES) {
    for (let i = 0; i < ob.length; i++) {
      out.push([normToMeters(ob[i]), normToMeters(ob[(i + 1) % ob.length])]);
    }
  }
  obstacleEdgesM = out;
  return out;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** 선분 ab와 cd의 교차 여부(서버 movement 검증과 동일한 판정 기준). */
function segsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cellOf(p: Vec2): { x: number; y: number } {
  return {
    x: Math.min(GRID_COLS - 1, Math.max(0, Math.floor(p.x / PATH_CELL_M))),
    y: Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(p.y / PATH_CELL_M))),
  };
}

/** 막힌 셀이면 주변 링에서 가장 가까운 통과 셀을 찾는다(시작/목표 스냅).
 *  반경 25셀(2.5m) — 좌석 앵커가 워크스테이션 장애물 내부 깊숙이 있어도 닿게. */
function nearestOpenCell(c: { x: number; y: number }): { x: number; y: number } | null {
  const g = pathGrid();
  if (g[c.y * GRID_COLS + c.x]) return c;
  for (let r = 1; r <= 25; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) continue;
        if (g[y * GRID_COLS + x]) return { x, y };
      }
    }
  }
  return null;
}

/** 시작점 스냅용: pM에서 직선으로(벽 비교차) 닿을 수 있는 가장 가까운 열린 셀. */
function nearestReachableOpenCell(pM: Vec2): { x: number; y: number } | null {
  const c = cellOf(pM);
  const g = pathGrid();
  if (g[c.y * GRID_COLS + c.x]) return c;
  for (let r = 1; r <= 25; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) continue;
        if (!g[y * GRID_COLS + x]) continue;
        const center = { x: (x + 0.5) * PATH_CELL_M, y: (y + 0.5) * PATH_CELL_M };
        let crosses = false;
        for (const [p, q] of edgesM()) {
          if (segsIntersect(pM, center, p, q)) { crosses = true; break; }
        }
        if (!crosses) return { x, y };
      }
    }
  }
  return nearestOpenCell(c); // 폴백(전방 전부 벽 — 사실상 갇힘)
}

/** 선분(미터)이 통과 셀로만 지나가고 어떤 장애물 변과도 교차하지 않는가 — 경로 스무딩용. */
function segmentClear(a: Vec2, b: Vec2): boolean {
  const g = pathGrid();
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(d / 0.05));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const c = cellOf({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (!g[c.y * GRID_COLS + c.x]) return false;
  }
  // 정확 교차 검증 — 서버가 이 선분을 collision으로 거부하지 않음을 보장.
  for (const [p, q] of edgesM()) {
    if (segsIntersect(a, b, p, q)) return false;
  }
  return true;
}

/**
 * 장애물 위 앵커(좌석 등)의 최근접 보행 가능 지점(미터).
 * clampToWalkable은 씬 중심 방향으로 밀어내 멀어질 수 있어, 좌석 접근은 이걸 쓴다.
 */
export function nearestWalkableM(pM: Vec2): Vec2 {
  if (isWalkable(metersToNorm(pM))) return pM;
  const c = nearestOpenCell(cellOf(pM));
  if (!c) return normToMeters(clampToWalkable(metersToNorm(pM)));
  return { x: (c.x + 0.5) * PATH_CELL_M, y: (c.y + 0.5) * PATH_CELL_M };
}

/**
 * fromM → toM 보행 경로(미터 경유지, from 제외·to 포함). A* 8방향(코너 컷 금지) 후
 * 라인오브사이트 그리디 스무딩. 경로가 없으면 [toM] 반환(기존 직선 동작 폴백).
 */
export function findPath(fromM: Vec2, toM: Vec2): Vec2[] {
  const g = pathGrid();
  // 시작이 폐쇄 셀(가구 변에 좌초)이면 — 링에서 가장 가까운 셀이 아니라
  // fromM에서 **벽을 가로지르지 않고 닿을 수 있는** 열린 셀로 스냅해야 한다.
  // (반대편 셀로 스냅되면 첫 스텝부터 서버가 collision으로 전부 거부 → 영구 스턱)
  const start = nearestReachableOpenCell(fromM);
  const goal = nearestOpenCell(cellOf(toM));
  if (!start || !goal) return [toM];

  const N = GRID_COLS * GRID_ROWS;
  const idx = (x: number, y: number) => y * GRID_COLS + x;
  const startI = idx(start.x, start.y);
  const goalI = idx(goal.x, goal.y);

  const gScore = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  gScore[startI] = 0;

  // 이진 힙(f값 최소) — [f, index] 평탄 배열.
  const heap: number[] = [];
  const heapPush = (f: number, i: number) => {
    heap.push(f, i);
    let c = heap.length / 2 - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p * 2] <= heap[c * 2]) break;
      const tf = heap[p * 2], ti = heap[p * 2 + 1];
      heap[p * 2] = heap[c * 2]; heap[p * 2 + 1] = heap[c * 2 + 1];
      heap[c * 2] = tf; heap[c * 2 + 1] = ti;
      c = p;
    }
  };
  const heapPop = (): number => {
    const top = heap[1];
    const lf = heap.pop() as number;
    const li = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = li; heap[1] = lf;
      // 위 pop 순서 주의: [f,i] 쌍 — 마지막 쌍을 루트로.
      let c = 0;
      const size = heap.length / 2;
      for (;;) {
        const l = c * 2 + 1, r = c * 2 + 2;
        let m = c;
        if (l < size && heap[l * 2] < heap[m * 2]) m = l;
        if (r < size && heap[r * 2] < heap[m * 2]) m = r;
        if (m === c) break;
        const tf = heap[m * 2], ti = heap[m * 2 + 1];
        heap[m * 2] = heap[c * 2]; heap[m * 2 + 1] = heap[c * 2 + 1];
        heap[c * 2] = tf; heap[c * 2 + 1] = ti;
        c = m;
      }
    }
    return top;
  };
  const h = (i: number) => {
    const x = i % GRID_COLS, y = (i / GRID_COLS) | 0;
    const dx = Math.abs(x - goal.x), dy = Math.abs(y - goal.y);
    return Math.max(dx, dy) + 0.41421 * Math.min(dx, dy); // octile
  };
  heapPush(h(startI), startI);

  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.41421], [1, -1, 1.41421], [-1, 1, 1.41421], [-1, -1, 1.41421],
  ] as const;

  let found = false;
  while (heap.length > 0) {
    const cur = heapPop();
    if (cur === goalI) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % GRID_COLS, cy = (cur / GRID_COLS) | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_COLS || ny >= GRID_ROWS) continue;
      if (!g[idx(nx, ny)]) continue;
      // 대각선 코너 컷 금지 — 양옆 직교 셀이 모두 열려 있어야 통과.
      if (dx !== 0 && dy !== 0 && (!g[idx(cx + dx, cy)] || !g[idx(cx, cy + dy)])) continue;
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      const ng = gScore[cur] + cost;
      if (ng < gScore[ni]) {
        gScore[ni] = ng;
        from[ni] = cur;
        heapPush(ng + h(ni), ni);
      }
    }
  }
  if (!found) return [toM];

  // 역추적 → 셀 중심 경로. 원본 목표점은 **열린 셀일 때만** 덧붙인다 —
  // 폐쇄 셀(가구 변 근처) 원문을 붙이면 벽에서 수 cm 지점에 좌초해 다음 이동이 전부 거부된다.
  const raw: Vec2[] = [];
  for (let i = goalI; i !== -1; i = from[i]) {
    raw.push({ x: ((i % GRID_COLS) + 0.5) * PATH_CELL_M, y: (((i / GRID_COLS) | 0) + 0.5) * PATH_CELL_M });
  }
  raw.reverse();
  const toCell = cellOf(toM);
  if (g[toCell.y * GRID_COLS + toCell.x]) raw.push({ ...toM });

  // 그리디 스무딩: 현 위치에서 보이는(통과 셀만 지나는) 가장 먼 경유지로 점프.
  const out: Vec2[] = [];
  let cur = { ...fromM };
  let i = 0;
  while (i < raw.length) {
    let j = raw.length - 1;
    for (; j > i; j--) if (segmentClear(cur, raw[j])) break;
    out.push(raw[j]);
    cur = raw[j];
    i = j + 1;
  }
  return out.length > 0 ? out : [toM];
}
