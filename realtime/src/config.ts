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
 * 2.5D 씬 플로어 선택. "horizon" 설정 시(LAYOUT_SOURCE_URL 미설정일 때)
 * HORIZON_OPEN_PLAN(v2.2 팩 05_layouts) 보행 폴리곤 기반 플로어를 사용한다.
 * 미설정 시 기존 데모 플로어(기존 테스트 호환).
 */
export const SCENE_FLOOR = process.env.SCENE_FLOOR ?? "";

/**
 * FastAPI JWT 검증 (D4: HS256 자체 시크릿). onAuth에서 join 시 전달된 토큰을 검증한다.
 * JWT_SECRET은 백엔드 settings.jwt_secret_key와 **동일**해야 함(로컬 기본값 일치).
 */
export const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-CHANGE-IN-PRODUCTION";
export const JWT_ALGORITHM = "HS256" as const;
/** true면 유효 JWT 없는 join 거부(운영). 기본 false: 로컬/테스트는 토큰 없이도 허용. */
export const JWT_REQUIRED = (process.env.JWT_REQUIRED ?? "false").toLowerCase() === "true";

/** 배포 환경(NODE_ENV). production이면 무인증 join·dev 기본 시크릿을 금지한다(P1-4). */
export const NODE_ENV = process.env.NODE_ENV ?? "development";
export const IS_PRODUCTION = NODE_ENV === "production";

/**
 * 운영 기동 가드(P1-4, 2026-07-17) — index.ts 부트스트랩에서 호출.
 * production인데 (a) JWT_REQUIRED가 꺼져 있거나 (b) JWT_SECRET이 dev 기본값이면
 * 무인증 join·토큰 위조가 가능하므로 fail-fast 한다.
 */
export function assertProductionSafe(): void {
  if (!IS_PRODUCTION) return;
  const problems: string[] = [];
  if (!JWT_REQUIRED) problems.push("JWT_REQUIRED must be true");
  if (JWT_SECRET.includes("CHANGE-IN-PRODUCTION")) problems.push("JWT_SECRET is a dev default");
  if (problems.length) {
    throw new Error(
      `[realtime] production 기동 거부(P1-4): ${problems.join(", ")} — 환경변수를 설정하세요.`,
    );
  }
}
