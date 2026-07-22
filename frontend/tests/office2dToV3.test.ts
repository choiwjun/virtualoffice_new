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

  it('워크벤치 3개(10인 재설계)가 officeV3.BENCHES 위치에 놓임', () => {
    const benches = L.furniture.filter((f) => f.t === 'bench4');
    expect(benches).toHaveLength(BENCHES.length);
    for (const b of BENCHES) {
      expect(
        benches.some((f) => Math.hypot((f.x as number) - b.x, (f.y as number) - b.y) < 1e-6),
      ).toBe(true);
    }
  });

  it('벤치들끼리 데스크 footprint(2.9×1.5)가 겹치지 않는다', () => {
    for (let i = 0; i < BENCHES.length; i++) {
      for (let j = i + 1; j < BENCHES.length; j++) {
        const a = BENCHES[i];
        const b = BENCHES[j];
        const apart =
          Math.abs(a.x - b.x) >= 2.9 || Math.abs(a.y - b.y) >= 1.5;
        expect(apart, `${a.cluster}↔${b.cluster}`).toBe(true);
      }
    }
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

  it('좌석점 12개(벤치 3 파생) — WS-A·B 유지 + WS-C 신설(활성 10석은 시드에서 결정)', () => {
    expect(V3_SEATS.map((s) => s.seatNumber).sort()).toEqual([
      'WS-A1', 'WS-A2', 'WS-A3', 'WS-A4',
      'WS-B1', 'WS-B2', 'WS-B3', 'WS-B4',
      'WS-C1', 'WS-C2', 'WS-C3', 'WS-C4',
    ]);
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
