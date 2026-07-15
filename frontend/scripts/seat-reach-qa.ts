/* 좌석 도달성 QA: 모든 좌석 앵커에 대해 nearestWalkableM → findPath 종점 거리를 검사.
 * 실행: npx tsx scripts/seat-reach-qa.ts (frontend/) */
import { findPath, isWalkable, nearestWalkableM, normToMeters, SPAWNS } from '../lib/office2d';
import * as fs from 'fs';
import * as path from 'path';

const layout = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../tools/asset-gen/out/layout.json'), 'utf-8'),
);

const start = normToMeters(SPAWNS.lobby);
let fail = 0;
for (const s of layout.seats ?? []) {
  const anchor = normToMeters({ x: s.x, y: s.y }); // layout.json 좌석은 정규화 좌표
  const walkable = isWalkable(anchor);
  const goal = nearestWalkableM(anchor);
  const goalDist = Math.hypot(goal.x - anchor.x, goal.y - anchor.y);
  const p = findPath(start, goal);
  const end = p[p.length - 1];
  const endDist = Math.hypot(end.x - anchor.x, end.y - anchor.y);
  const ok = endDist <= 1.0; // SEAT_SNAP_M
  if (!ok) fail++;
  console.log(
    `${s.id}\tanchorWalkable=${walkable}\tgoalDist=${goalDist.toFixed(3)}\tpathEndDist=${endDist.toFixed(3)}\twaypoints=${p.length}\t${ok ? 'OK' : '★FAIL'}`,
  );
}
console.log(fail === 0 ? 'ALL SEATS REACHABLE' : `${fail} seats UNREACHABLE within snap radius`);
process.exit(fail === 0 ? 0 : 1);
