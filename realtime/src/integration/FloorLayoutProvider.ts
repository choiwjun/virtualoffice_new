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

/** Factory: LAYOUT_SOURCE_URL 설정 시 Http(폴백=Demo), 아니면 Demo. */
export function createFloorLayoutProvider(url: string, token = ""): FloorLayoutProvider {
  return url ? new HttpFloorLayoutProvider(url, token) : new DemoFloorLayoutProvider();
}
