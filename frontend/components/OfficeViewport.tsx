'use client';

// 실시간 R3F 오피스 뷰포트 — v10.0 PBR 강화 리깅 에셋 + 렌더 폴리싱 (D28.2, 2026-07-11).
// 첨부 패키지(virtual_office_complete_product_v10_0) 정합 사용. 정본 레지스트리 = 05_registries/asset-registry-v10.json.
//  · 씬 = SCENE_ACME_HQ_HERO_V4_001.glb (PBR 내장, 텍스처 114장 — v8 대비 토폴로지 동일·머티리얼만 강화). 정적 T포즈 인물은 숨기고 애니 아바타로 대체.
//  · 캐릭터 = characters_rigged/*.glb (동일 V8 rig 18조인트·12클립 유지, PBR 텍스처 내장). 렌더 = IBL 환경맵 + ACES + Bloom + 소프트 그림자.
// 스킨드 메시 복제는 SkeletonUtils.clone(three/examples) — 일반 clone은 스켈레톤 바인딩이 깨진다.
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useGLTF, OrbitControls, ContactShadows, Html } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useOfficeRoom } from '@/hooks/useOfficeRoom';
import type { ConnStatus, NetPlayer } from '@/lib/realtime';

// glb Z-up → three.js Y-up 보정 (v8 에셋 up-axis Z, pivot BOTTOM_CENTER)
const ZUP: [number, number, number] = [-Math.PI / 2, 0, 0];

// 캐릭터는 Draco 지오메트리 압축본. 디코더는 CDN 대신 로컬(public/draco/, 온프렘 친화).
const DRACO = '/draco/';

// 씬 = 풀 PBR SCENE_ACME_HQ_HERO_V4_001.glb(22.4MB, 텍스처 114장, 비압축) — 압축본보다 텍스처 선명.
const SCENE_URL = '/office/scene_v10_full.glb';
// 캐릭터 = v10 패키지 원본(characters_rigged, 비압축) — 구형 Draco 재압축본은 리깅 손상(X자 팔)이라 폐기.
const HERO_M = '/office/characters_rigged/CHAR_MALE_RIGGED_HERO_V8_001.glb';
const HERO_F = '/office/characters_rigged/CHAR_FEMALE_RIGGED_HERO_V8_001.glb';
const HERO_RECEP = '/office/characters_rigged/CHAR_RECEPTIONIST_RIGGED_HERO_V8_001.glb';
const M1 = '/office/characters_rigged/CHAR_MALE_001_RIGGED_V8.glb';
const MCASUAL = '/office/characters_rigged/CHAR_MALE_CASUAL_002_RIGGED_V8.glb';
const F1 = '/office/characters_rigged/CHAR_FEMALE_001_RIGGED_V8.glb';
const FBIZ = '/office/characters_rigged/CHAR_FEMALE_BUSINESS_002_RIGGED_V8.glb';
const CHAR_URLS = [HERO_M, HERO_F, HERO_RECEP, M1, MCASUAL, F1, FBIZ];

// ─────────────────────────────────────────────
// C2: 서버 좌표(20×15m 데모 층 평면) ↔ R3F 월드 매핑.
// 서버 중앙(10,7.5) → 월드 원점(0,0). scale는 씬 크기에 맞춘 근사(실 레이아웃 연동 시 교체).
// floor y → world z, floor x → world x.
// ─────────────────────────────────────────────
const FLOOR_W = 20;
const FLOOR_H = 15;
const FLOOR_SCALE = 0.52; // 데모 층 20×15m → 월드 ±5.2×±3.9. 씬 실측 바닥 footprint(±5.9×±3.7)에 맞춤.
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

