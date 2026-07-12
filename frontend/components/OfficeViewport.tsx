'use client';

// 실시간 R3F 오피스 뷰포트 — v10.0 PBR 강화 리깅 에셋 + 렌더 폴리싱 (D28.2, 2026-07-11).
// 첨부 패키지(virtual_office_complete_product_v10_0) 정합 사용. 정본 레지스트리 = 05_registries/asset-registry-v10.json.
//  · 씬 = SCENE_ACME_HQ_HERO_V4_001.glb (PBR 내장, 텍스처 114장 — v8 대비 토폴로지 동일·머티리얼만 강화). 정적 T포즈 인물은 숨기고 애니 아바타로 대체.
//  · 캐릭터 = characters_rigged/*.glb (동일 V8 rig 18조인트·12클립 유지, PBR 텍스처 내장). 렌더 = IBL 환경맵 + ACES + Bloom + 소프트 그림자.
// 스킨드 메시 복제는 SkeletonUtils.clone(three/examples) — 일반 clone은 스켈레톤 바인딩이 깨진다.
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { useGLTF, OrbitControls, ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useOfficeRoom } from '@/hooks/useOfficeRoom';
import type { ConnStatus, NetPlayer } from '@/lib/realtime';

// glb Z-up → three.js Y-up 보정 (v8 에셋 up-axis Z, pivot BOTTOM_CENTER)
const ZUP: [number, number, number] = [-Math.PI / 2, 0, 0];

// v10 GLB는 Draco 지오메트리 압축본(office/ 합계 ~34→22.6MB). 디코더는 CDN 대신 로컬(public/draco/, 온프렘 친화).
const DRACO = '/draco/';

const SCENE_URL = '/office/scene_v4.glb';
const HERO_M = '/office/male_rigged.glb';
const HERO_F = '/office/female_rigged.glb';
const HERO_RECEP = '/office/receptionist_rigged.glb';
const M1 = '/office/male01.glb';
const MCASUAL = '/office/malecasual.glb';
const F1 = '/office/female01.glb';
const FBIZ = '/office/femalebiz.glb';
const CHAR_URLS = [HERO_M, HERO_F, HERO_RECEP, M1, MCASUAL, F1, FBIZ];

// ─────────────────────────────────────────────
// C2: 서버 좌표(20×15m 데모 층 평면) ↔ R3F 월드 매핑.
// 서버 중앙(10,7.5) → 월드 원점(0,0). scale는 씬 크기에 맞춘 근사(실 레이아웃 연동 시 교체).
// floor y → world z, floor x → world x.
// ─────────────────────────────────────────────
const FLOOR_W = 20;
const FLOOR_H = 15;
const FLOOR_SCALE = 0.5;
function floorToWorld(fx: number, fy: number): [number, number] {
  return [(fx - FLOOR_W / 2) * FLOOR_SCALE, (fy - FLOOR_H / 2) * FLOOR_SCALE];
}
function worldToFloor(wx: number, wz: number): [number, number] {
  return [wx / FLOOR_SCALE + FLOOR_W / 2, wz / FLOOR_SCALE + FLOOR_H / 2];
}
// userId(없으면 sessionId)로 아바타 glb 결정 — 사용자별 일관.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// 씬에 구워진 정적 T포즈 인물 노드명 (가구 아님) — 이 접두사로 시작하면 숨긴다.
const BAKED_PEOPLE = /^(worker_|ethan_|walk_|receptionist_|meeting_person)/i;
const EMISSIVE_MAT = /emissive|neon|led|glow|warm|screen|ui|light/i;

function OfficeScene() {
  const { scene } = useGLTF(SCENE_URL, DRACO);
  useMemo(() => {
    scene.traverse((o) => {
      if (BAKED_PEOPLE.test(o.name)) {
        o.visible = false;
        return;
      }
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          const mm = m as THREE.MeshStandardMaterial;
          if (mm && EMISSIVE_MAT.test(mm.name || '')) mm.emissiveIntensity = 2.6; // Bloom 대상으로 발광 부스트
        });
      }
    });
  }, [scene]);
  return <primitive object={scene} rotation={ZUP} />;
}

