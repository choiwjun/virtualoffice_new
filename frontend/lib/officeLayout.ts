/**
 * 편집기 좌석(캔버스 픽셀 좌표)을 D12 서버 validate를 통과하는
 * 공식 office_layout 스키마 JSON draft로 변환한다 (REQ-003).
 *
 * 정본 스키마: docs/data-model/office-layout-schema.json (Draft 2020-12).
 * 검증기: backend/app/services/office_layout_validator.py
 *   (context 없음 → 구조·좌표범위·seat↔furniture 좌표일치·reachability BFS 검사).
 *
 * 생성 규칙(빈 zones/rooms/colliders + seats+furniture + spawn)은
 * backend 참조 검증(ERROR 0 / WARNING 0)으로 확정된 형태를 그대로 따른다.
 */

/** office_layout seat_type enum (스키마 §seat). */
const SEAT_TYPES = ['fixed', 'free', 'temp', 'partner'] as const;
type SeatType = (typeof SEAT_TYPES)[number];

/** 캔버스 픽셀 → 미터 변환 기본 배율. addSeat 픽셀 간격(≈130px)과 정합. */
export const DEFAULT_PX_PER_METER = 50;

export interface EditorSeat {
  id: string;
  x: number; // 캔버스 픽셀 X
  y: number; // 캔버스 픽셀 Y
  type?: string;
}

export interface EditorRoom {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
  type?: string; // meeting|lobby|lounge|focus|phonebooth
}

export interface EditorZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  color?: string;
}

