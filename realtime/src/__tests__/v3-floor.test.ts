/**
 * v3-floor.test.ts — V3FloorLayoutProvider(D35 Phase 1b 탑다운 축정렬) 지오메트리 검증.
 *
 * 프론트 officeV3.ts와 동일 좌표계(가로 20m, 세로 941/1672·20)로 축정렬 room + 가구 사각 벽을
 * 등록하는지, 스폰·좌석(벤치 파생 8석)·두 벤치 통로가 보행 가능한지, 데스크/경계 가로지르기가
 * 8검사에서 거부되는지 확인.
 *
 * Run with:  npm test  (scene-floor.test 뒤에 체인)
 */

import { V3FloorLayoutProvider, SCENE_W_M, SCENE_H_M } from "../integration/FloorLayoutProvider";
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
  console.log("v3-floor.test — V3FloorLayoutProvider (탑다운 축정렬)");

  const layout = await new V3FloorLayoutProvider().getLayout("office-demo", "floor-1");

  assert(SCENE_W_M === 20 && Math.abs(SCENE_H_M - (941 / 1672) * SCENE_W_M) < 1e-9, "좌표계: 가로 20m, 세로 = 941/1672 × 20m");
  // room 4변 + 가구 9개 × 4변 = 4 + 36 = 40 (10인 재설계: 벤치 3 + 회의테이블 2 + 팬트리/라운지/다이닝/부스).
  assert(layout.walls.length === 4 + 9 * 4, `room 4변 + 가구 사각 9개 벽 등록 (${layout.walls.length})`);
  assert(layout.seats.length === 12, "좌석점 12(벤치 3 파생 — DB 활성은 10석, C3·C4는 게스트)");
  assert(
    ["WS-A1", "WS-A4", "WS-B1", "WS-B4", "WS-C1", "WS-C2"].every((id) => layout.seats.some((s) => s.seatId === id)),
    "좌석 id = WS-A·B 유지 + WS-C 신설",
  );
  assert(layout.meetingZones.length === 2, "회의존 2개(boardroom + meeting-a)");
  assert(!!layout.spawn && layout.spawn.x === 6 && layout.spawn.y === 3, "스폰 = (6,3) 로비 개활지");

  const spawn = layout.spawn!;
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

  // 1) 스폰 근처 정상 스텝 → 허용
  const okStep = validateMove({ ...baseCtx, target: { x: spawn.x + 0.08, y: spawn.y } });
  assert(okStep.ok, `스폰(${spawn.x},${spawn.y})에서 0.08m 스텝 허용`);

  // 2) 바운즈 밖(벽 여유 밖) → out_of_bounds
  const oob = validateMove({ ...baseCtx, target: { x: 0.1, y: 0.1 } });
  assert(!oob.ok && oob.reason === "out_of_bounds", "room 사각 밖 목표 거부(out_of_bounds)");

  // 3) 세로 통로(x≈8.1, A/B열↔C열 사이) 순수 이동 → 허용
  const aisle = validateMove({
    ...baseCtx,
    mover: { ...mover, x: 8.1, y: 4.6 },
    target: { x: 8.1, y: 9.8 },
    dtSeconds: 4,
  });
  assert(aisle.ok, "세로 통로(x≈8.1) 이동 허용");

  // 4) 벤치 A 데스크(상판 4.95~7.85 × 4.95~6.45) 가로지르기 → collision.
  //    아래 통로에서 데스크 중심(6.4,5.7)으로 향하면 하단 변(y6.45) 교차.
  const intoDesk = validateMove({
    ...baseCtx,
    mover: { ...mover, x: 6.4, y: 6.9 },
    target: { x: 6.4, y: 5.7 },
    dtSeconds: 2,
  });
  assert(!intoDesk.ok && intoDesk.reason === "collision", "벤치 데스크 상판 가로지르기 거부(collision)");

  // 5) 좌석점(WS-A3 = 5.675,6.87)은 데스크 밖이라 통로에서 도달 가능(collision 아님).
  const toSeat = validateMove({
    ...baseCtx,
    mover: { ...mover, x: 5.675, y: 7.3 },
    target: { x: 5.675, y: 6.87 },
    dtSeconds: 1,
  });
  assert(toSeat.ok, "좌석점(WS-A3, 데스크 밖)으로 이동 허용");

  console.log(`\nv3-floor: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
