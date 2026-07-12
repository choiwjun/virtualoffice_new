/**
 * live-check.ts — 실행 중인 backend(8000)+realtime(2567)에 대한 라이브 E2E.
 * backend 로그인으로 실제 JWT를 받아 → 라이브 realtime에 접속(onAuth가 실 토큰 검증) →
 * identity 위조 방지 확인 → 라이브 이동. (LAYOUT_SOURCE_URL/PRESENCE_SINK_URL도 켜진
 * 서버라 layout fetch 404→demo 폴백, presence 배치 push까지 실제로 돈다.)
 *
 * 사전: backend·realtime 기동 필요. 실행: cd realtime && npx tsx scripts/live-check.ts
 */
import { Client, Room } from 'colyseus.js';

const BACKEND = process.env.BACKEND ?? 'http://127.0.0.1:8000';
const RT = process.env.RT ?? 'ws://127.0.0.1:2567';
let passed = 0;
let failed = 0;
function assert(c: boolean, l: string): void {
  if (c) { passed++; console.log('  PASS ', l); } else { failed++; console.error('  FAIL ', l); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const selfOf = (room: Room) =>
  (room.state as { players: { get: (k: string) => { x: number; y: number; userId: string } | undefined } }).players.get(room.sessionId);

async function main(): Promise<void> {
  // 1) backend 로그인 → 실제 JWT
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'alice@virtualoffice.local', password: 'password123' }),
  });
  const body = (await res.json()) as { access_token?: string };
  const token = body.access_token;
  assert(!!token, 'backend /api/auth/login → JWT 발급');

  // 2) 라이브 realtime 접속(위조 userId 전달) → onAuth가 실 토큰 검증 + sub로 override
  const client = new Client(RT);
  const room = await client.joinOrCreate('office', {
    userId: 'SPOOFED', name: 'Alice', officeId: 'office-demo', floorId: 'floor-1', jwt: token,
  });
  await sleep(400);
  const self = selfOf(room);
  assert(!!self, '라이브 realtime join (실 JWT를 onAuth가 수락)');
  assert(self?.userId === '1001', `identity=토큰 sub, 위조 무시 (got ${self?.userId})`);

  // 3) 라이브 이동
  const start = { x: self!.x, y: self!.y };
  for (let i = 0; i < 12; i++) {
    const s = selfOf(room)!;
    room.send('move_request', { target: { x: s.x + 0.05, y: s.y + 0.05 }, seq: i + 1 });
    await sleep(90);
  }
  const p = selfOf(room)!;
  assert(Math.hypot(p.x - start.x, p.y - start.y) > 0.3, `라이브 이동 (moved ${Math.hypot(p.x - start.x, p.y - start.y).toFixed(2)}m)`);

  await room.leave(true);
  await sleep(200);
  console.log(`\n=== live-check: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
