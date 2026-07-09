'use client';

// design-style-analysis §4 — 상태 뱃지(pill)
// 상태를 색+텍스트 병기로 표현 (접근성 §8)

export type PresenceStatus =
  | 'online'
  | 'meeting'
  | 'external'
  | 'focus'
  | 'away'
  | 'offline';

const STATUS_MAP: Record<PresenceStatus, { label: string; dot: string; pill: string }> = {
  online:   { label: '업무중',   dot: 'bg-status-online',   pill: 'bg-[rgba(34,197,94,0.15)]   text-status-online' },
  meeting:  { label: '회의중',   dot: 'bg-status-meeting',  pill: 'bg-[rgba(239,68,68,0.15)]   text-status-meeting' },
  external: { label: '외근중',   dot: 'bg-status-external', pill: 'bg-[rgba(245,158,11,0.15)]  text-status-external' },
  focus:    { label: '집중모드', dot: 'bg-status-focus',    pill: 'bg-[rgba(139,92,246,0.15)]  text-status-focus' },
  away:     { label: '자리비움', dot: 'bg-status-away',     pill: 'bg-[rgba(148,163,184,0.15)] text-status-away' },
  offline:  { label: '오프라인', dot: 'bg-status-offline',  pill: 'bg-[rgba(75,85,104,0.20)]   text-text-muted' },
};

interface StatusBadgeProps {
  status: PresenceStatus;
  showDot?: boolean;
}

export function StatusBadge({ status, showDot = true }: StatusBadgeProps) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.offline;
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
        s.pill,
      ].join(' ')}
    >
      {showDot && <span className={['w-1.5 h-1.5 rounded-full flex-shrink-0', s.dot].join(' ')} />}
      {s.label}
    </span>
  );
}
