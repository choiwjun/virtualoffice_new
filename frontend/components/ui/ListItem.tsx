'use client';

import React from 'react';

// design-style-analysis §4 — 리스트 아이템
// 좌측 아바타/아이콘 + 텍스트 2줄(주/보조) + 우측 상태/메타

interface ListItemProps {
  leading?: React.ReactNode;
  primary: string;
  secondary?: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function ListItem({
  leading,
  primary,
  secondary,
  trailing,
  onClick,
  className = '',
}: ListItemProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={[
        'w-full flex items-center gap-3 px-4 py-2.5 text-left',
        'hover:bg-bg-surface-raised transition-colors rounded-lg',
        onClick ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan' : '',
        className,
      ].join(' ')}
    >
      {leading && <span className="flex-shrink-0">{leading}</span>}
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-text-primary truncate">{primary}</span>
        {secondary && (
          <span className="block text-[11px] text-text-muted truncate mt-0.5">{secondary}</span>
        )}
      </span>
      {trailing && <span className="flex-shrink-0 ml-1">{trailing}</span>}
    </Tag>
  );
}
