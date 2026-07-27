/**
 * realtime.ts — Colyseus 클라이언트 연결 모듈 (C2).
 *
 * `realtime/` 서버(OfficeRoom, 포트 2567)에 접속해 서버 권위 상태(players)를 받고
 * 로컬 입력(move_request)을 보낸다. DOM/React 비의존 → Node 통합 스모크로 검증 가능.
 *
 * 성능: 서버는 20Hz로 state delta를 보낸다. 매 틱 React setState 하면 20Hz 재렌더가 되므로,
 * players는 **in-place로 갱신되는 Map(mutable)**으로 노출하고 뷰포트 rAF 루프가 imperative하게 읽는다.
 * React state 갱신은 (a) 연결 상태, (b) 로스터(입장/퇴장 시 sessionId 집합 변경)에만 사용.
 *
 * 재연결(06 §5.3): 비정상 끊김 시 지수 백오프(1s→2s→4s→…→최대 30s)로 자동 재접속.
 * 60초 경과 시 포기 → 'disconnected'(호출측이 오프라인 로컬 모드 폴백) + reconnect()로 수동 재시도.
 * 재접속은 새 세션(joinOrCreate)이므로 sessionId가 바뀐다 → onSelf로 통지.
 *
 * 프로토콜 정본: realtime/README.md, docs/planning/15-realtime-server-spec.md.
 */

import { Client, Room } from 'colyseus.js';
import { findPath } from './office2d';

export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface NetPlayer {
  sessionId: string;
  userId: string;
  name: string;
  x: number;
  y: number;
  facing: number;
  status: string;
  seatId: string;
  anim: string;
  lastSeq: number;
}

export interface JoinInfo {
  userId: string;
  name: string;
  companyId?: string;
  officeId: string;
  floorId: string;
  jwt?: string;
}

export interface OfficeConnectionHandlers {
  onStatus?: (s: ConnStatus) => void;
  /** 플레이어 집합(sessionId)이 바뀔 때만 호출 — React 로스터 갱신용. */
  onRoster?: (sessionIds: string[]) => void;
  /** 회의 명시입장(D24) 서버 판정 결과 — enter_meeting 응답. */
  onMeetingEntry?: (r: MeetingEntryResult) => void;
  /** (재)접속 성공 시 본인 sessionId 통지 — 재연결로 세션이 바뀔 수 있음(§5.3). */
  onSelf?: (sessionId: string) => void;
  /** 배포 레이아웃 재배포/롤백(D12 layout_updated) — 구조·이동 지오메트리 즉시 재조회 트리거. */
  onLayoutUpdated?: () => void;
  /** 1:1 통화 시그널(09 §3.3) — 벨·응답·취소. 미디어는 LiveKit이 별도로 나른다. */
  onCallSignal?: (s: CallSignal) => void;
}

/** 1:1 통화 시그널. 서버가 근접(5m)을 검증한 뒤에만 invite가 전달된다. */
export type CallSignal =
  | { type: 'invite'; fromUserId: string; fromName: string; distance: number }
  | { type: 'ringing'; targetUserId: string; targetName: string }
  | { type: 'accepted'; fromUserId: string; fromName: string }
  | { type: 'declined'; fromUserId: string; fromName: string }
  | { type: 'cancelled'; fromUserId: string }
  | { type: 'denied'; targetUserId: string; reason?: string };

