import { Client } from 'colyseus.js';
const BACKEND = 'http://127.0.0.1:8000';
const RT = 'ws://127.0.0.1:2567';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function login(email: string): Promise<string> {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}
const join = (tok: string) => new Client(RT).joinOrCreate('office', {
  officeId: 'office-demo', floorId: 'floor-1', jwt: tok,
});

async function main() {
  const [tokA, tokB] = await Promise.all([login('alice@virtualoffice.local'), login('bob@virtualoffice.local')]);
  const roomA = await join(tokA);
  await sleep(400);
  const roomB = await join(tokB);
  await sleep(800);
  type P = { userId: string; name?: string; x: number; y: number };
  const playersOf = (r: any): P[] => { const out: P[] = []; r.state.players.forEach((p: P) => out.push(p)); return out; };
  const a = playersOf(roomA); const b = playersOf(roomB);
  console.log('alice가 보는 players:', a.map(p => `${p.userId}(${p.name})`));
  console.log('bob이 보는 players:', b.map(p => `${p.userId}(${p.name})`));
  console.log(a.some(p => String(p.userId) === '1002') ? 'PASS alice 화면에 bob 아바타' : 'FAIL alice가 bob 못봄');
  console.log(b.some(p => String(p.userId) === '1001') ? 'PASS bob 화면에 alice 아바타' : 'FAIL bob이 alice 못봄');
  // bob 이동 → alice 뷰에 반영
  const bobSelf = (roomB.state as any).players.get(roomB.sessionId);
  const before = { x: bobSelf.x, y: bobSelf.y };
  for (let i = 0; i < 12; i++) {
    const s = (roomB.state as any).players.get(roomB.sessionId);
    roomB.send('move_request', { target: { x: s.x + 0.05, y: s.y + 0.05 }, seq: i + 1 });
    await sleep(90);
  }
  await sleep(400);
  const bobInA = playersOf(roomA).find(p => String(p.userId) === '1002')!;
  const moved = Math.hypot(bobInA.x - before.x, bobInA.y - before.y);
  console.log(moved > 0.3 ? `PASS bob 이동이 alice 화면에 동기화 (${moved.toFixed(2)}m)` : `FAIL 이동 미동기화 (${moved.toFixed(2)}m)`);
  roomA.leave(); roomB.leave();
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
