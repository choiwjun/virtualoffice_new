/**
 * realtime.ts — Colyseus 클라이언트 연결 모듈 (C2).
 *
 * `realtime/` 서버(OfficeRoom, 포트 2567)에 접속해 서버 권위 상태(players)를 받고
 * 로컬 입력(move_request)을 보낸다. DOM/React 비의존 → Node 통합 스모크로 검증 가능.
 *
 * 성능: 서버는 20Hz로 state delta를 보낸다. 매 틱 React setState 하면 20Hz 재렌더가 되므로,
 * players는 **in-place로 갱신되는 Map(mutable)**으로 노출하고 R3F useFrame이 imperative하게 읽는다.
 * React state 갱신은 (a) 연결 상태, (b) 로스터(입장/퇴장 시 sessionId 집합 변경)에만 사용.
 *
 * 프로토콜 정본: realtime/README.md, docs/planning/15-realtime-server-spec.md.
 */

import { Client, Room } from 'colyseus.js';

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
}

export interface OfficeConnection {
  selfSessionId: string;
  /** 서버 권위 플레이어 — in-place 갱신되는 live map. useFrame에서 직접 읽는다. */
  players: Map<string, NetPlayer>;
  requestMove: (x: number, y: number) => void;
  setStatus: (status: string, dnd?: boolean) => void;
  leave: () => void;
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
  const room: Room<SchemaState> = await client.joinOrCreate<SchemaState>('office', join);

  const players = new Map<string, NetPlayer>();
  let seq = 0;
  let lastRoster = '';
  let left = false;

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

  room.onStateChange(() => syncFromState());
  // 초기 스냅샷(join 직후)도 상태로 반영됨. 명시적 snapshot 메시지는 로깅만.
  room.onMessage('snapshot', () => syncFromState());
  room.onMessage('move_rejected', () => { /* 서버 권위 위치가 state로 정정됨 → 별도 처리 불필요 */ });

  room.onLeave((code) => {
    if (left) return;
    // 1000(정상) 외 코드는 비정상 종료 → disconnected
    handlers.onStatus?.(code === 1000 ? 'disconnected' : 'reconnecting');
  });
  room.onError(() => handlers.onStatus?.('error'));

  // ── destination-walker ──────────────────────────────────────────────
  // 서버는 스트리밍 이동 모델: move_request 한 건은 speed 예산(≈MAX_SPEED·dt·tol,
  // 첫 요청 dt=0.05s → ~0.1m) 이내의 작은 스텝만 허용한다. 따라서 먼 목적지 클릭은
  // 서버 권위 위치에서 목적지로 매 스텝(STEP_MS)마다 작은 이동을 스트리밍한다.
  // 거부되면 서버 위치가 안 바뀌므로 다음 스텝이 같은 위치에서 재계산 → 자연 정정.
  const STEP_MS = 100;
  const STEP_DIST = 0.09; // < 첫 요청 예산 0.105m (1.4·0.05·1.5). ≈0.9 m/s.
  let dest: { x: number; y: number } | null = null;
  const walkTimer: ReturnType<typeof setInterval> = setInterval(() => {
    if (!dest) return;
    const self = players.get(room.sessionId);
    if (!self) return;
    const dx = dest.x - self.x;
    const dy = dest.y - self.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) { dest = null; return; }
    const step = Math.min(d, STEP_DIST);
    const nx = self.x + (dx / d) * step;
    const ny = self.y + (dy / d) * step;
    room.send('move_request', { target: { x: nx, y: ny }, seq: ++seq });
  }, STEP_MS);

  // 첫 동기화 + 연결 성공 통지
  syncFromState();
  handlers.onStatus?.('connected');

  return {
    selfSessionId: room.sessionId,
    players,
    requestMove: (x: number, y: number) => {
      // 목적지 설정 → walker가 스텝을 스트리밍.
      dest = { x, y };
    },
    setStatus: (status: string, dnd?: boolean) => {
      room.send('status_change', { status, dnd });
    },
    leave: () => {
      left = true;
      clearInterval(walkTimer);
      try { room.leave(true); } catch { /* already gone */ }
    },
  };
}
