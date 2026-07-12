'use client';

// design-style-analysis §4 — 아바타 (원형 + 상태 점)
import type { PresenceStatus } from './StatusBadge';

const DOT_COLOR: Record<PresenceStatus, string> = {
  online:   'bg-status-online',
  meeting:  'bg-status-meeting',
  external: 'bg-status-external',
  focus:    'bg-status-focus',
  away:     'bg-status-away',
  offline:  'bg-status-offline',
};

interface AvatarProps {
  name: string;
  src?: string;
  status?: PresenceStatus;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-11 h-11 text-base' };
const DOT_SIZE = { sm: 'w-2 h-2 border', md: 'w-2.5 h-2.5 border', lg: 'w-3 h-3 border-2' };

export function Avatar({ name, src, status, size = 'md' }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <span className="relative inline-flex flex-shrink-0">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className={['rounded-full object-cover', SIZE[size]].join(' ')}
        />
      ) : (
        <span
          className={[
            'rounded-full bg-primary flex items-center justify-center',
            'text-white font-semibold select-none',
            SIZE[size],
          ].join(' ')}
          aria-label={name}
        >
          {initials}
        </span>
      )}
      {status && (
        <span
          className={[
            'absolute bottom-0 right-0 rounded-full border-bg-surface',
            DOT_COLOR[status],
            DOT_SIZE[size],
          ].join(' ')}
          aria-label={status}
        />
      )}
    </span>
  );
}
