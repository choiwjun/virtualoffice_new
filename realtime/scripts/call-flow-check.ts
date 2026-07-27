/**
 * call-flow-check.ts — 1:1 통화 흐름 라이브 스모크 (실 소켓 2인 접속).
 *
 * 유닛 테스트(call-signal.test.ts)는 핸들러를 직접 호출하지만, 이 스크립트는 **실제 WSS
 * 프로토콜**로 벨이 오가는지 확인한다: 멀 때 거부 → 걸어가서 근접 → 벨 → 수락.
 *
 * 선행: 백엔드(:8000)·실시간(:2567) 기동. 실행: npx tsx scripts/call-flow-check.ts
 */
import { Client, Room } from 'colyseus.js';

const BACKEND = 'http://127.0.0.1:8000';
const RT = 'ws://127.0.0.1:2567';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? `  [${detail}]` : ''}`);
  }
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  if (!res.ok) throw new Error(`login failed ${email}: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const join = (tok: string) =>
  new Client(RT).joinOrCreate('office', {
    companyId: '1',
    officeId: 'office-demo',
    floorId: 'floor-1',
    jwt: tok,
  });

/** 수신 메시지를 타입별로 모아 두는 수집기. */
function collect(room: Room, types: string[]): Record<string, unknown[]> {
  const bag: Record<string, unknown[]> = {};
  for (const t of types) {
    bag[t] = [];
    room.onMessage(t, (m: unknown) => bag[t].push(m ?? {}));
  }
  return bag;
}

/** target 좌표까지 작은 스텝으로 이동(서버 속도 예산에 맞춰 스트리밍). */
async function walkTo(room: Room, target: { x: number; y: number }, steps = 220): Promise<void> {
  for (let i = 0; i < steps; i++) {
    const s = (room.state as any).players.get(room.sessionId);
    if (!s) return;
    const d = Math.hypot(target.x - s.x, target.y - s.y);
    if (d < 1.2) return;
    const k = Math.min(0.1, d) / d;
    room.send('move_request', {
      target: { x: s.x + (target.x - s.x) * k, y: s.y + (target.y - s.y) * k },
      seq: i + 1,
    });
    await sleep(45);
  }
}

function posOf(room: Room, userId: string): { x: number; y: number } | null {
  let out: { x: number; y: number } | null = null;
  (room.state as any).players.forEach((p: { userId: string; x: number; y: number }) => {
    if (!out && String(p.userId) === userId) out = { x: p.x, y: p.y };
  });
  return out;
}

async function main(): Promise<void> {
  const [tokA, tokB] = await Promise.all([
    login('alice@virtualoffice.local'),
    login('bob@virtualoffice.local'),
  ]);
  const roomA = await join(tokA);
  await sleep(400);
  const roomB = await join(tokB);
  await sleep(900);

  const bagA = collect(roomA, ['call_ringing', 'call_denied', 'call_accepted', 'call_declined']);
  const bagB = collect(roomB, ['call_invite', 'call_cancelled']);

  console.log('\n[1] 두 클라이언트 접속');
  check('alice가 bob을 본다', !!posOf(roomA, '1002'));
  check('bob이 alice를 본다', !!posOf(roomB, '1001'));

  console.log('\n[2] 멀리 떨어뜨린 뒤 통화 → 거부');
  // 서로 반대편으로 이동시켜 5m를 확실히 넘긴다.
  await Promise.all([walkTo(roomA, { x: 2.5, y: 2.5 }), walkTo(roomB, { x: 17, y: 9.5 })]);
  await sleep(500);
  const selfA = posOf(roomA, '1001')!;
  const selfB = posOf(roomA, '1002')!;
  const far = Math.hypot(selfA.x - selfB.x, selfA.y - selfB.y);
  console.log(`       거리 ${far.toFixed(2)}m`);
  check('5m 초과 배치됨', far > 5, `${far.toFixed(2)}m`);

  bagA.call_denied.length = 0;
  roomA.send('call_request', { targetUserId: '1002' });
  await sleep(700);
  check('call_denied 수신', bagA.call_denied.length === 1, JSON.stringify(bagA.call_denied));
  check(
    '사유 too_far',
    (bagA.call_denied[0] as { reason?: string })?.reason === 'too_far',
    JSON.stringify(bagA.call_denied[0]),
  );
  check('상대 벨은 안 울림', bagB.call_invite.length === 0);

  console.log('\n[3] 걸어가서 근접 → 벨');
  const bobPos = posOf(roomA, '1002')!;
  await walkTo(roomA, bobPos);
  await sleep(500);
  const a2 = posOf(roomA, '1001')!;
  const b2 = posOf(roomA, '1002')!;
  const near = Math.hypot(a2.x - b2.x, a2.y - b2.y);
  console.log(`       거리 ${near.toFixed(2)}m`);
  check('5m 이내로 접근', near <= 5, `${near.toFixed(2)}m`);

  roomA.send('call_request', { targetUserId: '1002' });
  await sleep(700);
  check('bob에게 call_invite', bagB.call_invite.length === 1, JSON.stringify(bagB.call_invite));
  check(
    'invite 발신자 = alice',
    (bagB.call_invite[0] as { fromUserId?: string })?.fromUserId === '1001',
    JSON.stringify(bagB.call_invite[0]),
  );
  check('alice에게 call_ringing', bagA.call_ringing.length === 1);

  console.log('\n[4] 수락 → 발신자 통지');
  roomB.send('call_response', { targetUserId: '1001', accepted: true });
  await sleep(600);
  check('alice에게 call_accepted', bagA.call_accepted.length === 1, JSON.stringify(bagA.call_accepted));
  check('거절은 오지 않음', bagA.call_declined.length === 0);

  console.log('\n[5] 취소 전달');
  roomA.send('call_cancel', { targetUserId: '1002' });
  await sleep(500);
  check('bob에게 call_cancelled', bagB.call_cancelled.length === 1);

  roomA.leave();
  roomB.leave();
  console.log(`\n${'='.repeat(56)}`);
  console.log(`call-flow: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
