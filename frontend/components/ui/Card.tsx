'use client';

import React from 'react';

interface CardProps {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** design-style-analysis §4 — 카드/패널 */
export function Card({ title, action, children, className = '' }: CardProps) {
  return (
    <div
      className={[
        'rounded-card bg-bg-surface border border-border-subtle',
        'shadow-[0_2px_12px_rgba(0,0,0,0.35)] flex flex-col',
        className,
      ].join(' ')}
    >
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle flex-shrink-0">
          <span className="text-sm font-semibold text-text-primary">{title}</span>
          {action && <span className="text-xs text-text-muted hover:text-text-secondary cursor-pointer">{action}</span>}
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
