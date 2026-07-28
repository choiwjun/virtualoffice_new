/**
 * 공용 어휘 — 여러 화면이 같은 값을 표시한다(역할·프레즌스).
 *
 * 화면마다 `ROLE_LABELS` 같은 표를 따로 두면 같은 값이 화면마다 다르게 번역된다.
 * D39에서 팀 이름으로 겪은 것과 같은 병 — 정본을 하나 두고 전부 여기를 지난다.
 */
import type { MessageKey } from './index';

/** 알 수 없는 값은 `null` — 호출부가 원본 문자열을 그대로 보여 준다(지어내지 않는다). */
export function roleKey(role: string | null | undefined): MessageKey | null {
  switch (role) {
    case 'admin':
      return 'role.admin';
    case 'super_admin':
      return 'role.super_admin';
    case 'leader':
      return 'role.leader';
    case 'employee':
      return 'role.employee';
    default:
      return null;
  }
}

export function presenceKey(status: string | null | undefined): MessageKey | null {
  switch (status) {
    case 'online':
      return 'presence.online';
    case 'working':
      return 'presence.working';
    case 'meeting':
      return 'presence.meeting';
    case 'focus':
      return 'presence.focus';
    case 'away':
      return 'presence.away';
    case 'external':
      return 'presence.external';
    case 'offline':
      return 'presence.offline';
    default:
      return null;
  }
}

/** 프레즌스 배지 색 — 문구와 달리 번역 대상이 아니다(상태 시맨틱). */
export const PRESENCE_BADGE_CLASS: Record<string, string> = {
  online: 'bg-[rgba(34,197,94,0.16)] text-status-online',
  working: 'bg-[rgba(34,197,94,0.16)] text-status-online',
  meeting: 'bg-[rgba(56,189,248,0.15)] text-accent-cyan',
  focus: 'bg-[rgba(245,158,11,0.16)] text-status-external',
  away: 'bg-bg-surface-raised text-text-muted',
  external: 'bg-[rgba(139,92,246,0.18)] text-status-focus',
  offline: 'bg-bg-surface-raised text-text-muted',
};

/** 필터 드롭다운 등에서 쓰는 표시 순서. */
export const PRESENCE_ORDER = [
  'online',
  'working',
  'meeting',
  'focus',
  'away',
  'external',
  'offline',
] as const;
