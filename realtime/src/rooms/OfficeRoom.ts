import { Room, Client } from "@colyseus/core";
import jwt from "jsonwebtoken";
import { OfficeState, Player } from "../state/OfficeState";
import {
  TICK_MS,
  MAX_SPEED_MPS,
  AUTO_AWAY_MS,
  PRESENCE_FLUSH_MS,
  RECONNECT_WINDOW_SEC,
  MEETING_PROXIMITY_M,
  PRESENCE_SINK_URL,
  PRESENCE_SINK_TOKEN,
  LAYOUT_SOURCE_URL,
  LAYOUT_REFRESH_MS,
  SCENE_FLOOR,
  JWT_SECRET,
  JWT_ALGORITHM,
  JWT_REQUIRED,
  PresenceStatus,
} from "../config";
import {
  FloorLayout,
  FloorLayoutProvider,
  createFloorLayoutProvider,
} from "../integration/FloorLayoutProvider";
import { PresenceSink, PresenceRecord, createPresenceSink } from "../integration/PresenceSink";
import { validateMove, MovementContext } from "../validation/movement";
import { validateProximity, ProximityContext, ProxActor } from "../validation/proximity";
import { distance, pointInRect } from "../validation/geometry";

/** Options passed at room creation — identifies the floor this room owns. */
export interface OfficeRoomOptions {
  officeId?: string;
  floorId?: string;
  companyId?: string;
}

/**
 * JWT의 `company_id`(정수) / 룸 옵션의 companyId(문자열)를 같은 비교 가능한 형태로 정규화.
 * 값이 없으면 null — "테넌트 주장 없음"이라 검증을 건너뛴다(구 토큰·로컬 관용 모드).
 */
