/**
 * camera.ts
 * @TASK T0.4 — camera.json 타입 정의
 * @SPEC docs/3d-design/photoreal-web-strategy.md#5
 */

export interface CameraJson {
  camera_type: "ORTHO";
  source?: string;
  ortho_scale: number;
  ortho_w: number;
  ortho_h: number;
  aspect: number;
  render_w: number;
  render_h: number;
  clip_near: number;
  clip_far: number;
  elevation_deg: number;
  azimuth_deg: number;
  camera_position: [number, number, number];
  camera_rotation_euler_xyz_rad: [number, number, number];
  camera_rotation_euler_xyz_deg: [number, number, number];
  /** row-major flat 16 원소 (OpenGL column-major와 전치 관계) */
  view_matrix_row_major: number[];
  projection_matrix_row_major: number[];
  world_matrix_row_major: number[];
  threejs_notes: {
    coordinate_system: string;
    axis_remap: string;
    ortho_half_w: number;
    ortho_half_h: number;
  };
}

/**
 * Three.js에서 사용할 카메라 파라미터
 * Blender(Z-up, Y-forward) → Three.js(Y-up, Z-forward) 변환 후
 */
export interface ThreeJsCameraParams {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  /** Three.js 좌표계로 변환된 카메라 위치 */
  position: [number, number, number];
  /** Three.js 좌표계로 변환된 lookAt 대상 */
  target: [number, number, number];
}

/**
 * Blender → Three.js 좌표 변환
 * Blender: X=오른쪽, Y=앞(화면 안), Z=위
 * Three.js: X=오른쪽, Y=위, Z=앞(화면 밖)
 *
 * 변환: (bx, by, bz) → (bx, bz, -by)
 */
export function blenderToThreeJs(
  bx: number,
  by: number,
  bz: number
): [number, number, number] {
  return [bx, bz, -by];
}

/**
 * camera.json에서 Three.js OrthographicCamera 파라미터 추출
 */
export function extractThreeCameraParams(cam: CameraJson): ThreeJsCameraParams {
  const halfW = cam.ortho_w / 2;
  const halfH = cam.ortho_h / 2;

  // Blender 카메라 위치를 Three.js 좌표계로 변환
  const [bx, by, bz] = cam.camera_position;
  const threePos = blenderToThreeJs(bx, by, bz);

  return {
    left: -halfW,
    right: halfW,
    top: halfH,
    bottom: -halfH,
    near: cam.clip_near,
    far: cam.clip_far,
    position: threePos,
    target: [0, 0, 0], // 씬 중심
  };
}
