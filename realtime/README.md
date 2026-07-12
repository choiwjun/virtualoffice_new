# realtime — Colyseus authoritative office movement server

Greenfield realtime movement/presence server for the virtual-office product.
Server-authoritative: clients send **intent**, the server validates and owns the
state. Room = **one floor**. 20Hz simulation tick. This replaces the retired
WorkAdventure back.

Canonical spec: `docs/planning/15-realtime-server-spec.md` and
`docs/planning/09-realtime-collaboration.md`.

## Stack

- **Colyseus 0.15.x** (`@colyseus/core` + `colyseus`), `@colyseus/schema` for
  binary-delta state sync, `@colyseus/ws-transport` (ws) transport.
- **TypeScript**, CommonJS, plain `tsc` build. `tsx` for dev/test (no build step).
- **Port: 2567** internal WSS (behind Caddy, internal only). Override via `PORT`.

## Install / build / run / test

```bash
cd realtime
npm install
npm run build     # tsc → dist/
npm start         # node dist/index.js  (listens on PORT, default 2567)

npm run dev       # tsx watch src/index.ts  (hot reload)
npm test          # runs the smoke test via tsx (no build needed)
```

Env vars:

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `2567` | WSS listen port (internal, behind Caddy) |
| `PRESENCE_SINK_URL` | *(unset)* | If set, presence batches POST to `<url>/api/presence/batch`; else console log |

## Room model

- Room name `office`, keyed by `{ officeId, floorId }` via `.filterBy([...])` —
  each floor is its own room. Clients pass `officeId`/`floorId` in join options.
- State: `OfficeState { players: MapSchema<Player>, serverSeq }`.
- `Player { userId, name, x, y, facing, status, seatId, anim, lastSeq }`
  (position is the 2D floor plane; server-only fields — company/office/floor id,
  activity timestamp, DND, cooldowns — are not synced).

## Message protocol

### Client → Server

| Message | Payload | Handling |
|---|---|---|
| `move_request` | `{ target:{x,y}, targetSeatId?, seq }` | 8 movement checks; accept → integrate on tick; reject → `move_rejected` |
| `status_change` | `{ status?, dnd? }` | Manual `online/working/focus/external` + DND toggle; focus/external suppress auto-away |
| `sit_request` | `{ seatId }` | Server occupancy check + in-memory reserve → `sit_ok`/`sit_rejected` (client confirms with FastAPI seat API) |
| `enter_meeting` | `{ roomId }` | D24 step 1: proximity(2m)+capacity → `meeting_entry_allowed`/`meeting_entry_denied` (client then calls FastAPI to actually join; server does NOT mint LiveKit tokens) |
| `interact_request` | `{ targetUserId }` | 8 proximity checks → `interact_allowed`/`interact_denied` |
| `resume` | `{ lastSeq }` | Re-send full `snapshot` for reconnect recovery |

### Server → Client

| Message | Payload |
|---|---|
| *state patch* | Colyseus Schema binary delta every tick (primary `world_update` channel) |
| `snapshot` | `{ serverSeq, officeId, floorId, players[] }` — full state on join / reconnect / resume |
| `presence_event` | `{ userId, status, seatId, kind }` — join/leave/status_change/sit/auto_away |
| `move_rejected` | `{ reason, detail, seq, authoritative:{x,y} }` |
| `interact_allowed` / `interact_denied` | interaction gate result |
| `meeting_entry_allowed` / `meeting_entry_denied` | D24 meeting entry gate result (`joinVia` tells client the FastAPI endpoint) |
| `sit_ok` / `sit_rejected` | seat claim gate result |
| `layout_updated` | *(reserved)* re-load signal on layout redeploy (D12) — TODO wiring |

## Validation (server-authoritative — the whole point)

### Movement — 8 checks (`src/validation/movement.ts`)

`checkCompany`, `checkOffice`, `checkFloor` (tenant/scope isolation) ·
`checkBounds` (inside floor) · `checkCollision` (path doesn't cross a wall;
**pluggable** `collides`) · `checkSpeed` (distance ≤ `MAX_SPEED_MPS·dt·tol` —
rejects teleports) · `checkPermission` (team-zone access) · `checkSeatOccupancy`
· `checkMeetingCapacity`. `lastSeq` applied on the tick for reconciliation.

