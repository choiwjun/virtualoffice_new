/**
 * call-signal.test.ts — 1:1 통화 시그널링 (09 §3.3 상호작용).
 *
 * 핵심 계약: **통화 벨은 근접 5m 안에서만 울린다.** 채팅(DM)은 거리 제약이 없지만
 * 갑자기 울리는 벨은 방해라서, "옆에 와 있는 사람"만 걸 수 있게 공간적 맥락으로 정당화한다.
 * 미디어는 LiveKit이 나르고 여기서는 벨·응답·취소 중계만 검증한다.
 *
 * Run with:  npm test
 */

import { OfficeRoom } from "../rooms/OfficeRoom";
import { OfficeState, Player } from "../state/OfficeState";
import { DemoFloorLayoutProvider } from "../integration/FloorLayoutProvider";
import { PROXIMITY_M } from "../config";

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

interface Sent {
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
}

/** 클라이언트 스텁 — send를 기록해 어떤 시그널이 누구에게 갔는지 본다. */
function makeClient(sessionId: string, log: Sent[]) {
  return {
    sessionId,
    send(type: string, payload: Record<string, unknown>) {
      log.push({ sessionId, type, payload });
    },
  };
}

async function makeRoomWith(
  players: Array<{ sessionId: string; userId: string; name: string; x: number; y: number }>,
  log: Sent[],
) {
  const room = new OfficeRoom();
  (room as unknown as { listing: { remove(): void } }).listing = { remove() {} };
  const state = new OfficeState();
  (room as unknown as { state: OfficeState }).state = state;
  (room as unknown as { layout: unknown }).layout = await new DemoFloorLayoutProvider().getLayout(
    "office-demo",
    "floor-1",
  );
  const clients: unknown[] = [];
  for (const p of players) {
    const pl = new Player();
    pl.userId = p.userId;
    pl.name = p.name;
    pl.x = p.x;
    pl.y = p.y;
    pl.status = "online";
    pl.companyId = "company-demo";
    pl.officeId = "office-demo";
    pl.floorId = "floor-1";
    state.players.set(p.sessionId, pl);
    clients.push(makeClient(p.sessionId, log));
  }
  (room as unknown as { clients: unknown[] }).clients = clients;
  return { room, clients };
}

function sentTo(log: Sent[], sessionId: string, type: string): Sent | undefined {
  return log.find((s) => s.sessionId === sessionId && s.type === type);
}

