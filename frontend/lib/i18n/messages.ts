/**
 * 메시지 카탈로그 — 화면 문구의 정본.
 *
 * 키는 **화면·맥락 기준**으로 짓는다(`login.submit`), 영어 원문을 키로 쓰지 않는다.
 * 원문을 키로 쓰면 문구를 다듬을 때마다 키가 바뀌어 번역이 통째로 끊긴다.
 *
 * ko가 원본이다 — 이 제품은 한국어로 먼저 쓰였고 en이 번역이다. 그래서 `en`의 타입을
 * `ko`에서 파생시켜, **ko에 키를 추가하면 en이 컴파일 에러**가 나게 한다. 번역 누락을
 * 런타임에 발견하는 대신 빌드에서 막는다.
 */

export const ko = {
  // ── 공통 ────────────────────────────────────────────────
  'common.cancel': '취소',
  'common.save': '저장',
  'common.loading': '불러오는 중…',
  'common.retry': '다시 시도',

  // ── 로그인 (app/login) ──────────────────────────────────
  'login.title': '가상 오피스에 로그인',
  'login.email': '이메일',
  'login.password': '비밀번호',
  'login.emailPlaceholder': 'you@company.com',
  'login.submit': '로그인',
  'login.submitting': '로그인 중…',
  'login.forgot': '비밀번호를 잊으셨나요? 관리자에게 재설정 링크를 요청하세요.',
  'login.signupPrompt': '회사가 처음이신가요?',
  'login.signupLink': '회사 만들기',
  'login.expired': '세션이 만료되었습니다. 다시 로그인해 주세요.',
  'login.failed': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'login.networkError': '서버에 연결할 수 없습니다.',

  // ── 언어 전환 (설정) ────────────────────────────────────
  'locale.label': '언어',
  'locale.ko': '한국어',
  'locale.en': 'English',
} as const;

export type MessageKey = keyof typeof ko;

/** en은 ko에서 타입이 파생된다 — ko에 키를 더하면 여기서 컴파일 에러가 난다. */
export const en: Record<MessageKey, string> = {
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.loading': 'Loading…',
  'common.retry': 'Retry',

  'login.title': 'Sign in to your virtual office',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.emailPlaceholder': 'you@company.com',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.forgot': 'Forgot your password? Ask an administrator for a reset link.',
  'login.signupPrompt': 'New company?',
  'login.signupLink': 'Create a company',
  'login.expired': 'Your session expired. Please sign in again.',
  'login.failed': 'Incorrect email or password.',
  'login.networkError': 'Cannot reach the server.',

  'locale.label': 'Language',
  'locale.ko': '한국어',
  'locale.en': 'English',
};

export const CATALOGS = { ko, en } as const;
export type Locale = keyof typeof CATALOGS;
export const LOCALES: readonly Locale[] = ['ko', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'ko';
