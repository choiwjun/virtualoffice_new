/**
 * presence-sink-smoke.ts — HttpPresenceSink가 FastAPI presence batch 계약(D3)대로
 * 요청하는지 검증. mock HTTP 서버로 수신 요청(path·method·auth·body)을 캡처해 단언한다.
 * (실 백엔드 불필요 — 서버간 write path의 요청 계약만 증명. 수신측은 test_presence_batch.py.)
 *
 * 실행:  cd realtime && npx tsx scripts/presence-sink-smoke.ts
 */
import { createServer } from 'http';
import { HttpPresenceSink } from '../src/integration/PresenceSink';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log('  PASS ', label); }
  else { failed++; console.error('  FAIL ', label); }
}

async function main(): Promise<void> {
  const captured: { path?: string; method?: string; auth?: string; body?: unknown } = {};
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      captured.path = req.url;
      captured.method = req.method;
      captured.auth = req.headers['authorization'];
      try { captured.body = JSON.parse(raw); } catch { captured.body = raw; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: 1, skipped: 0 }));
    });
  });
  await new Promise<void>((r) => server.listen(2603, r));

  const sink = new HttpPresenceSink('http://localhost:2603', 'test-internal-token');
  await sink.push([
    { userId: '1', officeId: 'office-demo', floorId: 'floor-1', x: 3, y: 4, status: 'working', seatId: '', timestamp: 123 },
  ]);
  // 이벤트 루프에서 요청 처리 완료 대기
  await new Promise<void>((r) => setTimeout(r, 100));

  assert(captured.path === '/api/presence/batch', `POST path (got ${captured.path})`);
  assert(captured.method === 'POST', `method POST (got ${captured.method})`);
  assert(captured.auth === 'Bearer test-internal-token', `internal token header (got ${captured.auth})`);
  const body = captured.body as { records?: Array<{ userId: string; status: string; x: number }> };
  assert(!!body?.records && body.records.length === 1, 'body has records[1]');
  assert(body.records?.[0].userId === '1' && body.records?.[0].status === 'working', 'record fields preserved');

  // 빈 배치는 요청 안 보냄
  captured.path = undefined;
  await sink.push([]);
  await new Promise<void>((r) => setTimeout(r, 50));
  assert(captured.path === undefined, 'empty batch → no request');

  await new Promise<void>((r) => server.close(() => r()));
  console.log(`\n=== presence-sink-smoke: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
