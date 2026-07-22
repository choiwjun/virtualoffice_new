import { describe, it, expect, afterEach } from 'vitest';
import {
  V3_SEATS,
  V3_WALK_AREA,
  V3_OBSTACLES,
  V3_ROOMS,
  V3_SPAWN_M,
  seatsForBench,
  BENCHES,
} from '../lib/officeV3';
import {
  SCENE_W_M,
  SCENE_H_M,
  isWalkable,
  metersToNorm,
  setActiveFloorGeometry,
  findPath,
  nearestWalkableM,
} from '../lib/office2d';

describe('officeV3 탑다운 지오메트리(축정렬 정본)', () => {
  afterEach(() => setActiveFloorGeometry(null)); // 다른 테스트로 누수 방지

  it('좌석 파생 오프셋이 렌더러 bench4와 정합(±0.725 x, ±1.17 y)', () => {
    const s = seatsForBench({ cluster: 'WS-A', x: 8.4, y: 5.3 });
    const xs = s.map((p) => p.x).sort();
    const ys = s.map((p) => p.y).sort();
    expect(xs[0]).toBeCloseTo(8.4 - 0.725, 9);
    expect(xs[3]).toBeCloseTo(8.4 + 0.725, 9);
    expect(ys[0]).toBeCloseTo(5.3 - 1.17, 9);
    expect(ys[3]).toBeCloseTo(5.3 + 1.17, 9);
  });

  it('모든 좌석이 월드 경계 안 + V3 보행영역 안(장애물 밖)이라 착석 가능', () => {
    setActiveFloorGeometry({ walkArea: V3_WALK_AREA, obstacles: V3_OBSTACLES });
    for (const s of V3_SEATS) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(SCENE_W_M);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(SCENE_H_M);
      // 좌석점 자체가 보행 가능해야(의자에 앉을 수 있어야) 함 — 데스크 footprint 밖.
      expect(isWalkable(metersToNorm({ x: s.x, y: s.y }))).toBe(true);
    }
  });

  it('주요 통로가 열려 있다 — 세로 통로 x≈8.1(A/B열↔C열) + 동측 통로 x≈12.6', () => {
    setActiveFloorGeometry({ walkArea: V3_WALK_AREA, obstacles: V3_OBSTACLES });
    for (const y of [4.6, 6.0, 7.3, 8.6, 9.8]) {
      expect(isWalkable(metersToNorm({ x: 8.1, y })), `세로 통로 (8.1,${y})`).toBe(true);
    }
    for (const y of [7.0, 8.2, 9.6]) {
      expect(isWalkable(metersToNorm({ x: 12.6, y })), `동측 통로 (12.6,${y})`).toBe(true);
    }
  });

  it('스폰이 보행 가능', () => {
    setActiveFloorGeometry({ walkArea: V3_WALK_AREA, obstacles: V3_OBSTACLES });
    expect(isWalkable(metersToNorm(V3_SPAWN_M))).toBe(true);
  });

  it('모든 좌석이 스폰에서 A* 경로로 도달 가능(snap 반경 1.0m 내)', () => {
    setActiveFloorGeometry({ walkArea: V3_WALK_AREA, obstacles: V3_OBSTACLES });
    const start = { ...V3_SPAWN_M };
    for (const s of V3_SEATS) {
      const goal = nearestWalkableM({ x: s.x, y: s.y });
      const path = findPath(start, goal);
      const end = path[path.length - 1];
      const dist = Math.hypot(end.x - s.x, end.y - s.y);
      expect(dist, `${s.seatNumber} pathEndDist`).toBeLessThanOrEqual(1.0);
    }
  });

  it('V3 방 id가 legacy·realtime 계약(boardroom/meeting-a 포함)과 일치', () => {
    const ids = V3_ROOMS.map((r) => r.id).sort();
    expect(ids).toEqual(
      ['boardroom', 'booth', 'cafe', 'lounge', 'meeting-a', 'pantry', 'reception'].sort(),
    );
    // 회의 근접 판정이 참조하는 두 방이 존재해야 함.
    expect(V3_ROOMS.some((r) => r.id === 'boardroom')).toBe(true);
    expect(V3_ROOMS.some((r) => r.id === 'meeting-a')).toBe(true);
  });

  it('BENCHES 좌석 파생 순서가 렌더러 seatDefs와 동일(1=좌상,2=우상,3=좌하,4=우하)', () => {
    const s = seatsForBench(BENCHES[0]);
    expect(s[0].x).toBeLessThan(BENCHES[0].x); // 좌
    expect(s[0].y).toBeLessThan(BENCHES[0].y); // 상
    expect(s[1].x).toBeGreaterThan(BENCHES[0].x); // 우
    expect(s[1].y).toBeLessThan(BENCHES[0].y); // 상
    expect(s[2].x).toBeLessThan(BENCHES[0].x); // 좌
    expect(s[2].y).toBeGreaterThan(BENCHES[0].y); // 하
    expect(s[3].x).toBeGreaterThan(BENCHES[0].x); // 우
    expect(s[3].y).toBeGreaterThan(BENCHES[0].y); // 하
  });
});
