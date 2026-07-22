/* 좌석 도달성 QA: 모든 좌석 앵커에 대해 nearestWalkableM → findPath 종점 거리를 검사.
 * 두 지오메트리를 검증한다:
 *   [legacy] layout.json(구 다이아 좌표) + HORIZON walkArea (기본 office2d 지오메트리)
 *   [v3]     officeV3.V3_SEATS(축정렬) + V3 walkArea/obstacles (setActiveFloorGeometry 주입)
 * 실행: npx tsx scripts/seat-reach-qa.ts (frontend/) */
import {
  findPath,
  isWalkable,
  metersToNorm,
  nearestWalkableM,
  normToMeters,
  setActiveFloorGeometry,
  SPAWNS,
  type Vec2,
} from '../lib/office2d';
import { V3_SEATS, V3_WALK_AREA, V3_OBSTACLES, V3_SPAWN_M } from '../lib/officeV3';
import * as fs from 'fs';
import * as path from 'path';

const SEAT_SNAP_M = 1.0;

interface Anchor {
  id: string;
  x: number;
  y: number;
}

/** 좌석 목록 + 시작점(미터)으로 도달성 검사. 반환 = 실패 수. */
function runSuite(name: string, seats: Anchor[], start: Vec2): number {
  console.log(`\n=== ${name} (seats ${seats.length}, start ${start.x.toFixed(2)},${start.y.toFixed(2)}) ===`);
  let fail = 0;
  for (const a of seats) {
    const anchor = { x: a.x, y: a.y };
    const walkable = isWalkable(metersToNorm(anchor)); // 앵커(좌석점)가 보행 가능 = 착석 지점
    const goal = nearestWalkableM(anchor);
    const goalDist = Math.hypot(goal.x - anchor.x, goal.y - anchor.y);
    const p = findPath(start, goal);
    const end = p[p.length - 1];
    const endDist = Math.hypot(end.x - anchor.x, end.y - anchor.y);
    const ok = endDist <= SEAT_SNAP_M;
    if (!ok) fail++;
    console.log(
      `${a.id}\tanchorWalkable=${walkable}\tgoalDist=${goalDist.toFixed(3)}\tpathEndDist=${endDist.toFixed(3)}\twaypoints=${p.length}\t${ok ? 'OK' : '★FAIL'}`,
    );
  }
  console.log(fail === 0 ? `  ALL SEATS REACHABLE (${name})` : `  ${fail} seats UNREACHABLE (${name})`);
  return fail;
}

let totalFail = 0;

// ── [legacy] layout.json(정규 좌표) × HORIZON 기본 지오메트리 ──
setActiveFloorGeometry(null); // HORIZON 복원
const layout = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../tools/asset-gen/out/layout.json'), 'utf-8'),
);
const legacySeats: Anchor[] = (layout.seats ?? []).map((s: { seatNumber?: string; x: number; y: number }) => {
  const m = normToMeters({ x: s.x, y: s.y });
  return { id: s.seatNumber ?? '?', x: m.x, y: m.y };
});
totalFail += runSuite('legacy (HORIZON diamond)', legacySeats, normToMeters(SPAWNS.lobby));

// ── [v3] officeV3 축정렬 좌석 × V3 지오메트리 ──
setActiveFloorGeometry({ walkArea: V3_WALK_AREA, obstacles: V3_OBSTACLES });
const v3Seats: Anchor[] = V3_SEATS.map((s) => ({ id: s.seatNumber, x: s.x, y: s.y }));
totalFail += runSuite('v3 (top-down axis-aligned)', v3Seats, { ...V3_SPAWN_M });

setActiveFloorGeometry(null); // 정리
console.log(totalFail === 0 ? '\nALL SUITES PASS' : `\n${totalFail} total unreachable`);
process.exit(totalFail === 0 ? 0 : 1);
