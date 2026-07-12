/**
 * office2d.ts — 2.5D 가상오피스 씬 설정 + 좌표계 (정본).
 *
 * 씬 지오메트리 정본: docs/virtual_office_2_5d_modular_brandable_v2_2_hotfix/05_layouts/HORIZON_OPEN_PLAN.json
 * 캐릭터 표시 메타 정본: docs/virtual_office_2_5d_character_pack_v3_0/03_registry/character-registry-v3.json
 * 캐릭터 프레임 아트: v1 production pack frames(부감 신작 납품 시 public/office2d/characters만 교체).
 *
 * 좌표계: 플레이트 1672×941px. 서버(realtime)와 미터 단위 공유 — 가로 20m 스케일.
 * realtime/src/integration/FloorLayoutProvider.ts 의 SCENE_W_M/SCENE_H_M 과 동일해야 한다.
 */

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
  { x: 0.2, y: 0.25 },
  { x: 0.78, y: 0.22 },
  { x: 0.91, y: 0.82 },
  { x: 0.13, y: 0.86 },
];

export interface SceneRoom {
  id: string;
  label: string;
  /** 정규 좌표 폴리곤. */
  polygon: Vec2[];
}

export const ROOMS: SceneRoom[] = [
  {
    id: 'reception',
    label: 'Reception',
    polygon: [
      { x: 0.12, y: 0.08 }, { x: 0.42, y: 0.08 }, { x: 0.44, y: 0.34 }, { x: 0.14, y: 0.35 },
    ],
  },
  {
    id: 'boardroom',
    label: 'Board Room',
    polygon: [
      { x: 0.66, y: 0.08 }, { x: 0.95, y: 0.08 }, { x: 0.94, y: 0.34 }, { x: 0.64, y: 0.33 },
    ],
  },
  {
    id: 'lounge',
    label: 'Lounge',
    polygon: [
      { x: 0.37, y: 0.08 }, { x: 0.66, y: 0.08 }, { x: 0.64, y: 0.29 }, { x: 0.4, y: 0.3 },
    ],
  },
];

/** 스폰 포인트(정규) — HORIZON_OPEN_PLAN spawnPoints. */
export const SPAWNS: Record<string, Vec2> = {
  lobby: { x: 0.38, y: 0.44 },
  work: { x: 0.48, y: 0.57 },
  meeting: { x: 0.75, y: 0.34 },
  cafe: { x: 0.3, y: 0.77 },
};

/**
 * 가구 충돌 폴리곤(정규) — 플레이트에 구워진 가구 위로 걷지 못하게 막는다.
 * 플레이트 그리드 실측(눈대중 ±2%). realtime SceneFloorLayoutProvider의
 * HORIZON_OBSTACLES와 반드시 동일해야 한다(서버는 이 변을 벽으로 등록).
 */
export const OBSTACLES: Vec2[][] = [
  // 리셉션 데스크
  [{ x: 0.195, y: 0.335 }, { x: 0.295, y: 0.255 }, { x: 0.395, y: 0.315 }, { x: 0.265, y: 0.415 }],
  // 중앙 8인 회의 테이블(+의자)
  [{ x: 0.415, y: 0.455 }, { x: 0.545, y: 0.375 }, { x: 0.615, y: 0.44 }, { x: 0.475, y: 0.53 }],
  // 워크스테이션 클러스터(좌측 2열)
  [{ x: 0.31, y: 0.575 }, { x: 0.475, y: 0.465 }, { x: 0.575, y: 0.565 }, { x: 0.42, y: 0.70 }],
  // 워크스테이션 클러스터(우측 하단)
  [{ x: 0.52, y: 0.70 }, { x: 0.655, y: 0.615 }, { x: 0.735, y: 0.70 }, { x: 0.60, y: 0.80 }],
  // 팬트리 아일랜드(+스툴)
  [{ x: 0.135, y: 0.66 }, { x: 0.27, y: 0.575 }, { x: 0.36, y: 0.66 }, { x: 0.225, y: 0.76 }],
  // 카페 원탁(+의자)
  [{ x: 0.22, y: 0.84 }, { x: 0.30, y: 0.78 }, { x: 0.38, y: 0.84 }, { x: 0.30, y: 0.91 }],
  // 중앙 우측 유리회의실 테이블
  [{ x: 0.655, y: 0.42 }, { x: 0.755, y: 0.375 }, { x: 0.80, y: 0.425 }, { x: 0.70, y: 0.475 }],
  // 보드룸 테이블(우상단, 보행영역 접경부)
  [{ x: 0.705, y: 0.255 }, { x: 0.845, y: 0.21 }, { x: 0.90, y: 0.255 }, { x: 0.76, y: 0.30 }],
];

// ---------------------------------------------------------------------------
// 캐릭터
// ---------------------------------------------------------------------------

export const CHARACTER_IDS = [
  'JAMES', 'OLIVIA', 'ETHAN', 'SOPHIA', 'NOAH', 'AVA', 'LIAM', 'MAYA',
] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

export type AvatarState = 'idle' | 'walk';

/** 상태별 프레임 애니 스펙(v1 frames). 표시 높이는 avatarHeightFrac()이 깊이 기반으로 계산. */
export const AVATAR_ANIM: Record<AvatarState, { frames: number; fps: number; heightScale: number }> = {
  idle: { frames: 6, fps: 6, heightScale: 1 },
  walk: { frames: 8, fps: 10, heightScale: 188 / 190 },
};

/**
 * 깊이(원근) 기반 아바타 표시 높이 — 씬에 구워져 있던 인물 실측 캘리브레이션:
 * 화면 위쪽(멀리) 발 y≈0.36에서 신장 ≈ 화면높이 0.14, 아래쪽(가까이) y≈0.80에서 ≈0.17.
 * 보행영역 상단(0.22)~하단(0.86)에 선형 매핑.
 */
const HEIGHT_FRAC_BACK = 0.13;  // ny = WALK_TOP에서
const HEIGHT_FRAC_FRONT = 0.175; // ny = WALK_BOTTOM에서
const WALK_TOP = 0.22;
const WALK_BOTTOM = 0.86;

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
