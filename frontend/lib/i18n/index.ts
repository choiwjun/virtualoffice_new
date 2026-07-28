/**
 * i18n 런타임 — 화면 문구를 코드에서 떼어낸다 (23 C1).
 *
 * 한국어 1,800줄+이 컴포넌트에 박혀 있다. 라이브러리를 쓰지 않고 얇게 만든 이유:
 * 필요한 건 키 조회·보간·폴백 셋뿐인데, next-intl류는 라우팅 세그먼트(`/[locale]/…`)를
 * 요구해 앱 전체 경로 구조를 건드린다. 그 값은 이 제품이 아직 치를 이유가 없다.
 *
 * 로케일은 **사용자 선택 > 브라우저 언어 > ko** 순. 서버 렌더에서는 항상 기본값을 쓴다
 * (localStorage가 없다) — 첫 페인트가 기본 로케일이고 마운트 후 사용자 선택으로 바뀐다.
 */

import { CATALOGS, DEFAULT_LOCALE, LOCALES, type Locale, type MessageKey } from './messages';

export type { Locale, MessageKey };
export { LOCALES, DEFAULT_LOCALE };

const STORAGE_KEY = 'locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** 저장된 선택 → 브라우저 언어 → 기본값. SSR에서는 기본값. */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (isLocale(saved)) return saved;
  const nav = window.navigator?.language?.slice(0, 2);
  return isLocale(nav) ? nav : DEFAULT_LOCALE;
}

export function saveLocale(locale: Locale): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, locale);
}

export type TranslateVars = Record<string, string | number>;

/**
 * 키 → 문구. `{name}` 자리표시자를 `vars`로 채운다.
 *
 * 없는 키는 **키 문자열을 그대로 돌려준다**. 빈 문자열이면 화면에서 조용히 사라져 아무도
 * 모르고, 예외를 던지면 문구 하나 때문에 화면 전체가 죽는다. 키가 보이면 QA에서 바로 걸린다.
 * 번역이 빠진 로케일은 ko로 폴백한다 — 영어 화면에 한국어가 섞이는 편이 키가 보이는 것보다 낫다.
 */
export function translate(locale: Locale, key: MessageKey, vars?: TranslateVars): string {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  const raw: string | undefined =
    (catalog as Record<string, string>)[key] ??
    (CATALOGS[DEFAULT_LOCALE] as Record<string, string>)[key];
  if (raw === undefined) return key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}
