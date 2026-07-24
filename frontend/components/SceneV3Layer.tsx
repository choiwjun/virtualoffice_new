'use client';

/**
 * SceneV3Layer — D35 "텍스처드 탑다운 V3" 씬 배경(feature flag ON일 때만 마운트).
 *
 * public/plate-v3/horizon-scene-v3.js(HorizonSceneV3.renderScene)를 1회 동적 로드하고,
 * buildV3Layout()으로 만든 레이아웃을 캔버스에 그려 기존 플레이트 배경을 대체한다.
 * people 레이어는 제외(실아바타 = Colyseus). 테마 변경 시 비동기 재렌더(웜 ~300ms, UI 비차단).
 *
 * 캔버스는 절대충전(inset-0, w/h 100%) — 스테이지 박스(플레이트 20:11.256 비율)에 맞춰
 * object-fit: fill로 늘린다. v3 월드(20×11.256)와 스테이지 비율이 동일하므로 왜곡 없음.
 * 좌표 정합: 월드 미터 → 정규는 metersToNorm과 일치(어댑터 주석 참조) → 아바타/좌석 정렬 유지.
 *
 * renderScale: 방 포커스 줌 시 캔버스가 CSS로 확대되면 백킹 해상도가 그만큼 떨어져 흐려진다.
 *   줌 배율만큼 백킹 픽셀을 키워(1920×scale) 재렌더하면 확대해도 선명(D35 "줌 재렌더"). 기본 1.
 */

import { useEffect, useRef, useState } from 'react';
import { buildV3Layout } from '@/lib/office2dToV3';
import type { SceneThemeId } from '@/lib/office2d';

const SCRIPT_SRC = '/plate-v3/horizon-scene-v3.js';
const V3_LAYERS = ['floor', 'furniture', 'foreground', 'grade'] as const; // people 제외

interface RenderSceneOpts {
  canvas: HTMLCanvasElement;
  theme: SceneThemeId;
  layers: readonly string[];
  width?: number;
  height?: number;
}
interface HorizonSceneV3Api {
  renderScene: (layout: unknown, opts: RenderSceneOpts) => { canvas: HTMLCanvasElement };
}
declare global {
  interface Window {
    HorizonSceneV3?: HorizonSceneV3Api;
  }
}

/** 스크립트 1회 로드(중복 주입 방지) — 이미 로드됐으면 즉시 resolve. */
let scriptPromise: Promise<HorizonSceneV3Api> | null = null;
function loadV3(): Promise<HorizonSceneV3Api> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.HorizonSceneV3) return Promise.resolve(window.HorizonSceneV3);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<HorizonSceneV3Api>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const onOk = () => {
      if (window.HorizonSceneV3) resolve(window.HorizonSceneV3);
      else reject(new Error('HorizonSceneV3 not exposed after load'));
    };
    if (existing) {
      if (window.HorizonSceneV3) return resolve(window.HorizonSceneV3);
      existing.addEventListener('load', onOk, { once: true });
      existing.addEventListener('error', () => reject(new Error('v3 script load error')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.addEventListener('load', onOk, { once: true });
    s.addEventListener('error', () => reject(new Error('v3 script load error')), { once: true });
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export default function SceneV3Layer({ theme, renderScale = 1 }: { theme: SceneThemeId; renderScale?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const scale = Math.min(2.5, Math.max(1, renderScale)); // 백킹 해상도 배율(과도한 메모리 방지 상한 2.5)

  // 스크립트 로드(마운트 1회).
  useEffect(() => {
    let cancelled = false;
    loadV3()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        // 로드 실패 — 캔버스는 빈 채로 두고(호출측 배경색 유지), 회귀 없음.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 렌더/재렌더 — ready + theme 변경 시. 비동기 프레임에 그려 UI를 막지 않는다.
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const api = typeof window !== 'undefined' ? window.HorizonSceneV3 : undefined;
    if (!canvas || !api) return;
    let raf = 0;
    let cancelled = false;
    raf = requestAnimationFrame(() => {
      if (cancelled) return;
      try {
        const width = Math.round(1920 * scale);
        api.renderScene(buildV3Layout(), {
          canvas,
          theme,
          layers: V3_LAYERS,
          width,
          height: Math.round((width * 941) / 1672), // 플레이트 20:11.256 비율
        });
      } catch {
        // 렌더 실패 시 이전 프레임 유지(빈 캔버스면 배경색 노출) — 회귀 없음.
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [ready, theme, scale]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 w-full h-full"
      style={{ display: 'block', objectFit: 'fill' }}
    />
  );
}
