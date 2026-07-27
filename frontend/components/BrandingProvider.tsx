'use client';

/**
 * BrandingProvider — 로그인 후 테넌트 브랜딩을 읽어 CSS 변수에 주입하고 컨텍스트로 공급한다.
 * (E5 · 24-spec Phase 4)
 *
 * `(protected)` 트리 최상단에 둔다. 셸·설정 화면이 `useBranding()`으로 브랜드명·로고를 쓰고,
 * 색은 `applyBrandColors`가 `:root`를 덮어써 Tailwind 유틸 전체에 자동 반영된다.
 *
 * FOUC: 초기값은 globals.css의 기본 토큰 → fetch 후 덮어쓴다. 브랜드 색을 쓰는 표면이
 * 버튼·액센트로 한정돼 있어 깜빡임이 눈에 띄지 않는다(SSR 프리로드는 후속).
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { applyBrandColors, type Branding } from '@/lib/branding';

interface BrandingContextValue {
  branding: Branding | null;
  /** 관리자가 브랜딩을 저장한 직후 즉시 반영시킬 때 호출 (재로그인 불필요). */
  refresh: () => Promise<void>;
  /** 저장 전 미리보기 — 서버 상태는 그대로 두고 화면 색만 바꾼다. */
  preview: (partial: Pick<Branding, 'primary_color' | 'accent_color'> | null) => void;
}

const BrandingCtx = createContext<BrandingContextValue>({
  branding: null,
  refresh: async () => {},
  preview: () => {},
});

export function useBranding(): BrandingContextValue {
  return useContext(BrandingCtx);
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Branding | null>(null);

  async function load(): Promise<Branding | null> {
    try {
      const b = await api.get<Branding>('/api/branding');
      setBranding(b);
      applyBrandColors(b);
      return b;
    } catch {
      // 브랜딩 실패가 앱 진입을 막으면 안 된다 — 기본 테마로 계속.
      return null;
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: BrandingContextValue = {
    branding,
    refresh: async () => {
      await load();
    },
    preview: (partial) => applyBrandColors(partial ?? branding),
  };

  return <BrandingCtx.Provider value={value}>{children}</BrandingCtx.Provider>;
}
