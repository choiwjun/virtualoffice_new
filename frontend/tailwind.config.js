/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ─── design-style-analysis §1 컬러 토큰 ────────────────────────────────
      // 정본은 globals.css :root의 --color-* (RGB 채널). 화이트라벨 = 변수 1-플립(감사 23 A1/A7).
      colors: {
        // 1.1 배경/서피스
        'bg-base':              'rgb(var(--color-bg-base) / <alpha-value>)',
        'bg-surface':           'rgb(var(--color-bg-surface) / <alpha-value>)',
        'bg-surface-raised':    'rgb(var(--color-bg-surface-raised) / <alpha-value>)',
        'border-subtle':        'rgb(var(--color-border-subtle) / <alpha-value>)',
        // 1.2 브랜드/프라이머리
        primary:               'rgb(var(--color-primary) / <alpha-value>)',
        'primary-hover':        'rgb(var(--color-primary-hover) / <alpha-value>)',
        'accent-cyan':          'rgb(var(--color-accent-cyan) / <alpha-value>)',
        // 1.3 상태 시맨틱
        'status-online':        'rgb(var(--color-status-online) / <alpha-value>)',
        'status-meeting':       'rgb(var(--color-status-meeting) / <alpha-value>)',
        'status-external':      'rgb(var(--color-status-external) / <alpha-value>)',
        'status-focus':         'rgb(var(--color-status-focus) / <alpha-value>)',
        'status-away':          'rgb(var(--color-status-away) / <alpha-value>)',
        'status-offline':       'rgb(var(--color-status-offline) / <alpha-value>)',
        danger:                'rgb(var(--color-danger) / <alpha-value>)',
        // 1.4 텍스트
        'text-primary':         'rgb(var(--color-text-primary) / <alpha-value>)',
        'text-secondary':       'rgb(var(--color-text-secondary) / <alpha-value>)',
        'text-muted':           'rgb(var(--color-text-muted) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Pretendard', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
        btn:  '10px',
      },
    },
  },
  plugins: [],
};
