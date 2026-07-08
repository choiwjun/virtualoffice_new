/**
 * AvatarWithDepth.tsx
 * @TASK T0.6 — 깊이합성 아바타 (캡슐 형태)
 * @SPEC docs/planning/16-render-spike-and-roadmap.md#A.2
 *
 * 깊이합성 ShaderMaterial을 사용하는 테스트 아바타.
 * 몸통(캡슐) + 머리(구) 조합. 발 위치 = 월드 Y좌표.
 *
 * 좌표계 (Three.js):
 *   X = 오른쪽, Y = 위, Z = 앞(화면 밖)
 *   아바타 위치 (x, y_feet, z): y_feet = 바닥 높이 (Blender Z=0 → Three.js Y=0)
 */

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  depthCompositeVertexShader,
  depthCompositeFragmentShader,
  AVATAR_COLORS,
} from "../shaders/depthComposite.glsl";

interface AvatarWithDepthProps {
  /** Three.js 월드 좌표 (발 위치 기준) */
  position: [number, number, number];
  /** office_depth.png 텍스처 */
  depthTexture: THREE.Texture;
  /** 깊이 판정 편향 (기본 0.005: 경계 떨림 방지) */
  depthBias?: number;
}

const BODY_HEIGHT = 1.5;   // 몸통 높이 (m)
const BODY_RADIUS = 0.25;  // 몸통 반지름
const HEAD_RADIUS = 0.22;  // 머리 반지름

export function AvatarWithDepth({
  position,
  depthTexture,
  depthBias = 0.005,
}: AvatarWithDepthProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { size, camera } = useThree();

  // 깊이합성 ShaderMaterial — 몸통용
  const bodyMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: depthCompositeVertexShader,
      fragmentShader: depthCompositeFragmentShader,
      uniforms: {
        uOfficeDepth: { value: depthTexture },
        uResolution: { value: new THREE.Vector2(size.width, size.height) },
        uNear: { value: (camera as THREE.OrthographicCamera).near },
        uFar: { value: (camera as THREE.OrthographicCamera).far },
        uDepthBias: { value: depthBias },
        uAvatarColor: { value: new THREE.Vector3(...AVATAR_COLORS.body) },
      },
      side: THREE.FrontSide,
    });
  }, [depthTexture, size.width, size.height, camera, depthBias]);

  // 머리용 ShaderMaterial
  const headMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: depthCompositeVertexShader,
      fragmentShader: depthCompositeFragmentShader,
      uniforms: {
        uOfficeDepth: { value: depthTexture },
        uResolution: { value: new THREE.Vector2(size.width, size.height) },
        uNear: { value: (camera as THREE.OrthographicCamera).near },
        uFar: { value: (camera as THREE.OrthographicCamera).far },
        uDepthBias: { value: depthBias },
        uAvatarColor: { value: new THREE.Vector3(...AVATAR_COLORS.head) },
      },
      side: THREE.FrontSide,
    });
  }, [depthTexture, size.width, size.height, camera, depthBias]);

  // 해상도 변경 시 uniform 업데이트
  useFrame(() => {
    if (bodyMaterial.uniforms.uResolution) {
      bodyMaterial.uniforms.uResolution.value.set(size.width, size.height);
      headMaterial.uniforms.uResolution.value.set(size.width, size.height);
    }
  });

  const [x, y, z] = position;
  // 몸통 중심 Y = 발 위치 + 몸통 높이/2
  const bodyY = y + BODY_HEIGHT / 2;
  // 머리 중심 Y = 발 위치 + 몸통 높이 + 머리 반지름
  const headY = y + BODY_HEIGHT + HEAD_RADIUS;

  return (
    <group ref={groupRef}>
      {/* 몸통 (캡슐 근사: CylinderGeometry) */}
      <mesh
        position={[x, bodyY, z]}
        material={bodyMaterial}
        renderOrder={1}
      >
        <cylinderGeometry args={[BODY_RADIUS, BODY_RADIUS * 0.9, BODY_HEIGHT, 16]} />
      </mesh>

      {/* 머리 (구) */}
      <mesh
        position={[x, headY, z]}
        material={headMaterial}
        renderOrder={1}
      >
        <sphereGeometry args={[HEAD_RADIUS, 16, 12]} />
      </mesh>

      {/* 발 위치 마커 (발 Y=ground 확인용 — 디버그 전용, 깊이합성 미적용) */}
      <mesh position={[x, y + 0.01, z]}>
        <cylinderGeometry args={[0.12, 0.12, 0.02, 12]} />
        <meshBasicMaterial color="#ff4444" transparent opacity={0.8} />
      </mesh>
    </group>
  );
}
