/**
 * client-smoke.ts — C2 클라이언트↔서버 통합 스모크 (브라우저 불필요).
 *
 * 인프로세스 OfficeRoom 서버 + colyseus.js 클라이언트로, 프론트 클라이언트 모듈
 * (frontend/lib/realtime.ts)이 사용하는 **프로토콜과 스트리밍 walker 로직을 동일하게**
 * 재현해 end-to-end 동작을 검증한다:
 *   1) join → 본인 플레이어 스폰(층 중앙)
 *   2) 먼 목적지로 walker 스텝 스트리밍 → 서버 권위 위치 이동 + anim=walk
 *   3) 2번째 접속 → 로스터 증가(상호 가시)
 *   4) leave → 로스터 감소
 * (R3F 시각 렌더는 브라우저 육안 QA 별도. 이 테스트는 네트워크 프로토콜을 증명한다.)
 *
 * 실행:  cd realtime && npx tsx scripts/client-smoke.ts
 */
import { createServer } from 'http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, Room } from 'colyseus.js';
import jwt from 'jsonwebtoken';
import { OfficeRoom } from '../src/rooms/OfficeRoom';
import { JWT_SECRET } from '../src/config';

const PORT = 2599;
let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log('  PASS ', label); }
  else { failed++; console.error('  FAIL ', label); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(50); }
  return false;
}

interface P { x: number; y: number; anim: string; userId: string }
const selfOf = (room: Room): P | undefined =>
  (room.state as { players: { get: (k: string) => P | undefined } }).players.get(room.sessionId);
const sizeOf = (room: Room): number =>
  (room.state as { players: { size: number } }).players.size;

/** frontend/lib/realtime.ts의 walker와 동일: 서버 권위 위치→목적지로 작은 스텝 스트리밍. */
function attachWalker(room: Room): { moveTo: (x: number, y: number) => void; stop: () => void } {
  let seq = 0;
  let dest: { x: number; y: number } | null = null;
  const timer = setInterval(() => {
    if (!dest) return;
    const self = selfOf(room);
    if (!self) return;
    const dx = dest.x - self.x, dy = dest.y - self.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) { dest = null; return; }
    const step = Math.min(d, 0.09);
    room.send('move_request', { target: { x: self.x + (dx / d) * step, y: self.y + (dy / d) * step }, seq: ++seq });
  }, 100);
  return { moveTo: (x, y) => { dest = { x, y }; }, stop: () => clearInterval(timer) };
}

async function main(): Promise<void> {
  const gameServer = new Server({ transport: new WebSocketTransport({ server: createServer() }) });
  gameServer.define('office', OfficeRoom).filterBy(['officeId', 'floorId']);
  await gameServer.listen(PORT);
  console.log(`[test] in-process server on ws://localhost:${PORT}`);

  // 1) client 1 접속
  const c1 = new Client(`ws://localhost:${PORT}`);
  const room = await c1.joinOrCreate('office', { userId: 'u1', name: 'Alice', officeId: 'office-demo', floorId: 'floor-1' });
  const walker = attachWalker(room);
  const okSelf = await waitFor(() => !!selfOf(room));
  assert(okSelf, 'client1 joined & self player present');
  const self0 = selfOf(room)!;
  const start = { x: self0.x, y: self0.y };
  assert(Math.abs(start.x - 10) < 0.05 && Math.abs(start.y - 7.5) < 0.05, `spawn at floor centre (got ${start.x.toFixed(2)},${start.y.toFixed(2)})`);

  // 2) 먼 목적지로 걷기 — walker 스텝 스트리밍이 서버 위치를 전진시켜야 함
  walker.moveTo(14, 11);
  let sawWalk = false;
  const moved = await waitFor(() => {
    const p = selfOf(room)!;
    if (p.anim === 'walk') sawWalk = true; // 이동 창 어느 샘플에서든 walk 관측(스트리밍상 walk↔idle 오감)
    return Math.hypot(p.x - start.x, p.y - start.y) > 1.0;
  }, 5000);
  const p1 = selfOf(room)!;
  assert(moved, `avatar walked toward dest (moved ${Math.hypot(p1.x - start.x, p1.y - start.y).toFixed(2)}m → ${p1.x.toFixed(2)},${p1.y.toFixed(2)})`);
  assert(sawWalk, 'server set anim=walk during movement');

  // 3) client 2 접속 → 로스터 증가, 상호 가시
  const c2 = new Client(`ws://localhost:${PORT}`);
  const room2 = await c2.joinOrCreate('office', { userId: 'u2', name: 'Bob', officeId: 'office-demo', floorId: 'floor-1' });
  const sees2 = await waitFor(() => sizeOf(room) >= 2, 3000);
  assert(sees2, `client1 sees 2 players (size=${sizeOf(room)})`);

  // 4) client 2 leave → 로스터 감소
  await room2.leave(true);
  const back1 = await waitFor(() => sizeOf(room) === 1, 5000);
  assert(back1, `roster shrinks after client2 leave (size=${sizeOf(room)})`);

  // 5) onAuth: 유효 JWT → 토큰 sub로 identity (client가 준 userId 무시 = 위조 방지)
  const token = jwt.sign({ sub: '777', email: 'z@x.com' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const c3 = new Client(`ws://localhost:${PORT}`);
  const room3 = await c3.joinOrCreate('office', { userId: 'SPOOFED', name: 'Z', officeId: 'office-demo', floorId: 'floor-1', jwt: token });
  await waitFor(() => !!selfOf(room3));
  assert(selfOf(room3)!.userId === '777', `valid JWT → userId from token sub, spoof ignored (got ${selfOf(room3)!.userId})`);
  await room3.leave(true);

  // 6) onAuth: 위조 JWT → join 거부
  let rejected = false;
  try {
    const cbad = new Client(`ws://localhost:${PORT}`);
    await cbad.joinOrCreate('office', { userId: 'x', officeId: 'office-demo', floorId: 'floor-1', jwt: 'bad.token.value' });
  } catch { rejected = true; }
  assert(rejected, 'invalid JWT → join rejected');

  walker.stop();
  await room.leave(true);
  await sleep(200); // 소켓 close 핸들러 정착(Windows libuv 종료 레이스 회피)
  await gameServer.gracefullyShutdown(false);
  await sleep(200);
  console.log(`\n=== client-smoke: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
