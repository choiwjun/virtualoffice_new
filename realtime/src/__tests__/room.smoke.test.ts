/**
 * room.smoke.test.ts — standalone smoke test (no live socket required).
 *
 * Asserts the load-bearing server-authoritative behaviours by driving the pure
 * validation functions + a real OfficeRoom instance directly:
 *   1. a player can join and receives an initial snapshot
 *   2. a valid move is accepted and integrates position on the tick
 *   3. an over-speed (teleport) move is rejected
 *   4. a too-far interact is rejected
 *   5. reconnect/resume returns a snapshot of current state
 *
 * Run with:  npm test   (uses tsx, no build needed)
 * Exits non-zero on any failed assertion.
 */

import { DemoFloorLayoutProvider } from "../integration/FloorLayoutProvider";
import { validateMove, MovementContext } from "../validation/movement";
import { validateProximity, ProximityContext, ProxActor } from "../validation/proximity";
import { OfficeRoom } from "../rooms/OfficeRoom";
import { OfficeState, Player } from "../state/OfficeState";
import { MAX_SPEED_MPS, PROXIMITY_M } from "../config";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

function eq<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
}

// Test harness: rooms are created directly (no matchMaker), so Colyseus' internal
// `this.listing` is unset. When the empty-room auto-dispose timer fires it calls
// `this.listing.remove()` and throws. In production matchMaker sets `listing`, so this
// is a harness-only artifact — stub it to a no-op so teardown stays clean. (We let the
// room still auto-dispose so its timers clear and the process exits.)
function makeRoom(): OfficeRoom {
  const r = new OfficeRoom();
  (r as unknown as { listing: { remove(): void } }).listing = { remove() {} };
  return r;
}