// 제공 캐릭터 리그는 팔이 벌어진 A/T 바인드포즈 + 클립이 팔을 거의 안 내림 →
// 윗팔 본을 로컬 Y축으로 회전해 몸통 옆으로 내린다. (양팔 대칭)
const ARM_DOWN = THREE.MathUtils.degToRad(70);

// 리깅 캐릭터 독립 인스턴스: SkeletonUtils.clone로 스켈레톤까지 복제 후 지정 클립 루프 재생.
function useRiggedCharacter(url: string, clip: string) {
  const { scene, animations } = useGLTF(url, DRACO);
  const inst = useMemo(() => {
    const c = skeletonClone(scene);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
      const up = o.name.toUpperCase();
      if (up.endsWith('UPPER_ARM_R')) o.rotateY(ARM_DOWN); // 오른팔 내림
      if (up.endsWith('UPPER_ARM_L')) o.rotateY(-ARM_DOWN); // 왼팔 내림
    });
    return c;
  }, [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(inst), [inst]);
  useEffect(() => {
    const src = THREE.AnimationClip.findByName(animations, clip) ?? animations[0];
    if (!src) return;
    // 팔/손 트랙 제거 → 위 팔내림 보정이 유지되게(믹서가 덮어쓰지 않게). 다리·몸통은 정상 애니.
    const c = src.clone();
    c.tracks = c.tracks.filter((t) => !/ARM|HAND/i.test(t.name));
    const action = mixer.clipAction(c);
    action.reset().fadeIn(0.25).play();
    return () => {
      action.fadeOut(0.1);
      mixer.stopAllAction();
    };
  }, [mixer, animations, clip]);
  useFrame((_, dt) => mixer.update(dt));
  return inst;
}

function Person({
  url,
  clip,
  pos,
  rot,
}: {
  url: string;
  clip: string;
  pos: [number, number, number];
  rot: number;
}) {
  const inst = useRiggedCharacter(url, clip);
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <primitive object={inst} rotation={ZUP} />
    </group>
  );
}

