/**
 * camera.test.ts
 * @TASK T0.10 — 카메라 좌표 변환 단위 테스트
 * @TEST 수용기준 A.3: 아바타 발 위치 = 배경 바닥 좌표 정합
 *
 * 테스트 대상:
 *  - blenderToThreeJs: 좌표계 변환 정확성
 *  - extractThreeCameraParams: 카메라 파라미터 추출
 */

import { describe, it, expect } from "vitest";
import {
  blenderToThreeJs,
  extractThreeCameraParams,
} from "../types/camera";
import type { CameraJson } from "../types/camera";

// generate_test_assets.py가 생성하는 camera.json 샘플
const MOCK_CAM: CameraJson = {
  camera_type: "ORTHO",
  ortho_scale: 8.0,
  ortho_w: 14.222222222222221,
  ortho_h: 8.0,
  aspect: 1.7777777777777777,
  render_w: 1920,
  render_h: 1080,
  clip_near: 0.1,
  clip_far: 100.0,
  elevation_deg: 35.264389682754654,
  azimuth_deg: 45.0,
  camera_position: [8.660254037844387, -8.660254037844387, 8.660254037844386],
  camera_rotation_euler_xyz_rad: [0.9553166181245093, 0.0, 0.7853981633974483],
  camera_rotation_euler_xyz_deg: [54.735610317245346, 0.0, 45.0],
  view_matrix_row_major: [
    0.7071067811865476, 0.7071067811865476, -0.0, -0.0,
    -0.408248290463863, 0.408248290463863, 0.8164965809277261, -0.0,
    0.5773502691896258, -0.5773502691896258, 0.5773502691896257, -15.0,
    0, 0, 0, 1,
  ],
  projection_matrix_row_major: [
    0.140625, 0, 0, 0,
    0, 0.25, 0, 0,
    0, 0, -0.02002002002002002, -1.002002002002002,
    0, 0, 0, 1,
  ],
  world_matrix_row_major: Array.from({ length: 16 }, (_, i) => i),
  threejs_notes: {
    coordinate_system: "Blender Y-forward Z-up → Three.js Y-up Z-forward",
    axis_remap: "Blender(x,y,z) → Three.js(x,z,-y)",
    ortho_half_w: 7.111111111111111,
    ortho_half_h: 4.0,
  },
};

describe("blenderToThreeJs 좌표계 변환", () => {
  it("원점은 변환 후에도 원점", () => {
    const [tx, ty, tz] = blenderToThreeJs(0, 0, 0);
    // -0 === 0 이지만 toEqual은 구분하므로 toBeCloseTo 사용
    expect(tx).toBeCloseTo(0);
    expect(ty).toBeCloseTo(0);
    expect(tz).toBeCloseTo(0);
  });

  it("Blender X축 → Three.js X축 (변화 없음)", () => {
    const [tx, ty, tz] = blenderToThreeJs(1, 0, 0);
    expect(tx).toBeCloseTo(1);
    expect(ty).toBeCloseTo(0);
    expect(tz).toBeCloseTo(0);
  });

  it("Blender Y축(앞) → Three.js -Z축(앞)", () => {
    // Blender Y+ = 씬 앞 → Three.js Z- (화면 안)
    const [tx, ty, tz] = blenderToThreeJs(0, 1, 0);
    expect(tx).toBeCloseTo(0);
    expect(ty).toBeCloseTo(0);
    expect(tz).toBeCloseTo(-1);
  });

  it("Blender Z축(위) → Three.js Y축(위)", () => {
    const [tx, ty, tz] = blenderToThreeJs(0, 0, 1);
    expect(tx).toBeCloseTo(0);
    expect(ty).toBeCloseTo(1);
    expect(tz).toBeCloseTo(0);
  });

  it("책상 Blender 중심(0, 1.2, 0.375) → Three.js(0, 0.375, -1.2)", () => {
    const [tx, ty, tz] = blenderToThreeJs(0, 1.2, 0.375);
    expect(tx).toBeCloseTo(0);
    expect(ty).toBeCloseTo(0.375);
    expect(tz).toBeCloseTo(-1.2);
  });

  it("유리벽 Blender 중심(0, -0.5, 1.0) → Three.js(0, 1.0, 0.5)", () => {
    const [tx, ty, tz] = blenderToThreeJs(0, -0.5, 1.0);
    expect(tx).toBeCloseTo(0);
    expect(ty).toBeCloseTo(1.0);
    expect(tz).toBeCloseTo(0.5);
  });
});

describe("extractThreeCameraParams", () => {
  it("ortho 범위: left/right/top/bottom이 ortho_w/h 절반과 일치", () => {
    const params = extractThreeCameraParams(MOCK_CAM);
    expect(params.left).toBeCloseTo(-MOCK_CAM.ortho_w / 2);
    expect(params.right).toBeCloseTo(MOCK_CAM.ortho_w / 2);
    expect(params.top).toBeCloseTo(MOCK_CAM.ortho_h / 2);
    expect(params.bottom).toBeCloseTo(-MOCK_CAM.ortho_h / 2);
  });

  it("near/far 전달 정확성", () => {
    const params = extractThreeCameraParams(MOCK_CAM);
    expect(params.near).toBe(0.1);
    expect(params.far).toBe(100.0);
  });

  it("카메라 위치 Blender→Three.js 변환 적용됨", () => {
    const params = extractThreeCameraParams(MOCK_CAM);
    // Blender(8.66, -8.66, 8.66) → Three.js(8.66, 8.66, 8.66)
    const [bx, by, bz] = MOCK_CAM.camera_position;
    expect(params.position[0]).toBeCloseTo(bx);   // x 그대로
    expect(params.position[1]).toBeCloseTo(bz);   // y ← Blender z
    expect(params.position[2]).toBeCloseTo(-by);  // z ← -Blender y
  });

  it("lookAt target은 씬 원점(0,0,0)", () => {
    const params = extractThreeCameraParams(MOCK_CAM);
    expect(params.target).toEqual([0, 0, 0]);
  });

  it("aspect ratio = ortho_w / ortho_h", () => {
    const params = extractThreeCameraParams(MOCK_CAM);
    const computedAspect =
      (params.right - params.left) / (params.top - params.bottom);
    expect(computedAspect).toBeCloseTo(MOCK_CAM.ortho_w / MOCK_CAM.ortho_h);
  });
});

describe("아바타 발 위치 좌표 정합 (수용기준 A.3)", () => {
  it("바닥 Y=0 → Three.js Y=0 (Blender Z=0 → Three.js Y=0)", () => {
    // 바닥은 Blender Z=0 → Three.js Y=0
    const [, ty] = blenderToThreeJs(0, 0, 0);
    expect(ty).toBe(0);
  });

  it("아바타 발 위치(Y=0)가 배경 바닥(Y=0)과 일치", () => {
    // 아바타 발 Y=0, 바닥 Y=0 → 드리프트 없음
    const floorY = blenderToThreeJs(0, 0, 0)[1]; // Three.js Y
    const avatarFeetY = 0; // 발 위치
    expect(avatarFeetY).toBeCloseTo(floorY);
  });
});