### Proximity — 8 checks (`src/validation/proximity.ts`)

`checkSameCompany/Office/Floor` · `checkDistance` (< 5m) · `checkLineOfSight`
(opaque wall blocks; glass does not; **pluggable** `losBlockedFn`) ·
`checkTargetStatus` (not offline) · `checkCooldown` (1s per target) · `checkDnd`
(target focus/external + DND rejects).

Every check is a **pure named function** — unit-tested directly without a socket.

## Integration seams (stubbed — do NOT call real services)

- `PresenceSink` (`src/integration/PresenceSink.ts`): `ConsolePresenceSink`
  (default, logs) / `HttpPresenceSink` (POST `/api/presence/batch`, enabled by
  `PRESENCE_SINK_URL`). Flushed every ~3s.
- `FloorLayoutProvider` (`src/integration/FloorLayoutProvider.ts`):
  `DemoFloorLayoutProvider` (hardcoded 20×15m floor, 1 interior wall, 2 seats, 1
  meeting zone). `HttpFloorLayoutProvider` = **TODO** (fetch FastAPI layout).
- `onAuth` JWT verification: **stubbed** (accepts + passes identity through).
- Meeting entry (D24): server does the proximity+capacity gate only, then emits
  an event telling the client to call FastAPI `POST /api/meetings/{id}/join`.
  Server never mints LiveKit tokens.
- Auto-away after 5 min inactivity → status `away` + `presence_event`.

## Frontend client (C2)

The Next.js app connects via `colyseus.js`:

- `frontend/lib/realtime.ts` — `createOfficeConnection(url, join, handlers)`: joins the
  `office` room, keeps a **mutable `players` map** synced from state deltas (read
  imperatively in R3F `useFrame`, not through React state — avoids 20Hz re-renders),
  and exposes `requestMove(x,y)`. Because the server only accepts small per-request
  steps (speed budget ≈ `MAX_SPEED·dt·tol`), `requestMove` sets a **destination** and
  an internal walker streams sub-steps from the server-authoritative position toward it.
- `frontend/hooks/useOfficeRoom.ts` — React wrapper (auth identity, roster state,
  graceful degradation when the server is offline).
- `frontend/components/OfficeViewport.tsx` — renders one avatar per server player
  (position interpolated), click-to-move via a ground raycast, and a connection badge.

Run both locally:

```bash
cd realtime && npm start           # ws://localhost:2567
cd frontend && npm run dev         # localhost:3000  (NEXT_PUBLIC_REALTIME_URL overrides the ws url)
```

**Client↔server integration smoke** (in-process server + client, no browser):

```bash
cd realtime && npm run client-smoke   # 6 assertions: join, spawn, streamed walk, roster in/out
```

Coordinate mapping (server 20×15m demo plane → R3F world) lives in `OfficeViewport`
(`FLOOR_SCALE`); exact furniture alignment awaits the real layout fetch (below).

## STATUS: minimal viable — TODO

Implemented & smoke-tested: room join/leave, 20Hz movement integration, all
8+8 validation checks, seat/meeting/interact gates, auto-away, presence batch
flush (console), snapshot on join, `allowReconnection` + resume snapshot.

Stubbed / not yet real:

- [ ] **Real layout fetch** — `HttpFloorLayoutProvider` against FastAPI
      `GET /api/office/{id}/layout` (currently hardcoded demo floor).
- [ ] **Real presence push** — wire `HttpPresenceSink` to the live FastAPI
      `POST /api/presence/batch` (currently console log by default).
- [ ] **JWT verification** in `onAuth` (currently accepts all; must verify the
      FastAPI HS256 single-session token).
- [ ] **Real collision mesh / navmesh** — current collision is wall-segment
      crossing; LOS is opaque-wall ray test. Swap in the office_layout collider
      polygons + glass masking.
- [ ] **LiveKit handshake wiring** — the `meeting_entry_allowed` → FastAPI
      `POST /api/meetings/{id}/join` → LiveKit token round-trip (client side).
- [ ] **Protocol version negotiation** in `onAuth` (reject on mismatch).
- [ ] **`layout_updated` broadcast** on layout redeploy (D12).
- [ ] **Load test to 20 concurrent** (dogfood) / 100 (design) — spike S3, not run.
```
