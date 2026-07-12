import { Schema, type } from "@colyseus/schema";

/**
 * Player — one avatar in a floor room.
 *
 * Position is the 2D floor plane (x, y) per 15-realtime-server-spec §2.
 * (The R3F client maps floor-plane y -> world z; the server only cares about
 *  the 2D plane for bounds / collision / distance math.)
 *
 * The server is authoritative: it integrates position on the tick from a
 * validated target, and clients send intent (`move_request`) only.
 */
export class Player extends Schema {
  /** ERP user id (stable identity across reconnects). */
  @type("string") userId = "";

  /** Display name. */
  @type("string") name = "";

  /** Floor-plane position X (metres). */
  @type("number") x = 0;

  /** Floor-plane position Y (metres). */
  @type("number") y = 0;

  /** Facing angle in radians (0 = +X). */
  @type("number") facing = 0;

  /** One of the 7 presence states (D13): offline|online|working|meeting|focus|away|external. */
  @type("string") status = "online";

  /** Seat currently occupied, or "" if none. */
  @type("string") seatId = "";

  /** Animation clip: idle | walk. */
  @type("string") anim = "idle";

  /** Last client input sequence the server has applied (for reconciliation). */
  @type("number") lastSeq = 0;

  // ---- server-only fields (not synced; excluded from schema) ----

  /** Company id for tenant isolation (proximity check #1). */
  companyId = "";
  /** Office id (proximity/move check #2). */
  officeId = "";
  /** Floor id (proximity/move check #3). */
  floorId = "";
  /** Last activity timestamp (ms) for auto-away. */
  lastActivityAt = Date.now();
  /** True when user manually set focus/external — suppresses auto-away. */
  manualStatusHold = false;
  /** Whether user has enabled Do-Not-Disturb (proximity check #8). */
  dndEnabled = false;
  /** Per-target interaction cooldown map: targetUserId -> last interact ms. */
  interactCooldowns: Record<string, number> = {};
}
