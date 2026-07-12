/**
 * FloorLayoutProvider — the source of floor geometry used by movement/proximity
 * validation: bounds (for coordinate validity), colliders (for collision + LOS),
 * seats (for occupancy), and meeting zones (for capacity + enter_meeting).
 *
 * Spec seam: 15-realtime-server-spec §4 (colliders/bounds), §5 (LOS), §3 (meeting
 * capacity). Real implementation fetches from FastAPI GET /api/office/{id}/layout
 * (09 §5.4 step 7). Here we ship a hardcoded demo floor so the room is testable
 * offline. Swap in HttpFloorLayoutProvider (TODO) without touching the room.
 */

/** Axis-aligned rectangle in floor-plane metres. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A wall / glass-wall segment used for collision AABB and LOS ray intersection. */
export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Glass walls block movement but (optionally) not LOS — kept for future masking. */
  glass?: boolean;
}

export interface Seat {
  seatId: string;
  x: number;
  y: number;
  /** "fixed" seats require assignedUserId to match; "flex" seats are first-come. */
  type: "fixed" | "flex";
  assignedUserId?: string;
}

export interface MeetingZone {
  roomId: string;
  bounds: Rect;
  capacity: number;
}

export interface FloorLayout {
  officeId: string;
  floorId: string;
  /** Outer walkable bounds. */
  bounds: Rect;
  walls: WallSegment[];
  seats: Seat[];
  meetingZones: MeetingZone[];
  /** 스폰 위치(미터). 없으면 방이 bounds 중심을 사용. */
  spawn?: { x: number; y: number };
}

/** Pluggable provider interface — real impl fetches from FastAPI. */
export interface FloorLayoutProvider {
  getLayout(officeId: string, floorId: string): Promise<FloorLayout>;
}

/**
 * DemoFloorLayoutProvider — a single rectangular 20m x 15m floor with one
 * interior wall, two seats, and one meeting zone. Enough to exercise every
 * validation branch (bounds, collision, seat occupancy, capacity, LOS).
 */
export class DemoFloorLayoutProvider implements FloorLayoutProvider {
  async getLayout(officeId: string, floorId: string): Promise<FloorLayout> {
    return {
      officeId,
      floorId,
      bounds: { x: 0, y: 0, w: 20, h: 15 },
      walls: [
        // One interior partition wall from (10,0) to (10,8) — splits the room,
        // useful for LOS occlusion tests.
        { x1: 10, y1: 0, x2: 10, y2: 8, glass: false },
      ],
      seats: [
        { seatId: "seat-A", x: 3, y: 3, type: "flex" },
        { seatId: "seat-B", x: 5, y: 3, type: "fixed", assignedUserId: "user-owner" },
      ],
      meetingZones: [
        { roomId: "meeting-1", bounds: { x: 14, y: 9, w: 5, h: 5 }, capacity: 4 },
      ],
    };
  }
}

/**
 * HttpFloorLayoutProvider — FastAPI에서 배포된 층 레이아웃을 가져온다.
 * `GET /api/realtime/floor-layout?office_id=&floor_id=` (내부 토큰)이 05 office_layout JSON을
 * 이미 FloorLayout 형태로 매핑해 준다(매핑은 백엔드가 수행, 15-realtime §4 / 05 §5). 실패/미배포 시
 * 데모 층으로 폴백해 이동서버가 계속 동작한다. `layout_updated`(D12) 캐시 무효화는 TODO.
 */
