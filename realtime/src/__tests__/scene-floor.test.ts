/**
 * scene-floor.test.ts — SceneFloorLayoutProvider(HORIZON 2.5D) 지오메트리 검증.
 *
 * 프론트 lib/office2d.ts와 동일한 좌표계(가로 20m, 세로 941/1672·20m)를 쓰는지,
 * 스폰(바운즈 중심)이 보행 폴리곤 안인지, 경계 밖 이동이 8검사에서 거부되는지 확인.
 *
 * Run with:  npm test  (room.smoke 뒤에 체인)
 */

import {
  SceneFloorLayoutProvider,
  HORIZON_OBSTACLES,
  HORIZON_SPAWN_N,
  SCENE_W_M,
  SCENE_H_M,
} from "../integration/FloorLayoutProvider";
import { validateMove, MovementContext, Mover } from "../validation/movement";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

async function main(): Promise<void> {
  console.log("scene-floor.test — SceneFloorLayoutProvider (HORIZON)");

  const layout = await new SceneFloorLayoutProvider().getLayout("office-demo", "floor-1");

  assert(SCENE_W_M === 20 && Math.abs(SCENE_H_M - (941 / 1672) * SCENE_W_M) < 1e-9, "좌표계: 가로 20m, 세로 = 941/1672 × 20m");
  const expectedWalls = 4 + HORIZON_OBSTACLES.reduce((s, ob) => s + ob.length, 0);
  assert(layout.walls.length === expectedWalls, `보행 폴리곤 4변 + 가구 폴리곤 변 전부 walls 등록 (${expectedWalls})`);
  assert(layout.seats.length === 0, "seats 비어 있음(아트 미납)");
  assert(layout.meetingZones.length === 2, "회의존 2개(boardroom + meeting-a) 등록");
  assert(layout.meetingZones.some((z) => z.roomId === "boardroom") && layout.meetingZones.some((z) => z.roomId === "meeting-a"), "boardroom·meeting-a roomId");

  // 스폰 = layout.spawn (로비 개활지; bounds 중심은 워크스테이션과 겹침)
  assert(!!layout.spawn, "layout.spawn 제공(로비)");
  const spawn = layout.spawn!;
  assert(Math.abs(spawn.x - HORIZON_SPAWN_N[0] * SCENE_W_M) < 1e-9 && Math.abs(spawn.y - HORIZON_SPAWN_N[1] * SCENE_H_M) < 1e-9, "스폰 = layout.json lobby");

  const mover: Mover = {
    userId: "u1",
    companyId: "c1",
    officeId: "office-demo",
    floorId: "floor-1",
    x: spawn.x,
    y: spawn.y,
    status: "online",
    seatId: "",
  };
  const baseCtx: Omit<MovementContext, "target"> = {
    mover,
    dtSeconds: 0.05,
    layout,
    room: { companyId: "c1", officeId: "office-demo", floorId: "floor-1" },
    seatOccupancy: new Map(),
  };

  // 1) 스폰 근처의 정상 스텝(속도 예산 내) → 허용
  const okStep = validateMove({ ...baseCtx, target: { x: spawn.x + 0.08, y: spawn.y } });
  assert(okStep.ok, `스폰(${spawn.x.toFixed(2)},${spawn.y.toFixed(2)})에서 0.08m 스텝 허용`);

  // 2) 바운즈 밖 목표 → out_of_bounds
  const oob = validateMove({ ...baseCtx, target: { x: 0.5, y: 0.5 } });
  assert(!oob.ok && oob.reason === "out_of_bounds", "바운즈 밖 목표 거부(out_of_bounds)");

  // 3) 폴리곤 경계를 가로지르는 이동 → collision
  //    v1 다이아 폴리곤 우상단 변(A(8.17,1.98)-B(18.72,7.26)) 위 x=10에서 y≈2.90.
  //    그 살짝 안쪽(10,3.1)에서 밖(10,2.55)으로 — 바운즈 안·폴리곤 밖 교차.
  const nearTop: Mover = { ...mover, x: 10, y: 3.1 };
  const cross = validateMove({
    ...baseCtx,
    mover: nearTop,
    target: { x: 10, y: 2.55 },
    dtSeconds: 1,
  });
  assert(!cross.ok && cross.reason === "collision", "보행 폴리곤 경계 가로지르기 거부(collision)");

  // 4) 개활지 내부의 순수 이동(경계·가구 비교차) → 허용
  //    정규 (0.561,0.564)→(0.564,0.577): WS-A와 보드룸 사이 복도(v1 팩 개활지).
  const inside = validateMove({
    ...baseCtx,
    mover: { ...mover, x: 0.561 * SCENE_W_M, y: 0.564 * SCENE_H_M },
    target: { x: 0.564 * SCENE_W_M, y: 0.577 * SCENE_H_M },
    dtSeconds: 1,
  });
  assert(inside.ok, "개활지 내부 이동 허용");

  // 5) 가구(중앙 회의 테이블) 가로지르기 → collision
  //    테이블 좌측 개활지 → 테이블 중심으로 이동 시 폴리곤 변 교차.
  const nearTable: Mover = { ...mover, x: 0.42 * SCENE_W_M, y: 0.5 * SCENE_H_M };
  const intoTable = validateMove({
    ...baseCtx,
    mover: nearTable,
    target: { x: 0.5 * SCENE_W_M, y: 0.58 * SCENE_H_M },
    dtSeconds: 2,
  });
  assert(!intoTable.ok && intoTable.reason === "collision", "가구 폴리곤 가로지르기 거부(collision)");

  console.log(`\nscene-floor: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
