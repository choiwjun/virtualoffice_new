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
 * HttpFloorLayoutProvider — TODO real impl.
 * Fetch from FastAPI `GET /api/office/{officeId}/layout?floor={floorId}` and
 * translate the office_layout JSON (05-office-layout-schema) into FloorLayout.
 * Cache per (office,floor); invalidate on `layout_updated` (D12).
 */
export class HttpFloorLayoutProvider implements FloorLayoutProvider {
  constructor(private readonly baseUrl: string) {}

  async getLayout(_officeId: string, _floorId: string): Promise<FloorLayout> {
    // TODO: const res = await fetch(`${this.baseUrl}/api/office/${officeId}/layout?floor=${floorId}`)
    //       return mapOfficeLayoutJson(await res.json());
    throw new Error("HttpFloorLayoutProvider not implemented — use DemoFloorLayoutProvider for now");
  }
}
