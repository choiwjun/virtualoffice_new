/**
 * BackgroundQuad.tsx
 * @TASK T0.5 — 배경 풀스크린 쿼드 (office_bg.png)
 * @SPEC docs/3d-design/photoreal-web-strategy.md#2
 *
 * 역할:
 *  - office_bg.png를 화면 전체에 꽉 채워 표시
 *  - 깊이 버퍼에 기록하지 않음 (배경이므로 항상 후면)
 *  - 렌더 순서 최우선 (renderOrder = -1)
 */

import { useTexture } from "@react-three/drei";
import * as THREE from "three";

interface BackgroundQuadProps {
  bgUrl: string;
}

export function BackgroundQuad({ bgUrl }: BackgroundQuadProps) {
  const texture = useTexture(bgUrl);

  // 텍스처 필터링 설정
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      {/*
       * 풀스크린 쿼드: 카메라 ortho 영역과 동일한 크기의 평면
       * 깊이 쓰기 비활성화: 아바타가 무조건 배경 위에 그려지되,
       * 깊이합성 셰이더가 office_depth.png로 오클루전을 판정함
       */}
      <planeGeometry args={[2, 2]} />
      <meshBasicMaterial
        map={texture}
        depthWrite={false}
        depthTest={false}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}