export interface EditorWall {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BuildLayoutInput {
  officeId: string; // UUID (office.id)
  floorId: string; // UUID (floor.id)
  floorName?: string;
  floorLevel?: number;
  seats: EditorSeat[];
  rooms?: EditorRoom[];
  zones?: EditorZone[];
  walls?: EditorWall[];
  createdBy: number; // erp_user.id
  pxPerMeter?: number;
}

function newUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // 구형 런타임 폴백 (RFC4122 v4 근사).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function toSeatType(t?: string): SeatType {
  return (SEAT_TYPES as readonly string[]).includes(t ?? '') ? (t as SeatType) : 'free';
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * 편집기 상태 → office_layout JSON.
 * 좌석마다 동일 좌표의 furniture를 자동 생성해 seat↔furniture 좌표일치(§3.2)를 만족시킨다.
 * zones/rooms/colliders는 빈 배열로 두어 room 벽/콜리전 없는 개방 평면(=전 좌석 도달 가능)을 보장한다.
 */
export function buildOfficeLayout(input: BuildLayoutInput): Record<string, unknown> {
  const px = input.pxPerMeter && input.pxPerMeter > 0 ? input.pxPerMeter : DEFAULT_PX_PER_METER;
  const now = new Date().toISOString();
  const floorName = input.floorName || '1F';

  const seatsM = input.seats.map((s) => ({
    type: s.type,
    mx: round3(s.x / px),
    my: round3(s.y / px),
  }));

  const roomsM = (input.rooms ?? []).map((r) => ({
    id: r.id, name: r.name, type: r.type,
    x: round3(r.x / px), y: round3(r.y / px),
    w: Math.max(2, round3(r.w / px)), h: Math.max(2, round3(r.h / px)),
  }));
  const zonesM = (input.zones ?? []).map((z) => ({
    id: z.id, label: z.label, color: z.color,
    x: round3(z.x / px), y: round3(z.y / px),
    w: Math.max(1, round3(z.w / px)), h: Math.max(1, round3(z.h / px)),
  }));
  const wallsM = (input.walls ?? []).map((w) => ({
    x: round3(w.x / px), y: round3(w.y / px),
    w: Math.max(0.2, round3(w.w / px)), h: Math.max(0.2, round3(w.h / px)),
  }));

  const extentX = Math.max(
    0,
    ...seatsM.map((s) => s.mx),
    ...roomsM.map((r) => r.x + r.w),
    ...zonesM.map((z) => z.x + z.w),
    ...wallsM.map((w) => w.x + w.w),
  );
  const extentY = Math.max(
    0,
    ...seatsM.map((s) => s.my),
    ...roomsM.map((r) => r.y + r.h),
    ...zonesM.map((z) => z.y + z.h),
    ...wallsM.map((w) => w.y + w.h),
  );
  const width = round3(extentX + 2) || 10;
  const height = round3(extentY + 2) || 10;

  const furniture = seatsM.map((s, i) => ({
    furniture_id: `F_${String(i + 1).padStart(3, '0')}`,
    asset_id: 'desk_standard',
    type: 'desk',
    coords: { x: s.mx, y: s.my },
  }));

  const seats = seatsM.map((s, i) => ({
    seat_id: `S_${String(i + 1).padStart(3, '0')}`,
    seat_type: toSeatType(s.type),
    coords: { x: s.mx, y: s.my },
    facing: 180,
    furniture_id: `F_${String(i + 1).padStart(3, '0')}`,
  }));

  const ROOM_TYPES = ['meeting', 'lobby', 'lounge', 'focus', 'phonebooth'];
  const rooms = roomsM.map((r, i) => {
    const doorWidth = Math.min(1.2, round3(r.w * 0.5));
    return {
      room_id: `R_${String(i + 1).padStart(3, '0')}`,
      name: r.name || `회의실 ${i + 1}`,
      type: ROOM_TYPES.includes(r.type ?? '') ? r.type : 'meeting',
      capacity: 6,
      capacity_mode: 'by_room',
      max_concurrent_users: 6,
      coords: { x: r.x, y: r.y, width: r.w, height: r.h },
      entrance: {
        trigger_x: round3(r.x + r.w / 2 - 0.5),
        trigger_y: round3(r.y + r.h - 1.0),
        trigger_width: 1.0,
        trigger_height: 0.5,
        entry_direction: 'south',
      },
      doors: [
        { door_id: `D_${String(i + 1).padStart(3, '0')}`, wall: 'south', offset: round3(r.w / 2), width: doorWidth, door_type: 'glass_single' },
      ],
    };
  });

  const zones = zonesM.map((z, i) => ({
    zone_id: `Z_${String(i + 1).padStart(3, '0')}`,
    label: z.label || `구역 ${i + 1}`,
    type: 'team',
    color: z.color || '#3498db',
    polygon: [
      { x: z.x, y: z.y },
      { x: round3(z.x + z.w), y: z.y },
      { x: round3(z.x + z.w), y: round3(z.y + z.h) },
      { x: z.x, y: round3(z.y + z.h) },
    ],
  }));

  const colliders = wallsM.map((w, i) => ({
    collider_id: `C_${String(i + 1).padStart(3, '0')}`,
    shape: 'box',
    box: { x: w.x, y: w.y, width: w.w, height: w.h },
    physics: { block_avatar: true },
    description: `벽 ${i + 1}`,
  }));

  const spawn =
    seatsM.length > 0
      ? { x: seatsM[0].mx, y: seatsM[0].my }
      : { x: round3(width / 2), y: round3(height / 2) };

  return {
    metadata: {
      version: '1.1',
      schema_version: 1,
      layout_id: newUuid(),
      office_id: input.officeId,
      floor_id: input.floorId,
      floor_name: floorName,
      created_at: now,
      updated_at: now,
      created_by: input.createdBy,
      updated_by: input.createdBy,
      language: 'ko-KR',
    },
    floor: {
      id: input.floorId,
      level: input.floorLevel ?? 1,
      name: floorName,
      coordinate_origin: 'top_left',
      floor_height_m: 0,
      unit_system: 'metric',
    },
    dimensions: { width_m: width, height_m: height, min_x: 0, max_x: width, min_y: 0, max_y: height, unit: 'meter' },
    zones,
    rooms,
    seats,
    furniture,
    colliders,
    spawn_points: [{ spawn_id: 'SP_DEFAULT', type: 'lobby', coords: spawn, facing: 90 }],
    spawn_default: { spawn_id: 'SP_DEFAULT' },
  };
}