async function main(): Promise<void> {
  console.log("\n[1] 가까이 있으면 벨이 울린다");
  {
    const log: Sent[] = [];
    const { room, clients } = await makeRoomWith(
      [
        { sessionId: "s1", userId: "1001", name: "앨리스", x: 10, y: 7 },
        { sessionId: "s2", userId: "1002", name: "밥", x: 11, y: 7 }, // 1m
      ],
      log,
    );
    (room as unknown as { handleCallRequest(c: unknown, m: unknown): void }).handleCallRequest(
      clients[0],
      { targetUserId: "1002" },
    );
    const invite = sentTo(log, "s2", "call_invite");
    assert(!!invite, "상대에게 call_invite 전달");
    eq(invite?.payload.fromUserId, "1001", "발신자 id");
    eq(invite?.payload.fromName, "앨리스", "발신자 이름");
    assert(!!sentTo(log, "s1", "call_ringing"), "발신자에게 call_ringing");
    assert(!sentTo(log, "s1", "call_denied"), "거부 아님");
  }

  console.log(`\n[2] 멀리 있으면 거부된다 (근접 ${PROXIMITY_M}m)`);
  {
    const log: Sent[] = [];
    const { room, clients } = await makeRoomWith(
      [
        { sessionId: "s1", userId: "1001", name: "앨리스", x: 2, y: 2 },
        { sessionId: "s2", userId: "1002", name: "밥", x: 18, y: 12 }, // 한참 멀다
      ],
      log,
    );
    (room as unknown as { handleCallRequest(c: unknown, m: unknown): void }).handleCallRequest(
      clients[0],
      { targetUserId: "1002" },
    );
    const denied = sentTo(log, "s1", "call_denied");
    assert(!!denied, "발신자에게 call_denied");
    eq(denied?.payload.reason, "too_far", "사유 too_far");
    assert(!sentTo(log, "s2", "call_invite"), "상대 벨은 울리지 않는다");
  }

  console.log("\n[3] 접속하지 않은 상대");
  {
    const log: Sent[] = [];
    const { room, clients } = await makeRoomWith(
      [{ sessionId: "s1", userId: "1001", name: "앨리스", x: 10, y: 7 }],
      log,
    );
    (room as unknown as { handleCallRequest(c: unknown, m: unknown): void }).handleCallRequest(
      clients[0],
      { targetUserId: "9999" },
    );
    eq(sentTo(log, "s1", "call_denied")?.payload.reason, "target_offline", "사유 target_offline");
  }

  console.log("\n[4] 수락 → 발신자에게 call_accepted");
  {
    const log: Sent[] = [];
    const { room, clients } = await makeRoomWith(
      [
        { sessionId: "s1", userId: "1001", name: "앨리스", x: 10, y: 7 },
        { sessionId: "s2", userId: "1002", name: "밥", x: 11, y: 7 },
      ],
      log,
    );
    // 수신자(s2)가 발신자(1001)에게 응답
    (room as unknown as { handleCallResponse(c: unknown, m: unknown): void }).handleCallResponse(
      clients[1],
      { targetUserId: "1001", accepted: true },
    );
    const accepted = sentTo(log, "s1", "call_accepted");
    assert(!!accepted, "발신자에게 call_accepted");
    eq(accepted?.payload.fromUserId, "1002", "수락자 id");
    assert(!sentTo(log, "s1", "call_declined"), "거절 아님");
  }

  console.log("\n[5] 거절 → 발신자에게 call_declined");
  {
    const log: Sent[] = [];
    const { room, clients } = await makeRoomWith(
      [
        { sessionId: "s1", userId: "1001", name: "앨리스", x: 10, y: 7 },
        { sessionId: "s2", userId: "1002", name: "밥", x: 11, y: 7 },
      ],
      log,
    );
    (room as unknown as { handleCallResponse(c: unknown, m: unknown): void }).handleCallResponse(
      clients[1],
      { targetUserId: "1001", accepted: false },
    );
    assert(!!sentTo(log, "s1", "call_declined"), "발신자에게 call_declined");
  }

  console.log("\n[6] 발신 취소 → 수신자 벨 종료");
  {
    const log: Sent[] = [];
    const { room, clients } = await makeRoomWith(
      [
        { sessionId: "s1", userId: "1001", name: "앨리스", x: 10, y: 7 },
        { sessionId: "s2", userId: "1002", name: "밥", x: 11, y: 7 },
      ],
      log,
    );
    (room as unknown as { handleCallCancel(c: unknown, m: unknown): void }).handleCallCancel(
      clients[0],
      { targetUserId: "1002" },
    );
    const cancelled = sentTo(log, "s2", "call_cancelled");
    assert(!!cancelled, "수신자에게 call_cancelled");
    eq(cancelled?.payload.fromUserId, "1001", "취소한 사람 id");
  }

  console.log(`\n${"=".repeat(56)}`);
  console.log(`call-signal: ${passed} passed, ${failed} failed`);
  // 하네스가 room.clients를 채워 두기 때문에 Colyseus의 빈 방 auto-dispose가 걸리지 않고,
  // 방의 시뮬레이션/패치 타이머가 이벤트 루프를 붙잡아 프로세스가 끝나지 않는다.
  // 검증은 끝났으므로 명시적으로 종료한다(다른 스모크 테스트는 방을 비워 자연 종료된다).
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
