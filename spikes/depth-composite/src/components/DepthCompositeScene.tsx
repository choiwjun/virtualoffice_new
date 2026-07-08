/**
 * DepthCompositeScene.tsx
 * @TASK T0.7 — 깊이합성 씬 루트 (R3F Canvas 내부)
 * @SPEC docs/planning/16-render-spike-and-roadmap.md#A.2
 *
 * 구성:
 *  1. BackgroundQuad — office_bg.png 풀스크린
 *  2. OrthographicCamera — camera.json 재현
 *  3. AvatarWithDepth — 깊이합성 아바타
 *
 * 좌표계 정합:
 *  - Blender Z-up → Three.js Y-up 변환
 *  - 책상 Blender(0, 1.2, 0~0.75) → Three.js(0, 0~0.75, -1.2)
 *  - 유리벽 Blender(0, -0.5, 0~2) → Three.js(0, 0~2, 0.5)
 *
 * 아바타 이동:
 *  - WASD / 방향키: 아바타 이동 (Three.js X/Z 평면)
 *  - Q/E: 아바타 Y축 이동 (계단 테스트용)
 *  - 슬라이더는 App.tsx HUD에서 외부 state로 제어
 */

import { useEffect } from "react";
import { useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BackgroundQuad } from "./BackgroundQuad";
import { AvatarWithDepth } from "./AvatarWithDepth";
import { CameraJson, extractThreeCameraParams } from "../types/camera";

// Blender 좌표 → Three.js 변환 (Z-up → Y-up)
// Blender(x, y, z) → Three.js(x, z, -y)
const B2T = (bx: number, by: number, bz: number): [number, number, number] => [bx, bz, -by];

// 씬 오브젝트 좌표 (Three.js 기준)
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

// 아바타 초기 위치 (책상 앞, Three.js 좌표)
const AVATAR_INIT: [number, number, number] = [0, 0, 1.5];

// 이동 속도
const MOVE_SPEED = 0.08;

interface DepthCompositeSceneProps {
  camData: CameraJson;
  bgUrl: string;
  depthUrl: string;
  /** 외부(App.tsx)에서 제어하는 아바타 위치 */
  avatarPos: [number, number, number];
}

export function DepthCompositeScene({
  camData,
  bgUrl,
  depthUrl,
  avatarPos,
}: DepthCompositeSceneProps) {
  const { camera } = useThree();

  // 깊이 텍스처 로드
  const depthTexture = useLoader(THREE.TextureLoader, depthUrl);
  depthTexture.minFilter = THREE.LinearFilter;
  depthTexture.magFilter = THREE.LinearFilter;

  // camera.json으로 직교 카메라 설정
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

    // Blender 카메라 위치·방향 재현 (Three.js 좌표계)
    const [px, py, pz] = params.position;
    orthoCamera.position.set(px, py, pz);
    orthoCamera.lookAt(0, 0, 0);
    orthoCamera.updateMatrixWorld();
  }, [camera, camData]);

  return (
    <>
      {/* 배경 풀스크린 쿼드 */}
      <BackgroundQuad bgUrl={bgUrl} />

      {/*
       * 씬 구조 (디버그 와이어프레임 — 좌표 정합 확인용)
       * 깊이합성 배경에 덮이므로 시각적으로 보이지 않음.
       * 개발 중 좌표 정합 확인을 위해 남겨둠.
       */}
      <mesh position={SCENE.desk.pos}>
        <boxGeometry args={SCENE.desk.size} />
        <meshBasicMaterial color="#ff8800" wireframe transparent opacity={0.3} />
      </mesh>

      <mesh position={SCENE.glassWall.pos}>
        <boxGeometry args={SCENE.glassWall.size} />
        <meshBasicMaterial color="#0088ff" wireframe transparent opacity={0.3} />
      </mesh>

      {/* 바닥 그리드 (좌표 정합 확인) */}
      <gridHelper args={[10, 10, "#444", "#222"]} position={[0, 0, 0]} />

      {/* 아바타 (깊이합성 적용) */}
      <AvatarWithDepth
        position={avatarPos}
        depthTexture={depthTexture}
        depthBias={0.005}
      />

      {/* 환경광 (최소) */}
      <ambientLight intensity={0.5} />
    </>
  );
}

export { AVATAR_INIT, MOVE_SPEED };