export function normalizeCompanyId(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * 토큰의 회사와 룸의 회사가 같은가.
 *
 * 룸 companyId의 기본값(`company-demo`)은 "테넌트 미지정"을 뜻한다 — 데모/로컬에서 룸을
 * 옵션 없이 만들면 이 값이 된다. 이 경우엔 막을 근거가 없으므로 통과시킨다.
 * 룸이 실제 테넌트로 생성된 경우에만 엄격히 비교한다.
 */
export function companyMatchesRoom(tokenCompanyId: string, roomCompanyId: string): boolean {
  if (!roomCompanyId || roomCompanyId === DEFAULT_COMPANY_ID) return true;
  return tokenCompanyId === roomCompanyId;
}

/** 룸 옵션 미지정 시의 데모 테넌트 — 실제 회사 식별자가 아니다. */
export const DEFAULT_COMPANY_ID = "company-demo";

/** join()/onAuth() options a client sends. */
export interface JoinOptions {
  userId?: string;
  name?: string;
  companyId?: string;
  officeId?: string;
  floorId?: string;
  jwt?: string;
  /** For reconnect/resume: last server_seq the client saw. */
  lastSeq?: number;
}

/**
 * OfficeRoom — one Colyseus room per floor. Keyed by {officeId, floorId} via
 * filterBy so clients join the correct floor room (see index.ts define()).
 *
 * Responsibilities (15-realtime-server-spec):
 *  - 20Hz simulation tick: integrate movement, bump server_seq, detect auto-away.
 *  - Message handlers: move_request / status_change / sit_request /
 *    enter_meeting / interact_request — each server-validated.
 *  - Presence batch push to FastAPI every PRESENCE_FLUSH_MS.
 *  - Reconnection via allowReconnection + snapshot resend.
 */
export class OfficeRoom extends Room<OfficeState> {
  maxClients = 100; // design cap (§7); dogfood target = 20.

  private layout!: FloorLayout;
  private layoutProvider: FloorLayoutProvider;
  private presenceSink: PresenceSink;

  private officeId = "office-demo";
  private floorId = "floor-1";
  private companyId = DEFAULT_COMPANY_ID;

  /** seatId -> userId occupancy (authoritative in memory). */
  private seatOccupancy = new Map<string, string>();
  /** roomId -> occupant count for meeting zones. */
  private meetingOccupancy = new Map<string, number>();
  /** Per-player intended move target (integrated on the tick). */
  private moveTargets = new Map<string, { x: number; y: number; seq: number; at: number }>();
  /** 단일 세션 강제(#7/REQ-015): 축출 중인 sessionId — onLeave가 reconnection 대기를 건너뛴다. */
  private evicting = new Set<string>();

  private presenceFlushHandle?: ReturnType<typeof setInterval>;
  private layoutRefreshHandle?: ReturnType<typeof setInterval>;
  /** 현재 로드된 지오메트리 서명 — 라이브 재조회 시 변경 감지용. */
  private layoutSig = "";

  constructor() {
    super();
    this.layoutProvider = createFloorLayoutProvider(LAYOUT_SOURCE_URL, PRESENCE_SINK_TOKEN, SCENE_FLOOR);
    this.presenceSink = createPresenceSink(PRESENCE_SINK_URL, PRESENCE_SINK_TOKEN);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async onCreate(options: OfficeRoomOptions): Promise<void> {
    this.officeId = options.officeId ?? this.officeId;
    this.floorId = options.floorId ?? this.floorId;
    this.companyId = options.companyId ?? this.companyId;

    this.setState(new OfficeState());
    this.layout = await this.layoutProvider.getLayout(this.officeId, this.floorId);
    // 어떤 층 지오메트리로 이동/충돌을 검증하는지(배포 레이아웃 vs 씬 폴백) 운영 진단 로그.
    // eslint-disable-next-line no-console
    console.log(
      `[realtime] room ${this.officeId}/${this.floorId} layout: bounds ${this.layout.bounds.w.toFixed(1)}x${this.layout.bounds.h.toFixed(1)}m, walls=${this.layout.walls.length}, seats=${this.layout.seats.length}, zones=${this.layout.meetingZones.length}`,
    );

    // Seed meeting occupancy counters.
    for (const z of this.layout.meetingZones) this.meetingOccupancy.set(z.roomId, 0);
    this.layoutSig = this.layoutSignature(this.layout);

    this.registerMessageHandlers();

    // 20Hz authoritative simulation tick (§7 / D22).
    this.setSimulationInterval((dtMs) => this.tick(dtMs), TICK_MS);

    // Presence batch push to FastAPI (§6 / D3), 1–5s cadence.
    this.presenceFlushHandle = setInterval(() => void this.flushPresence(), PRESENCE_FLUSH_MS);

    // 배포 레이아웃 라이브 재조회(D12 layout_updated) — 재배포/롤백을 룸 재생성 없이 반영.
    if (LAYOUT_REFRESH_MS > 0) {
      this.layoutRefreshHandle = setInterval(() => void this.refreshLayout(), LAYOUT_REFRESH_MS);
    }
  }

  /**
   * onAuth — FastAPI HS256 JWT 검증 (D4 / 09 §5.3). 반환값이 onJoin의 `auth`가 된다.
   *
   * **테넌트 경계(22 T0-1 잔여)**: 이전에는 `sub`/`email`만 토큰에서 취하고 `companyId`는
   * 클라이언트가 준 값을 그대로 썼다. 그래서 회사 2의 유저가 회사 1의 방에 들어가
   * `companyId: "1"`을 주장하면 그 층의 아바타·프레즌스를 그대로 볼 수 있었다.
   * 이제 토큰의 `company_id` 클레임을 정본으로 삼고, **방의 회사와 다르면 join을 거부**한다.
   */
  async onAuth(_client: Client, options: JoinOptions): Promise<JoinOptions> {
    const token = options?.jwt;
    if (!token) {
      if (JWT_REQUIRED) throw new Error("unauthorized: missing token");
      return options ?? {}; // 로컬/테스트 관용(JWT_REQUIRED=false)
    }
    let payload: { sub?: string; email?: string; company_id?: number | string };
    try {
      payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as typeof payload;
    } catch {
      throw new Error("unauthorized: invalid token");
    }

    // 토큰에 company_id가 있으면 그것만 신뢰한다(클라 주장은 버린다).
    const claimed = normalizeCompanyId(payload.company_id);
    if (claimed !== null && !companyMatchesRoom(claimed, this.companyId)) {
      // 방의 테넌트와 다르면 거부 — 존재 은닉을 위해 사유는 구분하지 않는다.
      throw new Error("forbidden: company mismatch");
    }

    return {
      ...options,
      // 토큰 identity를 신뢰 — 클라이언트가 준 userId를 토큰 sub로 덮어써 위조를 막는다(D4).
      userId: payload.sub ?? options.userId,
      name: options.name ?? payload.email,
      companyId: claimed ?? options.companyId,
    };
  }

  onJoin(client: Client, options: JoinOptions, auth?: JoinOptions): void {
    // onAuth 반환(토큰 검증 identity)이 있으면 그것을 신뢰, 없으면(관용 모드) 원본 options.
    const id: JoinOptions = auth ?? options;
    const player = new Player();
    player.userId = id.userId ?? client.sessionId;
    player.name = id.name ?? player.userId;
    player.companyId = id.companyId ?? this.companyId;
    player.officeId = id.officeId ?? this.officeId;
    player.floorId = id.floorId ?? this.floorId;
    player.status = "online";
    player.anim = "idle";
    player.lastActivityAt = Date.now();
    // Spawn: 레이아웃 지정 스폰(씬 플로어) 우선, 없으면 floor centre.
    player.x = this.layout.spawn?.x ?? this.layout.bounds.x + this.layout.bounds.w / 2;
    player.y = this.layout.spawn?.y ?? this.layout.bounds.y + this.layout.bounds.h / 2;

    // 단일 세션 강제(#7 / REQ-015): 같은 userId의 기존 세션이 있으면 축출.
    this.state.players.forEach((existing, sid) => {
      if (sid !== client.sessionId && existing.userId === player.userId) {
        const live = this.clients.find((c) => c.sessionId === sid);
        if (live) {
          this.evicting.add(sid);
          live.leave(4000); // 4000 = single-session eviction
        } else {
          // 재접속 유예(allowReconnection) 중인 유령 세션 — this.clients에 없어
          // leave()로는 축출 불가. 새 세션이 대체하므로 즉시 정리한다.
          // (없으면 새로고침 때마다 이전 아바타가 30초간 '움직이지 않는 고스트'로 잔류)
          this.releasePlayer(sid);
        }
      }
    });

    this.state.players.set(client.sessionId, player);

    // Initial full snapshot on join (§3 / 09 §5.4 step 9).
    client.send("snapshot", this.buildSnapshot());
    this.broadcastPresenceEvent(player, "join");
  }

  /**
   * onLeave — support reconnection. If the drop is consented (transient), hold
   * the seat for RECONNECT_WINDOW_SEC and resend a snapshot on return. Otherwise
   * remove the player and release resources.
   */
  async onLeave(client: Client, consented: boolean): Promise<void> {
    // 축출된 세션(#7)은 reconnection 대기 없이 즉시 정리.
    if (this.evicting.has(client.sessionId)) {
      this.evicting.delete(client.sessionId);
      this.releasePlayer(client.sessionId);
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (player) player.status = "away";

    try {
      if (consented) throw new Error("consented leave");
      // Wait for reconnection within the window.
      await this.allowReconnection(client, RECONNECT_WINDOW_SEC);
      // Reconnected: resync the client with a fresh snapshot (last_seq recovery).
      const back = this.state.players.get(client.sessionId);
      if (back) {
        back.status = "online";
        back.lastActivityAt = Date.now();
      }
      client.send("snapshot", this.buildSnapshot());
      return;
    } catch {
      // Not reconnected (or consented): finalize departure.
      this.releasePlayer(client.sessionId);
    }
  }

  onDispose(): void {
    if (this.presenceFlushHandle) clearInterval(this.presenceFlushHandle);
    if (this.layoutRefreshHandle) clearInterval(this.layoutRefreshHandle);
    void this.flushPresence();
  }

  /** 지오메트리 변경 감지용 서명 — bounds/walls/seats/zones/spawn을 결정적으로 직렬화. */
  private layoutSignature(l: FloorLayout): string {
    return JSON.stringify({
      b: l.bounds,
      w: l.walls,
      s: l.seats.map((s) => [s.seatId, s.x, s.y, s.type, s.assignedUserId ?? ""]),
      z: l.meetingZones.map((z) => [z.roomId, z.bounds, z.capacity]),
      sp: l.spawn ?? null,
    });
  }

  /**
   * 배포 레이아웃 라이브 재조회 — 관리자가 재배포/롤백하면 룸 재생성 없이 지오메트리를 hot-swap.
   * 변경 없으면 no-op. 변경 시 this.layout 교체 + 회의존 카운터 보존 재시드 + 클라에 layout_updated
   * 브로드캐스트(프론트가 즉시 구조 재조회·이동 지오메트리 교체). 이동/충돌은 this.layout을 직접 읽어
   * 다음 tick부터 새 벽/경계를 적용한다.
   */
  private async refreshLayout(): Promise<void> {
    let next: FloorLayout;
    try {
      next = await this.layoutProvider.getLayout(this.officeId, this.floorId);
    } catch {
      return; // 조회 실패 → 기존 지오메트리 유지
    }
    const sig = this.layoutSignature(next);
    if (sig === this.layoutSig) return; // 변경 없음

    this.layout = next;
    this.layoutSig = sig;
    // 회의존 카운터: 살아있는 zone은 카운트 보존, 신규는 0, 사라진 zone은 제거.
    const live = new Set(next.meetingZones.map((z) => z.roomId));
    for (const id of [...this.meetingOccupancy.keys()]) {
      if (!live.has(id)) this.meetingOccupancy.delete(id);
    }
    for (const z of next.meetingZones) {
      if (!this.meetingOccupancy.has(z.roomId)) this.meetingOccupancy.set(z.roomId, 0);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[realtime] room ${this.officeId}/${this.floorId} layout hot-swapped: bounds ${next.bounds.w.toFixed(1)}x${next.bounds.h.toFixed(1)}m, walls=${next.walls.length}, seats=${next.seats.length}, zones=${next.meetingZones.length}`,
    );
    this.broadcast("layout_updated", { bounds: next.bounds });
  }

  // -------------------------------------------------------------------------
  // Message handlers
  // -------------------------------------------------------------------------

  private registerMessageHandlers(): void {
    this.onMessage("move_request", (client, msg: { target?: { x: number; y: number }; targetSeatId?: string; seq?: number }) =>
      this.handleMove(client, msg)
    );
    this.onMessage("status_change", (client, msg: { status?: string; dnd?: boolean }) =>
      this.handleStatusChange(client, msg)
    );
    this.onMessage("sit_request", (client, msg: { seatId?: string }) =>
      this.handleSit(client, msg)
    );
    this.onMessage("enter_meeting", (client, msg: { roomId?: string }) =>
      this.handleEnterMeeting(client, msg)
    );
    this.onMessage("interact_request", (client, msg: { targetUserId?: string }) =>
      this.handleInteract(client, msg)
    );
    // 1:1 즉석 통화 시그널링 — 벨을 울리는 경로에서만 근접(5m)을 강제한다.
    this.onMessage("call_request", (client, msg: { targetUserId?: string }) =>
      this.handleCallRequest(client, msg)
    );
    this.onMessage("call_response", (client, msg: { targetUserId?: string; accepted?: boolean }) =>
      this.handleCallResponse(client, msg)
    );
    this.onMessage("call_cancel", (client, msg: { targetUserId?: string }) =>
      this.handleCallCancel(client, msg)
    );
    // Explicit resume request (client sends last_seq) → re-snapshot.
    this.onMessage("resume", (client, _msg: { lastSeq?: number }) => {
      client.send("snapshot", this.buildSnapshot());
    });
  }

  /** move_request → run the 8 movement checks; on success record the target. */
  private handleMove(
    client: Client,
    msg: { target?: { x: number; y: number }; targetSeatId?: string; seq?: number }
  ): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg.target) return;
    player.lastActivityAt = Date.now();

    const prev = this.moveTargets.get(client.sessionId);
    const dtSeconds = prev ? Math.max(0.001, (Date.now() - prev.at) / 1000) : 0.05;

    const ctx: MovementContext = {
      mover: {
        userId: player.userId,
        companyId: player.companyId,
        officeId: player.officeId,
        floorId: player.floorId,
        x: player.x,
        y: player.y,
        status: player.status,
        seatId: player.seatId,
      },
      target: msg.target,
      dtSeconds,
      layout: this.layout,
      room: { companyId: this.companyId, officeId: this.officeId, floorId: this.floorId },
      seatOccupancy: this.seatOccupancy,
      targetSeatId: msg.targetSeatId,
      meetingOccupancy: this.meetingOccupancy,
    };

    const result = validateMove(ctx);
    if (!result.ok) {
      // Reject → tell client to reconcile to the authoritative position (§4).
      client.send("move_rejected", {
        reason: result.reason,
        detail: result.detail,
        seq: msg.seq ?? 0,
        authoritative: { x: player.x, y: player.y },
      });
      return;
    }

    // Accepted intent — integrated toward on the tick.
    this.moveTargets.set(client.sessionId, {
      x: msg.target.x,
      y: msg.target.y,
      seq: msg.seq ?? 0,
      at: Date.now(),
    });
  }

  /** status_change → manual focus/external/online toggles (auto transitions are server-side). */
  private handleStatusChange(client: Client, msg: { status?: string; dnd?: boolean }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.lastActivityAt = Date.now();

    if (typeof msg.dnd === "boolean") player.dndEnabled = msg.dnd;

    const allowedManual: PresenceStatus[] = ["online", "working", "focus", "external"];
    if (msg.status && (allowedManual as string[]).includes(msg.status)) {
      player.status = msg.status;
      // focus/external suppress auto-away.
      player.manualStatusHold = msg.status === "focus" || msg.status === "external";
      this.broadcastPresenceEvent(player, "status_change");
    }
  }

  /**
   * sit_request → the server does the occupancy check; the real seat claim is
   * delegated to FastAPI (D3). Here we validate + reserve in memory and emit an
   * event instructing the client to confirm via FastAPI.
   */
  private handleSit(client: Client, msg: { seatId?: string }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg.seatId) return;
    player.lastActivityAt = Date.now();

    const seat = this.layout.seats.find((s) => s.seatId === msg.seatId);
    if (!seat) {
      client.send("sit_rejected", { reason: "unknown_seat", seatId: msg.seatId });
      return;
    }
    const occupant = this.seatOccupancy.get(msg.seatId);
    if (occupant && occupant !== player.userId) {
      client.send("sit_rejected", { reason: "seat_occupied", seatId: msg.seatId });
      return;
    }
    if (seat.type === "fixed" && seat.assignedUserId && seat.assignedUserId !== player.userId) {
      client.send("sit_rejected", { reason: "not_assigned", seatId: msg.seatId });
      return;
    }

    // Release any previous seat, take the new one.
    if (player.seatId) this.seatOccupancy.delete(player.seatId);
    this.seatOccupancy.set(msg.seatId, player.userId);
    player.seatId = msg.seatId;
    player.x = seat.x;
    player.y = seat.y;
    player.status = "working"; // seat arrival → working (auto transition)
    player.anim = "idle";
    this.moveTargets.delete(client.sessionId);

    // TODO: client should confirm the claim with FastAPI (seat domain authority, D3).
    client.send("sit_ok", { seatId: msg.seatId, confirmWith: "POST /api/seat-assignments" });
    this.broadcastPresenceEvent(player, "sit");
  }

  /**
   * enter_meeting (D24 two-step) — STEP 1 only: server checks proximity (2m) +
   * capacity, then emits `meeting_entry_allowed` telling the client to call
   * FastAPI POST /api/meetings/{id}/join itself (server does NOT mint LiveKit
   * tokens). Auto-join is forbidden.
   */
  private handleEnterMeeting(client: Client, msg: { roomId?: string }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg.roomId) return;
    player.lastActivityAt = Date.now();

    const zone = this.layout.meetingZones.find((z) => z.roomId === msg.roomId);
    if (!zone) {
      client.send("meeting_entry_denied", { roomId: msg.roomId, reason: "unknown_room" });
      return;
    }

    // Near-check: avatar must be within MEETING_PROXIMITY_M of the zone (or inside it).
    const zoneCenter = { x: zone.bounds.x + zone.bounds.w / 2, y: zone.bounds.y + zone.bounds.h / 2 };
    const near = pointInRect(player, zone.bounds) || distance(player, zoneCenter) <= MEETING_PROXIMITY_M;
    if (!near) {
      client.send("meeting_entry_denied", { roomId: msg.roomId, reason: "too_far" });
      return;
    }

    // Capacity check.
    const count = this.meetingOccupancy.get(msg.roomId) ?? 0;
    if (count >= zone.capacity) {
      client.send("meeting_entry_denied", { roomId: msg.roomId, reason: "meeting_full" });
      return;
    }

    // Allowed → client must explicitly call FastAPI to actually join (D24).
    client.send("meeting_entry_allowed", {
      roomId: msg.roomId,
      capacity: zone.capacity,
      occupancy: count,
      // Client does the real join + LiveKit token via FastAPI:
      joinVia: `POST /api/meetings/${msg.roomId}/join`,
    });
  }

  /** interact_request → run the 8 proximity checks against the target. */
  private handleInteract(client: Client, msg: { targetUserId?: string }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg.targetUserId) return;
    player.lastActivityAt = Date.now();

    // Find the target player by userId.
    let target: Player | undefined;
    for (const p of this.state.players.values()) {
      if (p.userId === msg.targetUserId) {
        target = p;
        break;
      }
    }
    if (!target) {
      client.send("interact_denied", { targetUserId: msg.targetUserId, reason: "target_not_found" });
      return;
    }

    const ctx: ProximityContext = {
      requester: this.toProxActor(player),
      target: this.toProxActor(target),
      layout: this.layout,
    };
    const result = validateProximity(ctx);
    if (!result.ok) {
      client.send("interact_denied", {
        targetUserId: msg.targetUserId,
        reason: result.reason,
        detail: result.detail,
      });
      return;
    }

    // Record cooldown and open the interaction menu.
    player.interactCooldowns[target.userId] = Date.now();
    client.send("interact_allowed", {
      targetUserId: target.userId,
      targetName: target.name,
      distance: distance(player, target),
    });
  }

  // -------------------------------------------------------------------------
  // 1:1 통화 시그널링 (09 §3.3 상호작용)
  //
  // 채팅(DM)은 거리 제약이 없지만 **통화는 근접 5m를 강제**한다. 갑자기 울리는 벨은
  // 방해라, "옆에 와 있는 사람"만 걸 수 있게 해 공간적 맥락으로 정당화한다.
  // 미디어 자체는 LiveKit이 나르고(백엔드 /api/calls/token), 여기서는 벨과 응답만 중계한다.
  // -------------------------------------------------------------------------

  /** userId로 접속 중인 상대의 (sessionId, Player)를 찾는다. */
  private findBySessionUserId(userId: string): { sessionId: string; player: Player } | null {
    for (const [sessionId, p] of this.state.players.entries()) {
      if (p.userId === userId) return { sessionId, player: p };
    }
    return null;
  }

  private handleCallRequest(client: Client, msg: { targetUserId?: string }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg.targetUserId) return;
    player.lastActivityAt = Date.now();

    const found = this.findBySessionUserId(msg.targetUserId);
    if (!found) {
      // 접속 중이 아니면 벨을 울릴 곳이 없다 — 클라는 "채팅으로 남기기"를 권한다.
      client.send("call_denied", { targetUserId: msg.targetUserId, reason: "target_offline" });
      return;
    }

    // 근접·쿨다운·DND 등 상호작용 규칙 재사용(09 §3.3) — 통화만의 별도 규칙을 만들지 않는다.
    const result = validateProximity({
      requester: this.toProxActor(player),
      target: this.toProxActor(found.player),
      layout: this.layout,
    });
    if (!result.ok) {
      client.send("call_denied", {
        targetUserId: msg.targetUserId,
        reason: result.reason,
        detail: result.detail,
      });
      return;
    }

    player.interactCooldowns[found.player.userId] = Date.now();
    const targetClient = this.clients.find((c) => c.sessionId === found.sessionId);
    if (!targetClient) {
      client.send("call_denied", { targetUserId: msg.targetUserId, reason: "target_offline" });
      return;
    }
    // 상대에게 벨, 발신자에게 호출 중 표시.
    targetClient.send("call_invite", {
      fromUserId: player.userId,
      fromName: player.name,
      distance: distance(player, found.player),
    });
    client.send("call_ringing", {
      targetUserId: found.player.userId,
      targetName: found.player.name,
    });
  }

  private handleCallResponse(
    client: Client,
    msg: { targetUserId?: string; accepted?: boolean }
  ): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg.targetUserId) return;
    player.lastActivityAt = Date.now();

    // targetUserId = 최초 발신자. 그에게 수락/거절을 되돌려준다.
    const caller = this.findBySessionUserId(msg.targetUserId);
    if (!caller) return; // 발신자가 이미 나감 — 조용히 종료
    const callerClient = this.clients.find((c) => c.sessionId === caller.sessionId);
    if (!callerClient) return;

    callerClient.send(msg.accepted ? "call_accepted" : "call_declined", {
      fromUserId: player.userId,
      fromName: player.name,
    });
  }

  private handleCallCancel(client: Client, msg: { targetUserId?: string }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg.targetUserId) return;
    const target = this.findBySessionUserId(msg.targetUserId);
    if (!target) return;
    const targetClient = this.clients.find((c) => c.sessionId === target.sessionId);
    targetClient?.send("call_cancelled", { fromUserId: player.userId });
  }

  // -------------------------------------------------------------------------
  // Simulation tick (20Hz)
  // -------------------------------------------------------------------------

  private tick(dtMs: number): void {
    const dt = dtMs / 1000;
    const now = Date.now();
    this.state.serverSeq++;

    for (const [sessionId, player] of this.state.players.entries()) {
      // Integrate movement toward the accepted target at MAX_SPEED.
      const t = this.moveTargets.get(sessionId);
      if (t) {
        const dx = t.x - player.x;
        const dy = t.y - player.y;
        const dist = Math.hypot(dx, dy);
        const step = MAX_SPEED_MPS * dt;
        if (dist <= step || dist === 0) {
          player.x = t.x;
          player.y = t.y;
          player.anim = "idle";
          this.moveTargets.delete(sessionId);
        } else {
          player.x += (dx / dist) * step;
          player.y += (dy / dist) * step;
          player.facing = Math.atan2(dy, dx);
          player.anim = "walk";
        }
        player.lastSeq = t.seq;
      }

      // Auto-away: 5 min inactivity (unless manual focus/external hold).
      if (
        !player.manualStatusHold &&
        player.status !== "away" &&
        player.status !== "offline" &&
        now - player.lastActivityAt > AUTO_AWAY_MS
      ) {
        player.status = "away";
        this.broadcastPresenceEvent(player, "auto_away");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Presence + snapshot helpers
  // -------------------------------------------------------------------------

  private async flushPresence(): Promise<void> {
    // onCreate가 상태를 세우기 전에 dispose되면(생성 실패·즉시 폐기) state가 없다.
    // 여기서 터지면 onDispose 경로 전체가 죽으므로 조용히 빠진다 — 보낼 프레즌스도 없다.
    if (!this.state?.players) return;
    const batch: PresenceRecord[] = [];
    for (const p of this.state.players.values()) {
      batch.push({
        userId: p.userId,
        officeId: p.officeId,
        floorId: p.floorId,
        x: p.x,
        y: p.y,
        status: p.status,
        seatId: p.seatId,
        timestamp: Date.now(),
      });
    }
    await this.presenceSink.push(batch);
  }

  /** Full snapshot used on join and reconnect/resume (§3 snapshot). */
  buildSnapshot(): {
    serverSeq: number;
    officeId: string;
    floorId: string;
    players: Array<Record<string, unknown>>;
  } {
    const players: Array<Record<string, unknown>> = [];
    for (const p of this.state.players.values()) {
      players.push({
        userId: p.userId,
        name: p.name,
        x: p.x,
        y: p.y,
        facing: p.facing,
        status: p.status,
        seatId: p.seatId,
        anim: p.anim,
        lastSeq: p.lastSeq,
      });
    }
    return {
      serverSeq: this.state.serverSeq,
      officeId: this.officeId,
      floorId: this.floorId,
      players,
    };
  }

  private broadcastPresenceEvent(player: Player, kind: string): void {
    this.broadcast("presence_event", {
      userId: player.userId,
      status: player.status,
      seatId: player.seatId,
      kind,
    });
  }

  private releasePlayer(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (player) {
      player.status = "offline";
      if (player.seatId) this.seatOccupancy.delete(player.seatId);
      this.broadcastPresenceEvent(player, "leave");
    }
    this.moveTargets.delete(sessionId);
    this.state.players.delete(sessionId);
  }

  private toProxActor(p: Player): ProxActor {
    return {
      userId: p.userId,
      companyId: p.companyId,
      officeId: p.officeId,
      floorId: p.floorId,
      x: p.x,
      y: p.y,
      status: p.status,
      dndEnabled: p.dndEnabled,
      interactCooldowns: p.interactCooldowns,
    };
  }
}