// ─────────────────────────────────────────────
// 레퍼런스 디자인의 오버레이 pill: 아바타 이름표 + 룸 라벨 (07_visual_reference 정합)
// drei <Html>은 캔버스 위 DOM으로 투영되어 3D 위치를 따라간다.
// ─────────────────────────────────────────────
function NameTag({ name, dotColor = '#22C55E' }: { name: string; dotColor?: string }) {
  return (
    <Html center position={[0, 2.05, 0]} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
          padding: '3px 10px', borderRadius: 999,
          background: 'rgba(13,20,36,0.92)', border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
          fontSize: 11, fontWeight: 600, color: '#F1F5F9',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: dotColor, flexShrink: 0 }} />
        {name}
      </div>
    </Html>
  );
}

function RoomLabel({ pos, name, sub }: { pos: [number, number, number]; name: string; sub?: string }) {
  return (
    <Html center position={pos} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          whiteSpace: 'nowrap', padding: '6px 12px', borderRadius: 10,
          background: 'rgba(10,16,30,0.92)', border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 3px 12px rgba(0,0,0,0.5)', textAlign: 'left',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: '#F8FAFC', lineHeight: 1.2 }}>{name}</div>
        {sub && <div style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1.3 }}>{sub}</div>}
      </div>
    </Html>
  );
}

// 씬에 구워진 정적 T포즈 인물 노드명 (가구 아님) — 이 접두사로 시작하면 숨긴다.
const BAKED_PEOPLE = /^(worker_|ethan_|walk_|receptionist_|meeting_person)/i;
// 발광 부스트는 진짜 발광체(네온/LED/스크린)만 — 'warm/light' 등 이름만 밝은 가구 재질을 태우면 안 됨.
const EMISSIVE_MAT = /neon|led|screen|display|monitor/i;

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
          // 이미 emissive 색이 있는 진짜 발광체만 부스트 — 흰 가구가 광원처럼 타는 버그 방지.
          if (
            mm &&
            EMISSIVE_MAT.test(mm.name || '') &&
            mm.emissive &&
            mm.emissive.r + mm.emissive.g + mm.emissive.b > 0.01
          ) {
            mm.emissiveIntensity = 2.2;
          }
        });
      }
    });
  }, [scene]);
  return <primitive object={scene} rotation={ZUP} />;
}

// 리깅 캐릭터 독립 인스턴스: SkeletonUtils.clone로 스켈레톤까지 복제 후 지정 클립 루프 재생.
// 정본 런타임(11_complete_runtime_app/AvatarController.ts)과 동일 — 클립을 트랙 필터/본 보정 없이
// 그대로 재생한다(v10 클립이 팔 포즈를 소유. 구버전 '팔 내림 핵'은 X자 팔 버그의 원인이었음).
// rate: 재생속도 ref — 걷기 시 실제 이동속도에 맞춰 발 미끄러짐(문워크) 방지.
function useRiggedCharacter(url: string, clip: string) {
  const { scene, animations } = useGLTF(url, DRACO);
  const rate = useRef(1);
  const inst = useMemo(() => {
    const c = skeletonClone(scene);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    return c;
  }, [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(inst), [inst]);
  useEffect(() => {
    const src = THREE.AnimationClip.findByName(animations, clip) ?? animations[0];
    if (!src) return;
    const action = mixer.clipAction(src);
    action.reset().fadeIn(0.25).play();
    return () => {
      action.fadeOut(0.1);
      mixer.stopAllAction();
    };
  }, [mixer, animations, clip]);
  useFrame((_, dt) => mixer.update(dt * rate.current));
  return { inst, rate };
}

/** 걷기 클립이 기준하는 보행속도(정본 AvatarController speed=1.35 u/s). 실이동/기준 비율로 재생속도 동기화. */
const WALK_CLIP_SPEED = 1.35;

function Person({
  url,
  clip,
  pos,
  rot,
  name,
  dot,
}: {
  url: string;
  clip: string;
  pos: [number, number, number];
  rot: number;
  name?: string;
  dot?: string;
}) {
  const { inst } = useRiggedCharacter(url, clip);
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <primitive object={inst} rotation={ZUP} />
      {name && <NameTag name={name} dotColor={dot} />}
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
  const { inst, rate } = useRiggedCharacter(url, clip);
  const g = useRef<THREE.Group>(null!);
  const prev = useRef<[number, number]>([0, 0]);
  useFrame((state, dt) => {
    if (!g.current) return;
    const t = state.clock.getElapsedTime();
    const [x, z] = path(t);
    g.current.position.set(x, 0, z);
    const [px, pz] = prev.current;
    const dx = x - px, dz = z - pz;
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) g.current.rotation.y = Math.atan2(dx, dz);
    // 발 미끄러짐 방지: 걷기 클립 재생속도를 실제 경로 속도에 동기화.
    const sp = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
    rate.current = THREE.MathUtils.clamp(sp / WALK_CLIP_SPEED, 0.3, 1.3);
    prev.current = [x, z];
  });
  return (
    <group ref={g}>
      <primitive object={inst} rotation={ZUP} />
    </group>
  );
}

