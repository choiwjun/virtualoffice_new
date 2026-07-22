import { describe, it, expect, afterEach } from 'vitest';
import {
  ROOMS,
  SPAWNS,
  SCENE_W_M,
  SCENE_H_M,
  normToMeters,
  metersToNorm,
  findPath,
  isWalkable,
  clampToWalkable,
  setActiveFloorGeometry,
  pointInPolygon,
  typingBurstAt,
  type Vec2,
} from '../lib/office2d';

describe('coordinate transforms', () => {
  it('normToMeters/metersToNorm roundtrip', () => {
    const p: Vec2 = { x: 0.42, y: 0.63 };
    const back = metersToNorm(normToMeters(p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it('normToMeters scales by scene dimensions', () => {
    const m = normToMeters({ x: 1, y: 1 });
    expect(m.x).toBeCloseTo(SCENE_W_M, 6);
    expect(m.y).toBeCloseTo(SCENE_H_M, 6);
  });
});

describe('typingBurstAt (착석 타건 버스트 — D35 배지 모션 게이트)', () => {
  it('같은 userId·같은 시각이면 결정적(모든 클라이언트 동일 위상)', () => {
    const t = 1_700_000_000_000;
    expect(typingBurstAt('1001', t)).toBe(typingBurstAt('1001', t));
  });

  it('사이클(9.5s) 안에 on/off 구간이 모두 존재한다', () => {
    const base = 1_700_000_000_000;
    const seen = new Set<boolean>();
    for (let s = 0; s < 10; s++) seen.add(typingBurstAt('1001', base + s * 1000));
    // 사이클 9.5s에 on 4s — 1초 간격 10샘플이면 on·off 둘 다 관측된다.
    expect(seen.has(true)).toBe(true);
    expect(seen.has(false)).toBe(true);
  });
});

describe('geometry helpers', () => {
  const square: Vec2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it('pointInPolygon: inside vs outside', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, square)).toBe(false);
  });

  it('isWalkable: spawn is walkable, far point is not', () => {
    expect(isWalkable(SPAWNS.lobby)).toBe(true);
    expect(isWalkable({ x: 1.5, y: 1.5 })).toBe(false);
  });

  it('clampToWalkable returns a walkable point', () => {
    const clamped = clampToWalkable({ x: 1.5, y: 1.5 }); // 씬 밖 클릭
    expect(isWalkable(clamped)).toBe(true);
  });
});

describe('findPath (그리드 A*)', () => {
  /** 방 폴리곤 안에서 보행 가능한 첫 지점(정규) 탐색 — 실제 클릭 가능한 실내 지점. */
  function walkableInside(roomId: string): Vec2 {
    const room = ROOMS.find((r) => r.id === roomId);
    if (!room) throw new Error(`room ${roomId} not found`);
    for (let y = 0.4; y < 0.95; y += 0.008) {
      for (let x = 0.4; x < 0.95; x += 0.008) {
        const p = { x, y };
        if (pointInPolygon(p, room.polygon) && isWalkable(p)) return p;
      }
    }
    throw new Error(`no walkable point inside ${roomId}`);
  }

  it('로비 스폰 → 보드룸 내부: 유리벽을 우회하는 다중 경유지 경로', () => {
    const from = normToMeters(SPAWNS.lobby);
    const to = normToMeters(walkableInside('boardroom'));
    const path = findPath(from, to);
    expect(path.length).toBeGreaterThan(1); // 직선 불가 → 문 개구부 경유
    for (const wp of path) expect(isWalkable(metersToNorm(wp))).toBe(true);
    const last = path[path.length - 1];
    expect(Math.hypot(last.x - to.x, last.y - to.y)).toBeLessThan(0.2);
  });

  it('로비 스폰 → 글라스 미팅룸 내부: 경로 존재', () => {
    const from = normToMeters(SPAWNS.lobby);
    const to = normToMeters(walkableInside('meeting-a'));
    const path = findPath(from, to);
    expect(path.length).toBeGreaterThan(1);
    const last = path[path.length - 1];
    expect(Math.hypot(last.x - to.x, last.y - to.y)).toBeLessThan(0.2);
  });
});

describe('setActiveFloorGeometry (배포 레이아웃 이동 지오메트리)', () => {
  // 배포 bounds 사각형(정규 0~0.6 × 0~0.9) + 세로 벽(x≈0.30~0.34, y0.10~0.80).
  const bounds: Vec2[] = [
    { x: 0, y: 0 },
    { x: 0.6, y: 0 },
    { x: 0.6, y: 0.9 },
    { x: 0, y: 0.9 },
  ];
  const wall: Vec2[] = [
    { x: 0.30, y: 0.10 },
    { x: 0.34, y: 0.10 },
    { x: 0.34, y: 0.80 },
    { x: 0.30, y: 0.80 },
  ];

  afterEach(() => setActiveFloorGeometry(null)); // 다른 테스트에 새지 않게 HORIZON 복원

  it('교체하면 isWalkable이 배포 경계·벽을 따른다', () => {
    setActiveFloorGeometry({ walkArea: bounds, obstacles: [wall] });
    expect(isWalkable({ x: 0.5, y: 0.5 })).toBe(true); // bounds 안, 벽 밖
    expect(isWalkable({ x: 0.32, y: 0.5 })).toBe(false); // 벽 내부 → 차단
    expect(isWalkable({ x: 0.8, y: 0.5 })).toBe(false); // bounds 밖
  });

  it('null 복원 시 HORIZON 기본으로 돌아온다', () => {
    setActiveFloorGeometry({ walkArea: bounds, obstacles: [wall] });
    setActiveFloorGeometry(null);
    expect(isWalkable(SPAWNS.lobby)).toBe(true); // 씬 스폰 다시 보행 가능
    expect(isWalkable({ x: 0.8, y: 0.5 })).toBe(false); // HORIZON에서도 이 점은 벽/경계 밖
  });

  it('findPath가 배포 벽을 우회한다(경로가 벽을 통과하지 않음)', () => {
    setActiveFloorGeometry({ walkArea: bounds, obstacles: [wall] });
    const from = normToMeters({ x: 0.15, y: 0.5 }); // 벽 왼쪽
    const to = normToMeters({ x: 0.5, y: 0.5 }); // 벽 오른쪽
    const path = findPath(from, to);
    expect(path.length).toBeGreaterThan(1); // 직선 불가 → 상/하단 개구부 우회
    for (const wp of path) expect(isWalkable(metersToNorm(wp))).toBe(true);
    const last = path[path.length - 1];
    expect(Math.hypot(last.x - to.x, last.y - to.y)).toBeLessThan(0.3);
  });
});
