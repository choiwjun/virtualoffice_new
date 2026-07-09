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
      colors: {
        // 1.1 배경/서피스
        'bg-base':              '#0E1626',
        'bg-surface':           '#161F32',
        'bg-surface-raised':    '#1E2940',
        'border-subtle':        '#273350',
        // 1.2 브랜드/프라이머리
        primary:               '#3B5BFE',
        'primary-hover':        '#2F4BE0',
        'accent-cyan':          '#38BDF8',
        // 1.3 상태 시맨틱
        'status-online':        '#22C55E',
        'status-meeting':       '#EF4444',
        'status-external':      '#F59E0B',
        'status-focus':         '#8B5CF6',
        'status-away':          '#94A3B8',
        'status-offline':       '#4B5568',
        danger:                '#EF4444',
        // 1.4 텍스트
        'text-primary':         '#F1F5F9',
        'text-secondary':       '#B4C0D3',
        'text-muted':           '#7A899E',
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