// 씬 실측 인물 자리(three 월드 X=좌우·Z=깊이). 베이크 정적본을 숨기고 이 자리를 애니 아바타로 대체.
const PEOPLE: { url: string; clip: string; pos: [number, number, number]; rot: number; name?: string; dot?: string }[] = [
  { url: HERO_RECEP, clip: 'ANIM_IDLE_001', pos: [-3.7, 0, -1.61], rot: 0.8, name: 'Olivia' }, // 리셉션(기립)
  { url: HERO_M, clip: 'ANIM_TALK_001', pos: [-1.3, 0, 2.91], rot: 2.0, name: 'Lucas' }, // 카페 쪽 대화
  { url: HERO_F, clip: 'ANIM_TALK_001', pos: [-2.3, 0, 2.7], rot: -1.0, name: 'Maya' }, // 카페 대화 상대
  { url: M1, clip: 'ANIM_TYPING_001', pos: [1.56, 0, 1.06], rot: Math.PI, name: 'Jordan' }, // 데스크 워커(착석 타이핑)
  { url: F1, clip: 'ANIM_TYPING_001', pos: [0.04, 0, 3.24], rot: 0, name: 'Sophia' }, // 데스크 워커(착석)
  { url: FBIZ, clip: 'ANIM_MEETING_IDLE_001', pos: [2.53, 0, 0.63], rot: 0.7, name: 'Emma', dot: '#EF4444' }, // 회의 착석
  { url: MCASUAL, clip: 'ANIM_MEETING_IDLE_001', pos: [3.94, 0, 0.63], rot: 1.1, name: 'Noah', dot: '#EF4444' }, // 회의 착석
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
  const { inst, rate } = useRiggedCharacter(url, clip);
  const g = useRef<THREE.Group>(null!);
  const prev = useRef<[number, number]>([0, 0]);
  const idleFrames = useRef(99);
  const isWalk = useRef(false);
  const spawned = useRef(false);

  useFrame((_, dt) => {
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
    // 발 미끄러짐 방지: 걷기 클립 재생속도를 화면상 실제 이동속도에 동기화.
    const sp = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
    rate.current = wantWalk ? THREE.MathUtils.clamp(sp / WALK_CLIP_SPEED, 0.3, 1.2) : 1;
  });

  const displayName = playersRef.current.get(sessionId)?.name || (isSelf ? '나' : '게스트');
  return (
    <group ref={g}>
      <primitive object={inst} rotation={ZUP} />
      <NameTag name={isSelf ? `${displayName} (나)` : displayName} dotColor={isSelf ? '#3B82F6' : '#22C55E'} />
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

// 클릭 이동: 바닥 평면 raycast → 서버 좌표로 변환(bounds 클램프)해 move_request 전송.
// 평면을 크게(80×80) + 씬 바닥 살짝 위(y=0.01)에 둬서 어느 지점을 클릭해도 raycast가 잡는다.
// 클릭 지점에 시안색 마커 링을 띄워 피드백을 준다.
function MoveGround({ onMove }: { onMove: (fx: number, fy: number) => void }) {
  const [marker, setMarker] = useState<[number, number] | null>(null);
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          let [fx, fy] = worldToFloor(e.point.x, e.point.z);
          fx = Math.max(0, Math.min(FLOOR_W, fx));
          fy = Math.max(0, Math.min(FLOOR_H, fy));
          onMove(fx, fy);
          setMarker(floorToWorld(fx, fy));
        }}
      >
        <planeGeometry args={[80, 80]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {marker && (
        <mesh position={[marker[0], 0.03, marker[1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.13, 0.22, 28]} />
          <meshBasicMaterial color="#22D3EE" transparent opacity={0.95} />
        </mesh>
      )}
    </>
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

// 정본 런타임(11_complete_runtime_app/OfficeApp.ts)과 동일한 스튜디오 IBL:
// three RoomEnvironment을 PMREM으로 구워 scene.environment에 넣는다(온프렘 안전, 네트워크 불필요).
function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    return () => {
      scene.environment = null;
      envTex.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

export default function OfficeViewport() {
  const { status, roster, playersRef, selfIdRef, requestMove } = useOfficeRoom(true);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <Canvas
      // 정본 렌더링(OfficeApp.ts): Perspective + ACES exposure 1.08 + PCFSoft 그림자.
      camera={{ fov: 38, position: [8.2, 6.6, 9.2], near: 0.05, far: 200 }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 1.05;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
      shadows
      dpr={[1, 2]}
      style={{ width: '100%', height: '100%' }}
    >
      {/* 배경/포그: 레퍼런스(07_visual_reference) 딥네이비 */}
      <color attach="background" args={['#0b1220']} />
      <fogExp2 attach="fog" args={['#0b1220', 0.01]} />
      {/* 정본 라이팅(OfficeApp.ts) + 레퍼런스 밝은 실내 무드 상향 */}
      <hemisphereLight args={['#bdd8ff', '#3a2d22', 1.2]} />
      <directionalLight
        position={[12, 20, 10]}
        intensity={4.2}
        color="#fff1dc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
      >
        <orthographicCamera attach="shadow-camera" args={[-11, 11, 11, -11, 0.1, 70]} />
      </directionalLight>
      <directionalLight position={[-8, 6, -7]} intensity={1.1} color="#7ba9ff" />
      {/* 실내 웜 포인트라이트: 리셉션·라운지 온광 + 회의실 쿨광 (레퍼런스 무드) */}
      <pointLight position={[-3.7, 2.4, -1.6]} color="#ffd2a3" intensity={4.5} distance={6.5} />
      <pointLight position={[-1.7, 2.5, 2.8]} color="#ffe0b8" intensity={3.5} distance={6} />
      <pointLight position={[3.2, 2.4, 0.7]} color="#bcd6ff" intensity={3} distance={5.5} />
      <Suspense fallback={null}>
        {/* 스튜디오 IBL(RoomEnvironment PMREM) — PBR 재질 반사/필 (정본과 동일) */}
        <StudioEnvironment />
        <OfficeScene />
        {/* 룸 라벨 pill (레퍼런스: Reception / Board Room / Lounge) */}
        <RoomLabel pos={[-4.1, 2.2, -1.9]} name="Reception" sub="리셉션" />
        <RoomLabel pos={[3.3, 2.3, 0.3]} name="Board Room" sub="회의실 · 유리룸" />
        <RoomLabel pos={[-3.4, 2.4, 1.9]} name="Lounge" sub="라운지 · 카페" />
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
      <OrbitControls target={[0, 0.4, 0]} enablePan={false} minDistance={6} maxDistance={26} maxPolarAngle={Math.PI / 2.2} />
      <EffectComposer multisampling={4}>
        {/* LED 스트립·스크린·블루 네온 글로우 (레퍼런스의 회의실 네온 프레임 강조) */}
        <Bloom luminanceThreshold={0.92} luminanceSmoothing={0.2} mipmapBlur intensity={0.55} radius={0.7} />
      </EffectComposer>
    </Canvas>
      <ConnBadge status={status} count={roster.length} />
    </div>
  );
}

CHAR_URLS.forEach((u) => useGLTF.preload(u, DRACO));
useGLTF.preload(SCENE_URL, DRACO);
