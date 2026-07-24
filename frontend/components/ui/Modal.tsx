'use client';

/**
 * Modal — 접근성 내장 다이얼로그 프리미티브 (감사 23 A4).
 *
 * 이전엔 `#161F32` 모달 표면이 12개 파일에 복붙되고 백드롭·닫기·포커스트랩이 매번 재작성됐다.
 * 이 프리미티브 하나로 role=dialog·aria-modal·포커스 트랩·ESC·스크롤 락·백드롭 닫기를 표준화한다.
 * 표면은 다크 오피스 셸 토큰만 사용(bg-bg-surface / border-border-subtle / text-*).
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** 백드롭 클릭/ESC로 닫기 허용 (기본 true). 파괴적 확인창은 false 권장. */
  dismissable?: boolean;
}

const WIDTHS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  dismissable = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // 스크롤 락

    const focusTimer = setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      prevFocus.current?.focus?.();
    };
  }, [open, onClose, dismissable]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 vo-modal-backdrop"
      style={{ background: 'rgba(8,13,26,0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={`w-full ${WIDTHS[size]} rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl outline-none flex flex-col max-h-[90vh] vo-modal-panel`}
      >
        {title != null && (
          <div className="flex-shrink-0 flex items-center justify-between px-5 h-12 border-b border-border-subtle">
            <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-text-secondary">{children}</div>
        {footer != null && (
          <div className="flex-shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
