'use client';

// 실시간 R3F 오피스 뷰포트 — v1.1 스타일라이즈드 에셋.
// 씬에 박힌 T포즈 캐릭터는 숨기고, 팔 내린 포즈(IDLE/WALK)로 교체.
// (리깅 전이라 골격 애니는 없음 — 정적 포즈 + 위치 이동. 부드러운 걷기는 Mixamo 리깅 후.)
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls, ContactShadows } from '@react-three/drei';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';

// glTF Y-up vs 에셋 Z-up → -90°X 보정
const ZUP: [number, number, number] = [-Math.PI / 2, 0, 0];

function OfficeScene() {
  const { scene } = useGLTF('/office/scene.glb');
  // 씬에 박힌 T포즈 캐릭터 노드 숨김
  useMemo(() => {
    scene.traverse((o) => {
      if (/CHAR_|AVATAR/i.test(o.name)) o.visible = false;
    });
  }, [scene]);
  return <primitive object={scene} rotation={ZUP} />;
}

// 정적 포즈 인물 (팔 내린 idle 등)
function Person({ url, pos, rot }: { url: string; pos: [number, number, number]; rot: number }) {
  const { scene } = useGLTF(url);
  const inst = useMemo(() => scene.clone(true), [scene]);
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <primitive object={inst} rotation={ZUP} />
    </group>
  );
}

// 걷는 인물 (walk 포즈 + 위치 이동)
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

// 팔 내린 idle 인물들 (사무실 곳곳)
const IDLE: Array<{ url: string; pos: [number, number, number]; rot: number }> = [
  { url: '/office/male_idle.glb', pos: [-2.5, 0, 0.2], rot: 0.6 },
  { url: '/office/female_idle.glb', pos: [1.6, 0, 1.4], rot: -1.2 },
  { url: '/office/male_idle.glb', pos: [3.2, 0, -0.6], rot: 2.4 },
  { url: '/office/female_idle.glb', pos: [-3.8, 0, 2.4], rot: 0.2 },
  { url: '/office/male_idle.glb', pos: [0.4, 0, 3.0], rot: 1.5 },
];
const WALK: Array<{ url: string; path: (t: number) => [number, number] }> = [
  { url: '/office/male_walk.glb', path: (t) => [Math.sin(t * 0.5) * 4, 1.0] },
  { url: '/office/female_walk.glb', path: (t) => [Math.cos(t * 0.4) * 3 + 0.5, Math.sin(t * 0.4) * 2 - 0.5] },
];

export default function OfficeViewport() {
  return (
    <Canvas
      orthographic
      camera={{ position: [40, 34, 40], zoom: 46, near: 0.1, far: 500 }}
      gl={{ toneMapping: THREE.AgXToneMapping, outputColorSpace: THREE.SRGBColorSpace, antialias: true }}
      style={{ width: '100%', height: '100%' }}
      onCreated={({ gl }) => gl.setClearColor('#0d1b36')}
    >
      <ambientLight intensity={0.8} />
      <hemisphereLight args={['#ffffff', '#7a6d5c', 0.5]} />
      <directionalLight position={[12, 24, 10]} intensity={2.2} />
      <Suspense fallback={null}>
        <OfficeScene />
        {IDLE.map((p, i) => (
          <Person key={`i${i}`} url={p.url} pos={p.pos} rot={p.rot} />
        ))}
        {WALK.map((w, i) => (
          <Walker key={`w${i}`} url={w.url} path={w.path} />
        ))}
        <ContactShadows position={[0, 0.01, 0]} opacity={0.3} scale={30} blur={2.2} far={6} />
      </Suspense>
      <OrbitControls target={[0, 1, 0]} enablePan={false} minZoom={20} maxZoom={90} />
    </Canvas>
  );
}

useGLTF.preload('/office/scene.glb');
