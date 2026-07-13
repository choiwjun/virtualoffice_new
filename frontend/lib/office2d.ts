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
  [{ x: 0.4115, y: 0.4012 }, { x: 0.5275, y: 0.5041 }, { x: 0.4176, y: 0.6017 }, { x: 0.3017, y: 0.4987 }],
  [{ x: 0.6281, y: 0.7264 }, { x: 0.683, y: 0.7751 }, { x: 0.6373, y: 0.8158 }, { x: 0.5824, y: 0.767 }],
  [{ x: 0.622, y: 0.6776 }, { x: 0.7379, y: 0.7806 }, { x: 0.7303, y: 0.7873 }, { x: 0.6144, y: 0.6844 }],
  [{ x: 0.619, y: 0.6803 }, { x: 0.6266, y: 0.6871 }, { x: 0.5351, y: 0.7684 }, { x: 0.5275, y: 0.7616 }],
  [{ x: 0.5336, y: 0.7616 }, { x: 0.5702, y: 0.7941 }, { x: 0.5625, y: 0.8009 }, { x: 0.5259, y: 0.7684 }],
  [{ x: 0.6068, y: 0.8266 }, { x: 0.6434, y: 0.8591 }, { x: 0.6357, y: 0.8659 }, { x: 0.5991, y: 0.8334 }],
  [{ x: 0.2621, y: 0.347 }, { x: 0.3353, y: 0.412 }, { x: 0.2804, y: 0.4608 }, { x: 0.2072, y: 0.3957 }],
  [{ x: 0.2438, y: 0.309 }, { x: 0.259, y: 0.3226 }, { x: 0.1797, y: 0.393 }, { x: 0.1645, y: 0.3795 }],
  [{ x: 0.4664, y: 0.5909 }, { x: 0.5824, y: 0.6938 }, { x: 0.4725, y: 0.7914 }, { x: 0.3566, y: 0.6884 }],
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

export type AvatarState = 'idle' | 'walk';

/** 상태별 프레임 애니 스펙(v1 frames). 표시 높이는 avatarHeightFrac()이 깊이 기반으로 계산. */
export const AVATAR_ANIM: Record<AvatarState, { frames: number; fps: number; heightScale: number }> = {
  idle: { frames: 6, fps: 6, heightScale: 1 },
  walk: { frames: 8, fps: 10, heightScale: 1 }, // v1 팩: 상태 공통 220×460 캔버스
};

/**
 * 깊이(원근) 기반 아바타 표시 높이 — 씬에 구워져 있던 인물 실측 캘리브레이션:
 * 화면 위쪽(멀리) 발 y≈0.36에서 신장 ≈ 화면높이 0.14, 아래쪽(가까이) y≈0.80에서 ≈0.17.
 * 보행영역 상단(0.22)~하단(0.86)에 선형 매핑.
 */
const HEIGHT_FRAC_BACK = 0.088;  // v1 아이소 팩: 원근 없음 — 가독용 미세 변화만
const HEIGHT_FRAC_FRONT = 0.102;
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
