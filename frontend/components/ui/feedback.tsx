'use client';

/**
 * feedback.tsx — 전역 토스트 + 확인 다이얼로그 인프라 (감사 23 C4/C2/C3).
 *
 * 이전엔 성공/에러 피드백이 페이지별 임시 flash state·native `alert/confirm/prompt`로 흩어져
 * 비동기 불가·스타일 불가·스크린리더 취약·모바일 이질감이 있었다. 이 한 쌍으로 통일한다:
 *   - useToast(): toast.success/error/info — aria-live=polite 영역에 스택, 자동 소멸.
 *   - useConfirm(): await confirm({...}) → boolean. `if (confirm(msg))`의 접근성 대체.
 *
 * <FeedbackProvider>로 (protected) 트리 전체를 감싼다.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Modal } from './Modal';

/* ─────────────────────────── Toast ─────────────────────────── */

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}
export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within <FeedbackProvider>');
  return ctx;
}

const TOAST_META: Record<ToastKind, { color: string; icon: string; label: string }> = {
  success: { color: '#22C55E', icon: 'M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.8 6.3-6.3a1 1 0 011.4 0z', label: '성공' },
  error: { color: '#F87171', icon: 'M10 2a8 8 0 100 16 8 8 0 000-16zM9 6h2v5H9V6zm0 6h2v2H9v-2z', label: '오류' },
  info: { color: '#60A5FA', icon: 'M10 2a8 8 0 100 16 8 8 0 000-16zM9 5h2v2H9V5zm0 4h2v6H9V9z', label: '알림' },
};

function ToastViewport({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((t) => {
        const m = TOAST_META[t.kind];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-xl border border-border-subtle bg-bg-surface-raised shadow-2xl vo-toast-in"
            style={{ minWidth: 220, maxWidth: 440 }}
          >
            <span
              className="flex-shrink-0 grid place-items-center w-5 h-5 rounded-full"
              style={{ background: `${m.color}22`, color: m.color }}
              aria-hidden="true"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d={m.icon} clipRule="evenodd" />
              </svg>
            </span>
            <span className="text-[13px] text-text-primary leading-snug flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="알림 닫기"
              className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────── Confirm dialog ─────────────────────── */

export interface ConfirmOptions {
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 파괴적 동작(삭제 등) — 확인 버튼을 위험색으로. */
  danger?: boolean;
}
/** 문자열을 넘기면 `{ message }`로 취급 — 호출부 편의(감사 23 C2 마이그레이션). */
type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm must be used within <FeedbackProvider>');
  return ctx;
}

/* ─────────────────────────── Provider ─────────────────────────── */

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  // Toast
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(1);
  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = seq.current++;
      setToasts((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => dismiss(id), 3800);
    },
    [dismiss],
  );
  const toastApi = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  // Confirm
  const [confirmState, setConfirmState] = useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);
  const confirm = useCallback<ConfirmFn>((raw) => {
    const opts: ConfirmOptions = typeof raw === 'string' ? { message: raw } : raw;
    return new Promise<boolean>((resolve) => setConfirmState({ opts, resolve }));
  }, []);
  const settle = useCallback(
    (v: boolean) => {
      confirmState?.resolve(v);
      setConfirmState(null);
    },
    [confirmState],
  );

  return (
    <ToastCtx.Provider value={toastApi}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <ToastViewport items={toasts} onDismiss={dismiss} />
        <Modal
          open={confirmState !== null}
          onClose={() => settle(false)}
          title={confirmState?.opts.title ?? '확인'}
          size="sm"
          footer={
            <>
              <button
                type="button"
                onClick={() => settle(false)}
                className="px-3.5 py-1.5 rounded-lg text-[13px] font-medium text-text-secondary border border-border-subtle hover:bg-white/5 transition-colors"
              >
                {confirmState?.opts.cancelLabel ?? '취소'}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold text-white transition-colors"
                style={{ background: confirmState?.opts.danger ? '#DC2626' : '#3B5BFE' }}
              >
                {confirmState?.opts.confirmLabel ?? '확인'}
              </button>
            </>
          }
        >
          <p className="text-[13.5px] text-text-secondary leading-relaxed">{confirmState?.opts.message}</p>
        </Modal>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}
