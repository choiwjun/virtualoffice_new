import { describe, it, expect } from 'vitest';
import { buildV3Layout } from '../lib/office2dToV3';
import { SCENE_W_M, SCENE_H_M, metersToNorm } from '../lib/office2d';
import { BENCHES, seatsForBench, V3_SEATS } from '../lib/officeV3';

describe('buildV3Layout (office2d → v3 어댑터, Phase 1b 탑다운)', () => {
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

  it('워크벤치 2개가 officeV3.BENCHES(축정렬 상하 2열) 위치에 놓임', () => {
    const benches = L.furniture.filter((f) => f.t === 'bench4');
    expect(benches).toHaveLength(2);
    for (const b of BENCHES) {
      expect(
        benches.some((f) => Math.hypot((f.x as number) - b.x, (f.y as number) - b.y) < 1e-6),
      ).toBe(true);
    }
  });

  it('두 벤치는 겹치지 않는다(데스크 footprint 2.9×1.5 분리)', () => {
    const [a, b] = BENCHES;
    // 상하 2열이므로 y 간격이 데스크 깊이(1.5)보다 커야 겹치지 않음.
    expect(Math.abs(a.y - b.y)).toBeGreaterThan(1.5);
  });

  it('벤치가 좌석 4점을 파생하고 정규 좌표가 벤치 데스크 위에 정렬(metersToNorm)', () => {
    const seatsA = seatsForBench(BENCHES[0]);
    expect(seatsA.map((s) => s.seatNumber)).toEqual(['WS-A1', 'WS-A2', 'WS-A3', 'WS-A4']);
    // 좌석은 벤치 중심에서 ±0.725(x)·±1.17(y) 오프셋(렌더러 bench4와 정합).
    for (const s of seatsA) {
      expect(Math.abs(Math.abs(s.x - BENCHES[0].x) - 0.725)).toBeLessThan(1e-9);
      expect(Math.abs(Math.abs(s.y - BENCHES[0].y) - 1.17)).toBeLessThan(1e-9);
      const n = metersToNorm({ x: s.x, y: s.y });
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(1);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(1);
    }
  });

  it('전 좌석 8개, id는 WS-A1~A4·WS-B1~B4 유지', () => {
    expect(V3_SEATS.map((s) => s.seatNumber).sort()).toEqual(
      ['WS-A1', 'WS-A2', 'WS-A3', 'WS-A4', 'WS-B1', 'WS-B2', 'WS-B3', 'WS-B4'],
    );
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
