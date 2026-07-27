'use client';

/**
 * console.tsx — 콘솔(메뉴) 페이지 공용 UI 킷.
 *
 * 목적: 업무현황·보고서·KPI·회의·관리 등 오버레이 창 페이지들이 **동일한 시각 언어**를 쓰게 하는
 * 정제된 프리미티브. 카드 라운드/그림자/헤더/빈상태/세그먼트/스탯을 한 곳에서 관리 → 페이지는 조립만.
 * 다크 오피스 셸 토큰(bg-base/surface/surface-raised, border-subtle, text-*, primary, accent-cyan)만 사용.
 *
 * 시각 규율(고도화):
 *  - 카드 = rounded-2xl + 미세 상단 하이라이트(inset) + 부드러운 드롭섀도, hover 시 테두리 강조.
 *  - 스탯 = 아이콘 칩(정체성 색 틴트) + tabular 큰 숫자 + 라벨, 배경에 아주 옅은 색 그라디언트.
 *  - 빈 상태 = 아이콘 칩 + 제목 + 보조문구(+선택 CTA). 밋밋한 텍스트 금지.
 */

import React from 'react';

/** 카드 공통 표면 — 라운드/보더/그림자/상단 하이라이트. */
export const CARD_SURFACE =
  'rounded-2xl border border-border-subtle bg-bg-surface ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_28px_-16px_rgba(0,0,0,0.6)]';

/* ─────────────────────────── PageHeader ─────────────────────────── */
export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <span className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-bg-surface-raised border border-border-subtle text-accent-cyan">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-bold text-text-primary tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-[12.5px] text-text-muted mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}

/* ─────────────────────────── ToolbarButton ─────────────────────────── */
export function ToolbarButton({
  children,
  onClick,
  icon,
  variant = 'default',
  disabled,
  title,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  icon?: React.ReactNode;
  variant?: 'default' | 'primary';
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
}) {
  const base =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all ' +
    'disabled:opacity-45 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan';
  const styles =
    variant === 'primary'
      ? 'bg-primary text-white hover:bg-primary-hover shadow-[0_6px_16px_-8px_rgba(59,91,254,0.8)]'
      : 'border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-surface-raised hover:border-white/15';
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${styles}`}>
      {icon && <span className="w-3.5 h-3.5 flex items-center justify-center">{icon}</span>}
      {children}
    </button>
  );
}

/* ─────────────────────────── Segmented ─────────────────────────── */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-3 py-1 text-[12px]' : 'px-4 py-1.5 text-[13px]';
  return (
    <div className="inline-flex gap-1 p-1 rounded-xl bg-bg-base border border-border-subtle">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className={[
              pad,
              'rounded-lg font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
              on
                ? 'bg-bg-surface-raised text-accent-cyan shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_4px_10px_-6px_rgba(0,0,0,0.6)]'
                : 'text-text-muted hover:text-text-primary',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── StatCard ─────────────────────────── */
export function StatCard({
  label,
  value,
  accent = 'rgb(var(--color-primary))',
  icon,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  icon?: React.ReactNode;
  hint?: string;
}) {
  return (
    <div
      className={`${CARD_SURFACE} relative overflow-hidden p-4 transition-colors hover:border-white/12`}
      style={{ background: `linear-gradient(160deg, ${accent}0F 0%, rgba(22,31,50,0) 60%)` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-text-muted">{label}</span>
        {icon && (
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${accent}22`, color: accent }}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 text-[26px] leading-none font-extrabold tracking-tight tabular-nums" style={{ color: accent }}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-text-muted">{hint}</div>}
    </div>
  );
}

/* ─────────────────────────── SectionCard ─────────────────────────── */
export function SectionCard({
  title,
  icon,
  action,
  children,
  className = '',
  bodyClassName = 'p-4',
}: {
  title?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`${CARD_SURFACE} flex flex-col ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="text-text-muted flex-shrink-0">{icon}</span>}
            {title && <h2 className="text-[13.5px] font-semibold text-text-primary truncate">{title}</h2>}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/* ─────────────────────────── EmptyState ─────────────────────────── */
export function EmptyState({
  icon = '📊',
  title,
  hint,
  action,
  compact,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8 gap-2' : 'py-14 gap-3'}`}>
      <span className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl bg-bg-surface-raised border border-border-subtle text-text-muted">
        {icon}
      </span>
      <div>
        <p className="text-[13.5px] font-medium text-text-secondary">{title}</p>
        {hint && <p className="text-[12px] text-text-muted mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/* ─────────────────────────── ErrorBanner / LoadingState ─────────────────────────── */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] text-red-300 bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.28)]">
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="underline font-medium hover:text-red-200 flex-shrink-0">
          재시도
        </button>
      )}
    </div>
  );
}

export function LoadingState({ label = '데이터를 불러오는 중…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-text-muted text-[13px]">
      <span className="w-4 h-4 rounded-full border-2 border-border-subtle border-t-accent-cyan animate-spin" />
      {label}
    </div>
  );
}

/* ─────────────────────────── ProgressRow (카테고리/분포 막대) ─────────────────────────── */
export function ProgressRow({
  label,
  meta,
  pct,
  accent = 'rgb(var(--color-primary))',
}: {
  label: string;
  meta?: string;
  pct: number;
  accent?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="font-medium text-text-secondary truncate">{label}</span>
        {meta && <span className="text-text-muted flex-shrink-0 ml-2">{meta}</span>}
      </div>
      <div className="h-2 w-full bg-bg-base rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: accent }} />
      </div>
    </div>
  );
}
