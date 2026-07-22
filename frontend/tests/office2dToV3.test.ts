import { describe, it, expect } from 'vitest';
import { buildV3Layout } from '../lib/office2dToV3';
import { SCENE_W_M, SCENE_H_M, metersToNorm } from '../lib/office2d';

/** seed_seats.py와 동일 앵커(정규) — 좌석 정합 검증용. */
const SEAT_ANCHORS_NORM: Record<string, { x: number; y: number }> = {
  'WS-A1': { x: 0.3993, y: 0.4662 },
  'WS-A2': { x: 0.4542, y: 0.515 },
  'WS-A3': { x: 0.3429, y: 0.5163 },
  'WS-A4': { x: 0.3978, y: 0.5651 },
  'WS-B1': { x: 0.4542, y: 0.6559 },
  'WS-B2': { x: 0.5092, y: 0.7047 },
  'WS-B3': { x: 0.3978, y: 0.706 },
  'WS-B4': { x: 0.4527, y: 0.7548 },
};
function clusterCentroidM(prefix: string): { x: number; y: number } {
  const pts = Object.entries(SEAT_ANCHORS_NORM)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, n]) => ({ x: n.x * SCENE_W_M, y: n.y * SCENE_H_M }));
  const c = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: c.x / pts.length, y: c.y / pts.length };
}

describe('buildV3Layout (office2d → v3 어댑터)', () => {
  const L = buildV3Layout();

  it('world는 office2d 좌표 계약(SCENE_W_M × SCENE_H_M)과 일치', () => {
    expect(L.world.w).toBeCloseTo(SCENE_W_M, 6);
    expect(L.world.h).toBeCloseTo(SCENE_H_M, 6);
  });

  it('room은 벽 여유를 둔 월드 내부 사각형', () => {
    expect(L.room.x).toBeGreaterThan(0);
    expect(L.room.y).toBeGreaterThan(0);
    expect(L.room.x + L.room.w).toBeLessThan(L.world.w);
    expect(L.room.y + L.room.h).toBeLessThan(L.world.h);
  });

  it('people 레이어는 항상 비어 있다(실아바타는 Colyseus)', () => {
    expect(L.people).toEqual([]);
  });

  it('워크벤치 2개가 실제 좌석 클러스터 중심에 놓여 좌석 마커와 정합', () => {
    const benches = L.furniture.filter((f) => f.t === 'bench4');
    expect(benches).toHaveLength(2);
    const A = clusterCentroidM('WS-A');
    const B = clusterCentroidM('WS-B');
    const near = (b: { x: number; y: number }, c: { x: number; y: number }) =>
      Math.hypot(b.x - c.x, b.y - c.y) < 0.01;
    expect(benches.some((b) => near(b, A))).toBe(true);
    expect(benches.some((b) => near(b, B))).toBe(true);
  });

  it('벤치 중심의 정규 좌표가 좌석 앵커 정규 좌표와 정합(metersToNorm 일치)', () => {
    const benches = L.furniture.filter((f) => f.t === 'bench4');
    const A = clusterCentroidM('WS-A');
    const bench = benches.find((b) => Math.hypot(b.x - A.x, b.y - A.y) < 0.01)!;
    const nBench = metersToNorm({ x: bench.x, y: bench.y });
    // WS-A 앵커들의 정규 중심과 벤치 정규 중심이 같아야 함(좌석 위 데스크).
    const anchorsN = Object.entries(SEAT_ANCHORS_NORM)
      .filter(([k]) => k.startsWith('WS-A'))
      .map(([, n]) => n);
    const nAnchor = anchorsN.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    nAnchor.x /= anchorsN.length;
    nAnchor.y /= anchorsN.length;
    expect(nBench.x).toBeCloseTo(nAnchor.x, 4);
    expect(nBench.y).toBeCloseTo(nAnchor.y, 4);
  });

  it('회의 존은 유리·카펫, 팬트리 존은 타일 바닥', () => {
    const meeting = L.zones.find((z) => z.kind === 'meeting');
    const pantry = L.zones.find((z) => z.kind === 'pantry');
    expect(meeting?.floor).toBe('carpet');
    expect(meeting?.glass?.length).toBeGreaterThan(0);
    expect(pantry?.floor).toBe('tile');
  });

  it('핵심 v3 가구 타입이 모두 렌더러가 지원하는 타입', () => {
    // horizon-scene-v3.js PAINT 디스패치가 아는 타입만 사용(오탈자 방어).
    const SUPPORTED = new Set([
      'rug', 'plant', 'trough', 'pebbles', 'rocks', 'bench4', 'meetingTable', 'diningTable',
      'cafeTable', 'sofa', 'tubChair', 'pouf', 'coffeeTable', 'sideTable', 'lamp', 'counter',
      'fridge', 'waterCooler', 'credenza', 'console', 'tv', 'booth', 'doormat',
      'whiteboard', 'art', 'bookshelf', 'printer', 'coatrack', 'sign', 'shelf', 'chair',
    ]);
    for (const f of L.furniture) expect(SUPPORTED.has(f.t)).toBe(true);
  });

  it('모든 가구가 월드 경계 안에 있다', () => {
    for (const f of L.furniture) {
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x).toBeLessThanOrEqual(L.world.w);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeLessThanOrEqual(L.world.h);
    }
  });
});
