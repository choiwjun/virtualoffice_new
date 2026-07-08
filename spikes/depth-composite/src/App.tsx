/**
 * App.tsx
 * @TASK T0.8 — 깊이합성 스파이크 앱 루트
 * @SPEC docs/planning/16-render-spike-and-roadmap.md#A.3
 *
 * 레이아웃:
 *  - 배경 div: office_bg.png CSS background-image (풀스크린)
 *  - Canvas (투명, fullscreen) — R3F 씬 (아바타 + 와이어프레임)
 *  - HUD overlay — 아바타 위치 + 슬라이더
 *
 * 배경을 CSS로 깔고 Canvas를 투명하게 올리는 이유:
 *  BackgroundQuad(planeGeometry)는 직교카메라 ortho 볼륨과 정렬 맞추기가
 *  복잡하고 오류가 많음. CSS background-size:cover 가 확실히 풀스크린을 보장.
 *  깊이합성 셰이더는 office_depth.png를 screenUV로 샘플하므로 배경 표시 방식과 무관.
 */

import { Suspense, useState, useEffect, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import {
  DepthCompositeScene,
  AVATAR_INIT,
  AVATAR_INIT_S,
  sliderToAvatarPos,
} from "./components/DepthCompositeScene";
import type { CameraJson } from "./types/camera";

// 에셋 경로 (public/에 복사됨 — build_office.py 산출물)
const BG_URL = "/office_bg.png";
const DEPTH_URL = "/office_depth.png";
const CAMERA_JSON_URL = "/camera.json";

async function loadCameraJson(url: string): Promise<CameraJson> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`camera.json 로드 실패: ${res.status}`);
  return res.json();
}

function LoadingScreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#1a1a2e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#aaa",
        fontFamily: "monospace",
        fontSize: "14px",
      }}
    >
      <div>
        <div style={{ marginBottom: 8 }}>Phase 0 Depth-Composite Spike</div>
        <div style={{ color: "#666" }}>에셋 로딩 중...</div>
      </div>
    </div>
  );
}

// HUD 오버레이
interface HudProps {
  avatarPos: [number, number, number];
  sliderS: number;
  onSliderS: (v: number) => void;
  onReset: () => void;
}

function Hud({ avatarPos, sliderS, onSliderS, onReset }: HudProps) {
  const [x, y, z] = avatarPos;

  // 앞/뒤 판정: sliderS 기준
  // s < -0.3: 책상 앞 (카메라 가까운 쪽)
  // s > +0.3: 책상 뒤 (카메라 먼 쪽)
  const deskStatus =
    sliderS < -0.3
      ? "책상 앞 — 온전히 보여야 함"
      : sliderS > 0.3
      ? "책상 뒤 — 가려져야 함 (하반신 discard)"
      : "책상 동일 깊이";

  const statusColor = sliderS < -0.3 ? "#4f4" : sliderS > 0.3 ? "#f84" : "#fa0";

  return (
    <>
      {/* 좌상단: 컨트롤 */}
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          background: "rgba(0,0,0,0.75)",
          color: "#eee",
          padding: "12px 16px",
          borderRadius: 8,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.8,
          userSelect: "none",
          minWidth: 280,
        }}
      >
        <div style={{ color: "#4af", fontWeight: "bold", marginBottom: 6 }}>
          Phase 0 — 깊이합성 오클루전 스파이크
        </div>

        {/* Z축 슬라이더: 책상 앞 ↔ 뒤 */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ color: "#fa0", marginBottom: 2 }}>
            슬라이더: 책상 앞(−) ↔ 책상 뒤(+)
          </div>
          <input
            id="slider-s"
            type="range"
            min={-3}
            max={3}
            step={0.05}
            value={sliderS}
            onChange={(e) => onSliderS(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ fontSize: 11, color: "#888", display: "flex", justifyContent: "space-between" }}>
            <span>← 앞 (보임)</span>
            <span>s = {sliderS.toFixed(2)}</span>
            <span>뒤 (가려짐) →</span>
          </div>
        </div>

        <button
          onClick={onReset}
          style={{
            background: "#333",
            color: "#eee",
            border: "1px solid #555",
            borderRadius: 4,
            padding: "4px 12px",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          초기화 (s = {AVATAR_INIT_S})
        </button>
      </div>

      {/* 우상단: 아바타 위치 + 상태 */}
      <div
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          background: "rgba(0,0,0,0.75)",
          color: "#eee",
          padding: "12px 16px",
          borderRadius: 8,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.8,
          minWidth: 240,
        }}
      >
        <div style={{ color: "#4af", fontWeight: "bold", marginBottom: 4 }}>
          아바타 위치 (Three.js)
        </div>
        <div>X: {x.toFixed(3)}</div>
        <div>Y: {y.toFixed(3)} (발 높이)</div>
        <div>Z: {z.toFixed(3)}</div>
        <div style={{ marginTop: 6, color: statusColor, fontWeight: "bold" }}>
          {deskStatus}
        </div>
        <div style={{ marginTop: 4, color: "#666", fontSize: 10 }}>
          슬라이더 s={sliderS.toFixed(2)}, 이동방향 XZ(0.707,0.707)
        </div>
      </div>

      {/* 좌하단: 수용기준 */}
      <div
        style={{
          position: "fixed",
          bottom: 12,
          left: 12,
          background: "rgba(0,0,0,0.75)",
          color: "#eee",
          padding: "12px 16px",
          borderRadius: 8,
          fontFamily: "monospace",
          fontSize: 11,
          lineHeight: 1.9,
        }}
      >
        <div style={{ color: "#4af", fontWeight: "bold", marginBottom: 4 }}>
          수용기준 (docs/16 §A.3)
        </div>
        <div>[ ] 책상 앞(s&lt;0) → 아바타 온전히 보임</div>
        <div>[ ] 책상 뒤(s&gt;0) → 하반신이 책상에 가려짐</div>
        <div>[ ] 배경 office_bg.png 풀스크린 표시</div>
        <div>[ ] 스크린샷 2종 저장 (evidence/)</div>
        <div style={{ marginTop: 6, color: "#888", fontSize: 10 }}>
          깊이 bias=0.001 | near=0.1, far=100 | 씬깊이~0.15
        </div>
      </div>

      {/* 우하단: 범례 */}
      <div
        style={{
          position: "fixed",
          bottom: 12,
          right: 12,
          background: "rgba(0,0,0,0.6)",
          color: "#888",
          padding: "8px 12px",
          borderRadius: 8,
          fontFamily: "monospace",
          fontSize: 10,
          lineHeight: 1.7,
        }}
      >
        <div style={{ color: "#f84" }}>orange wire = 책상 (Blender y=1.2)</div>
        <div style={{ color: "#48f" }}>blue wire = 유리벽 (Blender y=-0.5)</div>
        <div style={{ color: "#f44" }}>red disk = 아바타 발 마커</div>
        <div style={{ color: "#6cf" }}>blue body = 아바타 (깊이합성 적용)</div>
      </div>
    </>
  );
}