function Walker({
  url,
  clip,
  path,
}: {
  url: string;
  clip: string;
  path: (t: number) => [number, number];
}) {
  const inst = useRiggedCharacter(url, clip);
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

// 씬 실측 인물 자리(three 월드 X=좌우·Z=깊이). 베이크 정적본을 숨기고 이 자리를 애니 아바타로 대체.
const PEOPLE: { url: string; clip: string; pos: [number, number, number]; rot: number }[] = [
  { url: HERO_RECEP, clip: 'ANIM_IDLE_001', pos: [-3.7, 0, -1.61], rot: 0.8 }, // 리셉션(기립)
  { url: HERO_M, clip: 'ANIM_TALK_001', pos: [-1.3, 0, 2.91], rot: 2.0 }, // 카페 쪽 대화
  { url: HERO_F, clip: 'ANIM_TALK_001', pos: [-2.3, 0, 2.7], rot: -1.0 }, // 카페 대화 상대
  { url: M1, clip: 'ANIM_TYPING_001', pos: [1.56, 0, 1.06], rot: Math.PI }, // 데스크 워커(착석 타이핑)
  { url: F1, clip: 'ANIM_TYPING_001', pos: [0.04, 0, 3.24], rot: 0 }, // 데스크 워커(착석)
  { url: FBIZ, clip: 'ANIM_MEETING_IDLE_001', pos: [2.53, 0, 0.63], rot: 0.7 }, // 회의 착석
  { url: MCASUAL, clip: 'ANIM_MEETING_IDLE_001', pos: [3.94, 0, 0.63], rot: 1.1 }, // 회의 착석
];
const WALKERS: { url: string; clip: string; path: (t: number) => [number, number] }[] = [
  { url: M1, clip: 'ANIM_WALK_001', path: (t) => [Math.sin(t * 0.4) * 3.2, -0.9] as [number, number] },
  {
    url: F1,
    clip: 'ANIM_WALK_001',
    path: (t) =>
      [0.75 + Math.cos(t * 0.35) * 1.8, -0.55 + Math.sin(t * 0.35) * 0.45] as [number, number],
  },
];

// ─────────────────────────────────────────────
// C2: 서버 권위 네트워크 아바타 (실시간 이동)
// 위치는 서버 state를 useFrame에서 imperative하게 읽어 보간(Walker와 동일 패턴).
// ─────────────────────────────────────────────
function NetworkedAvatar({
  sessionId,
  playersRef,
  isSelf,
}: {
  sessionId: string;
  playersRef: MutableRefObject<Map<string, NetPlayer>>;
  isSelf: boolean;
}) {
  const url = useMemo(
    () => CHAR_URLS[hashStr(playersRef.current.get(sessionId)?.userId || sessionId) % CHAR_URLS.length],
    [sessionId, playersRef],
  );
  const [clip, setClip] = useState('ANIM_IDLE_001');
  const inst = useRiggedCharacter(url, clip);
  const g = useRef<THREE.Group>(null!);
  const prev = useRef<[number, number]>([0, 0]);
  const idleFrames = useRef(99);
  const isWalk = useRef(false);
  const spawned = useRef(false);

  useFrame(() => {
    const p = playersRef.current.get(sessionId);
    if (!p || !g.current) return;
    const [tx, tz] = floorToWorld(p.x, p.y);
    if (!spawned.current) {
      g.current.position.set(tx, 0, tz);
      prev.current = [tx, tz];
      spawned.current = true;
    } else {
      g.current.position.x += (tx - g.current.position.x) * 0.18;
      g.current.position.z += (tz - g.current.position.z) * 0.18;
    }
    const [px, pz] = prev.current;
    const dx = g.current.position.x - px;
    const dz = g.current.position.z - pz;
    const moved = Math.abs(dx) + Math.abs(dz);
    if (moved > 1e-4) g.current.rotation.y = Math.atan2(dx, dz);
    prev.current = [g.current.position.x, g.current.position.z];
    // 서버 anim 필드는 스트리밍 이동상 walk↔idle이 잦게 오간다 → 실제 위치변화 + 정지 hysteresis로
    // walk/idle 판정(기존 Walker 패턴)해 클립 깜빡임을 방지.
    if (moved > 0.003) idleFrames.current = 0;
    else idleFrames.current++;
    const wantWalk = idleFrames.current < 10;
    if (wantWalk !== isWalk.current) {
      isWalk.current = wantWalk;
      setClip(wantWalk ? 'ANIM_WALK_001' : 'ANIM_IDLE_001');
    }
  });

  return (
    <group ref={g}>
      <primitive object={inst} rotation={ZUP} />
      {isSelf && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.26, 0.34, 28]} />
          <meshBasicMaterial color="#3B5BFE" transparent opacity={0.85} />
        </mesh>
      )}
    </group>
  );
}

function NetworkedAvatars({
  roster,
  playersRef,
  selfIdRef,
}: {
  roster: string[];
  playersRef: MutableRefObject<Map<string, NetPlayer>>;
  selfIdRef: MutableRefObject<string>;
}) {
  return (
    <>
      {roster.map((id) => (
        <NetworkedAvatar key={id} sessionId={id} playersRef={playersRef} isSelf={id === selfIdRef.current} />
      ))}
    </>
  );
}

