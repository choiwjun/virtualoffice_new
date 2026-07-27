/**
 * layout-world-guard.test.ts — HttpFloorLayoutProvider의 월드 대조 가드.
 *
 * 배포 레이아웃과 클라 씬은 둘 다 좌표를 "미터"라고 부르지만, 크기가 다르면 같은 (10, 5)가
 * 서로 다른 자리를 뜻한다. 크기가 다른 층을 그대로 받으면 이동 검증이 **조용히** 어긋난다 —
 * 씬 박스가 배포 박스 안에 들어가면 거부조차 나지 않아 아무도 모른다.
 * 실측(2026-07-27): 씬 20×11.256m, 배포본 23.8×18.5m로 서버·클라가 다른 세계를 돌리고 있었다.
 *
 * Run with:  npm test  (v3-floor.test 뒤에 체인)
 */

import {
  HttpFloorLayoutProvider,
  V3FloorLayoutProvider,
  isSameWorld,
  WORLD_MATCH_TOLERANCE_M,
  type FloorLayout,
  type Rect,
} from "../integration/FloorLayoutProvider";

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

/** fetch를 갈아끼워 원하는 bounds의 층을 돌려준다(네트워크 없이 가드만 검사). */
function stubFetch(bounds: Rect, extra: Partial<FloorLayout> = {}): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () =>
      ({
        officeId: "office-demo",
        floorId: "floor-1",
        bounds,
        walls: [],
        seats: [],
        meetingZones: [],
        ...extra,
      }) as FloorLayout,
  })) as unknown as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** console.warn을 가로채 경고 횟수를 센다. */
function captureWarn(): { lines: string[]; restore: () => void } {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.warn = original; } };
}

async function main(): Promise<void> {
  console.log("layout-world-guard.test — 배포 레이아웃 월드 대조");

  const scene = await new V3FloorLayoutProvider().getLayout("office-demo", "floor-1");

  // ── isSameWorld 단위 ────────────────────────────────────────────────
  assert(isSameWorld(scene.bounds, { ...scene.bounds }), "같은 크기 → 같은 세계");
  assert(
    isSameWorld(scene.bounds, { ...scene.bounds, w: scene.bounds.w + WORLD_MATCH_TOLERANCE_M / 2 }),
    "허용 오차 안의 차이는 흡수(반올림·inset)",
  );
  assert(
    !isSameWorld(scene.bounds, { x: 0, y: 0, w: 23.8, h: 18.5 }),
    "실측 배포본(23.8×18.5) → 다른 세계",
  );
  assert(
    !isSameWorld(scene.bounds, { x: 0, y: 0, w: 15, h: 9 }),
    "더 작은 박스도 다른 세계 — 클라가 갈 수 있는 곳을 서버가 전부 거부하게 된다",
  );

  // ── 크기가 다른 배포본은 거부하고 씬으로 폴백 ─────────────────────────
  {
    const restoreFetch = stubFetch({ x: 0, y: 0, w: 23.8, h: 18.5 });
    const warn = captureWarn();
    const provider = new HttpFloorLayoutProvider("http://stub", "", new V3FloorLayoutProvider());
    const got = await provider.getLayout("office-demo", "floor-1");
    // 같은 층을 여러 번 새로 읽어도(LAYOUT_REFRESH_MS) 경고는 한 번만.
    await provider.getLayout("office-demo", "floor-1");
    await provider.getLayout("office-demo", "floor-1");
    warn.restore();
    restoreFetch();

    assert(isSameWorld(got.bounds, scene.bounds), "월드 불일치 → 씬 층으로 폴백");
    assert(got.walls.length === scene.walls.length, "폴백 층의 벽을 그대로 쓴다(빈 벽 아님)");
    assert(warn.lines.length === 1, `같은 불일치는 한 번만 경고 (${warn.lines.length}회)`);
    assert(
      warn.lines[0].includes("world mismatch") && warn.lines[0].includes("23.80x18.50"),
      "경고에 실제 크기가 찍힌다 — 로그만 보고 원인을 알 수 있게",
    );
  }

  // ── 씬과 같은 크기면 배포본을 그대로 쓴다(기능 보존) ────────────────────
  {
    const restoreFetch = stubFetch(scene.bounds, {
      walls: [{ x1: 1, y1: 1, x2: 2, y2: 1 }],
      meetingZones: [{ roomId: "r1", bounds: { x: 1, y: 1, w: 2, h: 2 }, capacity: 4 }],
    });
    const warn = captureWarn();
    const got = await new HttpFloorLayoutProvider("http://stub", "", new V3FloorLayoutProvider()).getLayout(
      "office-demo",
      "floor-1",
    );
    warn.restore();
    restoreFetch();

    assert(got.walls.length === 1, "월드가 같으면 배포본의 벽을 쓴다 — 가드가 기능을 죽이지 않는다");
    assert(got.meetingZones.length === 1 && got.meetingZones[0].roomId === "r1", "배포본 회의존도 그대로");
    assert(warn.lines.length === 0, "정상 경로에는 경고 없음");
  }

  console.log("\n========================================================");
  console.log(`layout-world-guard: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
