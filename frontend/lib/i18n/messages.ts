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


  // ── 내비게이션 (components/OfficeShell) ─────────────────
  'nav.office': '가상오피스',
  'nav.workLog': '업무관리',
  'nav.workStatus': '업무현황',
  'nav.trip': '출장관리',
  'nav.kpi': 'KPI평가',
  'nav.reports': '보고서',
  'nav.meetings': '회의실예약',
  'nav.chat': '커뮤니케이션',
  'nav.hr': '인사·근태',
  'nav.settings': '설정',
  'nav.admin.kpi': 'KPI관리',
  'nav.admin.orgChart': '조직도',
  'nav.admin.officeLayout': '좌석배치',
  'nav.admin.rooms': '회의실',
  'nav.admin.sync': '동기화',
  'nav.admin.audit': '감사로그',
  'nav.admin.notices': '공지관리',
  'nav.admin.branding': '브랜딩',

  // ── 셸 크롬 ─────────────────────────────────────────────
  'shell.appName': '가상 오피스',
  'shell.mainMenu': '주 메뉴',
  'shell.adminSection': '관리',
  'shell.adminConsole': '관리 콘솔',
  'shell.collapseMenu': '메뉴 접기',
  'shell.logout': '로그아웃',
  'shell.profile': '프로필',
  'shell.me': '나',
  'shell.workHub': '업무 허브',
  'shell.workHubTitle': '업무 허브 — 업무관리 · 업무현황 · 보고서 · KPI평가',
  'shell.attendance': '근태 · 출장',
  'shell.more': '더보기',
  'shell.moreTitle': '더보기 — 설정 · 관리 콘솔',
  'shell.openInOffice': '오피스에서 보기',
  'shell.comingSoon': '준비중',
  'shell.openMemberPanel': '구성원 패널 열기',
  'shell.collapsePanel': '패널 접기',
  'shell.closeToOffice': '닫기 — 오피스로 돌아가기',
  'shell.searchPlaceholder': '구성원 · 방 · 기능 검색 — 이동은 여기서',
  'shell.searchAria': '구성원·방·기능 검색 (커맨드 팔레트)',
  'shell.paletteTitle': '커맨드 팔레트',
  'shell.noResults': '결과가 없습니다',
  'shell.notifications': '알림',
  'shell.recentNotices': '최근 공지',
  'shell.noNotices': '공지사항이 없습니다',
  'shell.pinned': '고정',

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


  'nav.office': 'Virtual office',
  'nav.workLog': 'Work log',
  'nav.workStatus': 'Work status',
  'nav.trip': 'Business trips',
  'nav.kpi': 'KPI review',
  'nav.reports': 'Reports',
  'nav.meetings': 'Meeting rooms',
  'nav.chat': 'Chat',
  'nav.hr': 'People & attendance',
  'nav.settings': 'Settings',
  'nav.admin.kpi': 'KPI admin',
  'nav.admin.orgChart': 'Org chart',
  'nav.admin.officeLayout': 'Seating',
  'nav.admin.rooms': 'Rooms',
  'nav.admin.sync': 'Sync',
  'nav.admin.audit': 'Audit log',
  'nav.admin.notices': 'Notices',
  'nav.admin.branding': 'Branding',

  'shell.appName': 'Virtual office',
  'shell.mainMenu': 'Main menu',
  'shell.adminSection': 'Admin',
  'shell.adminConsole': 'Admin console',
  'shell.collapseMenu': 'Collapse menu',
  'shell.logout': 'Sign out',
  'shell.profile': 'Profile',
  'shell.me': 'Me',
  'shell.workHub': 'Work hub',
  'shell.workHubTitle': 'Work hub — work log · status · reports · KPI',
  'shell.attendance': 'Attendance & trips',
  'shell.more': 'More',
  'shell.moreTitle': 'More — settings · admin console',
  'shell.openInOffice': 'Open in office',
  'shell.comingSoon': 'Coming soon',
  'shell.openMemberPanel': 'Open member panel',
  'shell.collapsePanel': 'Collapse panel',
  'shell.closeToOffice': 'Close — back to the office',
  'shell.searchPlaceholder': 'Search people · rooms · features',
  'shell.searchAria': 'Search people, rooms and features (command palette)',
  'shell.paletteTitle': 'Command palette',
  'shell.noResults': 'No results',
  'shell.notifications': 'Notifications',
  'shell.recentNotices': 'Recent notices',
  'shell.noNotices': 'No notices',
  'shell.pinned': 'Pinned',

  'locale.label': 'Language',
  'locale.ko': '한국어',
  'locale.en': 'English',
};

export const CATALOGS = { ko, en } as const;
export type Locale = keyof typeof CATALOGS;
export const LOCALES: readonly Locale[] = ['ko', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'ko';
