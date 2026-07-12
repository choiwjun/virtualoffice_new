/**
 * movement.ts — server-authoritative movement validation (the whole point).
 *
 * Implements the 8 movement checks from 15-realtime-server-spec §4 / 09 §1.2.
 * Every check is a pure named function taking a MovementContext and returning a
 * CheckResult, so they are unit-testable without a live socket. The room calls
 * `validateMove()` which runs all 8 and returns the first failure (or ok).
 *
 * Movement is server-authoritative: the client sends a `move_request` with a
 * target position + seq; the server validates and, on success, the tick loop
 * integrates the avatar toward the target. The MAX_SPEED cap makes teleport /
 * over-speed cheats impossible.
 */

import { MAX_SPEED_MPS, SPEED_TOLERANCE, PresenceStatus } from "../config";
import type { FloorLayout, Seat } from "../integration/FloorLayoutProvider";
import { distance, pointInRect, pathCrossesWalls, Vec2 } from "./geometry";

/** Named machine-readable reasons; the room echoes these back on rejection. */
export type MoveRejectReason =
  | "company_mismatch"
  | "office_mismatch"
  | "floor_mismatch"
  | "out_of_bounds"
  | "collision"
  | "over_speed"
  | "no_permission"
  | "seat_occupied"
  | "meeting_full";

export interface CheckResult {
  ok: boolean;
  reason?: MoveRejectReason;
  detail?: string;
}

const OK: CheckResult = { ok: true };
function fail(reason: MoveRejectReason, detail?: string): CheckResult {
  return { ok: false, reason, detail };
}

/** Minimal "mover" view — the acting player's authoritative identity + position. */
export interface Mover {
  userId: string;
  companyId: string;
  officeId: string;
  floorId: string;
  x: number;
  y: number;
  status: PresenceStatus | string;
  seatId: string;
}

/** Room-level context needed to validate a move. */
export interface MovementContext {
  mover: Mover;
  target: Vec2;
  /** Seconds elapsed since the mover's previous accepted move (for speed cap). */
  dtSeconds: number;
  layout: FloorLayout;
  /** Room tenant/scope the mover is joined into (checks 1–3). */
  room: { companyId: string; officeId: string; floorId: string };
  /** Zones (team_zone ids) the mover is permitted to enter; undefined = all allowed. */
  allowedZones?: Set<string> | undefined;
  /** seatId -> userId currently occupying it (for seat-occupancy check). */
  seatOccupancy: Map<string, string>;
  /** Optional target seat this move intends to take (from sit flow). */
  targetSeatId?: string | undefined;
  /** roomId -> current occupant count (for meeting capacity check). */
  meetingOccupancy?: Map<string, number>;
  /** Pluggable collision test. Defaults to wall-segment crossing from layout. */
  collides?: (from: Vec2, to: Vec2, layout: FloorLayout) => boolean;
  /** Which team_zone the target position falls in, if the layout has zones. */
  zoneAt?: (p: Vec2, layout: FloorLayout) => string | undefined;
}

// ---------------------------------------------------------------------------
// The 8 checks (each pure, each independently testable)
// ---------------------------------------------------------------------------

/** #1 Tenant isolation — mover's company must match the room's company. */
export function checkCompany(ctx: MovementContext): CheckResult {
  return ctx.mover.companyId === ctx.room.companyId ? OK : fail("company_mismatch");
}

/** #2 Office match. */
export function checkOffice(ctx: MovementContext): CheckResult {
  return ctx.mover.officeId === ctx.room.officeId ? OK : fail("office_mismatch");
}

/** #3 Floor match — a room is one floor; no cross-floor moves (no elevator yet). */
export function checkFloor(ctx: MovementContext): CheckResult {
  return ctx.mover.floorId === ctx.room.floorId ? OK : fail("floor_mismatch");
}

/** #4a Coordinate validity — target must be inside the floor bounds. */
export function checkBounds(ctx: MovementContext): CheckResult {
  return pointInRect(ctx.target, ctx.layout.bounds)
    ? OK
    : fail("out_of_bounds", `target (${ctx.target.x},${ctx.target.y}) outside floor bounds`);
}