export interface OfficeConnection {
  /** 최초 접속 세션 — 재연결 시 in-place 갱신되며 onSelf로도 통지. */
  selfSessionId: string;
  /** 서버 권위 플레이어 — in-place 갱신되는 live map. useFrame에서 직접 읽는다.
   *  재연결 후에도 동일 Map 인스턴스를 유지한다(ref 소비자 안전). */
  players: Map<string, NetPlayer>;
  requestMove: (x: number, y: number) => void;
  /** 경유지 경로 이동(A* 결과) — walker가 각 경유지를 순서대로 스트리밍. */
  requestPath: (points: Array<{ x: number; y: number }>) => void;
  /** 회의 명시입장(D24) 요청 — 서버 판정은 onMeetingEntry로 통지. */
  enterMeeting: (roomId: string) => void;
  /** 1:1 통화 걸기 — 서버가 근접(5m)을 검증. 결과는 onCallSignal(ringing|denied). */
  callRequest: (targetUserId: string) => void;
  /** 걸려온 통화에 응답. targetUserId = 발신자. */
  callRespond: (targetUserId: string, accepted: boolean) => void;
  /** 발신 취소(상대가 받기 전). */
  callCancel: (targetUserId: string) => void;
  setStatus: (status: string, dnd?: boolean) => void;
  /** 재연결 포기(오프라인 폴백) 후 수동 재시도 — "다시 연결" 버튼(§5.3). */
  reconnect: () => void;
  leave: () => void;
}

/** enter_meeting(D24 1단계) 서버 판정 결과. ok면 클라가 명시 입장(POST /meetings/join) 진행. */
export interface MeetingEntryResult {
  roomId: string;
  ok: boolean;
  reason?: string;
}

// 서버 스키마는 colyseus.js가 제네릭 디코드 → 느슨하게 접근.
interface SchemaPlayer {
  userId: string; name: string; x: number; y: number; facing: number;
  status: string; seatId: string; anim: string; lastSeq: number;
}
interface SchemaState {
  players: {
    forEach: (cb: (value: SchemaPlayer, key: string) => void) => void;
  };
}

// 재연결 백오프(06 §5.3): 1s→2s→4s→…→최대 30s, 60초 경과 시 포기.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_GIVE_UP_MS = 60_000;

/**
 * 서버에 접속하고 상태 구독을 배선한다. resolve = 접속 성공(첫 상태 수신 후).
 * reject = 접속 실패(서버 오프라인 등) → 호출측이 graceful degradation.
 */
