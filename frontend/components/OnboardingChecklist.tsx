'use client';

/**
 * 첫실행 온보딩 — 3단계 체크리스트 + 최초 1회 투어 (E6 · 24-spec Phase 5 · 23 E6).
 *
 * 체크리스트는 **서버가 실측 파생**한 상태를 그대로 그린다(로컬 추측 없음). 항목을 끝내고
 * 돌아오면 자동으로 체크된다. 접기(dismiss)는 회사 단위, 투어는 유저 단위로 서버에 남는다.
 *
 * 투어는 셸의 `data-tour` 요소를 찾아 스포트라이트를 그린다. 요소가 없으면(레일 모드·좁은 화면)
 * 화면 중앙 카드로 폴백해 어떤 레이아웃에서도 깨지지 않는다.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

interface Checklist {
  seat_placed: boolean;
  notice_posted: boolean;
  team_invited: boolean;
}
interface Onboarding {
  checklist: Checklist;
  completed: boolean;
  dismissed: boolean;
  tour_done: boolean;
  can_manage: boolean;
}

type StepKey = keyof Checklist;

const STEPS: { key: StepKey; title: string; hint: string; href: string; cta: string }[] = [
  {
    key: 'seat_placed',
    title: '좌석 배치하기',
    hint: '사무실 도면에 자리를 놓으면 팀원이 앉을 수 있습니다.',
    href: '/admin/office-layout',
    cta: '좌석 편집기 열기',
  },
  {
    key: 'notice_posted',
    title: '첫 공지 올리기',
    hint: '팀이 처음 들어왔을 때 볼 환영 공지를 남겨보세요.',
    href: '/admin/notices',
    cta: '공지 작성',
  },
  {
    key: 'team_invited',
    title: '팀 초대하기',
    hint: '직원을 추가하고 초대 링크를 전달하면 본인이 비밀번호를 설정합니다.',
    href: '/admin/employees',
    cta: '직원 관리 열기',
  },
];

/** 투어 단계 — 셸의 data-tour 속성과 맞춘다. */
const TOUR: { target: string | null; title: string; body: string }[] = [
  {
    target: null,
    title: '가상 오피스에 오신 걸 환영합니다',
    body: '실제 사무실처럼 생긴 공간에서 팀의 현재 상태를 한눈에 보고, 자리에 앉아 일하고, 회의실에 모입니다. 30초만에 핵심만 짚어드릴게요.',
  },
  {
    target: '[data-tour="viewport"]',
    title: '여기가 우리 사무실입니다',
    body: '팀원 배지가 실시간으로 움직입니다. 빈 자리를 클릭하면 앉고, 방 이름을 누르면 그 공간으로 이동합니다.',
  },
  {
    target: '[data-tour="command"]',
    title: '⌘K 로 어디든 이동',
    body: '사람·회의실·기능을 한 곳에서 검색합니다. 메뉴를 외울 필요가 없습니다.',
  },
  {
    target: '[data-tour="presence"]',
    title: '누가 무엇을 하는지',
    body: '팀원의 현재 상태(업무중·회의중·자리비움)가 실시간으로 보입니다.',
  },
  {
    target: '[data-tour="admin-nav"]',
    title: '관리 메뉴',
    body: '직원·좌석·공지·브랜딩을 여기서 설정합니다. 아래 체크리스트를 따라가면 초기 설정이 끝납니다.',
  },
];

const CheckIcon = ({ done }: { done: boolean }) =>
  done ? (
    <svg viewBox="0 0 20 20" className="w-5 h-5 text-status-online" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0z"
        clipRule="evenodd"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <circle cx="10" cy="10" r="7.2" strokeDasharray="3 2.5" />
    </svg>
  );

