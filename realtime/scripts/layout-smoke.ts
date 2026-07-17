/**
 * layout-smoke.ts — HttpFloorLayoutProvider 검증 (mock 백엔드).
 *   1) fetch 성공 → 반환 레이아웃 사용 + 내부 토큰 헤더 전송
 *   2) 404(미배포) → 데모 층 폴백(이동서버 계속 동작)
 *   3) 팩토리: URL 없으면 데모 / URL+SCENE_FLOOR=horizon → 404 폴백도 HORIZON(지오메트리 불일치 방지)
 * (백엔드 매핑 정확성은 test_realtime_layout.py. 여기선 provider의 fetch/fallback 계약.)
 *
 * 실행:  cd realtime && npx tsx scripts/layout-smoke.ts
 */
import { createServer } from 'http';
import { HttpFloorLayoutProvider, createFloorLayoutProvider } from '../src/integration/FloorLayoutProvider';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log('  PASS ', label); }
  else { failed++; console.error('  FAIL ', label); }
}

async function main(): Promise<void> {
  let mode: 'ok' | '404' = 'ok';
  let capturedAuth: string | undefined;
  const okLayout = {
    officeId: 'o', floorId: 'f',
    bounds: { x: 0, y: 0, w: 30, h: 20 },
    walls: [], seats: [{ seatId: 'S1', x: 1, y: 2, type: 'fixed' }],
    meetingZones: [{ roomId: 'R1', bounds: { x: 1, y: 1, w: 2, h: 2 }, capacity: 4 }],
  };
  const server = createServer((req, res) => {
    capturedAuth = req.headers['authorization'];
    if (mode === '404') { res.writeHead(404); res.end('none'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(okLayout));
  });
  await new Promise<void>((r) => server.listen(2604, r));

  const provider = new HttpFloorLayoutProvider('http://localhost:2604', 'tok');

  mode = 'ok';
  const l1 = await provider.getLayout('o', 'f');
  assert(l1.bounds.w === 30 && l1.seats.length === 1, `http provider returns fetched layout (w=${l1.bounds.w})`);
  assert(capturedAuth === 'Bearer tok', `sends internal token header (got ${capturedAuth})`);

  mode = '404';
  const l2 = await provider.getLayout('o', 'f');
  assert(l2.bounds.w === 20 && l2.bounds.h === 15, `404 → demo fallback (w=${l2.bounds.w},h=${l2.bounds.h})`);

  const demo = createFloorLayoutProvider('', '');
  const l3 = await demo.getLayout('o', 'f');
  assert(l3.bounds.w === 20, 'factory: empty url → demo provider');

  const withScene = createFloorLayoutProvider('http://localhost:2604', 'tok', 'horizon');
  mode = '404';
  const l4 = await withScene.getLayout('o', 'f');
  assert(l4.meetingZones.some((z) => z.roomId === 'boardroom'), `factory: url+horizon → 404 폴백 = HORIZON scene (zones=${l4.meetingZones.map((z) => z.roomId).join(',')})`);

  await new Promise<void>((r) => server.close(() => r()));
  console.log(`\n=== layout-smoke: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
