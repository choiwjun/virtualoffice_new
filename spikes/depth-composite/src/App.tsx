/**
 * App.tsx
 * @TASK T0.8 — 깊이합성 스파이크 앱 루트
 * @SPEC docs/planning/16-render-spike-and-roadmap.md#A.3
 *
 * 레이아웃:
 *  - Canvas (fullscreen) — R3F 씬
 *  - HUD overlay — 아바타 위치 표시 + 이동 컨트롤 슬라이더
 *  - 수용기준 체크리스트 (좌하단)
 */

import { Suspense, useState, useEffect, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { DepthCompositeScene, AVATAR_INIT } from "./components/DepthCompositeScene";
import type { CameraJson } from "./types/camera";

// 에셋 경로 (Vite가 public/ 또는 상대 경로로 서빙)
const BG_URL = "../../render-pipeline/out/office_bg.png";
const DEPTH_URL = "../../render-pipeline/out/office_depth.png";
const CAMERA_JSON_URL = "../../render-pipeline/out/camera.json";

// 카메라 JSON 동기 로드 (fetch + useState 조합)
async function loadCameraJson(url: string): Promise<CameraJson> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`camera.json 로드 실패: ${res.status}`);
  return res.json();
}

// 로딩 폴백 컴포넌트
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
  zSlider: number;
  onZSlider: (v: number) => void;
  onReset: () => void;
}

function Hud({ avatarPos, zSlider, onZSlider, onReset }: HudProps) {
  const [x, y, z] = avatarPos;

  // 책상 앞/뒤 판정 (Three.js Z: 책상이 Z=-1.2 근처)
  // 아바타 Z > -0.5 → 앞, Z < -1.9 → 뒤
  const deskStatus =
    z > -0.5 ? "책상 앞 (보여야 함)" : z < -1.9 ? "책상 뒤 (가려져야 함)" : "책상 근처";

  return (
    <>
      {/* 좌상단: 컨트롤 */}
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          background: "rgba(0,0,0,0.7)",
          color: "#eee",
          padding: "12px 16px",
          borderRadius: 8,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.8,
          userSelect: "none",
          minWidth: 260,
        }}
      >
        <div style={{ color: "#4af", fontWeight: "bold", marginBottom: 6 }}>
          Phase 0 — 깊이합성 스파이크
        </div>

        <div style={{ color: "#aaa", marginBottom: 8 }}>
          이동: WASD / 방향키 &nbsp;|&nbsp; 높이: Q(위) E(아래)
        </div>

        {/* Z축 슬라이더 (책상 앞뒤) */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ color: "#fa0", marginBottom: 2 }}>
            Z축 슬라이더 (책상 앞 ↔ 뒤)
          </div>
          <input
            type="range"
            min={-3}
            max={3}
            step={0.05}
            value={zSlider}
            onChange={(e) => onZSlider(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ fontSize: 11, color: "#888" }}>
            Z = {zSlider.toFixed(2)} &nbsp; (책상: Z ≈ -1.2)
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
          위치 초기화
        </button>
      </div>

      {/* 우상단: 아바타 위치 */}
      <div
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          background: "rgba(0,0,0,0.7)",
          color: "#eee",
          padding: "12px 16px",
          borderRadius: 8,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.8,
          minWidth: 220,
        }}
      >
        <div style={{ color: "#4af", fontWeight: "bold", marginBottom: 4 }}>
          아바타 위치 (Three.js)
        </div>
        <div>X: {x.toFixed(3)}</div>
        <div>Y: {y.toFixed(3)}</div>
        <div>Z: {z.toFixed(3)}</div>
        <div style={{ marginTop: 6, color: "#fa0" }}>{deskStatus}</div>
      </div>

      {/* 좌하단: 수용기준 */}
      <div
        style={{
          position: "fixed",
          bottom: 12,
          left: 12,
          background: "rgba(0,0,0,0.7)",
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
        <div>[ ] 책상 앞 → 아바타 온전히 보임</div>
        <div>[ ] 책상 뒤 → 아바타 정확히 가려짐 (≤2px 오차)</div>
        <div>[ ] 발 위치 = 배경 바닥과 좌표 정합</div>
        <div>[ ] 스크린샷 3종 저장 (evidence/)</div>
        <div
          style={{ marginTop: 6, color: "#f84", fontSize: 10 }}
        >
          육안확인필요: Blender 없어 더미 에셋 사용
        </div>
      </div>

      {/* 우하단: 조작 안내 */}
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
        <div>orange dot = 발 위치 마커</div>
        <div>orange wire = 책상 영역</div>
        <div>blue wire = 유리벽 영역</div>
      </div>
    </>
  );
}

// 메인 앱 — camera.json 로드 후 씬 마운트
export default function App() {
  const [camData, setCamData] = useState<CameraJson | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [avatarPos, setAvatarPos] = useState<[number, number, number]>(AVATAR_INIT);
  const [zSlider, setZSlider] = useState(AVATAR_INIT[2]);

  // camera.json 로드 (마운트 1회)
  useEffect(() => {
    loadCameraJson(CAMERA_JSON_URL)
      .then((data) => setCamData(data))
      .catch((err) => setLoadError(String(err)));
  }, []);

  const handleZSlider = useCallback((v: number) => {
    setZSlider(v);
    setAvatarPos((prev) => [prev[0], prev[1], v]);
  }, []);

  const handleReset = useCallback(() => {
    setAvatarPos(AVATAR_INIT);
    setZSlider(AVATAR_INIT[2]);
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
      <Canvas
        orthographic
        camera={{
          // 초기값 — useEffect에서 camera.json으로 덮어씀
          left: -7.11,
          right: 7.11,
          top: 4,
          bottom: -4,
          near: 0.1,
          far: 100,
          position: [8.66, 8.66, -8.66],
        }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
        style={{ position: "fixed", inset: 0 }}
      >
        <Suspense fallback={null}>
          <DepthCompositeScene
            camData={camData}
            bgUrl={BG_URL}
            depthUrl={DEPTH_URL}
            avatarPos={avatarPos}
          />
        </Suspense>
      </Canvas>

      <Hud
        avatarPos={avatarPos}
        zSlider={zSlider}
        onZSlider={handleZSlider}
        onReset={handleReset}
      />
    </>
  );
}