export async function createOfficeConnection(
  url: string,
  join: JoinInfo,
  handlers: OfficeConnectionHandlers,
): Promise<OfficeConnection> {
  handlers.onStatus?.('connecting');
  const client = new Client(url);
  let room: Room<SchemaState> = await client.joinOrCreate<SchemaState>('office', join);

  const players = new Map<string, NetPlayer>();
  let seq = 0;
  let lastRoster = '';
  let left = false;
  let connected = false;
  let reconnecting = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const syncFromState = () => {
    const state = room.state;
    if (!state || !state.players) return;
    const seen = new Set<string>();
    state.players.forEach((p, key) => {
      seen.add(key);
      let np = players.get(key);
      if (!np) {
        np = { sessionId: key, userId: '', name: '', x: 0, y: 0, facing: 0, status: 'online', seatId: '', anim: 'idle', lastSeq: 0 };
        players.set(key, np);
      }
      np.userId = p.userId; np.name = p.name;
      np.x = p.x; np.y = p.y; np.facing = p.facing;
      np.status = p.status; np.seatId = p.seatId; np.anim = p.anim; np.lastSeq = p.lastSeq;
    });
    for (const key of Array.from(players.keys())) {
      if (!seen.has(key)) players.delete(key);
    }
    const roster = Array.from(players.keys()).sort().join(',');
    if (roster !== lastRoster) {
      lastRoster = roster;
      handlers.onRoster?.(Array.from(players.keys()));
    }
  };

  /** 연결이 살아있을 때만 send(끊김/재연결 레이스 방어). */
  const safeSend = (type: string, payload: unknown) => {
    if (!connected) return;
    try { room.send(type, payload); } catch { /* 종료 직전 레이스 — 다음 상태 동기화로 정정 */ }
  };

  /** 방 인스턴스에 핸들러 배선 — 최초 접속과 재접속이 공유. */
  const wireRoom = (r: Room<SchemaState>) => {
    room = r;
    r.onStateChange(() => syncFromState());
    // 초기 스냅샷(join 직후)도 상태로 반영됨. 명시적 snapshot 메시지는 로깅만.
    r.onMessage('snapshot', () => syncFromState());
    r.onMessage('move_rejected', (m: { reason?: string; detail?: string }) => {
      // 서버 권위 위치는 state로 정정됨. 사유는 dev에서만 노출.
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[realtime] move_rejected:', m?.reason, m?.detail ?? '');
      }
      // 연속 거부 = 현 위치→경유지 선분이 서버 벽과 교차(경유지 조기 소화로 폴리라인 이탈 등).
      // 같은 스텝의 무한 재시도(스톨 사망) 대신 현 위치에서 최종 목적지로 재경로.
      if (route.length === 0 || ++rejectStreak < REJECT_REPATH_STREAK || repathBudget <= 0) return;
      const self = players.get(room.sessionId);
      if (!self) return;
      const goal = route[route.length - 1];
      repathBudget--;
      rejectStreak = 0;
      stall = 0;
      route = findPath({ x: self.x, y: self.y }, goal);
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[realtime] re-path from (${self.x.toFixed(2)},${self.y.toFixed(2)}) waypoints=${route.length} budgetLeft=${repathBudget}`);
      }
    });
    // 회의 명시입장(D24) 서버 판정 — allowed면 클라가 프롬프트 후 명시 join.
    r.onMessage('meeting_entry_allowed', (m: { roomId?: string }) =>
      handlers.onMeetingEntry?.({ roomId: m?.roomId ?? '', ok: true }),
    );
    r.onMessage('meeting_entry_denied', (m: { roomId?: string; reason?: string }) =>
      handlers.onMeetingEntry?.({ roomId: m?.roomId ?? '', ok: false, reason: m?.reason }),
    );
    r.onMessage('layout_updated', () => handlers.onLayoutUpdated?.());
    // ── 1:1 통화 시그널(09 §3.3) — 서버가 근접 5m 검증 후에만 invite가 온다 ──
    r.onMessage('call_invite', (m: { fromUserId?: string; fromName?: string; distance?: number }) =>
      handlers.onCallSignal?.({
        type: 'invite',
        fromUserId: m?.fromUserId ?? '',
        fromName: m?.fromName ?? '',
        distance: m?.distance ?? 0,
      }),
    );
    r.onMessage('call_ringing', (m: { targetUserId?: string; targetName?: string }) =>
      handlers.onCallSignal?.({
        type: 'ringing',
        targetUserId: m?.targetUserId ?? '',
        targetName: m?.targetName ?? '',
      }),
    );
    r.onMessage('call_accepted', (m: { fromUserId?: string; fromName?: string }) =>
      handlers.onCallSignal?.({ type: 'accepted', fromUserId: m?.fromUserId ?? '', fromName: m?.fromName ?? '' }),
    );
    r.onMessage('call_declined', (m: { fromUserId?: string; fromName?: string }) =>
      handlers.onCallSignal?.({ type: 'declined', fromUserId: m?.fromUserId ?? '', fromName: m?.fromName ?? '' }),
    );
    r.onMessage('call_cancelled', (m: { fromUserId?: string }) =>
      handlers.onCallSignal?.({ type: 'cancelled', fromUserId: m?.fromUserId ?? '' }),
    );
    r.onMessage('call_denied', (m: { targetUserId?: string; reason?: string }) =>
      handlers.onCallSignal?.({ type: 'denied', targetUserId: m?.targetUserId ?? '', reason: m?.reason }),
    );
    r.onLeave((code) => {
      connected = false;
      if (left) return;
      if (code === 1000) {
        // 정상 종료 → 재연결하지 않음(의도된 퇴장).
        handlers.onStatus?.('disconnected');
        return;
      }
      if (code === 4000) {
        // 단일 세션 축출(#7: 같은 계정이 다른 곳에서 접속) → 자동 재접속 금지.
        // 재접속하면 상대 세션을 다시 축출해 두 탭이 서로 밀어내는 핑퐁이 된다.
        handlers.onStatus?.('disconnected');
        return;
      }
      startReconnect(); // 비정상 끊김 → 지수 백오프 자동 재연결(§5.3)
    });
    r.onError(() => { /* 연결 오류는 onLeave로 이어짐 — 상태 전이는 거기서 일원화 */ });
  };

  /** 지수 백오프 재연결 루프. immediate=true면 즉시 1회 시도("다시 연결" 버튼). */
  const startReconnect = (immediate = false) => {
    if (left || reconnecting) return;
    reconnecting = true;
    handlers.onStatus?.('reconnecting');
    const startedAt = Date.now();
    let delay = RECONNECT_BASE_MS;

    const attempt = () => {
      if (left) { reconnecting = false; return; }
      if (Date.now() - startedAt > RECONNECT_GIVE_UP_MS) {
        // 포기 → 오프라인 로컬 모드 폴백(호출측 칩 + "다시 연결" 버튼).
        reconnecting = false;
        handlers.onStatus?.('disconnected');
        return;
      }
      // 새 세션으로 재입장 — 서버는 동일 userId 기존 세션을 축출(#7)하므로 유령 세션 없음.
      client.joinOrCreate<SchemaState>('office', join)
        .then((r) => {
          if (left) { try { r.leave(true); } catch { /* noop */ } reconnecting = false; return; }
          reconnecting = false;
          players.clear();
          lastRoster = '';
          wireRoom(r);
          conn.selfSessionId = r.sessionId;
          handlers.onSelf?.(r.sessionId);
          connected = true;
          syncFromState(); // 백오프 리셋은 루프 종료로 자연 달성(다음 끊김 시 1s부터)
          handlers.onStatus?.('connected');
        })
        .catch(() => {
          if (left) { reconnecting = false; return; }
          reconnectTimer = setTimeout(attempt, delay);
          delay = Math.min(delay * 2, RECONNECT_MAX_MS);
        });
    };

    if (immediate) attempt();
    else {
      reconnectTimer = setTimeout(attempt, delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    }
  };

  wireRoom(room);

  // ── destination-walker ──────────────────────────────────────────────
  // 서버는 스트리밍 이동 모델: move_request 한 건은 speed 예산(≈MAX_SPEED·dt·tol,
  // 첫 요청 dt=0.05s → ~0.1m) 이내의 작은 스텝만 허용한다. 따라서 먼 목적지 클릭은
  // 서버 권위 위치에서 목적지로 매 스텝(STEP_MS)마다 작은 이동을 스트리밍한다.
  // route = 경유지 큐(A* 경로) — 직선 스텝이 유리벽을 가로지르지 않게 문 개구부를 경유.
  // 거부되면 서버 위치가 안 바뀌므로 다음 스텝이 같은 위치에서 재계산 → 자연 정정.
  // 서버 예산: 타깃 소화 후엔 dt=0.05 가정으로 리셋(cap 0.105m) — 요청당 보폭을 키울 수 없다.
  // 매끄러움은 케이던스로: 50ms×0.07m = 1.4m/s를 서버가 쉼 없이 걷는다
  // (100ms×0.09는 64ms 이동 + 36ms 정지의 톱니 스터터).
  const STEP_MS = 50;
  const STEP_DIST = 0.07;
  const STALL_TICKS = 30; // 벽(가구 충돌)에 막혀 1.5초간 전진 없으면 목적지 포기(최후 안전망).
  // 중간 경유지 도달 판정(마지막 목적지는 0.05). 반드시 A* 클리어런스(0.07m)보다 작아야 한다:
  // 경유지를 eps만큼 못 미친 지점에서 다음 경유지로 방향을 틀면 폴리라인을 최대 eps만큼
  // 안쪽으로 질러가는데, 0.12였을 때 책상 모서리를 ~3cm 클립해 서버가 전 스텝을 거부했다
  // (스텝 0.07m의 반보폭 0.035보다는 커야 경유지 주위를 맴돌지 않는다).
  const WAYPOINT_EPS = 0.06;
  const REJECT_REPATH_STREAK = 3; // 서버 연속 거부 n회 → 현 위치에서 재경로(자가 회복).
  let route: Array<{ x: number; y: number }> = [];
  let stall = 0;
  let rejectStreak = 0;
  let repathBudget = 0;
  let lastX = 0;
  let lastY = 0;
  const walkTimer: ReturnType<typeof setInterval> = setInterval(() => {
    if (route.length === 0 || !connected) return;
    const self = players.get(room.sessionId);
    if (!self) return;
    // 진행 정체 감지 — 서버가 스텝을 계속 거부하면(경로가 벽을 가로지름) 무한 재시도 방지.
    if (Math.hypot(self.x - lastX, self.y - lastY) < 0.01) {
      if (++stall >= STALL_TICKS) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[realtime] route abandoned (stall): at=(${self.x.toFixed(2)},${self.y.toFixed(2)}) next=(${route[0].x.toFixed(2)},${route[0].y.toFixed(2)}) remaining=${route.length}`,
          );
        }
        route = []; stall = 0; return;
      }
    } else {
      stall = 0;
      rejectStreak = 0; // 전진 재개 → 거부 스트릭 해소
    }
    lastX = self.x;
    lastY = self.y;
    let wp = route[0];
    let dx = wp.x - self.x;
    let dy = wp.y - self.y;
    let d = Math.hypot(dx, dy);
    // 경유지 도달 → 다음 경유지로 전진.
    while (d < (route.length > 1 ? WAYPOINT_EPS : 0.05)) {
      route.shift();
      if (route.length === 0) return;
      wp = route[0];
      dx = wp.x - self.x;
      dy = wp.y - self.y;
      d = Math.hypot(dx, dy);
    }
    const step = Math.min(d, STEP_DIST);
    const nx = self.x + (dx / d) * step;
    const ny = self.y + (dy / d) * step;
    safeSend('move_request', { target: { x: nx, y: ny }, seq: ++seq });
  }, STEP_MS);

  // 첫 동기화 + 연결 성공 통지
  connected = true;
  handlers.onSelf?.(room.sessionId);
  syncFromState();
  handlers.onStatus?.('connected');

  const conn: OfficeConnection = {
    selfSessionId: room.sessionId,
    players,
    requestMove: (x: number, y: number) => {
      // 단일 목적지 → walker가 스텝을 스트리밍.
      route = [{ x, y }];
      stall = 0;
      rejectStreak = 0;
      repathBudget = 3;
    },
    requestPath: (points: Array<{ x: number; y: number }>) => {
      route = points.map((p) => ({ x: p.x, y: p.y }));
      stall = 0;
      rejectStreak = 0;
      repathBudget = 3;
    },
    enterMeeting: (roomId: string) => {
      safeSend('enter_meeting', { roomId });
    },
    callRequest: (targetUserId: string) => {
      safeSend('call_request', { targetUserId });
    },
    callRespond: (targetUserId: string, accepted: boolean) => {
      safeSend('call_response', { targetUserId, accepted });
    },
    callCancel: (targetUserId: string) => {
      safeSend('call_cancel', { targetUserId });
    },
    setStatus: (status: string, dnd?: boolean) => {
      safeSend('status_change', { status, dnd });
    },
    reconnect: () => {
      if (left || connected || reconnecting) return;
      startReconnect(true);
    },
    leave: () => {
      left = true;
      connected = false;
      clearInterval(walkTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { room.leave(true); } catch { /* already gone */ }
    },
  };
  return conn;
}
