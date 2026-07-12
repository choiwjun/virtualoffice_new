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

/** 서버간 presence 배치 인증 토큰 — 백엔드 settings.internal_api_token과 동일해야 함. */
export const PRESENCE_SINK_TOKEN = process.env.PRESENCE_SINK_TOKEN ?? "";

/**
 * 층 레이아웃 소스(FastAPI). 설정 시 배포된 office_layout을 fetch(내부 토큰=PRESENCE_SINK_TOKEN),
 * 실패/미배포 시 데모 층 폴백. 미설정 시 항상 데모 층. Spec §4 / 05 §5.
 */
export const LAYOUT_SOURCE_URL = process.env.LAYOUT_SOURCE_URL ?? "";

/**
 * FastAPI JWT 검증 (D4: HS256 자체 시크릿). onAuth에서 join 시 전달된 토큰을 검증한다.
 * JWT_SECRET은 백엔드 settings.jwt_secret_key와 **동일**해야 함(로컬 기본값 일치).
 */
export const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-CHANGE-IN-PRODUCTION";
export const JWT_ALGORITHM = "HS256" as const;
/** true면 유효 JWT 없는 join 거부(운영). 기본 false: 로컬/테스트는 토큰 없이도 허용. */
export const JWT_REQUIRED = (process.env.JWT_REQUIRED ?? "false").toLowerCase() === "true";
