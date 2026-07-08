/**
 * DepthCompositeScene.tsx
 * @TASK T0.7 — 깊이합성 씬 루트 (R3F Canvas 내부)
 * @SPEC docs/planning/16-render-spike-and-roadmap.md#A.2
 *
 * 구성:
 *  1. OrthographicCamera — camera.json 재현
 *  2. AvatarWithDepth — 깊이합성 아바타
 *  ※ 배경 이미지는 CSS background-image로 표시 (App.tsx)
 *
 * 좌표계 정합:
 *  - Blender Z-up → Three.js Y-up 변환: Blender(x,y,z) → Three.js(x,z,-y)
 *  - 책상 Blender(0, 1.2, 0.375) → Three.js(0, 0.375, -1.2)
 *  - 유리벽 Blender(0, -0.5, 1.0) → Three.js(0, 1.0, 0.5)
 *
 * 아바타 이동 (슬라이더 s, 범위 -3..+3):
 *  - s < 0: 카메라에 가까운 쪽 (책상 앞 — 온전히 보임)
 *  - s = 0: 책상과 동일 깊이 (화면상 정중앙 겹침)
 *  - s > 0: 카메라에서 먼 쪽 (책상 뒤 — 가려짐)
 *
 * 아이소 뷰 정합:
 *  - 카메라 Three.js 위치: (8.66, 8.66, 8.66), lookAt(0,0,0)
 *  - 아바타 기준점: Three.js(1.2, 0, 0.0) — 아이소 뷰에서 책상 스크린 위치에
 *    대응하는 Y=0 바닥 교차점 (Blender 뷰행렬 역산으로 도출)
 *  - 이동 방향: XZ(0.707, 0.707) — 카메라에서 멀어지는 방향
 */

