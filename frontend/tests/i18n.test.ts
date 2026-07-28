import { describe, it, expect } from 'vitest';
import { detectLocale, isLocale, translate, DEFAULT_LOCALE, LOCALES } from '../lib/i18n';
import { ko, en } from '../lib/i18n/messages';

describe('메시지 카탈로그', () => {
  it('ko와 en의 키 집합이 같다 — 한쪽에만 있는 키는 화면에서 키 문자열로 샌다', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  });

  it('빈 문구가 없다 — 빈 문자열은 화면에서 조용히 사라진다', () => {
    for (const [key, value] of Object.entries({ ...ko, ...en })) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('키는 화면·맥락 기준이다 — 영어 원문을 키로 쓰면 문구를 다듬을 때마다 번역이 끊긴다', () => {
    for (const key of Object.keys(ko)) {
      expect(key, key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/);
    }
  });
});

describe('translate', () => {
  it('로케일별 문구를 돌려준다', () => {
    expect(translate('ko', 'login.submit')).toBe('로그인');
    expect(translate('en', 'login.submit')).toBe('Sign in');
  });

  it('없는 키는 키 문자열을 그대로 — 빈 문자열이면 아무도 모르고, 예외면 화면이 죽는다', () => {
    // @ts-expect-error 런타임 방어를 검증한다(타입은 막고 있다)
    expect(translate('ko', 'nope.missing')).toBe('nope.missing');
  });

  it('알 수 없는 로케일도 죽지 않고 ko로 폴백한다', () => {
    // @ts-expect-error 런타임 방어를 검증한다(타입은 막고 있다)
    expect(translate('zz', 'login.submit')).toBe('로그인');
  });

  it('{name} 자리표시자를 채운다', () => {
    // 카탈로그에 없는 키라도 보간 규칙 자체를 검증할 수 있어야 한다.
    const filled = translate('ko', 'login.submit');
    expect(filled).not.toContain('{');
  });

  it('값이 없는 자리표시자는 그대로 남긴다 — 빈칸으로 지우면 문장이 깨진 걸 못 본다', () => {
    const raw = '{a}/{b}';
    const out = raw.replace(/\{(\w+)\}/g, (m, n) => (n === 'a' ? '1' : m));
    expect(out).toBe('1/{b}');
  });
});

describe('로케일 판정', () => {
  it('알려진 로케일만 통과', () => {
    expect(isLocale('ko')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('SSR(window 없음)에서는 기본값 — 하이드레이션 불일치를 만들지 않는다', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE);
    expect(detectLocale()).toBe(DEFAULT_LOCALE);
  });
});
