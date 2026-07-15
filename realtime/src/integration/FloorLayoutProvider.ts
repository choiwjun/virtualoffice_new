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
 * HORIZON v1 팩 보행 폴리곤 (정규 0~1, 정본: tools/asset-gen/out/layout.json —
 * D30 프로시저럴 생성. 수정은 tools/asset-gen/src/plate.js → 재생성·재동기).
 */
const HORIZON_WALK_AREA: Array<[number, number]> = [
  [0.4085, 0.1762],
  [0.9362, 0.6451],
  [0.5915, 0.9513],
  [0.0638, 0.4825],
];

/**
 * 플레이트에 구워진 가구 충돌 폴리곤(정규) — 변을 벽으로 등록해 가구 위 보행을 막는다.
 * 프론트 lib/office2d.ts의 OBSTACLES와 반드시 동일해야 한다.
 */
export const HORIZON_OBSTACLES: Array<Array<[number, number]>> = [
  [[0.442, 0.2413], [0.5275, 0.3172], [0.4954, 0.3456], [0.41, 0.2697]],
  [[0.5946, 0.3605], [0.6739, 0.431], [0.6373, 0.4635], [0.558, 0.393]],
  [[0.5427, 0.4066], [0.622, 0.477], [0.5885, 0.5069], [0.5092, 0.4364]],
  [[0.6556, 0.4581], [0.6922, 0.4906], [0.6617, 0.5177], [0.6251, 0.4852]],
  [[0.7654, 0.5448], [0.8752, 0.6423], [0.8294, 0.683], [0.7196, 0.5854]],
  [[0.7654, 0.4852], [0.773, 0.492], [0.6449, 0.6058], [0.6373, 0.599]],
  [[0.6434, 0.599], [0.7349, 0.6803], [0.7288, 0.6857], [0.6373, 0.6044]],
  [[0.7715, 0.7128], [0.8081, 0.7453], [0.802, 0.7507], [0.7654, 0.7182]],
  // 워크스테이션 A/B — 책상 단위 4개씩(의자 통로는 보행 가능)
  [[0.4115, 0.4066], [0.4664, 0.4554], [0.439, 0.4798], [0.3841, 0.431]],
  [[0.4664, 0.4554], [0.5214, 0.5041], [0.4939, 0.5285], [0.439, 0.4798]],
  [[0.3582, 0.454], [0.4131, 0.5028], [0.3856, 0.5272], [0.3307, 0.4784]],
  [[0.4131, 0.5028], [0.468, 0.5516], [0.4405, 0.576], [0.3856, 0.5272]],
  [[0.6281, 0.7264], [0.683, 0.7751], [0.6373, 0.8158], [0.5824, 0.767]],
  [[0.622, 0.6776], [0.7379, 0.7806], [0.7303, 0.7873], [0.6144, 0.6844]],
  [[0.619, 0.6803], [0.6266, 0.6871], [0.5351, 0.7684], [0.5275, 0.7616]],
  [[0.5336, 0.7616], [0.5702, 0.7941], [0.5625, 0.8009], [0.5259, 0.7684]],
  [[0.6068, 0.8266], [0.6434, 0.8591], [0.6357, 0.8659], [0.5991, 0.8334]],
  [[0.2621, 0.347], [0.3353, 0.412], [0.2804, 0.4608], [0.2072, 0.3957]],
  [[0.2438, 0.309], [0.259, 0.3226], [0.1797, 0.393], [0.1645, 0.3795]],
  [[0.4664, 0.5963], [0.5214, 0.6451], [0.4939, 0.6694], [0.439, 0.6207]],
  [[0.5214, 0.6451], [0.5763, 0.6938], [0.5488, 0.7182], [0.4939, 0.6694]],
  [[0.4131, 0.6437], [0.468, 0.6925], [0.4405, 0.7169], [0.3856, 0.6681]],
  [[0.468, 0.6925], [0.5229, 0.7413], [0.4954, 0.7656], [0.4405, 0.7169]],
  [[0.1706, 0.477], [0.2102, 0.5123], [0.1736, 0.5448], [0.134, 0.5096]],
  [[0.6098, 0.8727], [0.6525, 0.9106], [0.6418, 0.9201], [0.5991, 0.8822]],
  [[0.6052, 0.874], [0.6129, 0.8808], [0.5641, 0.9242], [0.5564, 0.9174]],
  [[0.6449, 0.9093], [0.6525, 0.916], [0.6037, 0.9594], [0.5961, 0.9526]],
];

/** HORIZON 로비 스폰(정규 0.38, 0.44 — 개활지). bounds 중심은 워크스테이션과 겹쳐 스폰 불가. */
export const HORIZON_SPAWN_N: [number, number] = [0.4176, 0.3768];

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
        // v1 팩 layout.json meetingZones (bbox 미터 환산). 이동은 막지 않고 정원만 검사.
        { roomId: "boardroom", bounds: { x: 12.87, y: 5.52, w: 5.79, h: 2.90 }, capacity: 8 },
        { roomId: "meeting-a", bounds: { x: 10.61, y: 7.69, w: 4.03, h: 2.01 }, capacity: 4 },
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