// 클릭 이동: 바닥 평면 raycast → 서버 좌표로 변환해 move_request 전송.
// 투명(opacity 0)이라 보이지 않지만 raycast는 수신한다(visible=false면 raycast 제외됨).
function MoveGround({ onMove }: { onMove: (fx: number, fy: number) => void }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        const [fx, fy] = worldToFloor(e.point.x, e.point.z);
        onMove(fx, fy);
      }}
    >
      <planeGeometry args={[FLOOR_W * FLOOR_SCALE, FLOOR_H * FLOOR_SCALE]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// 연결 상태 배지 (HTML 오버레이 — Canvas 밖).
function ConnBadge({ status, count }: { status: ConnStatus; count: number }) {
  const map: Record<ConnStatus, { label: string; color: string }> = {
    connecting: { label: '실시간 연결 중…', color: '#F59E0B' },
    connected: { label: `실시간 연결 · ${count}명 접속`, color: '#22C55E' },
    reconnecting: { label: '재연결 중…', color: '#F59E0B' },
    disconnected: { label: '연결 끊김', color: '#EF4444' },
    error: { label: '실시간 서버 오프라인', color: '#94A3B8' },
  };
  const { label, color } = map[status];
  return (
    <div
      style={{
        position: 'absolute', left: 12, top: 44, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 8,
        background: 'rgba(13,27,54,0.78)', backdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: 11, color: '#cbd5e1', pointerEvents: 'none',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color, display: 'inline-block' }} />
      {label}
    </div>
  );
}

export default function OfficeViewport() {
  const { status, roster, playersRef, selfIdRef, requestMove } = useOfficeRoom(true);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <Canvas
      orthographic
      camera={{ position: [40, 34, 40], zoom: 48, near: 0.1, far: 500 }}
      // ACES 톤매핑(README 권장). AA는 EffectComposer multisampling으로.
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, antialias: false }}
      shadows
      dpr={[1, 2]}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#0d1b36']} />
      {/* 환경광은 IBL이 주로 담당 → 직접광은 절제 */}
      <ambientLight intensity={0.28} />
      <hemisphereLight args={['#dfeaff', '#5a4a3a', 0.35]} />
      <directionalLight
        position={[14, 24, 12]}
        intensity={2.0}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
      >
        <orthographicCamera attach="shadow-camera" args={[-11, 11, 11, -11, 0.1, 70]} />
      </directionalLight>
      <Suspense fallback={null}>
        {/* IBL 환경맵(오프라인 안전: Lightformer 절차적) — PBR 재질 반사/필 */}
        <Environment resolution={256} frames={1}>
          <Lightformer
            form="rect"
            intensity={1.6}
            color="#ffffff"
            position={[0, 8, 3]}
            scale={[14, 8, 1]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
          <Lightformer form="rect" intensity={0.9} color="#cfe0ff" position={[-9, 4, -5]} scale={[8, 8, 1]} rotation={[0, Math.PI / 3, 0]} />
          <Lightformer form="rect" intensity={0.7} color="#ffe6c2" position={[9, 4, 5]} scale={[8, 8, 1]} rotation={[0, -Math.PI / 3, 0]} />
        </Environment>
        <OfficeScene />
        {PEOPLE.map((p, i) => (
          <Person key={`p${i}`} {...p} />
        ))}
        {WALKERS.map((w, i) => (
          <Walker key={`w${i}`} {...w} />
        ))}
        {/* C2: 서버 권위 실시간 아바타 + 클릭 이동 바닥 */}
        <NetworkedAvatars roster={roster} playersRef={playersRef} selfIdRef={selfIdRef} />
        <MoveGround onMove={requestMove} />
        <ContactShadows position={[0, 0.01, 0]} opacity={0.45} scale={28} blur={2.6} far={6} />
      </Suspense>
      <OrbitControls target={[0, 1.2, 0]} enablePan={false} minZoom={24} maxZoom={120} />
      <EffectComposer multisampling={4}>
        {/* 발광 스트립·스크린·블루 네온만 은은하게 글로우 */}
        <Bloom luminanceThreshold={0.9} luminanceSmoothing={0.2} mipmapBlur intensity={0.6} radius={0.7} />
      </EffectComposer>
    </Canvas>
      <ConnBadge status={status} count={roster.length} />
    </div>
  );
}

CHAR_URLS.forEach((u) => useGLTF.preload(u, DRACO));
useGLTF.preload(SCENE_URL, DRACO);
