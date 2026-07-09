'use client';

// 실시간 R3F 오피스 뷰포트 — v1.1 스타일라이즈드 에셋.
// 씬 박힌 T포즈 캐릭터 숨김 → 팔 내린 포즈(IDLE/WALK)로 교체. (리깅 전: 정적 포즈)
// 주의: 이름표/회의실 라벨은 drei <Html>(orthographic+distanceFactor 조합이 렌더 예외→흰 캔버스) 대신
//       office 페이지의 캔버스 밖 DOM 오버레이로 처리한다. 이 컴포넌트는 캔버스만 안전하게 렌더.
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls, ContactShadows } from '@react-three/drei';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';

const ZUP: [number, number, number] = [-Math.PI / 2, 0, 0];

function OfficeScene() {
  const { scene } = useGLTF('/office/scene.glb');
  useMemo(() => {
    scene.traverse((o) => {
      if (/CHAR_|AVATAR/i.test(o.name)) o.visible = false;
    });
  }, [scene]);
  return <primitive object={scene} rotation={ZUP} />;
}

function Person({ url, pos, rot }: { url: string; pos: [number, number, number]; rot: number }) {
  const { scene } = useGLTF(url);
  const inst = useMemo(() => scene.clone(true), [scene]);
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <primitive object={inst} rotation={ZUP} />
    </group>
  );
}

function Walker({ url, path }: { url: string; path: (t: number) => [number, number] }) {
  const { scene } = useGLTF(url);
  const inst = useMemo(() => scene.clone(true), [scene]);
  const g = useRef<THREE.Group>(null!);
  const prev = useRef<[number, number]>([0, 0]);
  useFrame((state) => {
    if (!g.current) return;
    const t = state.clock.getElapsedTime();
    const [x, z] = path(t);
    g.current.position.set(x, 0, z);
    const [px, pz] = prev.current;
    const dx = x - px, dz = z - pz;
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) g.current.rotation.y = Math.atan2(dx, dz);
    prev.current = [x, z];
  });
  return (
    <group ref={g}>
      <primitive object={inst} rotation={ZUP} />
    </group>
  );
}

const IDLE = [
  { url: '/office/male_idle.glb', pos: [-2.5, 0, 0.2] as [number, number, number], rot: 0.6 },
  { url: '/office/female_idle.glb', pos: [1.6, 0, 1.4] as [number, number, number], rot: -1.2 },
  { url: '/office/male_idle.glb', pos: [3.2, 0, -0.6] as [number, number, number], rot: 2.4 },
  { url: '/office/female_idle.glb', pos: [-3.8, 0, 2.4] as [number, number, number], rot: 0.2 },
];
const WALK = [
  { url: '/office/male_walk.glb', path: (t: number) => [Math.sin(t * 0.5) * 4, 1.0] as [number, number] },
  { url: '/office/female_walk.glb', path: (t: number) => [Math.cos(t * 0.4) * 3 + 0.5, Math.sin(t * 0.4) * 2 - 0.5] as [number, number] },
];

export default function OfficeViewport() {
  return (
    <Canvas
      orthographic
      camera={{ position: [40, 34, 40], zoom: 46, near: 0.1, far: 500 }}
      gl={{ toneMapping: THREE.AgXToneMapping, outputColorSpace: THREE.SRGBColorSpace, antialias: true }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* 배경을 씬에 명시적으로 박아 흰 캔버스 방지 */}
      <color attach="background" args={['#0d1b36']} />
      <ambientLight intensity={0.8} />
      <hemisphereLight args={['#ffffff', '#7a6d5c', 0.5]} />
      <directionalLight position={[12, 24, 10]} intensity={2.2} />
      <Suspense fallback={null}>
        <OfficeScene />
        {IDLE.map((p, i) => (
          <Person key={`i${i}`} {...p} />
        ))}
        {WALK.map((w, i) => (
          <Walker key={`w${i}`} {...w} />
        ))}
        <ContactShadows position={[0, 0.01, 0]} opacity={0.3} scale={30} blur={2.2} far={6} />
      </Suspense>
      <OrbitControls target={[0, 1, 0]} enablePan={false} minZoom={20} maxZoom={90} />
    </Canvas>
  );
}

useGLTF.preload('/office/scene.glb');