export default function App() {
  const [camData, setCamData] = useState<CameraJson | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sliderS, setSliderS] = useState<number>(AVATAR_INIT_S);
  const [avatarPos, setAvatarPos] = useState<[number, number, number]>(AVATAR_INIT);

  // camera.json 로드 (마운트 1회)
  useEffect(() => {
    loadCameraJson(CAMERA_JSON_URL)
      .then((data) => setCamData(data))
      .catch((err) => setLoadError(String(err)));
  }, []);

  // 슬라이더 변경 → 아바타 위치 갱신
  const handleSliderS = useCallback((s: number) => {
    setSliderS(s);
    setAvatarPos(sliderToAvatarPos(s));
  }, []);

  const handleReset = useCallback(() => {
    setSliderS(AVATAR_INIT_S);
    setAvatarPos(AVATAR_INIT);
  }, []);

  if (loadError) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#1a1a2e",
          color: "#f44",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          padding: 24,
        }}
      >
        <div>
          <div style={{ fontWeight: "bold", marginBottom: 8 }}>에셋 로드 오류</div>
          <div style={{ color: "#aaa", fontSize: 12 }}>{loadError}</div>
          <div style={{ marginTop: 12, color: "#888", fontSize: 11 }}>
            python render-pipeline/generate_test_assets.py 를 먼저 실행하세요.
          </div>
        </div>
      </div>
    );
  }

  if (!camData) return <LoadingScreen />;

  return (
    <>
      {/*
       * 배경 레이어: office_bg.png 풀스크린 CSS background
       * Canvas를 transparent로 하고 그 아래에 깔아 확실히 풀스크린 표시.
       * Canvas background=transparent 이므로 이 배경이 보임.
       */}
      <div
        id="bg-layer"
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `url(${BG_URL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          zIndex: 0,
        }}
      />

      {/*
       * R3F Canvas: 투명 배경으로 배경 div 위에 올라감
       * camera는 camera.json 값으로 useEffect 내에서 덮어씀
       */}
      <Canvas
        orthographic
        camera={{
          left: -7.111,
          right: 7.111,
          top: 4.0,
          bottom: -4.0,
          near: 0.1,
          far: 100,
          position: [8.66, 8.66, 8.66],
        }}
        gl={{
          antialias: true,
          alpha: true,        // 캔버스 배경 투명
          toneMapping: THREE.NoToneMapping,
        }}
        style={{ position: "fixed", inset: 0, zIndex: 1 }}
      >
        <Suspense fallback={null}>
          <DepthCompositeScene
            camData={camData}
            depthUrl={DEPTH_URL}
            avatarPos={avatarPos}
            depthBias={0.001}
          />
        </Suspense>
      </Canvas>

      {/* HUD: Canvas 위에 올라감 */}
      <div style={{ position: "fixed", inset: 0, zIndex: 2, pointerEvents: "none" }}>
        <div style={{ pointerEvents: "auto" }}>
          <Hud
            avatarPos={avatarPos}
            sliderS={sliderS}
            onSliderS={handleSliderS}
            onReset={handleReset}
          />
        </div>
      </div>
    </>
  );
}
