/**
 * config.ts — central tuning constants for the realtime office server.
 *
 * Values map directly to the canonical spec:
 *   docs/planning/15-realtime-server-spec.md  (§4 movement, §5 proximity, §7 SLA, §8 port)
 *   docs/planning/09-realtime-collaboration.md (§1.2 checks, §2.3 auto-away, §5 sync)
 */

/** Simulation tick rate. Spec §7 / D22: 20Hz = 50ms. */
export const TICK_HZ = 20;
export const TICK_MS = Math.round(1000 / TICK_HZ); // 50ms

/**
 * Max avatar move speed in metres/second on the floor plane.
 * Movement validation derives the per-message distance cap from dt:
 *   maxDistance = MAX_SPEED_MPS * dt_seconds  (+ a small tolerance factor).
 * 1.4 m/s ≈ a brisk walk; kept modest so over-speed / teleport cheats are rejected.
 */
export const MAX_SPEED_MPS = 1.4;

/** Slack multiplier applied to the derived per-tick distance cap to absorb jitter/latency. */
export const SPEED_TOLERANCE = 1.5;

/** Proximity interaction radius in metres. Spec §5 / 09 §3.3 check #4: distance < 5m. */
export const PROXIMITY_M = 5;

/** Meeting-entry proximity radius in metres. Spec §3 enter_meeting: near (2m) check. */
export const MEETING_PROXIMITY_M = 2;

/** Interaction request cooldown per (requester,target) pair. 09 §3.3 check #7: 1s. */
export const INTERACT_COOLDOWN_MS = 1000;

/** Auto-away after inactivity. Spec §6 / D13 / OQ3: 5 minutes (configurable). */
export const AUTO_AWAY_MS = 5 * 60 * 1000;

/** Presence batch push cadence to FastAPI. Spec §6 / D3: 1–5s. */
export const PRESENCE_FLUSH_MS = 3000;

/** Reconnection window (seconds) for allowReconnection on transient WSS drops. */
export const RECONNECT_WINDOW_SEC = 30;

/** Internal WSS port. Spec §8: 2567 (behind Caddy, internal only). Override with PORT env. */
export const PORT = Number(process.env.PORT ?? 2567);

/** Protocol version negotiated on join. 09 §5.3: current = 3. */
export const PROTOCOL_VERSION = 3;
export const PROTOCOL_MIN = 2;

/** The 7 presence states (D13). */
export const PRESENCE_STATES = [
  "offline",
  "online",
  "working",
  "meeting",
  "focus",
  "away",
  "external",
] as const;
export type PresenceStatus = (typeof PRESENCE_STATES)[number];

/** Presence sink target (FastAPI). When unset, presence pushes log to console. Spec §6. */
export const PRESENCE_SINK_URL = process.env.PRESENCE_SINK_URL ?? "";
