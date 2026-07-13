import { describe, it, expect } from 'vitest';
import {
  CHARACTER_IDS,
  SPAWNS,
  SCENE_W_M,
  SCENE_H_M,
  normToMeters,
  metersToNorm,
  characterFor,
  characterForAvatar,
  isCharacterId,
  isWalkable,
  clampToWalkable,
  pointInPolygon,
  avatarHeightFrac,
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

describe('character assignment (#6)', () => {
  it('characterFor is deterministic and within the sprite set', () => {
    const a = characterFor('1001');
    const b = characterFor('1001');
    expect(a).toBe(b);
    expect(CHARACTER_IDS).toContain(a);
  });

  it('isCharacterId distinguishes valid sprite ids', () => {
    expect(isCharacterId(CHARACTER_IDS[0])).toBe(true);
    expect(isCharacterId('humanoid_a')).toBe(false); // 구 프리셋
    expect(isCharacterId(null)).toBe(false);
    expect(isCharacterId(undefined)).toBe(false);
  });

  it('characterForAvatar uses preset when it is a sprite id, else hash fallback', () => {
    const preset = CHARACTER_IDS[3];
    expect(characterForAvatar('999', preset)).toBe(preset); // 프리셋 우선
    expect(characterForAvatar('999', 'humanoid_b')).toBe(characterFor('999')); // 폴백
    expect(characterForAvatar('999', undefined)).toBe(characterFor('999'));
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

  it('avatarHeightFrac grows with depth (front bigger than back) and stays bounded', () => {
    const back = avatarHeightFrac(0.22, 'idle'); // 화면 위(멀리)
    const front = avatarHeightFrac(0.86, 'idle'); // 화면 아래(가까이)
    expect(front).toBeGreaterThan(back);
    expect(back).toBeGreaterThan(0.1);
    expect(front).toBeLessThan(0.2);
  });
});
