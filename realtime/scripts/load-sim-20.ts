/**
 * load-sim-20.ts — P7-T4 20명 동시접속 부하 시뮬레이션 (01-prd §7, D22).
 *
 * 무엇을 측정하나:
 *   - 실제 Colyseus 서버(인프로세스, 실 WebSocket 전송)에 20 클라이언트 동시 접속
 *   - 18 봇: 100ms 주기 소보폭(0.08m) move_request (≈0.8 m/s — 속도검증 통과 부하)
 *   - 1 프로버: 소보폭 버스트(0.07m×8) 왕복 홉 / 1 관찰자: 프로버 위치 변화를 10ms 폴링
 *   - 실측 2026-07-13: 20/20 유지, 표본 25/25, p50=72ms p95=131ms max=140ms → PASS
 *   - E2E 지연 = 프로버 move_request 송신 → 관찰자 상태에 위치 변화 관측
 *   - 판정: p95 < 500ms (D22), 20/20 접속 유지
 *
 * 한계(정직 기록): 동일 호스트 인프로세스라 네트워크 RTT는 미포함 — 서버 tick·
 * 브로드캐스트·직렬화 경로의 상한 검증. 실배포 환경 실측은 별도(외부 게이트).
 *
 * Run: npx tsx scripts/load-sim-20.ts   (백엔드/외부 의존 없음 — JWT_REQUIRED=false 기본)
 */

import { createServer } from 'http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, Room } from 'colyseus.js';
import { OfficeRoom } from '../src/rooms/OfficeRoom';

const PORT = 2599;
const N_CLIENTS = 20;
// 서버 속도검증: 첫 move는 dt=0.05s 가정 → 허용 ≈ 1.4×0.05×1.5 = 0.105m.
// 실클라이언트(뷰포트)처럼 소보폭 연속 전송 패턴을 쓴다.
const BOT_STEP_M = 0.08; // 100ms 주기 ≈ 0.8 m/s, 첫 move 캡(0.105m)도 통과
const BOT_PERIOD_MS = 100;
const PROBE_STEP_M = 0.07;
const PROBE_STEPS = 8; // 홉 총거리 ≈ 0.56m (소보폭 버스트)
const PROBE_STEP_MS = 80;
const PROBE_SETTLE_MS = 1200;
const PROBE_COUNT = 25;
const OBSERVE_POLL_MS = 10;
const MOVE_EPS = 0.02;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Pos = { userId: string; x: number; y: number };

function selfOf(room: Room): Pos {
  const p = (room.state as any).players.get(room.sessionId);
  return { userId: String(p.userId), x: Number(p.x), y: Number(p.y) };
}

function findByUserId(room: Room, userId: string): Pos | null {
  let found: Pos | null = null;
  (room.state as any).players.forEach((p: any) => {
    if (String(p.userId) === userId) found = { userId, x: Number(p.x), y: Number(p.y) };
  });
  return found;
}

function pctl(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  // ── 서버 부트 (인프로세스, 실 ws 전송) ──
  const gameServer = new Server({ transport: new WebSocketTransport({ server: createServer() }) });
  gameServer.define('office', OfficeRoom).filterBy(['officeId', 'floorId']);
  await gameServer.listen(PORT);
  console.log(`[load-sim] server up on :${PORT}`);

  const rooms: Room[] = [];
  const t0 = Date.now();
  for (let i = 0; i < N_CLIENTS; i++) {
    const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('office', {
      officeId: 'office-demo',
      floorId: 'floor-1',
      name: `bot-${i + 1}`,
    });
    room.onMessage('*', () => {}); // 미등록 핸들러 경고 억제
    rooms.push(room);
  }
  console.log(`[load-sim] ${rooms.length}/${N_CLIENTS} clients joined in ${Date.now() - t0}ms`);
  await sleep(800); // 초기 스냅샷 안정화

  // ── 역할 배정: [0]=프로버, [1]=관찰자, 나머지 18=배경 부하 봇 ──
  const prober = rooms[0];
  const observer = rooms[1];
  const bots = rooms.slice(2);
  const proberUid = selfOf(prober).userId;

  // 배경 봇: 소보폭 랜덤 워크 (검증 8항목 통과 범위 내)
  let botSeq = 0;
  const botTimer = setInterval(() => {
    botSeq++;
    for (const b of bots) {
      const s = (b.state as any).players.get(b.sessionId);
      if (!s) continue;
      const ang = Math.random() * Math.PI * 2;
      b.send('move_request', {
        target: { x: Number(s.x) + Math.cos(ang) * BOT_STEP_M, y: Number(s.y) + Math.sin(ang) * BOT_STEP_M },
        seq: botSeq,
      });
    }
  }, BOT_PERIOD_MS);

  let rejected = 0;
  prober.onMessage('move_rejected', () => {
    rejected++;
  });

  // 프로버 홉 → 관찰자 관측 지연 수집
  const latencies: number[] = [];
  let dir = 1;
  for (let hop = 0; hop < PROBE_COUNT; hop++) {
    const me = selfOf(prober);
    const obsStart = findByUserId(observer, proberUid); // 관찰자 시점의 홉 직전 위치
    if (!obsStart) {
      await sleep(PROBE_SETTLE_MS);
      continue;
    }

    const sendAt = Date.now();
    // 소보폭 버스트(실클라이언트 패턴) — 지연은 '첫 송신 → 관찰자 첫 관측'
    void (async () => {
      for (let s = 1; s <= PROBE_STEPS; s++) {
        prober.send('move_request', {
          target: { x: me.x + PROBE_STEP_M * s * dir, y: me.y },
          seq: 10_000 + hop * PROBE_STEPS + s,
        });
        await sleep(PROBE_STEP_MS);
      }
    })();
    dir = -dir; // 왕복 — 경계 이탈 방지

    const deadline = sendAt + 3_000;
    let observedAt: number | null = null;
    while (Date.now() < deadline) {
      const seen = findByUserId(observer, proberUid);
      if (seen && Math.hypot(seen.x - obsStart.x, seen.y - obsStart.y) > MOVE_EPS) {
        observedAt = Date.now();
        break;
      }
      await sleep(OBSERVE_POLL_MS);
    }
    if (observedAt !== null) latencies.push(observedAt - sendAt);
    await sleep(PROBE_SETTLE_MS); // 위치 안정화 후 다음 홉
  }

  clearInterval(botTimer);

  // ── 리포트 ──
  const alive = rooms.filter((r) => (r.connection as any)?.isOpen !== false).length;
  latencies.sort((a, b) => a - b);
  const p50 = pctl(latencies, 0.5);
  const p95 = pctl(latencies, 0.95);
  const max = latencies[latencies.length - 1] ?? NaN;

  console.log('\n===== load-sim-20 결과 (P7-T4 / D22) =====');
  console.log(`접속 유지: ${alive}/${N_CLIENTS}`);
  console.log(`프로버 표본: ${latencies.length}/${PROBE_COUNT} (move_rejected ${rejected}건)`);
  console.log(`E2E(송신→원격 관측) p50=${p50}ms p95=${p95}ms max=${max}ms`);
  const pass = alive === N_CLIENTS && latencies.length >= PROBE_COUNT * 0.8 && p95 < 500;
  console.log(pass ? 'PASS  20명 동시접속 + p95 < 500ms (D22)' : 'FAIL  기준 미달');

  for (const r of rooms) r.leave();
  await gameServer.gracefullyShutdown(false).catch(() => {});
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