export function OnboardingChecklist() {
  const [state, setState] = useState<Onboarding | null>(null);
  const [busy, setBusy] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api.get<Onboarding>('/api/onboarding'));
    } catch {
      // 온보딩 위젯 실패가 앱을 막지 않는다.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 라우트를 오가며 항목을 끝내고 돌아오면 자동 갱신 (실측 파생이라 재조회가 곧 최신).
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // 아직 투어를 안 본 사람에게 1회 자동 시작 (전 역할).
  useEffect(() => {
    if (state && !state.tour_done && tourStep === null) setTourStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function finishTour() {
    setTourStep(null);
    try {
      setState(await api.patch<Onboarding>('/api/onboarding', { tour_done: true }));
    } catch {
      /* 실패해도 이번 세션에선 닫힌다 */
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      setState(await api.patch<Onboarding>('/api/onboarding', { dismissed: true }));
    } finally {
      setBusy(false);
    }
  }

  const showChecklist =
    state !== null && state.can_manage && !state.dismissed && !state.completed;

  return (
    <>
      {tourStep !== null && state !== null && (
        <ProductTour step={tourStep} onStep={setTourStep} onFinish={finishTour} />
      )}
      {showChecklist && (
        <aside
          aria-label="첫 설정 체크리스트"
          className="absolute left-1/2 -translate-x-1/2 bottom-5 z-40 w-[min(560px,calc(100%-2rem))] rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl vo-modal-panel"
        >
          <div className="flex items-center justify-between px-4 h-11 border-b border-border-subtle">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-semibold text-text-primary">첫 설정</span>
              <span className="text-[11px] text-text-muted">
                {Object.values(state.checklist).filter(Boolean).length} / {STEPS.length} 완료
              </span>
            </div>
            <button
              type="button"
              onClick={dismiss}
              disabled={busy}
              className="text-[11px] text-text-muted hover:text-text-primary transition-colors"
            >
              나중에 하기
            </button>
          </div>

          <ol className="p-2">
            {STEPS.map((s) => {
              const done = state.checklist[s.key];
              return (
                <li
                  key={s.key}
                  className={`flex items-center gap-3 px-2.5 py-2 rounded-xl ${done ? 'opacity-60' : ''}`}
                >
                  <CheckIcon done={done} />
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-[13px] font-medium ${done ? 'text-text-muted line-through' : 'text-text-primary'}`}
                    >
                      {s.title}
                    </div>
                    {!done && <div className="text-[11.5px] text-text-muted mt-0.5">{s.hint}</div>}
                  </div>
                  {!done && (
                    <Link href={s.href} className="flex-shrink-0">
                      <Button size="sm" variant="secondary">
                        {s.cta}
                      </Button>
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </aside>
      )}
    </>
  );
}

/** 스포트라이트 투어 — 대상 요소를 찾으면 오려내고, 없으면 중앙 카드로 폴백. */
function ProductTour({
  step,
  onStep,
  onFinish,
}: {
  step: number;
  onStep: (n: number) => void;
  onFinish: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const current = TOUR[step];
  const isLast = step === TOUR.length - 1;

  useLayoutEffect(() => {
    if (!current?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(current.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [current]);

  // 리사이즈 시 스포트라이트 위치 재계산 (레이아웃이 바뀌어도 엉뚱한 곳을 비추지 않게).
  useEffect(() => {
    if (!current?.target) return;
    const recompute = () => {
      const el = document.querySelector(current.target!);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [current]);

  useEffect(() => {
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFinish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        isLast ? onFinish() : onStep(step + 1);
      }
      if (e.key === 'ArrowLeft' && step > 0) onStep(step - 1);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [step, isLast, onStep, onFinish]);

  if (!current) return null;

  const pad = 8;
  // 카드는 대상 아래에 붙이되, 화면 밖으로 나가면 위로 뒤집는다.
  const cardTop = rect
    ? rect.bottom + 14 + 220 > window.innerHeight
      ? Math.max(12, rect.top - 14 - 200)
      : rect.bottom + 14
    : 0;
  const cardLeft = rect
    ? Math.min(Math.max(12, rect.left + rect.width / 2 - 190), window.innerWidth - 392)
    : 0;

  return (
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-label="제품 둘러보기">
      {/* 배경 + 스포트라이트 구멍 (box-shadow로 오려낸다 — clip-path보다 호환성이 좋다) */}
      {rect ? (
        <div
          className="absolute rounded-xl pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(8,13,26,0.72)',
            border: '1.5px solid rgba(255,255,255,0.28)',
          }}
        />
      ) : (
        <div className="absolute inset-0" style={{ background: 'rgba(8,13,26,0.72)' }} />
      )}

      <div
        ref={cardRef}
        tabIndex={-1}
        className="absolute w-[380px] max-w-[calc(100vw-24px)] rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl outline-none p-5 vo-modal-panel"
        style={
          rect
            ? { top: cardTop, left: cardLeft }
            : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }
        }
      >
        <div className="text-[11px] text-text-muted mb-1.5">
          {step + 1} / {TOUR.length}
        </div>
        <h2 className="text-base font-bold text-text-primary mb-1.5">{current.title}</h2>
        <p className="text-[13px] text-text-secondary leading-relaxed">{current.body}</p>

        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            onClick={onFinish}
            className="text-[12px] text-text-muted hover:text-text-primary transition-colors"
          >
            건너뛰기
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button size="sm" variant="secondary" onClick={() => onStep(step - 1)}>
                이전
              </Button>
            )}
            <Button size="sm" onClick={() => (isLast ? onFinish() : onStep(step + 1))}>
              {isLast ? '시작하기' : '다음'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
