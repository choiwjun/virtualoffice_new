'use client';

// design-style-analysis §4 — 미디어 컨트롤 바 (비주얼 전용)
// 뷰포트 하단 중앙 pill 바: 마이크·카메라·화면공유·이모지·더보기

interface MediaBarProps {
  micOn?: boolean;
  camOn?: boolean;
  shareOn?: boolean;
  className?: string;
}

function CtrlBtn({
  active,
  danger,
  label,
  icon,
}: {
  active: boolean;
  danger?: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  const base =
    'flex items-center justify-center w-10 h-10 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan';
  const color = danger
    ? 'bg-status-meeting text-white'
    : active
      ? 'bg-bg-surface-raised text-text-primary'
      : 'bg-[rgba(239,68,68,0.18)] text-status-meeting';

  return (
    <button className={[base, color].join(' ')} aria-label={label} title={label} type="button">
      {icon}
    </button>
  );
}

export function MediaBar({ micOn = true, camOn = true, shareOn = false, className = '' }: MediaBarProps) {
  return (
    <div
      className={[
        'inline-flex items-center gap-2 px-4 py-2 rounded-full',
        'bg-bg-surface border border-border-subtle shadow-lg',
        className,
      ].join(' ')}
      role="toolbar"
      aria-label="미디어 컨트롤"
    >
      {/* 마이크 */}
      <CtrlBtn active={micOn} label={micOn ? '마이크 켜짐' : '마이크 음소거'} icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M10 12a3 3 0 003-3V5a3 3 0 00-6 0v4a3 3 0 003 3z" />
          <path fillRule="evenodd" d="M5 9a1 1 0 012 0 3 3 0 006 0 1 1 0 112 0 5 5 0 01-4 4.9V16h2a1 1 0 110 2H7a1 1 0 110-2h2v-2.1A5.001 5.001 0 015 9z" clipRule="evenodd" />
        </svg>
      } />
      {/* 카메라 */}
      <CtrlBtn active={camOn} label={camOn ? '카메라 켜짐' : '카메라 꺼짐'} icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12 2l4-2v8l-4-2V8z" />
        </svg>
      } />
      {/* 화면공유 */}
      <CtrlBtn active={shareOn} label="화면 공유" icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm2 0v6h10V5H5zm5 8a1 1 0 011 1v1h1a1 1 0 110 2H8a1 1 0 110-2h1v-1a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      } />
      {/* 구분선 */}
      <span className="w-px h-6 bg-border-subtle mx-1" />
      {/* 이모지 */}
      <CtrlBtn active={true} label="이모지" icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-2.5-9.5a1 1 0 11-2 0 1 1 0 012 0zm5 0a1 1 0 11-2 0 1 1 0 012 0zm-6.36 4.83a.75.75 0 001.06.02 3.5 3.5 0 014.6 0 .75.75 0 101.04-1.08 5 5 0 00-6.68 0 .75.75 0 00.02 1.06z" clipRule="evenodd" />
        </svg>
      } />
      {/* 더보기 */}
      <CtrlBtn active={true} label="더보기" icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      } />
      {/* 구분선 */}
      <span className="w-px h-6 bg-border-subtle mx-1" />
      {/* 나가기 */}
      <CtrlBtn active={false} danger label="통화 종료" icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
        </svg>
      } />
    </div>
  );
}
