/**
 * proximity.ts — server-authoritative proximity / interaction validation.
 *
 * Implements the 8 proximity checks from 15-realtime-server-spec §5 / 09 §3.3.
 * Used for `interact_request` (chat/call/etc.) and, with a tighter radius, as
 * the near-check inside `enter_meeting`.
 *
 * Every check is a pure named function; `validateProximity()` runs all 8 and
 * returns the first failure. LOS is a pluggable interface (defaults to the
 * wall-based ray test) so a real collider mesh can be swapped in later.
 */

import { PROXIMITY_M, INTERACT_COOLDOWN_MS } from "../config";
import type { FloorLayout } from "../integration/FloorLayoutProvider";
import { distance, losBlocked, Vec2 } from "./geometry";

export type ProximityRejectReason =
  | "company_mismatch"
  | "office_mismatch"
  | "floor_mismatch"
  | "too_far"
  | "los_blocked"
  | "target_offline"
  | "cooldown"
  | "target_dnd";

export interface ProximityResult {
  ok: boolean;
  reason?: ProximityRejectReason;
  detail?: string;
}

const OK: ProximityResult = { ok: true };
function fail(reason: ProximityRejectReason, detail?: string): ProximityResult {
  return { ok: false, reason, detail };
}

/** Minimal actor view for proximity checks. */
export interface ProxActor {
  userId: string;
  companyId: string;
  officeId: string;
  floorId: string;
  x: number;
  y: number;
  status: string;
  dndEnabled: boolean;
  /** requester's per-target cooldown map: targetUserId -> last-interact ms. */
  interactCooldowns: Record<string, number>;
}

export interface ProximityContext {
  requester: ProxActor;
  target: ProxActor;
  layout: FloorLayout;
  /** Radius in metres (defaults to PROXIMITY_M = 5). enter_meeting passes 2. */
  radius?: number;
  /** Cooldown window ms (defaults to INTERACT_COOLDOWN_MS = 1000). */
  cooldownMs?: number;
  now?: number;
  /** Pluggable LOS test — return true if sightline is blocked. */
  losBlockedFn?: (a: Vec2, b: Vec2, layout: FloorLayout) => boolean;
}

// ---------------------------------------------------------------------------
// The 8 checks
// ---------------------------------------------------------------------------

/** #1 Same company (tenant isolation). */
export function checkSameCompany(ctx: ProximityContext): ProximityResult {
  return ctx.requester.companyId === ctx.target.companyId ? OK : fail("company_mismatch");
}

/** #2 Same office. */
export function checkSameOffice(ctx: ProximityContext): ProximityResult {
  return ctx.requester.officeId === ctx.target.officeId ? OK : fail("office_mismatch");
}

/** #3 Same floor. */
export function checkSameFloor(ctx: ProximityContext): ProximityResult {
  return ctx.requester.floorId === ctx.target.floorId ? OK : fail("floor_mismatch");
}

/** #4 Distance under threshold (default 5m). */
export function checkDistance(ctx: ProximityContext): ProximityResult {
  const radius = ctx.radius ?? PROXIMITY_M;
  const d = distance(ctx.requester, ctx.target);
  return d < radius ? OK : fail("too_far", `distance ${d.toFixed(2)}m >= ${radius}m`);
}

/**
 * #5 Line of sight — a wall (opaque) between the two avatars blocks interaction.
 * Glass walls don't block LOS. Pluggable via ctx.losBlockedFn.
 */
export function checkLineOfSight(ctx: ProximityContext): ProximityResult {
  const blocked = ctx.losBlockedFn
    ? ctx.losBlockedFn(ctx.requester, ctx.target, ctx.layout)
    : losBlocked(ctx.requester, ctx.target, ctx.layout.walls);
  return blocked ? fail("los_blocked", "wall between avatars") : OK;
}

/** #6 Target status allows interaction — offline is excluded (away/meeting ok). */
export function checkTargetStatus(ctx: ProximityContext): ProximityResult {
  return ctx.target.status !== "offline" ? OK : fail("target_offline");
}

/** #7 Cooldown — same target must not be re-requested within the cooldown window. */
export function checkCooldown(ctx: ProximityContext): ProximityResult {
  const now = ctx.now ?? Date.now();
  const cooldown = ctx.cooldownMs ?? INTERACT_COOLDOWN_MS;
  const last = ctx.requester.interactCooldowns[ctx.target.userId];
  if (last !== undefined && now - last < cooldown) {
    return fail("cooldown", `re-request within ${cooldown}ms`);
  }
  return OK;
}

/**
 * #8 Do-Not-Disturb — if the target has DND enabled and is in focus/external,
 * reject (they've opted out of interruptions).
 */
export function checkDnd(ctx: ProximityContext): ProximityResult {
  const t = ctx.target;
  if (t.dndEnabled && (t.status === "focus" || t.status === "external")) {
    return fail("target_dnd", "target in focus/external with DND");
  }
  return OK;
}

/** Ordered list of all 8 proximity checks. */
export const PROXIMITY_CHECKS: Array<(ctx: ProximityContext) => ProximityResult> = [
  checkSameCompany,
  checkSameOffice,
  checkSameFloor,
  checkDistance,
  checkLineOfSight,
  checkTargetStatus,
  checkCooldown,
  checkDnd,
];

/** Run all 8; return the first failure, or ok. */
export function validateProximity(ctx: ProximityContext): ProximityResult {
  for (const check of PROXIMITY_CHECKS) {
    const r = check(ctx);
    if (!r.ok) return r;
  }
  return OK;
}