export class HttpFloorLayoutProvider implements FloorLayoutProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string = "",
    private readonly fallback: FloorLayoutProvider = new DemoFloorLayoutProvider(),
  ) {}

  async getLayout(officeId: string, floorId: string): Promise<FloorLayout> {
    try {
      const headers: Record<string, string> = {};
      if (this.token) headers["authorization"] = `Bearer ${this.token}`;
      const url = `${this.baseUrl}/api/realtime/floor-layout?office_id=${encodeURIComponent(officeId)}&floor_id=${encodeURIComponent(floorId)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`layout fetch ${res.status}`);
      const data = (await res.json()) as FloorLayout;
      if (!data || !data.bounds || !Array.isArray(data.seats) || !Array.isArray(data.walls) || !Array.isArray(data.meetingZones)) {
        throw new Error("bad layout shape");
      }
      return data;
    } catch (err) {
      // 미배포/네트워크 실패 → 데모 층 폴백(이동서버는 계속 동작).
      // eslint-disable-next-line no-console
      console.warn(`[layout] fetch failed for ${officeId}/${floorId}, using demo floor:`, (err as Error).message);
      return this.fallback.getLayout(officeId, floorId);
    }
  }
}

// ---------------------------------------------------------------------------
// 2.5D 씬 플로어 (v2.2 modular_brandable 팩)
// ---------------------------------------------------------------------------

/**
 * 2.5D 플레이트 좌표계 ↔ 미터 변환 상수.
 * 플레이트 = 1672×941px (16:9). 가로 20m로 스케일 → 세로 = 941/1672·20.
 * 프론트(lib/office2d.ts)의 SCENE_W_M/SCENE_H_M과 반드시 동일해야 한다.
 */
export const SCENE_W_M = 20;
export const SCENE_H_M = (941 / 1672) * SCENE_W_M; // ≈ 11.256

/**
 * HORIZON_OPEN_PLAN 보행 폴리곤 (정규 0~1, 정본:
 * docs/virtual_office_2_5d_modular_brandable_v2_2_hotfix/05_layouts/HORIZON_OPEN_PLAN.json).
 */
const HORIZON_WALK_AREA: Array<[number, number]> = [
  [0.2, 0.25],
  [0.78, 0.22],
  [0.91, 0.82],
  [0.13, 0.86],
];

/**
 * 플레이트에 구워진 가구 충돌 폴리곤(정규) — 변을 벽으로 등록해 가구 위 보행을 막는다.
 * 프론트 lib/office2d.ts의 OBSTACLES와 반드시 동일해야 한다.
 */
export const HORIZON_OBSTACLES: Array<Array<[number, number]>> = [
  // 리셉션 데스크
  [[0.195, 0.335], [0.295, 0.255], [0.395, 0.315], [0.265, 0.415]],
  // 중앙 8인 회의 테이블(+의자)
  [[0.415, 0.455], [0.545, 0.375], [0.615, 0.44], [0.475, 0.53]],
  // 워크스테이션 클러스터(좌측 2열)
  [[0.31, 0.575], [0.475, 0.465], [0.575, 0.565], [0.42, 0.70]],
  // 워크스테이션 클러스터(우측 하단)
  [[0.52, 0.70], [0.655, 0.615], [0.735, 0.70], [0.60, 0.80]],
  // 팬트리 아일랜드(+스툴)
  [[0.135, 0.66], [0.27, 0.575], [0.36, 0.66], [0.225, 0.76]],
  // 카페 원탁(+의자)
  [[0.22, 0.84], [0.30, 0.78], [0.38, 0.84], [0.30, 0.91]],
  // 중앙 우측 유리회의실 테이블
  [[0.655, 0.42], [0.755, 0.375], [0.80, 0.425], [0.70, 0.475]],
  // 보드룸 테이블(우상단, 보행영역 접경부)
  [[0.705, 0.255], [0.845, 0.21], [0.90, 0.255], [0.76, 0.30]],
];

/** HORIZON 로비 스폰(정규 0.38, 0.44 — 개활지). bounds 중심은 워크스테이션과 겹쳐 스폰 불가. */
const HORIZON_SPAWN_N: [number, number] = [0.38, 0.44];

/**
 * SceneFloorLayoutProvider — 2.5D 씬 레이아웃의 보행 폴리곤을 미터로 변환해
 * 플로어 지오메트리로 쓴다. bounds = 폴리곤 bbox, walls = 폴리곤 변(경계 밖 이동 차단).
 * 좌석은 좌석 앵커 아트 미납 상태라 비움, 회의존 = Board Room bbox(정원 8).
 */
export class SceneFloorLayoutProvider implements FloorLayoutProvider {
  async getLayout(officeId: string, floorId: string): Promise<FloorLayout> {
    const toM = ([nx, ny]: [number, number]) => ({ x: nx * SCENE_W_M, y: ny * SCENE_H_M });
    const polygonWalls = (poly: Array<[number, number]>): WallSegment[] =>
      poly.map((pt, i) => {
        const p = toM(pt);
        const q = toM(poly[(i + 1) % poly.length]);
        return { x1: p.x, y1: p.y, x2: q.x, y2: q.y, glass: false };
      });

    const pts = HORIZON_WALK_AREA.map(toM);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    // 벽 = 보행 폴리곤 경계 + 가구 폴리곤 변 전부(가구 위 보행 차단).
    const walls: WallSegment[] = [
      ...polygonWalls(HORIZON_WALK_AREA),
      ...HORIZON_OBSTACLES.flatMap(polygonWalls),
    ];
    return {
      officeId,
      floorId,
      bounds: { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY },
      walls,
      seats: [],
      meetingZones: [
        // Board Room (HORIZON rooms.boardroom bbox → 미터). 이동은 막지 않고 정원만 검사.
        { roomId: "boardroom", bounds: { x: 12.8, y: 0.9, w: 6.2, h: 2.93 }, capacity: 8 },
      ],
      spawn: toM(HORIZON_SPAWN_N),
    };
  }
}

/** Factory: LAYOUT_SOURCE_URL 설정 시 Http(폴백=Demo) → SCENE_FLOOR 설정 시 Scene → 기본 Demo. */
export function createFloorLayoutProvider(url: string, token = "", sceneFloor = ""): FloorLayoutProvider {
  if (url) return new HttpFloorLayoutProvider(url, token);
  if (sceneFloor === "horizon") return new SceneFloorLayoutProvider();
  return new DemoFloorLayoutProvider();
}