import { useEffect } from "react";
import { useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { AvatarWithDepth } from "./AvatarWithDepth";
import { CameraJson, extractThreeCameraParams } from "../types/camera";

// Blender 좌표 → Three.js 변환 (Z-up → Y-up)
// Blender(x, y, z) → Three.js(x, z, -y)
const B2T = (bx: number, by: number, bz: number): [number, number, number] => [bx, bz, -by];

// 씬 오브젝트 좌표 (Three.js 기준, 디버그 와이어프레임용)
const SCENE = {
  // 책상: Blender center(0, 1.2, 0.375) → Three.js(0, 0.375, -1.2)
  desk: {
    pos: B2T(0, 1.2, 0.375),
    // Blender scale(1.4, 0.7, 0.75) → Three.js(1.4, 0.75, 0.7)
    size: [1.4, 0.75, 0.7] as [number, number, number],
  },
  // 유리벽: Blender center(0, -0.5, 1.0) → Three.js(0, 1.0, 0.5)
  glassWall: {
    pos: B2T(0, -0.5, 1.0),
    size: [3.0, 2.0, 0.05] as [number, number, number],
  },
};

/**
 * 슬라이더 s(-3..+3) → Three.js 아바타 위치 변환
 *
 * 아이소 뷰 좌표 분석 (Blender view matrix 기반):
 *   - 책상 Blender(0, 1.2, 0.375) → screen(716, 288) in 1280×720
 *   - 아바타가 Blender Y=1.2에 서면 발 screen_y=316 = 책상 하단과 일치
 *   - 아바타 몸통(0~0.75m)이 책상 스크린 영역(screen_y 261~316)과 겹침
 *
 * 이동 방향: Three.js Z축 (= Blender -Y 방향)
 *   Z = -1.2 - 0.6 * s
 *   s < 0 → Z > -1.2 → Blender Y < 1.2 → 카메라 가까운 쪽 → 책상 앞 (보임)
 *   s = 0 → Z = -1.2 → Blender Y = 1.2 → 책상과 같은 위치 (경계)
 *   s > 0 → Z < -1.2 → Blender Y > 1.2 → 카메라 먼 쪽 → 책상 뒤 (가려짐)
 *
 * depth 검증 (near=0.1, far=100):
 *   책상 depth ≈ 0.1539 | s=-2 → 0.1491 (VISIBLE) | s=+2 → 0.1630 (OCCLUDED)
 *   depth 차이 0.014 >> bias 0.001 → 안정적 오클루전 판정
 */
export function sliderToAvatarPos(s: number): [number, number, number] {
  // X=0: 아이소 뷰 화면상 책상과 X 정렬
  // Z = -1.2 - 0.6*s: 책상 앞뒤 이동 (Blender Y 방향 = Three.js -Z)
  return [0, 0, -1.2 - 0.6 * s];
}

// 아바타 초기 위치: s=-2 (책상 앞, Blender Y=0.0, 카메라에 가까운 쪽)
export const AVATAR_INIT_S = -2;
export const AVATAR_INIT: [number, number, number] = sliderToAvatarPos(AVATAR_INIT_S);

// 이동 속도 (WASD 키보드 이동용)
export const MOVE_SPEED = 0.08;

interface DepthCompositeSceneProps {
  camData: CameraJson;
  depthUrl: string;
  /** 외부(App.tsx)에서 슬라이더/키보드로 제어하는 아바타 위치 */
  avatarPos: [number, number, number];
  /** 깊이 판정 편향 (0.001: near=0.1, far=100 씬에서 충분) */
  depthBias?: number;
}

export function DepthCompositeScene({
  camData,
  depthUrl,
  avatarPos,
  depthBias = 0.001,
}: DepthCompositeSceneProps) {
  const { camera } = useThree();

  // 깊이 텍스처 로드 (office_depth.png: 0=near/흑, 1=far/백)
  const depthTexture = useLoader(THREE.TextureLoader, depthUrl);
  depthTexture.minFilter = THREE.LinearFilter;
  depthTexture.magFilter = THREE.LinearFilter;

  // camera.json으로 직교 카메라 설정 (Blender 아이소 뷰 재현)
  useEffect(() => {
    const params = extractThreeCameraParams(camData);
    const orthoCamera = camera as THREE.OrthographicCamera;

    orthoCamera.left = params.left;
    orthoCamera.right = params.right;
    orthoCamera.top = params.top;
    orthoCamera.bottom = params.bottom;
    orthoCamera.near = params.near;
    orthoCamera.far = params.far;
    orthoCamera.updateProjectionMatrix();

    // Blender 카메라 위치·방향 재현
    // camera.json camera_position: (8.66, -8.66, 8.66) [Blender]
    // → Three.js(x,z,-y): (8.66, 8.66, 8.66)
    const [px, py, pz] = params.position;
    orthoCamera.position.set(px, py, pz);
    orthoCamera.lookAt(0, 0, 0);
    orthoCamera.updateMatrixWorld();
  }, [camera, camData]);

  return (
    <>
      {/*
       * 디버그 와이어프레임 (좌표 정합 시각화)
       * 배경 PNG와 겹쳐서 확인: 와이어프레임이 배경 오브젝트 윤곽과 맞으면 정합됨
       */}
      {/* 책상 와이어프레임 (주황색) */}
      <mesh position={SCENE.desk.pos}>
        <boxGeometry args={SCENE.desk.size} />
        <meshBasicMaterial color="#ff8800" wireframe transparent opacity={0.5} />
      </mesh>

      {/* 유리벽 와이어프레임 (파란색) */}
      <mesh position={SCENE.glassWall.pos}>
        <boxGeometry args={SCENE.glassWall.size} />
        <meshBasicMaterial color="#0088ff" wireframe transparent opacity={0.3} />
      </mesh>

      {/* 바닥 그리드 (좌표 정합 확인) */}
      <gridHelper args={[10, 10, "#444", "#222"]} position={[0, 0, 0]} />

      {/* 아바타 (깊이합성 오클루전 적용) */}
      <AvatarWithDepth
        position={avatarPos}
        depthTexture={depthTexture}
        depthBias={depthBias}
      />

      {/* 환경광 (최소) */}
      <ambientLight intensity={0.5} />
    </>
  );
}