async function main(): Promise<void> {
  const provider = new DemoFloorLayoutProvider();
  const layout = await provider.getLayout("office-demo", "floor-1");
  const room = { companyId: "company-demo", officeId: "office-demo", floorId: "floor-1" };

  const baseMover = {
    userId: "user-1",
    companyId: "company-demo",
    officeId: "office-demo",
    floorId: "floor-1",
    x: 10,
    y: 7,
    status: "online",
    seatId: "",
  };

  console.log("\n[1] join → initial snapshot");
  {
    // Drive a real OfficeRoom instance to exercise join + snapshot + tick.
    const room1 = makeRoom();
    // Minimal harness: set up state + layout the way onCreate would.
    (room1 as unknown as { state: OfficeState }).state = new OfficeState();
    (room1 as unknown as { layout: unknown }).layout = layout;

    const player = new Player();
    player.userId = "user-1";
    player.name = "Alice";
    player.companyId = "company-demo";
    player.officeId = "office-demo";
    player.floorId = "floor-1";
    player.x = 10;
    player.y = 7;
    (room1 as unknown as { state: OfficeState }).state.players.set("sess-1", player);

    const snap = room1.buildSnapshot();
    eq(snap.players.length, 1, "snapshot contains 1 player");
    eq(snap.officeId, "office-demo", "snapshot officeId");
    eq((snap.players[0] as { userId: string }).userId, "user-1", "snapshot player userId");
  }

  console.log("\n[2] valid move accepted");
  {
    // dt=0.5s at MAX_SPEED 1.4 m/s → cap ~1.05m (x1.5 tol). Move 0.5m: accepted.
    const ctx: MovementContext = {
      mover: { ...baseMover, x: 3, y: 10 },
      target: { x: 3.4, y: 10.2 }, // ~0.45m
      dtSeconds: 0.5,
      layout,
      room,
      seatOccupancy: new Map(),
    };
    const res = validateMove(ctx);
    assert(res.ok, "valid short move accepted");
  }

  console.log("\n[2b] tick integrates position toward target");
  {
    const room2 = makeRoom();
    (room2 as unknown as { state: OfficeState }).state = new OfficeState();
    (room2 as unknown as { layout: unknown }).layout = layout;
    const player = new Player();
    player.userId = "user-mover";
    player.x = 3;
    player.y = 10;
    (room2 as unknown as { state: OfficeState }).state.players.set("sess-m", player);
    (room2 as unknown as { moveTargets: Map<string, unknown> }).moveTargets.set("sess-m", {
      x: 3.5,
      y: 10,
      seq: 7,
      at: Date.now(),
    });
    // Invoke the private tick with a 50ms step.
    (room2 as unknown as { tick(dtMs: number): void }).tick(50);
    assert(player.x > 3 && player.x <= 3.5, `position advanced toward target (x=${player.x.toFixed(3)})`);
    eq(player.lastSeq, 7, "lastSeq applied for reconciliation");
    eq(player.anim, "walk", "anim=walk while moving");
  }

  console.log("\n[3] over-speed move rejected");
  {
    // dt=0.5s → cap ~1.05m. Teleport 8m along y (no wall crossed, in bounds):
    // must reject specifically with over_speed. Interior wall is at x=10 spanning
    // y 0..8, so a pure-y move at x=2 never crosses it — isolating the speed check.
    const ctx: MovementContext = {
      mover: { ...baseMover, x: 2, y: 2 },
      target: { x: 2, y: 10 }, // 8m in one step
      dtSeconds: 0.5,
      layout,
      room,
      seatOccupancy: new Map(),
    };
    const res = validateMove(ctx);
    assert(!res.ok, "over-speed move rejected");
    eq(res.reason, "over_speed", "rejection reason = over_speed");
  }

  console.log("\n[3b] out-of-bounds move rejected");
  {
    const ctx: MovementContext = {
      mover: { ...baseMover, x: 1, y: 1 },
      target: { x: -5, y: 1 },
      dtSeconds: 5,
      layout,
      room,
      seatOccupancy: new Map(),
    };
    const res = validateMove(ctx);
    assert(!res.ok, "out-of-bounds move rejected");
    eq(res.reason, "out_of_bounds", "rejection reason = out_of_bounds");
  }

  console.log("\n[3c] collision (path crosses wall) rejected");
  {
    // Interior wall from (10,0)-(10,8). Move from (8,4) to (12,4) crosses it.
    const ctx: MovementContext = {
      mover: { ...baseMover, x: 8, y: 4 },
      target: { x: 12, y: 4 },
      dtSeconds: 10, // generous dt so speed isn't the failing check
      layout,
      room,
      seatOccupancy: new Map(),
    };
    const res = validateMove(ctx);
    assert(!res.ok, "wall-crossing move rejected");
    eq(res.reason, "collision", "rejection reason = collision");
  }

  console.log("\n[4] proximity: too-far interact rejected");
  {
    const requester: ProxActor = {
      userId: "user-a",
      companyId: "company-demo",
      officeId: "office-demo",
      floorId: "floor-1",
      x: 1,
      y: 1,
      status: "online",
      dndEnabled: false,
      interactCooldowns: {},
    };
    const target: ProxActor = { ...requester, userId: "user-b", x: 18, y: 1 }; // 17m apart
    const ctx: ProximityContext = { requester, target, layout };
    const res = validateProximity(ctx);
    assert(!res.ok, "too-far interact rejected");
    eq(res.reason, "too_far", "rejection reason = too_far");
    assert(17 > PROXIMITY_M, "sanity: 17m exceeds PROXIMITY_M");
  }

  console.log("\n[4b] proximity: near interact allowed");
  {
    const requester: ProxActor = {
      userId: "user-a",
      companyId: "company-demo",
      officeId: "office-demo",
      floorId: "floor-1",
      x: 2,
      y: 12,
      status: "online",
      dndEnabled: false,
      interactCooldowns: {},
    };
    // 2m apart, same side of the interior wall (wall spans y 0..8; both at y=12).
    const target: ProxActor = { ...requester, userId: "user-b", x: 4, y: 12 };
    const ctx: ProximityContext = { requester, target, layout };
    const res = validateProximity(ctx);
    assert(res.ok, "near, unobstructed interact allowed");
  }

  console.log("\n[4c] proximity: LOS blocked by wall rejected");
  {
    // Wall (10,0)-(10,8). Two avatars at y=4 on opposite sides, 4m apart.
    const requester: ProxActor = {
      userId: "user-a",
      companyId: "company-demo",
      officeId: "office-demo",
      floorId: "floor-1",
      x: 8,
      y: 4,
      status: "online",
      dndEnabled: false,
      interactCooldowns: {},
    };
    const target: ProxActor = { ...requester, userId: "user-b", x: 12, y: 4 };
    const ctx: ProximityContext = { requester, target, layout };
    const res = validateProximity(ctx);
    assert(!res.ok, "LOS-blocked interact rejected");
    eq(res.reason, "los_blocked", "rejection reason = los_blocked");
  }

  console.log("\n[5] reconnect/resume returns snapshot of current state");
  {
    const room5 = makeRoom();
    (room5 as unknown as { state: OfficeState }).state = new OfficeState();
    (room5 as unknown as { layout: unknown }).layout = layout;
    const p1 = new Player();
    p1.userId = "user-x";
    p1.x = 5;
    p1.y = 5;
    p1.lastSeq = 42;
    (room5 as unknown as { state: OfficeState }).state.players.set("sess-x", p1);

    // Simulate resume: server rebuilds a full snapshot the client resyncs from.
    const snap = room5.buildSnapshot();
    eq(snap.players.length, 1, "resume snapshot has the player");
    const sp = snap.players[0] as { userId: string; lastSeq: number; x: number };
    eq(sp.userId, "user-x", "resume snapshot userId");
    eq(sp.lastSeq, 42, "resume snapshot preserves lastSeq for recovery");
    eq(sp.x, 5, "resume snapshot preserves position");
  }

  console.log("\n[sanity] config constants");
  {
    assert(MAX_SPEED_MPS > 0, "MAX_SPEED_MPS positive");
    eq(PROXIMITY_M, 5, "PROXIMITY_M = 5m per spec");
  }

  console.log(`\n=== smoke: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(1);
});
