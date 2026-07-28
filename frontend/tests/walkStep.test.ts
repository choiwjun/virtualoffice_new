import { describe, it, expect } from 'vitest';
import { walkStepDist, MAX_SPEED_MPS, MAX_STEP_DIST } from '../lib/realtime';

/**
 * 서버(realtime)의 속도 검사: `dist <= MAX_SPEED_MPS * dt * SPEED_TOLERANCE`,
 * 여기서 dt는 **도착 간격**이고 tolerance = 1.5.
 *
 * 고정 0.07m/50ms는 정확히 1.4m/s = 상한이라 여유가 0이었다 — 통과 조건이 dt >= 33ms라
 * setInterval이 조금만 당겨져도(실측 14~33ms) 거부됐다.
 */
const SPEED_TOLERANCE = 1.5;
const serverCap = (dtMs: number) => (MAX_SPEED_MPS * dtMs * SPEED_TOLERANCE) / 1000;

describe('walkStepDist — 보폭을 흐른 시간으로 재단', () => {
  it('정속 케이던스(50ms)에서는 기존과 같은 보폭', () => {
    expect(walkStepDist(50)).toBeCloseTo(MAX_STEP_DIST, 6);
  });

  it('고정 보폭이 거부되던 구간(dt < 33.3ms)에서 재단된 보폭은 통과한다', () => {
    // 실측 거부 로그: dt=14·20·27·30·33ms. 통과 조건이 dt >= 0.07/(1.4·1.5) = 33.3ms였다.
    for (const dtMs of [14, 20, 27, 30, 33]) {
      expect(MAX_STEP_DIST, `고정 보폭은 ${dtMs}ms에서 거부됐다`).toBeGreaterThan(serverCap(dtMs));
      expect(walkStepDist(dtMs), `${dtMs}ms`).toBeLessThanOrEqual(serverCap(dtMs) + 1e-9);
    }
  });

  it('어떤 간격에서도 서버 예산을 넘지 않는다', () => {
    for (const dtMs of [1, 5, 14, 33, 40, 50, 80, 200]) {
      expect(walkStepDist(dtMs), `${dtMs}ms`).toBeLessThanOrEqual(serverCap(dtMs) + 1e-9);
    }
  });

  it('느려져도 최대 보폭을 넘지 않는다 — 요청 하나로 순간이동하지 않게', () => {
    expect(walkStepDist(500)).toBe(MAX_STEP_DIST);
    expect(walkStepDist(10_000)).toBe(MAX_STEP_DIST);
  });

  it('정속은 그대로 1.4m/s — 느려진 게 아니라 재단됐을 뿐', () => {
    const total = [50, 50, 50, 50].reduce((sum, ms) => sum + walkStepDist(ms), 0);
    expect(total / 0.2).toBeCloseTo(MAX_SPEED_MPS, 6); // 0.2초 동안 간 거리 ÷ 시간
  });

  it('첫 스텝(elapsed 없음)은 최대 보폭 — 서버 dt 기본값 0.05s의 예산 0.105m 안', () => {
    expect(walkStepDist(0)).toBe(MAX_STEP_DIST);
    expect(walkStepDist(Number.NaN)).toBe(MAX_STEP_DIST);
    expect(MAX_STEP_DIST).toBeLessThanOrEqual(serverCap(50));
  });

  it('네트워크 지터 여유가 생긴다 — 보낸 간격의 2/3만 되어도 통과', () => {
    const sendGap = 50;
    const arrival = sendGap * (2 / 3); // 33ms — 33% 압축까지 흡수
    expect(walkStepDist(sendGap)).toBeLessThanOrEqual(serverCap(arrival) + 1e-9);
  });
});
