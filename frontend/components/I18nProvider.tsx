'use client';

/**
 * I18nProvider — 로케일 컨텍스트 + `useT()`.
 *
 * `BrandingProvider`와 같은 자리(앱 최상단)에 둔다. 로케일은 마운트 후에 확정된다 —
 * SSR에는 localStorage가 없어 서버가 사용자 선택을 알 수 없다. 그래서 첫 페인트는 기본
 * 로케일이고, 마운트 직후 선택값으로 교체된다(하이드레이션 불일치를 피하는 유일한 방법).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE,
  detectLocale,
  saveLocale,
  translate,
  type Locale,
  type MessageKey,
  type TranslateVars,
} from '@/lib/i18n';

interface I18nValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: MessageKey, vars?: TranslateVars) => string;
}

const I18nCtx = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const detected = detectLocale();
    if (detected !== DEFAULT_LOCALE) setLocaleState(detected);
    document.documentElement.lang = detected;
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    saveLocale(next);
    if (typeof document !== 'undefined') document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  );

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

/**
 * 프로바이더 밖에서도 죽지 않는다 — 기본 로케일로 번역한다.
 *
 * 로그인 전 화면·에러 바운더리처럼 프로바이더 트리 밖에서 렌더되는 자리가 있고, 거기서
 * 예외를 던지면 문구 하나 때문에 화면이 통째로 안 뜬다.
 */
export function useT(): I18nValue {
  const ctx = useContext(I18nCtx);
  if (ctx) return ctx;
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
  };
}
