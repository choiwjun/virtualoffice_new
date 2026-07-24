'use client';

/**
 * Button — variant×size 버튼 프리미티브 (감사 23 A5).
 *
 * 이전엔 액션 버튼이 페이지마다 인라인 className 손복사라 primary/secondary/danger/ghost가
 * 미묘하게 제각각이었다. 이 프리미티브로 변형·크기·상태(hover/disabled/loading)를 표준화한다.
 * 색은 디자인 토큰(CSS 변수 정본) → 화이트라벨 시 자동 반영.
 */

import React from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** 진행 중 — 스피너 표시 + 비활성화. */
  loading?: boolean;
}

const BASE =
  'inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary hover:bg-primary-hover text-white',
  secondary: 'bg-transparent border border-border-subtle text-text-secondary hover:bg-white/5',
  danger: 'bg-danger hover:brightness-95 text-white',
  ghost: 'bg-transparent text-text-secondary hover:bg-white/5',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-sm',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && (
        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
      {children}
    </button>
  );
});