/**
 * #4b Collision — the straight path from current to target must not cross a
 * blocking collider. Pluggable: ctx.collides overrides the default wall test.
 */
export function checkCollision(ctx: MovementContext): CheckResult {
  const from: Vec2 = { x: ctx.mover.x, y: ctx.mover.y };
  const collides = ctx.collides
    ? ctx.collides(from, ctx.target, ctx.layout)
    : pathCrossesWalls(from, ctx.target, ctx.layout.walls);
  return collides ? fail("collision", "path crosses a wall collider") : OK;
}

/**
 * #5 Speed limit — distance covered must not exceed MAX_SPEED_MPS * dt (with a
 * jitter tolerance). Rejects teleports and speed hacks. dt<=0 is treated as one
 * tick to avoid divide-by-zero exploits.
 */
export function checkSpeed(ctx: MovementContext): CheckResult {
  const dt = ctx.dtSeconds > 0 ? ctx.dtSeconds : 0.05;
  const maxDist = MAX_SPEED_MPS * dt * SPEED_TOLERANCE;
  const dist = distance({ x: ctx.mover.x, y: ctx.mover.y }, ctx.target);
  return dist <= maxDist
    ? OK
    : fail("over_speed", `moved ${dist.toFixed(2)}m > cap ${maxDist.toFixed(2)}m (dt=${dt}s)`);
}

/**
 * #6 Permission — if the target position lies in a restricted team_zone the
 * mover isn't allowed into, reject. When no zone system is provided, allow.
 */
export function checkPermission(ctx: MovementContext): CheckResult {
  if (!ctx.allowedZones || !ctx.zoneAt) return OK;
  const zone = ctx.zoneAt(ctx.target, ctx.layout);
  if (!zone) return OK; // public area
  return ctx.allowedZones.has(zone) ? OK : fail("no_permission", `zone ${zone} not permitted`);
}

/**
 * #7 Seat occupancy — if this move takes a seat, the seat must be free (or,
 * for fixed seats, assigned to this user).
 */
export function checkSeatOccupancy(ctx: MovementContext): CheckResult {
  if (!ctx.targetSeatId) return OK;
  const seat: Seat | undefined = ctx.layout.seats.find((s) => s.seatId === ctx.targetSeatId);
  if (!seat) return fail("seat_occupied", "unknown seat");
  if (seat.type === "fixed" && seat.assignedUserId && seat.assignedUserId !== ctx.mover.userId) {
    return fail("seat_occupied", "fixed seat assigned to another user");
  }
  const occupant = ctx.seatOccupancy.get(ctx.targetSeatId);
  if (occupant && occupant !== ctx.mover.userId) {
    return fail("seat_occupied", `seat held by ${occupant}`);
  }
  return OK;
}

/**
 * #8 Meeting capacity — if the target is inside a meeting zone, entering must
 * not exceed the room capacity.
 */
export function checkMeetingCapacity(ctx: MovementContext): CheckResult {
  const zone = ctx.layout.meetingZones.find((z) => pointInRect(ctx.target, z.bounds));
  if (!zone) return OK;
  const count = ctx.meetingOccupancy?.get(zone.roomId) ?? 0;
  return count < zone.capacity
    ? OK
    : fail("meeting_full", `meeting ${zone.roomId} at capacity ${zone.capacity}`);
}

/** Ordered list of all 8 checks. */
export const MOVEMENT_CHECKS: Array<(ctx: MovementContext) => CheckResult> = [
  checkCompany,
  checkOffice,
  checkFloor,
  checkBounds,
  checkCollision,
  checkSpeed,
  checkPermission,
  checkSeatOccupancy,
  checkMeetingCapacity,
];

/** Run all checks; return the first failure, or ok. */
export function validateMove(ctx: MovementContext): CheckResult {
  for (const check of MOVEMENT_CHECKS) {
    const r = check(ctx);
    if (!r.ok) return r;
  }
  return OK;
}
