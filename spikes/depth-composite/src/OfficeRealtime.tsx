// 실시간 R3F 오피스 데모 — 사용자 스타일라이즈드 에셋을 브라우저에서 실시간 렌더 + 캐릭터 이동
// 목적: 포토리얼 오프라인렌더/깊이합성 없이 "전부 실시간 3D 한 엔진"이 되는지 검증
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls, ContactShadows } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// glTF는 Y-up 규격이나 이 에셋 팩은 Z-up 저작 → -90° X 회전으로 세움
const ZUP_FIX: [number, number, number] = [-Math.PI / 2, 0, 0];

function OfficeScene() {
  const { scene } = useGLTF('/office/scene.glb');
  return <primitive object={scene} rotation={ZUP_FIX} />;
}

function Walker({ walkPath }: { walkPath: (t: number) => [number, number] }) {
  const { scene } = useGLTF('/office/char_walk.glb');
  const inst = useMemo(() => scene.clone(true), [scene]);
  const g = useRef<THREE.Group>(null!);
  const prev = useRef<[number, number]>([0, 0]);
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const [x, z] = walkPath(t);
    g.current.position.set(x, 0, z);
    // 진행 방향으로 회전
    const [px, pz] = prev.current;
    const dx = x - px, dz = z - pz;
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) g.current.rotation.y = Math.atan2(dx, dz);
    prev.current = [x, z];
  });
  return (
    <group ref={g}>
      <primitive object={inst} rotation={ZUP_FIX} />
    </group>
  );
}

export default function OfficeRealtime() {
  // 여러 명이 서로 다른 경로로 걷는 것처럼
  const paths: Array<(t: number) => [number, number]> = [
    (t) => [Math.sin(t * 0.5) * 4.5, 1.2],
    (t) => [-3 + Math.sin(t * 0.4 + 1) * 2, Math.cos(t * 0.4 + 1) * 2 - 1],
    (t) => [Math.cos(t * 0.45) * 3 + 2, Math.sin(t * 0.45) * 2 + 2],
  ];
  return (
    <Canvas
      orthographic
      camera={{ position: [40, 34, 40], zoom: 46, near: 0.1, far: 500 }}
      gl={{ toneMapping: THREE.AgXToneMapping, outputColorSpace: THREE.SRGBColorSpace, antialias: true }}
      style={{ width: '100vw', height: '100vh' }}
      onCreated={({ gl }) => gl.setClearColor('#c9cdd4')}
    >
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#ffffff', '#8d7f6f', 0.5]} />
      <directionalLight position={[12, 24, 10]} intensity={2.2} />
      <OfficeScene />
      {paths.map((p, i) => (
        <Walker key={i} walkPath={p} />
      ))}
      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={30} blur={2.2} far={6} />
      <OrbitControls target={[0, 1, 0]} />
    </Canvas>
  );
}

useGLTF.preload('/office/scene.glb');
useGLTF.preload('/office/char_walk.glb');
