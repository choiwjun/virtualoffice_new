'use client';

// OfficeShell — 통합 오피스 셸 ((protected)/layout.tsx 공통 레이아웃, D29 셸 단일화)
// 모든 메뉴 페이지(children)는 /office 셸 위 오버레이 창으로 렌더 → 디자인 연속 + 실시간 연결 유지
// @SPEC docs/planning/14-virtual-office-spec.md §1 §2.8
// @SPEC docs/3d-design/design-style-analysis.md §3 §4

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError, mediaUrl } from '@/lib/api';
import { getUser, logout, type User, type UserRole } from '@/lib/auth';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge, type EmployeePresenceStatus } from '@/components/ui/StatusBadge';
import { KpiGauge } from '@/components/ui/KpiGauge';
import { ProgressMetric } from '@/components/ui/ProgressMetric';
import { MediaBar } from '@/components/ui/MediaBar';
import { MeetingStage } from '@/components/ui/MeetingStage';
import { connectToMeeting, disconnectRoom } from '@/lib/livekit';
import { DisconnectReason, RoomEvent, type Room } from 'livekit-client';
import { ListItem } from '@/components/ui/ListItem';
import { ROOMS as VIEWPORT_ROOMS } from '@/lib/office2d';
import { useBranding } from '@/components/BrandingProvider';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import dynamic from 'next/dynamic';

// 2.5D 뷰포트는 브라우저 전용(WebSocket/DOM 계측) → SSR 비활성 dynamic import
const OfficeViewport2D = dynamic(() => import('@/components/OfficeViewport2D'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
      가상오피스 로딩 중…
    </div>
  ),
});

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────

interface WorkLog {
  id: number;
  title: string;
  status: string;
  logged_at: string;
}

// GET /api/kpi-results 실계약(14-spec §2.8.1): 정량은 value, 확정 시 final_score. score/max_score 필드는 없다.
interface KpiResult {
  metric: string;
  value: number | null;
  final_score: number | null;
  unit: string | null;
  period_type: string;
  period_key: string;
}

// GET /api/meetings 계약 — scheduled_at + duration_minutes 기반 (start_time/end_time 필드 없음)
interface Meeting {
  id: string;
  /** GET /api/rooms Room.id (UUID) */
  room_id?: string;
  title: string;
  scheduled_at: string;
  duration_minutes: number;
  started_at?: string | null;
  ended_at?: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  host_user_id?: number;
  participant_count?: number;
}

interface EmployeePresence {
  id: number;
  name: string;
  team_name?: string;
  status: EmployeePresenceStatus;
  avatar_url?: string;
}

// 공지사항 (14-virtual-office-spec §2.8): GET /api/notices
interface Notice {
  id: string;
  title: string;
  category?: string;
  pinned?: boolean;
  published_at?: string;
  created_at: string;
  author: string;
}

// 회의실 (GET /api/rooms): 뷰포트 방 라벨 ↔ Room.name 매칭에 사용 (livekit Room과 이름 충돌 방지)
interface RoomInfo {
  id: string; // UUID
  name: string; // 'Board Room' | 'Lounge' …
  type?: string;
  capacity?: number;
  floor_id?: string;
}

// ─────────────────────────────────────────────
// 좌측 내비 메뉴 정의
// ─────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

function IconOffice() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M3 3a1 1 0 000 2h1v11a1 1 0 001 1h10a1 1 0 001-1V5h1a1 1 0 100-2H3zm3 2h8v10H6V5zm2 2v2h4V7H8zm0 4v2h4v-2H8z" />
    </svg>
  );
}
function IconWork() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
    </svg>
  );
}
function IconCar() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
      <path d="M3 4a1 1 0 00-.894 1.447l1.447 2.894A1 1 0 004.447 9H6v2H4a1 1 0 100 2h1.268A3 3 0 1113 13h1a1 1 0 000-2h-1v-1h2a1 1 0 00.97-1.243l-1-4A1 1 0 0014 4H3z" />
    </svg>
  );
}
function IconKpi() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );
}
function IconReport() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
    </svg>
  );
}
function IconMeetRoom() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zm5.99 7.176A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
      <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
    </svg>
  );
}
function IconHR() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zm8 0a3 3 0 11-6 0 3 3 0 016 0zM3 14a7 7 0 0114 0H3z" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { href: '/office',           label: '가상오피스',    icon: <IconOffice /> },
  { href: '/work-log',         label: '업무관리',      icon: <IconWork /> },
  { href: '/work-status',      label: '업무현황',      icon: <IconChart /> },
  { href: '/trip',             label: '출장관리',      icon: <IconCar /> },
  { href: '/kpi',              label: 'KPI평가',       icon: <IconKpi /> },
  { href: '/reports',          label: '보고서',        icon: <IconReport /> },
  { href: '/meetings',         label: '회의실예약',    icon: <IconMeetRoom /> },
  { href: '/chat',             label: '커뮤니케이션',  icon: <IconChat /> },
  { href: '/admin/employees',  label: '인사·근태',     icon: <IconHR /> },
  { href: '/settings',         label: '설정',          icon: <IconSettings /> },
];

// 관리 메뉴 — 역할 게이트(구 관리콘솔 Sidebar.tsx 통합 → 셸 단일화)
const ADMIN_ITEMS: (NavItem & { roles: UserRole[] })[] = [
  { href: '/admin/kpi',           label: 'KPI관리',  icon: <IconKpi />,    roles: ['admin', 'super_admin', 'leader'] },
  { href: '/admin/org-chart',     label: '조직도',   icon: <IconHR />,     roles: ['admin', 'super_admin'] },
  { href: '/admin/office-layout', label: '좌석배치', icon: <IconOffice />, roles: ['admin', 'super_admin'] },
  { href: '/admin/sync',          label: '동기화',   icon: <IconChart />,  roles: ['admin', 'super_admin'] },
  { href: '/admin/audit',         label: '감사로그', icon: <IconReport />, roles: ['admin', 'super_admin'] },
  { href: '/admin/notices',       label: '공지관리', icon: <IconChat />,   roles: ['admin', 'super_admin'] },
  { href: '/admin/branding',      label: '브랜딩',   icon: <IconSettings />, roles: ['admin', 'super_admin'] },
];

// ─────────────────────────────────────────────
// 커맨드 팔레트(⌘K) — 스펙 시트 §3 "상단 검색 → 커맨드 팔레트": 구성원·방·기능 통합.
// 구성원 클릭 → 검색어 설정(기존 우측 패널 필터 동작 유지). 방/기능 클릭 → 라우팅.
// ─────────────────────────────────────────────
interface PaletteEntry {
  id: string;
  group: '구성원' | '방' | '기능';
  label: string;
  sub?: string;
  status?: EmployeePresenceStatus;
  /** 구성원 프로필 사진(D35 배지) — 없으면 이니셜. */
  photoUrl?: string | null;
  action: () => void;
}

function CommandPalette({
  open,
  onClose,
  entries,
}: {
  open: boolean;
  onClose: () => void;
  entries: PaletteEntry[];
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      // 열릴 때 입력 포커스(다음 프레임 — 렌더 후).
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const nq = q.trim().toLowerCase();
  const filtered = nq
    ? entries.filter((e) => e.label.toLowerCase().includes(nq) || e.sub?.toLowerCase().includes(nq))
    : entries;
  // 그룹 순서 유지(구성원 → 방 → 기능).
  const order: PaletteEntry['group'][] = ['구성원', '방', '기능'];
  const grouped = order
    .map((g) => ({ g, rows: filtered.filter((e) => e.group === g) }))
    .filter((x) => x.rows.length > 0);
  const flat = grouped.flatMap((x) => x.rows);

  useEffect(() => {
    if (active >= flat.length) setActive(Math.max(0, flat.length - 1));
  }, [flat.length, active]);

  if (!open) return null;

  const run = (e: PaletteEntry) => {
    e.action();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4"
      style={{ background: 'rgba(8,7,6,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="커맨드 팔레트"
    >
      <div
        className="w-full max-w-xl rounded-2xl overflow-hidden"
        style={chromeSurface('hi')}
        onClick={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') { ev.preventDefault(); onClose(); }
          else if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
          else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (ev.key === 'Enter') { ev.preventDefault(); if (flat[active]) run(flat[active]); }
        }}
      >
        <div className="flex items-center gap-2.5 px-4 h-12 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <span style={{ color: T1B.text2 }}><StrokeIcon d={RAIL_ICON.search} size={16} /></span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            placeholder="구성원 · 방 · 기능 검색 — 이동은 여기서"
            aria-label="구성원·방·기능 검색"
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px]"
            style={{ color: T1B.text1 }}
          />
          <span className="text-[10px] font-bold px-1.5 py-1 rounded" style={{ background: 'rgba(255,255,255,0.08)', color: T1B.text2 }}>ESC</span>
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {flat.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px]" style={{ color: T1B.text2 }}>결과가 없습니다</div>
          ) : (
            grouped.map(({ g, rows }) => (
              <div key={g} className="px-1.5 pb-1">
                <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold tracking-wide" style={{ color: T1B.groupLbl }}>{g}</div>
                {rows.map((e) => {
                  const idx = flat.indexOf(e);
                  const isActive = idx === active;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => run(e)}
                      className="w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-left transition-colors"
                      style={{ background: isActive ? T1B.hover : 'transparent' }}
                    >
                      {e.group === '구성원' && e.status ? (
                        <SceneBadge name={e.label} status={e.status} size={22} photoUrl={e.photoUrl} />
                      ) : (
                        <span style={{ color: T1B.icon }}>
                          <StrokeIcon d={e.group === '방' ? RAIL_ICON.cal : RAIL_ICON.grid4} size={16} />
                        </span>
                      )}
                      <span className="text-[12.5px] font-medium truncate" style={{ color: T1B.text1 }}>{e.label}</span>
                      {e.sub && <span className="ml-auto text-[11px] truncate flex-shrink-0 pl-2" style={{ color: T1B.text2 }}>{e.sub}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// (D33) 층 도면 카드 삭제 — 층 전환은 뷰포트 미니맵에 흡수(19-spec P0-3)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 사용자 상태 필터 탭
// ─────────────────────────────────────────────
type PresenceFilter = 'all' | 'office' | 'meeting' | 'external';
const FILTER_TABS: { key: PresenceFilter; label: string }[] = [
  { key: 'all',      label: '전체' },
  { key: 'office',   label: '사무실' },
  { key: 'meeting',  label: '회의중' },
  { key: 'external', label: '외근·출장' },
];

// 시안 People 패널: 상태 그룹 헤더(재실/회의중/자리비움/외근·출장/오프라인)
// 도트 색 = 씬 STATUS 맵과 동일(스펙 시트 §2): 재실 #34B369 · 회의중 #7B6BC9 · 자리비움 #EFAF3C · 외근 #3E6FB0 · 오프라인 #98A0AC
const PRESENCE_GROUPS: { key: string; label: string; color: string; statuses: EmployeePresenceStatus[] }[] = [
  { key: 'office',   label: '재실',       color: '#34B369', statuses: ['online', 'working', 'focus'] },
  { key: 'meeting',  label: '회의중',      color: '#7B6BC9', statuses: ['meeting'] },
  { key: 'away',     label: '자리비움',    color: '#EFAF3C', statuses: ['away'] },
  { key: 'external', label: '외근·출장',   color: '#3E6FB0', statuses: ['external'] },
  { key: 'offline',  label: '오프라인',    color: '#98A0AC', statuses: ['offline'] },
];

// ─────────────────────────────────────────────
// (1b 다크 정제) 셸 UI 리디자인 — docs/design-refs/shell-ui-redesign.dc.html "1b" 컬럼
// 웜 블랙 크롬 + 머스터드 활성. 스펙 시트 §2 컬러 토큰(B열)을 그대로 상수화.
// ─────────────────────────────────────────────
const T1B = {
  surface:   'rgba(22,20,18,0.84)',   // 표면
  surfaceHi: 'rgba(28,25,22,0.92)',   // 팝오버/플라이아웃(불투명↑)
  paletteBg: 'rgba(30,27,24,0.88)',   // 커맨드 팔레트 트리거
  blur:      'blur(22px) saturate(1.15)',
  border:    '1px solid rgba(255,255,255,0.09)',
  borderHi:  '1px solid rgba(255,255,255,0.10)',
  inset:     'inset 0 1px 0 rgba(255,255,255,0.06)',
  shadow:    '0 12px 32px rgba(0,0,0,0.42)',
  shadowHi:  '0 14px 36px rgba(0,0,0,0.5)',
  text1:     '#F0EAE2',
  text2:     '#CBBEAC',
  groupLbl:  '#C3B5A2',
  icon:      '#BFB2A0',
  mustard:   '#E3B23C',   // 활성 필/프라이머리 버튼
  mustardInk:'#1A1611',   // 머스터드 위 잉크
  hover:     'rgba(255,255,255,0.07)',
  dotRing:   '#211E1B',   // 상태 도트 표면 링
} as const;

// 셸 크롬 표면 공통 스타일(웜 블랙 글래스).
const chromeSurface = (raised?: 'hi' | 'palette'): React.CSSProperties => ({
  background: raised === 'hi' ? T1B.surfaceHi : raised === 'palette' ? T1B.paletteBg : T1B.surface,
  backdropFilter: T1B.blur,
  WebkitBackdropFilter: T1B.blur,
  border: raised === 'hi' ? T1B.borderHi : T1B.border,
  boxShadow: raised === 'hi' ? `${T1B.shadowHi},${T1B.inset}` : `${T1B.shadow},${T1B.inset}`,
});

// 스트로크 아이콘(레일/플라이아웃/팝오버) — 시안 renderVals()의 path 사전과 동일.
function StrokeIcon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size, flex: 'none' }}>
      <path d={d} />
    </svg>
  );
}
const RAIL_ICON = {
  office:  'M4 9.2 10 4.2l6 5M5.6 8.4V15.8h8.8V8.4',
  brief:   'M7 6V5a1.4 1.4 0 011.4-1.4h3.2A1.4 1.4 0 0113 5v1M3.6 6.4h12.8v9.2H3.6zM3.6 10.2h12.8',
  cal:     'M4 5.6h12v10.4H4zM4 9h12M7.4 3.6v3M12.6 3.6v3',
  chat:    'M4 4.6h12v8.6H9.8L6.4 16v-2.8H4z',
  clock:   'M16.4 10a6.4 6.4 0 11-12.8 0 6.4 6.4 0 0112.8 0zM10 6.4V10l2.4 1.6',
  more:    'M4.9 10a1 1 0 102 0 1 1 0 10-2 0M9 10a1 1 0 102 0 1 1 0 10-2 0M13.1 10a1 1 0 102 0 1 1 0 10-2 0',
  gear:    'M12.6 10a2.6 2.6 0 11-5.2 0 2.6 2.6 0 015.2 0zM10 3.4v1.8M10 14.8v1.8M3.4 10h1.8M14.8 10h1.8M5.3 5.3l1.3 1.3M13.4 13.4l1.3 1.3M14.7 5.3l-1.3 1.3M6.6 13.4l-1.3 1.3',
  // 업무 허브 플라이아웃 4종
  tasks:   'M8 5.4h8.4M8 10h8.4M8 14.6h6M3.6 5.2l1 1L6.4 4M3.6 9.8l1 1 1.8-2.2',
  pulse:   'M3.4 10h2.8l1.9-4.4 3 8.8 1.9-4.4h3.6',
  report:  'M5.6 3.6h6.2l3 3v9.8H5.6zM11.6 3.8V7h3M8 10.4h4M8 13h4',
  gauge:   'M4 13.6a6 6 0 0112 0M10 13.6l2.8-3',
  // 관리 콘솔 6종
  chart:   'M4 16h12M6.2 13V9.4M10 13V5.6M13.8 13V7.8',
  org:     'M8.4 3.8h3.2v3H8.4zM3.8 13.2H7v3H3.8zM13 13.2h3.2v3H13zM10 6.8v3.2M5.4 13.2v-3.2h9.2v3.2',
  grid4:   'M4 4h5.2v5.2H4zM10.8 4H16v5.2h-5.2zM4 10.8h5.2V16H4zM10.8 10.8H16V16h-5.2z',
  sync:    'M15.6 8.4A6 6 0 005.2 6.2M4.4 11.6a6 6 0 0010.4 2.2M15.6 4.2v4.2h-4.2M4.4 15.8v-4.2h4.2',
  log:     'M5.2 3.6h9.6v12.8H5.2zM7.6 7h4.8M7.6 10h4.8M7.6 13h3',
  mega:    'M4 8.6v3l2.6.5L14 15.2V4.8L6.6 8.1zM15.4 8.2a3 3 0 010 3.6',
  search:  'M14.2 8.7a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0zM12.8 12.8 16.4 16.4',
} as const;

// IA 재조직 매핑(스펙 시트 §3). href/역할 게이트는 NAV_ITEMS·ADMIN_ITEMS 그대로 참조.
// 업무 허브 = 업무관리·업무현황·보고서·KPI평가 (플라이아웃). 더보기 = 설정 + 관리 6종(역할 게이트).
const WORK_HUB_HREFS = ['/work-log', '/work-status', '/reports', '/kpi'];
const RAIL_MORE_ICON: Record<string, string> = {
  '/settings': RAIL_ICON.gear,
  '/admin/kpi': RAIL_ICON.chart,
  '/admin/org-chart': RAIL_ICON.org,
  '/admin/office-layout': RAIL_ICON.grid4,
  '/admin/sync': RAIL_ICON.sync,
  '/admin/audit': RAIL_ICON.log,
  '/admin/notices': RAIL_ICON.mega,
  '/admin/branding': RAIL_ICON.gear,
};
const WORK_HUB_ICON: Record<string, string> = {
  '/work-log': RAIL_ICON.tasks,
  '/work-status': RAIL_ICON.pulse,
  '/reports': RAIL_ICON.report,
  '/kpi': RAIL_ICON.gauge,
};

// 씬 배지 언어(V3 사진 배지 규격) — 이름 해시 → 그라디언트+링. OfficeViewport2D V3 배지와 동일 언어.
function badgeStyle(name: string): { grad: string; ring: string; ini: string } {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const hue = h % 360;
  const hue2 = (hue + 46) % 360;
  return {
    ini: name.length >= 3 ? name.slice(1) : name.slice(0, 2),
    grad: `linear-gradient(135deg,hsl(${hue},52%,58%),hsl(${hue2},56%,38%))`,
    ring: `hsl(${hue},46%,88%)`,
  };
}

// 상태 → 도트 색(스펙 시트 §2 상태 컬러, PRESENCE_GROUPS와 동일 팔레트).
const STATUS_DOT_1B: Record<EmployeePresenceStatus, string> = {
  online: '#34B369', working: '#34B369', focus: '#34B369',
  meeting: '#7B6BC9', away: '#EFAF3C', external: '#3E6FB0', offline: '#98A0AC',
};
// 팀명 부재 시 부제 폴백(상태 라벨).
const PRESENCE_META_LABEL: Record<EmployeePresenceStatus, string> = {
  online: '온라인', working: '업무 중', focus: '집중', meeting: '회의 중',
  away: '자리비움', external: '외근·출장', offline: '오프라인',
};

// 씬 배지 규격 아바타(우측 패널) — r8 타일 + 사진(D35, 없으면 이니셜) + 상태 도트(스펙 시트 §2·IA §3).
function SceneBadge({ name, status, size = 30, photoUrl }: { name: string; status: EmployeePresenceStatus; size?: number; photoUrl?: string | null }) {
  const b = badgeStyle(name);
  const dot = STATUS_DOT_1B[status] ?? STATUS_DOT_1B.offline;
  const src = mediaUrl(photoUrl);
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 8, background: b.grad, boxShadow: `0 0 0 2px ${b.ring}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: 11, fontWeight: 700, overflow: 'hidden' }}>
        {src ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={src} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          b.ini
        )}
      </div>
      <div style={{ position: 'absolute', right: -2, bottom: -2, width: 9, height: 9, borderRadius: '50%', background: dot, boxShadow: `0 0 0 2px ${T1B.dotRing}` }} />
    </div>
  );
}

// ─────────────────────────────────────────────
// 오피스 셸 (모든 (protected) 라우트의 상주 레이아웃)
// ─────────────────────────────────────────────
export default function OfficeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  // E5 화이트라벨 — 테넌트 브랜드명·로고. 미설정이면 기본 표기로 폴백.
  const { branding } = useBranding();
  const brandName = branding?.brand_name || 'VirtualOffice';
  const brandLogo = mediaUrl(branding?.logo_url);
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>('all');
  // D33 몰입 모드(19-spec P0-1): /office에서 사이드바=아이콘 레일·우측 패널=접힘이 기본.
  const [navExpanded, setNavExpanded] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // 헤더 검색(06 §1.2) — 우측 패널 직원 목록 이름/팀 필터. 셸에서 공유.
  const [searchQuery, setSearchQuery] = useState('');
  // 알림 드롭다운 + 마지막 확인 시각(localStorage 'notices_seen_at')
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticesSeenAt, setNoticesSeenAt] = useState<string | null>(null);

  // (1b) 커맨드 팔레트(⌘K/Ctrl+K) + 레일 플라이아웃/팝오버.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workHubOpen, setWorkHubOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  // 역할 게이트 관리 메뉴 + 오버레이(비-/office 라우트) 타이틀
  const role = (me?.role ?? 'employee') as UserRole;
  const adminItems = ADMIN_ITEMS.filter((i) => i.roles.includes(role));
  const isOffice = pathname === '/office';
  // 몰입 모드 파생 — /office든 메뉴 라우트든 동일하게 미니 레일 + 플로팅 크롬(오피스 위에 가볍게 띄움).
  // 사용자가 nav를 펼치면(navExpanded) 전 라우트에서 클래식 사이드바로 전환. 기본=몰입.
  const railMode = !navExpanded;
  // 프레즌스 패널은 전 라우트에서 온디맨드(핸들로 열기) — 메뉴 화면이 콘솔처럼 꽉 차 보이지 않게.
  const showPanel = panelOpen;
  const overlayItem = isOffice
    ? undefined
    : [...NAV_ITEMS, ...ADMIN_ITEMS]
        .filter((i) => !i.disabled && pathname.startsWith(i.href))
        .sort((a, b) => b.href.length - a.href.length)[0];

  // 데이터 상태
  const [workLogs, setWorkLogs]       = useState<WorkLog[]>([]);
  const [kpiResults, setKpiResults]   = useState<KpiResult[]>([]);
  const [meetings, setMeetings]       = useState<Meeting[]>([]);
  const [employees, setEmployees]     = useState<EmployeePresence[]>([]);
  const [todayMeetings, setTodayMeetings] = useState<Meeting[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);

  // C3: 회의 LiveKit 실미디어 연결
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  // WebRTC 안정화: 시그널/미디어 재연결 진행 여부 (연결 배지 표시용)
  const [mediaReconnecting, setMediaReconnecting] = useState(false);

  const handleJoinMeeting = useCallback(async (meetingId: string) => {
    if (joining || activeRoom) return; // 이중 클릭 시 룸 중복 연결·누수 방지
    setJoining(true);
    setJoinError(null);
    try {
      const room = await connectToMeeting(meetingId);
      setActiveRoom(room);
    } catch (err) {
      // 입장 실패 무음 처리 해소 — 실패 사유 인라인 배너 표시
      setActiveRoom(null);
      setJoinError(
        err instanceof ApiError
          ? `회의 입장 실패: ${err.message}`
          : '회의 입장에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
    } finally {
      setJoining(false);
    }
  }, [joining, activeRoom]);

  const handleLeaveMeeting = useCallback(async () => {
    await disconnectRoom(activeRoom);
    setActiveRoom(null);
  }, [activeRoom]);

  // WebRTC 안정화: 룸 수명주기 추적 — 서버측 회의 종료·토큰 만료·재연결 한도 초과로
  // 룸이 끊기면 activeRoom을 정리한다(미정리 시 "연결됨" 고착 + 재입장 차단).
  useEffect(() => {
    if (!activeRoom) {
      setMediaReconnecting(false);
      return;
    }
    const onReconnecting = () => setMediaReconnecting(true);
    const onReconnected = () => setMediaReconnecting(false);
    const onDisconnected = (reason?: DisconnectReason) => {
      setActiveRoom(null);
      setMediaReconnecting(false);
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        setJoinError('다른 곳에서 같은 계정으로 입장하여 회의 연결이 종료되었습니다');
      } else if (reason === DisconnectReason.ROOM_DELETED) {
        setJoinError('회의가 종료되었습니다');
      } else if (reason !== undefined && reason !== DisconnectReason.CLIENT_INITIATED) {
        setJoinError('회의 연결이 끊어졌습니다. 다시 입장해주세요');
      }
    };
    activeRoom.on(RoomEvent.Reconnecting, onReconnecting);
    activeRoom.on(RoomEvent.SignalReconnecting, onReconnecting);
    activeRoom.on(RoomEvent.Reconnected, onReconnected);
    activeRoom.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      activeRoom.off(RoomEvent.Reconnecting, onReconnecting);
      activeRoom.off(RoomEvent.SignalReconnecting, onReconnecting);
      activeRoom.off(RoomEvent.Reconnected, onReconnected);
      activeRoom.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [activeRoom]);

  // D24: 뷰포트 회의실 근접 프롬프트 확인 → 해당 방의 회의에 명시 입장(LiveKit).
  // 뷰포트 방 라벨(Reception/Lounge/Board Room…) ↔ GET /api/rooms Room.name 대소문자 무시 매칭
  // → 그 room_id의 진행중 회의(없으면 오늘 예정 중 가장 가까운 회의)에 입장.
  const handleViewportJoin = useCallback(
    (roomId: string) => {
      if (activeRoom) return; // 이미 연결됨
      const label = VIEWPORT_ROOMS.find((r) => r.id === roomId)?.label ?? roomId;
      const room = rooms.find((r) => r.name?.toLowerCase() === label.toLowerCase());
      const inProgress = room ? meetings.find((m) => m.room_id === room.id) : undefined;
      const nearestScheduled = room
        ? todayMeetings
            .filter((m) => m.room_id === room.id && m.status === 'scheduled')
            .sort(
              (a, b) =>
                Math.abs(new Date(a.scheduled_at).getTime() - Date.now()) -
                Math.abs(new Date(b.scheduled_at).getTime() - Date.now()),
            )[0]
        : undefined;
      const target = inProgress ?? nearestScheduled;
      if (target) {
        void handleJoinMeeting(target.id);
      } else {
        setJoinError('이 회의실에 진행 중인 회의가 없습니다');
      }
    },
    [rooms, meetings, todayMeetings, activeRoom, handleJoinMeeting],
  );

  // 페이지 이탈/룸 교체 시 연결 정리(disconnectRoom은 중복 호출 안전).
  useEffect(() => () => { void disconnectRoom(activeRoom); }, [activeRoom]);

  const [loadingWork, setLoadingWork]     = useState(true);
  const [loadingKpi,  setLoadingKpi]      = useState(true);
  const [loadingMeet, setLoadingMeet]     = useState(true);
  const [loadingEmp,  setLoadingEmp]      = useState(true);

  useEffect(() => {
    setMe(getUser());
    try {
      setNoticesSeenAt(localStorage.getItem('notices_seen_at'));
    } catch {
      // localStorage 접근 불가 시 무시 (배지=전체 신규 취급)
    }
  }, []);

  // 오늘의 업무 (work-logs)
  const fetchWorkLogs = useCallback(async () => {
    if (!me) return;
    setLoadingWork(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const data = await api.get<WorkLog[]>(
        `/api/work-logs?user_id=${me.id}&date=${today}&limit=5`,
      );
      setWorkLogs(Array.isArray(data) ? data : []);
    } catch {
      setWorkLogs([]);
    } finally {
      setLoadingWork(false);
    }
  }, [me]);

  // 나의 KPI
  const fetchKpi = useCallback(async () => {
    if (!me) return;
    setLoadingKpi(true);
    try {
      const data = await api.get<KpiResult[]>(
        `/api/kpi-results?user_id=${me.id}&period_type=quarterly`,
      );
      setKpiResults(Array.isArray(data) ? data : []);
    } catch {
      setKpiResults([]);
    } finally {
      setLoadingKpi(false);
    }
  }, [me]);

  // 진행중 화상회의 + 오늘 일정 (meetings)
  const fetchMeetings = useCallback(async () => {
    setLoadingMeet(true);
    try {
      const data = await api.get<Meeting[]>('/api/meetings?status=in_progress&limit=4');
      setMeetings(Array.isArray(data) ? data : []);
      // 오늘의 일정: KST(UTC+9) 오늘 0시~24시를 UTC ISO로 변환해 조회
      const kstDay = new Date(Date.now() + 9 * 3600_000);
      kstDay.setUTCHours(0, 0, 0, 0);
      const from = new Date(kstDay.getTime() - 9 * 3600_000);
      const to = new Date(from.getTime() + 24 * 3600_000);
      const today = await api.get<Meeting[]>(
        `/api/meetings?scheduled_from=${encodeURIComponent(from.toISOString())}&scheduled_to=${encodeURIComponent(to.toISOString())}&limit=5`,
      );
      setTodayMeetings(Array.isArray(today) ? today : []);
    } catch {
      setMeetings([]);
      setTodayMeetings([]);
    } finally {
      setLoadingMeet(false);
    }
  }, []);

  // 구성원 프로필 사진(D35 배지) — employees 확정 시 공개 아바타 외형 일괄 조회.
  const [memberPhotos, setMemberPhotos] = useState<Record<number, string | null>>({});
  useEffect(() => {
    const ids = employees.map((e) => e.id).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return;
    let cancelled = false;
    api
      .get<Array<{ user_id: number; photo_url: string | null }>>(
        `/api/avatars?user_ids=${ids.join(',')}`,
      )
      .then((rows) => {
        if (cancelled) return;
        setMemberPhotos((prev) => {
          const next = { ...prev };
          for (const r of rows) next[r.user_id] = r.photo_url ?? null;
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [employees]);

  // 사용자 목록 (GET /api/employees — 응답 presence_status 사용, 없으면 offline 폴백)
  const fetchEmployees = useCallback(async () => {
    setLoadingEmp(true);
    try {
      const data = await api.get<
        (Omit<EmployeePresence, 'status'> & { presence_status?: EmployeePresenceStatus | null })[]
      >('/api/employees?limit=30');
      setEmployees(
        (Array.isArray(data) ? data : []).map((e) => ({
          ...e,
          status: e.presence_status ?? 'offline',
        })),
      );
    } catch {
      setEmployees([]);
    } finally {
      setLoadingEmp(false);
    }
  }, []);

  // 공지사항 (notices)
  const fetchNotices = useCallback(async () => {
    try {
      const data = await api.get<{ items: Notice[] }>('/api/notices?limit=5');
      setNotices(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setNotices([]);
    }
  }, []);

  // 회의실 목록 (GET /api/rooms) — 뷰포트 방 ↔ 회의 매핑용, 셸에서 1회 로드
  const fetchRooms = useCallback(async () => {
    try {
      const data = await api.get<RoomInfo[]>('/api/rooms');
      setRooms(Array.isArray(data) ? data : []);
    } catch {
      setRooms([]);
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    fetchWorkLogs();
    fetchKpi();
    fetchMeetings();
    fetchEmployees();
    fetchNotices();
    fetchRooms();
  }, [me, fetchWorkLogs, fetchKpi, fetchMeetings, fetchEmployees, fetchNotices, fetchRooms]);

  // KPI 집계 — 헤드라인 = collaboration_score(14-spec §2.8.1), 없으면 score형 지표 평균. NaN 방지(구 r.score 참조 버그 수리).
  const _kpiVal = (r: KpiResult): number => r.final_score ?? r.value ?? 0;
  const _collab = kpiResults.find((r) => r.metric === 'collaboration_score');
  const _scoreRows = kpiResults.filter((r) => (r.unit ?? 'score') === 'score' && (r.final_score ?? r.value) != null);
  const avgScore = _collab
    ? Math.round(_kpiVal(_collab))
    : _scoreRows.length
      ? Math.round(_scoreRows.reduce((s, r) => s + _kpiVal(r), 0) / _scoreRows.length)
      : 0;

  // 사용자 필터 — offline은 '전체'에서만 노출. 헤더 검색어(이름/팀)와 AND 결합(06 §1.2)
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredEmployees = employees.filter((e) => {
    if (
      normalizedQuery &&
      !e.name?.toLowerCase().includes(normalizedQuery) &&
      !e.team_name?.toLowerCase().includes(normalizedQuery)
    ) {
      return false;
    }
    if (presenceFilter === 'all') return true;
    if (presenceFilter === 'office')   return e.status === 'online' || e.status === 'working' || e.status === 'focus' || e.status === 'away';
    if (presenceFilter === 'meeting')  return e.status === 'meeting';
    if (presenceFilter === 'external') return e.status === 'external';
    return true;
  });

  // 새 공지 배지 — published_at(없으면 created_at)이 마지막 확인 시각 이후인 공지 수
  const unseenNoticeCount = notices.filter((n) => {
    const ts = n.published_at ?? n.created_at;
    if (!ts) return false;
    if (!noticesSeenAt) return true;
    return new Date(ts).getTime() > new Date(noticesSeenAt).getTime();
  }).length;

  // (1b) 재실 카운터 — 오프라인이 아닌 구성원 수 / 전체(우측 패널 데이터, 스펙 시트 오피스 필).
  const onlineCount = employees.filter((e) => e.status !== 'offline').length;

  // (1b) ⌘K / Ctrl+K → 커맨드 팔레트. / 도 트리거(입력 포커스 중이 아닐 때).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // (1b) 커맨드 팔레트 엔트리 — 구성원(검색어 설정, 기존 패널 필터 동작 유지)·방·기능.
  const paletteEntries = useMemo<PaletteEntry[]>(() => {
    const memberEntries: PaletteEntry[] = employees.map((e) => ({
      id: `member-${e.id}`,
      group: '구성원' as const,
      label: e.name,
      sub: e.team_name,
      status: e.status,
      photoUrl: memberPhotos[e.id] ?? null,
      action: () => {
        // 기존 헤더 검색과 동일: 우측 패널 필터에 이름 반영 + 패널 열기(/office 몰입 시 접혀있을 수 있음).
        setSearchQuery(e.name);
        setPresenceFilter('all');
        setPanelOpen(true);
        if (pathname !== '/office') router.push('/office');
      },
    }));
    const roomEntries: PaletteEntry[] = VIEWPORT_ROOMS.map((r) => ({
      id: `room-${r.id}`,
      group: '방' as const,
      label: r.label,
      sub: '오피스에서 보기',
      action: () => {
        // 씬 카메라 포커스 등가물(스펙 §3) — 전체 플레이트 뷰(팬/줌 없음)라 방 글로우+라벨로 포커스.
        // /office면 이벤트로 즉시, 타 라우트면 ?focus= 쿼리로 이동 후 뷰포트가 마운트 시 반영.
        if (pathname === '/office') {
          window.dispatchEvent(new CustomEvent('office:focus-room', { detail: { roomId: r.id } }));
        } else {
          router.push(`/office?focus=${encodeURIComponent(r.id)}`);
        }
      },
    }));
    const fnEntries: PaletteEntry[] = [...NAV_ITEMS, ...adminItems]
      .filter((i) => !i.disabled)
      .map((i) => ({
        id: `fn-${i.href}`,
        group: '기능' as const,
        label: i.label,
        sub: i.href,
        action: () => router.push(i.href),
      }));
    return [...memberEntries, ...roomEntries, ...fnEntries];
  }, [employees, memberPhotos, adminItems, pathname, router]);

  // 알림 드롭다운 토글 — 열 때 확인 시각 갱신(localStorage 'notices_seen_at') → 배지 해소
  const handleNoticeToggle = () => {
    if (!noticeOpen) {
      const now = new Date().toISOString();
      try {
        localStorage.setItem('notices_seen_at', now);
      } catch {
        // localStorage 접근 불가 시 무시
      }
      setNoticesSeenAt(now);
    }
    setNoticeOpen(!noticeOpen);
  };

  // 공지 목록 페이지는 관리자용(/admin/notices)만 존재 → '전체 보기'는 관리자에게만 노출
  const canViewAllNotices = role === 'admin' || role === 'super_admin';

  // KST 기준 HH:MM
  const formatTime = (iso: string | Date) => {
    try { return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }); }
    catch { return String(iso); }
  };
  // meetings 계약: scheduled_at + duration_minutes → 종료시각 계산
  const meetingEndsAt = (m: Meeting) =>
    new Date(new Date(m.scheduled_at).getTime() + (m.duration_minutes ?? 0) * 60_000);

  // 내비 링크 렌더러 — 기본/관리 섹션 공용. railMode(D33)면 아이콘만 + title 툴팁.
  const renderNav = (item: NavItem) => {
    const isActive = !item.disabled && (pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)));
    if (railMode) {
      if (item.disabled) {
        return (
          <span
            key={item.href}
            title={`${item.label} — 준비중`}
            aria-disabled="true"
            className="flex items-center justify-center w-10 h-10 mx-auto rounded-lg cursor-not-allowed opacity-40 text-text-muted select-none"
          >
            {item.icon}
          </span>
        );
      }
      return (
        <Link
          key={item.href}
          href={item.href}
          title={item.label}
          aria-label={item.label}
          className={[
            'flex items-center justify-center w-10 h-10 mx-auto rounded-lg transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
            isActive
              ? 'bg-[rgba(59,91,254,0.15)] text-primary'
              : 'text-text-muted hover:bg-bg-surface-raised hover:text-text-primary',
          ].join(' ')}
          aria-current={isActive ? 'page' : undefined}
        >
          {item.icon}
        </Link>
      );
    }
    if (item.disabled) {
      return (
        <span
          key={item.href}
          title="준비중"
          aria-disabled="true"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium cursor-not-allowed opacity-40 text-text-secondary select-none"
        >
          <span className="text-text-muted">{item.icon}</span>
          {item.label}
          <span className="ml-auto text-[10px] px-1 py-0.5 rounded bg-bg-surface-raised text-text-muted leading-none">준비중</span>
        </span>
      );
    }
    return (
      <Link
        key={item.href}
        href={item.href}
        className={[
          'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
          isActive
            ? 'bg-[rgba(59,91,254,0.15)] text-primary border-l-2 border-primary pl-[10px]'
            : 'text-text-secondary hover:bg-bg-surface-raised hover:text-text-primary',
        ].join(' ')}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className={isActive ? 'text-primary' : 'text-text-muted'}>{item.icon}</span>
        {item.label}
      </Link>
    );
  };

  // ──────────────────────────────────────────
  // 렌더
  // ──────────────────────────────────────────

  // D33 하단 통합 독(19-spec P0-2)의 셸 세그먼트 — 뷰포트 dockSlot으로 주입.
  // 미디어바는 회의 연결 시에만(몰입 원칙), LIVE 칩은 미연결+진행중 회의 존재 시.
  const meetingDock = (
    <>
      {joinError && (
        <div
          role="alert"
          title={joinError}
          className="max-w-[240px] rounded-full border border-border-subtle px-3 py-1.5 text-[10px] text-danger leading-snug truncate"
          style={{ background: 'rgba(13,27,54,0.92)', backdropFilter: 'blur(6px)' }}
        >
          {joinError}
        </div>
      )}
      {meetings.length > 0 && !activeRoom && (
        <div
          className="flex items-center gap-2 rounded-full border border-border-subtle pl-3 pr-1.5 py-1"
          style={{ background: 'rgba(13,27,54,0.92)', backdropFilter: 'blur(6px)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0 animate-pulse" />
          <span className="text-[11px] font-semibold text-text-primary max-w-[140px] truncate">{meetings[0].title}</span>
          <span className="text-[10px] text-text-secondary flex-shrink-0">
            {meetings[0].participant_count != null ? `${meetings[0].participant_count}명` : 'LIVE'}
          </span>
          <button
            type="button"
            onClick={() => handleJoinMeeting(meetings[0].id)}
            disabled={joining}
            className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-primary text-white hover:bg-primary-hover disabled:opacity-50 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
          >
            {joining ? '연결 중…' : '입장하기'}
          </button>
        </div>
      )}
      {activeRoom && (
        <div className="flex items-center gap-2">
          {mediaReconnecting && (
            <span className="text-[10px] text-status-external font-medium whitespace-nowrap">● 재연결 중…</span>
          )}
          <MediaBar room={activeRoom} onLeave={handleLeaveMeeting} />
        </div>
      )}
    </>
  );

  return (
    <div
      className="flex flex-col h-screen overflow-hidden font-sans"
      style={{ background: 'rgb(var(--color-bg-base))' }}
    >
      {/* (1b) 커맨드 팔레트 — ⌘K/Ctrl+K 또는 팔레트 트리거로 열림 */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} entries={paletteEntries} />

      {/* ── 상단 헤더 (시안) — /office 몰입(railMode)에선 플로팅 크롬으로 대체(아래), 그 외 라우트는 상단바 유지 ── */}
      {!railMode && (
      <header className="flex-shrink-0 h-14 flex items-center justify-between px-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-sm">V</div>
          <span className="text-text-primary font-semibold text-[15px]">Virtual Office</span>
          <button className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-bg-surface-raised text-text-secondary text-[13px] transition-colors">
            본사 (HQ) <span className="text-text-muted">▾</span>
          </button>
        </div>
        <div className="flex-1 max-w-md mx-6 hidden md:block">
          {/* 헤더 검색 → 커맨드 팔레트 트리거(스펙 시트 §3). 클릭·포커스 시 팔레트 오픈. */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-surface text-text-muted text-[13px] border border-border-subtle hover:border-primary/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
            <span className="flex-1 min-w-0 text-left truncate">
              {searchQuery ? `검색: ${searchQuery}` : '구성원 · 방 · 기능 검색 — 이동은 여기서'}
            </span>
            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-bg-surface-raised text-text-secondary">⌘K</span>
          </button>
        </div>
        <div className="flex items-center gap-3">
          {/* 메시지 → 커뮤니케이션(/chat) 이동 */}
          <Link
            href="/chat"
            title="커뮤니케이션"
            aria-label="커뮤니케이션"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-surface-raised transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" /><path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" /></svg>
          </Link>
          {/* 알림 — 최근 공지 5건 드롭다운 + 새 공지 배지(notices_seen_at 비교) */}
          <div className="relative">
            <button
              type="button"
              onClick={handleNoticeToggle}
              title="알림"
              aria-label={unseenNoticeCount > 0 ? `알림 — 새 공지 ${unseenNoticeCount}건` : '알림'}
              aria-haspopup="true"
              aria-expanded={noticeOpen}
              className="relative w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-surface-raised transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" /></svg>
              {unseenNoticeCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {unseenNoticeCount > 9 ? '9+' : unseenNoticeCount}
                </span>
              )}
            </button>
            {noticeOpen && (
              <>
                {/* 바깥 클릭 시 닫힘 백드롭 */}
                <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setNoticeOpen(false)} />
                <div
                  role="menu"
                  aria-label="최근 공지"
                  className="absolute right-0 top-10 z-40 w-72 rounded-xl border border-border-subtle shadow-2xl overflow-hidden"
                  style={{ background: 'rgb(var(--color-bg-surface))' }}
                >
                  <div className="px-3 py-2.5 border-b border-border-subtle text-[12px] font-semibold text-text-primary">최근 공지</div>
                  <div className="max-h-80 overflow-y-auto py-1">
                    {notices.length === 0 ? (
                      <div className="px-3 py-4 text-[12px] text-text-muted text-center">공지사항이 없습니다</div>
                    ) : (
                      notices.map((n) => (
                        // 공지 전용 페이지 부재 → 드롭다운 내 읽기 전용 항목
                        <div key={n.id} className="px-3 py-2 hover:bg-bg-surface-raised transition-colors">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {n.pinned && (
                              <span className="flex-shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded bg-[rgba(59,91,254,0.2)] text-primary leading-none">고정</span>
                            )}
                            <span className="text-[12px] text-text-primary truncate">{n.title}</span>
                          </div>
                          <div className="text-[10px] text-text-muted mt-0.5">
                            {(n.published_at ?? n.created_at)?.slice(0, 10).replace(/-/g, '.')}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {canViewAllNotices && (
                    <Link
                      href="/admin/notices"
                      onClick={() => setNoticeOpen(false)}
                      className="block px-3 py-2 border-t border-border-subtle text-center text-[11px] font-medium text-primary hover:bg-bg-surface-raised transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                    >
                      전체 보기 ›
                    </Link>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 pl-1">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold">
              {me?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div className="text-right leading-tight hidden sm:block">
              <div className="text-[13px] text-text-primary font-medium">{me?.name ?? '—'}</div>
              <div className="text-[11px] text-status-online">● Online</div>
            </div>
          </div>
        </div>
      </header>
      )}

      {/* ── 본문 3열 (railMode에선 씬 풀블리드 + 플로팅 패널 → relative 앵커) ── */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
      {/* ── 좌 내비 — 펼침 사이드바(그 외 라우트 · /office 메뉴 펼침). railMode는 플로팅 미니 레일로 대체(아래) ── */}
      {!railMode && (
      <aside
        className="w-60 flex-shrink-0 flex flex-col border-r border-border-subtle transition-[width] duration-200"
        style={{ background: 'rgb(var(--color-bg-surface))' }}
      >
        {/* 로고 + 레일 접기(/office 메뉴 펼침 상태에서만 노출) */}
        <div className="px-5 py-4 border-b border-border-subtle flex-shrink-0 flex items-center justify-between gap-2">
          {/* E5: 브랜드명·로고는 테넌트 설정(useBranding)에서 온다. 미설정이면 회사명 → 기본 문구. */}
          <div className="min-w-0 flex items-center gap-2">
            {brandLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brandLogo}
                alt=""
                className="w-7 h-7 rounded-lg object-contain flex-shrink-0"
              />
            )}
            <div className="min-w-0">
              <div className="text-[10px] text-text-muted uppercase tracking-widest mb-0.5 truncate">
                {brandName}
              </div>
              <div className="text-base font-bold text-text-primary">가상 오피스</div>
            </div>
          </div>
          {isOffice && (
            <button
              type="button"
              onClick={() => setNavExpanded(false)}
              title="메뉴 접기"
              aria-label="메뉴 접기"
              aria-expanded={true}
              className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-surface-raised transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
            </button>
          )}
        </div>

        {/* 내비 메뉴 */}
        <nav className="flex-1 py-3 overflow-y-auto px-3 space-y-0.5" aria-label="주 메뉴">
          {NAV_ITEMS.map(renderNav)}
          {adminItems.length > 0 && (
            <div data-tour="admin-nav">
              <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">관리</div>
              {adminItems.map(renderNav)}
            </div>
          )}
        </nav>

        {/* 내 프로필 카드 */}
        <div className="px-3 py-3 border-t border-border-subtle flex-shrink-0">
          {me ? (
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-bg-surface-raised">
              <Avatar name={me.name} status="online" size="md" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-text-primary truncate">{me.name}</div>
                <StatusBadge status="online" />
              </div>
              <button
                onClick={logout}
                className="text-text-muted hover:text-danger transition-colors p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                title="로그아웃"
                aria-label="로그아웃"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm9.293 2.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="h-12 rounded-lg bg-bg-surface-raised animate-pulse" />
          )}
        </div>
      </aside>
      )}

      {/* ── 중앙 영역 ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 가상오피스 씬 = 2.5D 클린 플레이트 + 실시간 아바타 (v2.2 팩 + realtime Colyseus) */}
        <div className="relative flex-1 min-h-0">
          <div data-tour="viewport" className="absolute inset-0 overflow-hidden" style={{ background: '#0d1b36' }}>
            {/* D1(감사 23)/T1-13(22): 실시간 연결은 /office에서만 — 메뉴 라우트는 씬 배경만 유지하고
                Colyseus 방 슬롯·프레즌스 rAF를 점유하지 않는다(유휴 유저의 동접 천장 잠식 해소). */}
            <OfficeViewport2D onJoinMeeting={handleViewportJoin} dockSlot={meetingDock} realtimeEnabled={isOffice} />
          </div>

          {/* E6 첫실행 — 체크리스트(admin)·최초 투어(전원). 씬 위 오버레이. */}
          <OnboardingChecklist />

          {/* ── (1b) 플로팅 셸 크롬 — /office 몰입(railMode) 전용. 씬 위 z-30 오버레이 ── */}
          {railMode && (
            <>
              {/* 좌상단: 오피스 필 — 브랜드명 + 재실 카운터.
                  E5: 이름·로고는 테넌트 설정에서 온다. 셸이 특정 회사명을 박아 두면
                  다른 회사가 로그인해도 남의 간판이 걸린다(화이트라벨 전체가 무의미해진다). */}
              <div
                className="absolute left-4 top-4 z-30 h-11 flex items-center gap-2.5 pl-2 pr-3.5 rounded-2xl"
                style={chromeSurface()}
              >
                {brandLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brandLogo} alt="" className="w-[26px] h-[26px] rounded-lg object-contain flex-shrink-0" />
                ) : (
                  <div className="w-[26px] h-[26px] rounded-lg flex items-center justify-center text-white text-xs font-extrabold" style={{ background: 'linear-gradient(135deg,#C4553B,#E3B23C)' }}>
                    {brandName.trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-[13px] font-extrabold tracking-tight truncate max-w-[220px]" style={{ color: T1B.text1 }}>{brandName}</span>
                <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: 'rgba(255,255,255,0.07)', color: T1B.text2 }}>
                  <span className="w-[7px] h-[7px] rounded-full" style={{ background: '#34B369' }} />
                  {onlineCount}/{employees.length || onlineCount}
                </span>
              </div>

              {/* 상단 중앙: 커맨드 팔레트 트리거 */}
              <button
                type="button"
                data-tour="command"
                onClick={() => setPaletteOpen(true)}
                aria-label="구성원·방·기능 검색 (커맨드 팔레트)"
                className="absolute left-1/2 top-4 -translate-x-1/2 z-30 w-[480px] max-w-[46vw] h-11 flex items-center gap-2.5 px-3.5 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E3B23C]/60"
                style={chromeSurface('palette')}
              >
                <span style={{ color: T1B.text2 }}><StrokeIcon d={RAIL_ICON.search} size={16} /></span>
                <span className="flex-1 min-w-0 text-left text-[12.5px] truncate" style={{ color: T1B.text2 }}>
                  {searchQuery ? `검색: ${searchQuery}` : '구성원 · 방 · 기능 검색 — 이동은 여기서'}
                </span>
                <span className="text-[10.5px] font-bold px-1.5 py-1 rounded" style={{ background: 'rgba(255,255,255,0.08)', color: T1B.text2 }}>⌘K</span>
              </button>

              {/* 우상단: 알림 + 프로필 */}
              <div className="absolute right-4 top-4 z-30 flex gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={handleNoticeToggle}
                    title="알림"
                    aria-label={unseenNoticeCount > 0 ? `알림 — 새 공지 ${unseenNoticeCount}건` : '알림'}
                    aria-haspopup="true"
                    aria-expanded={noticeOpen}
                    className="relative w-11 h-11 rounded-2xl flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E3B23C]/60"
                    style={{ ...chromeSurface(), color: T1B.icon }}
                  >
                    <StrokeIcon d="M6.2 8.2a3.8 3.8 0 017.6 0c0 2.9 1.4 4.2 1.4 4.2H4.8s1.4-1.3 1.4-4.2M8.6 15.2a1.5 1.5 0 002.8 0" size={19} />
                    {unseenNoticeCount > 0 && (
                      <span className="absolute top-1 right-1 min-w-[14px] h-3.5 px-1 rounded-full text-white text-[9px] font-extrabold flex items-center justify-center leading-none" style={{ background: '#E0524D', boxShadow: `0 0 0 2px ${T1B.dotRing}` }}>
                        {unseenNoticeCount > 9 ? '9+' : unseenNoticeCount}
                      </span>
                    )}
                  </button>
                  {noticeOpen && (
                    <>
                      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setNoticeOpen(false)} />
                      <div role="menu" aria-label="최근 공지" className="absolute right-0 top-12 z-50 w-72 rounded-2xl overflow-hidden" style={chromeSurface('hi')}>
                        <div className="px-3.5 py-2.5 text-[12px] font-bold" style={{ color: T1B.text1, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>최근 공지</div>
                        <div className="max-h-80 overflow-y-auto py-1">
                          {notices.length === 0 ? (
                            <div className="px-3 py-4 text-[12px] text-center" style={{ color: T1B.text2 }}>공지사항이 없습니다</div>
                          ) : (
                            notices.map((n) => (
                              <div key={n.id} className="px-3.5 py-2 transition-colors" style={{ color: T1B.text1 }}>
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {n.pinned && <span className="flex-shrink-0 text-[9px] font-bold px-1 py-0.5 rounded leading-none" style={{ background: 'rgba(227,178,60,0.2)', color: T1B.mustard }}>고정</span>}
                                  <span className="text-[12px] truncate">{n.title}</span>
                                </div>
                                <div className="text-[10px] mt-0.5" style={{ color: T1B.text2 }}>{(n.published_at ?? n.created_at)?.slice(0, 10).replace(/-/g, '.')}</div>
                              </div>
                            ))
                          )}
                        </div>
                        {canViewAllNotices && (
                          <Link href="/admin/notices" onClick={() => setNoticeOpen(false)} className="block px-3 py-2 text-center text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E3B23C]/60" style={{ color: T1B.mustard, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                            전체 보기 ›
                          </Link>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setProfileOpen((o) => !o)}
                    title={me?.name ?? '프로필'}
                    aria-haspopup="true"
                    aria-expanded={profileOpen}
                    className="h-11 flex items-center gap-1.5 px-2.5 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E3B23C]/60"
                    style={chromeSurface()}
                  >
                    <div className="relative w-[30px] h-[30px]">
                      <div className="absolute inset-0 rounded-lg flex items-center justify-center text-white text-[11px] font-bold" style={{ background: badgeStyle(me?.name ?? '나').grad, boxShadow: `0 0 0 2px ${badgeStyle(me?.name ?? '나').ring}` }}>
                        {(me?.name ?? '나').slice(0, 2)}
                      </div>
                      <div className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full" style={{ background: '#34B369', boxShadow: `0 0 0 2px ${T1B.dotRing}` }} />
                    </div>
                    <span style={{ color: T1B.text2 }}><StrokeIcon d="M6.6 8.6 10 12l3.4-3.4" size={14} /></span>
                  </button>
                  {profileOpen && (
                    <>
                      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setProfileOpen(false)} />
                      <div role="menu" className="absolute right-0 top-12 z-50 w-52 rounded-2xl overflow-hidden p-1.5" style={chromeSurface('hi')}>
                        <div className="px-2.5 py-2">
                          <div className="text-[13px] font-bold truncate" style={{ color: T1B.text1 }}>{me?.name ?? '—'}</div>
                          <div className="text-[11px] mt-0.5 flex items-center gap-1.5" style={{ color: T1B.text2 }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#34B369' }} /> 온라인
                          </div>
                        </div>
                        <div className="h-px my-1 mx-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                        <Link href="/settings" onClick={() => setProfileOpen(false)} className="flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[12.5px] font-medium transition-colors" style={{ color: T1B.text1 }}>
                          <span style={{ color: T1B.icon }}><StrokeIcon d={RAIL_ICON.gear} size={16} /></span> 설정
                        </Link>
                        <button type="button" onClick={() => { setProfileOpen(false); logout(); }} className="w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[12.5px] font-medium text-left transition-colors" style={{ color: '#E0857A' }}>
                          <StrokeIcon d="M8 4.5H5.2A1.2 1.2 0 004 5.7v8.6a1.2 1.2 0 001.2 1.2H8M12.5 12.8 15.3 10l-2.8-2.8M15 10H8" size={16} /> 로그아웃
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* 좌측 미니 레일 — 5그룹 + 더보기(세로 중앙). 활성 = 머스터드 필 */}
              <div className="absolute left-4 top-1/2 -translate-y-1/2 z-30">
                <div className="w-[52px] flex flex-col items-center gap-1.5 py-2 rounded-2xl" style={chromeSurface()}>
                  {/* 1) 가상오피스(활성=씬 홈) */}
                  <Link
                    href="/office"
                    title="가상오피스"
                    aria-label="가상오피스"
                    aria-current="page"
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: T1B.mustard, color: T1B.mustardInk, boxShadow: '0 4px 12px rgba(227,178,60,0.35)' }}
                  >
                    <StrokeIcon d={RAIL_ICON.office} size={20} />
                  </Link>
                  {/* 2) 업무 허브(플라이아웃) */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => { setWorkHubOpen((o) => !o); setMoreOpen(false); }}
                      title="업무 허브 — 업무관리 · 업무현황 · 보고서 · KPI평가"
                      aria-label="업무 허브"
                      aria-haspopup="true"
                      aria-expanded={workHubOpen}
                      className="relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E3B23C]/60"
                      style={{ background: workHubOpen ? T1B.hover : 'transparent', color: T1B.icon }}
                    >
                      <StrokeIcon d={RAIL_ICON.brief} size={20} />
                      <span className="absolute top-[3px] right-[3px] min-w-[15px] h-[15px] rounded-lg text-[9px] font-extrabold flex items-center justify-center" style={{ background: T1B.mustard, color: T1B.mustardInk, boxShadow: `0 0 0 2px ${T1B.dotRing}` }}>4</span>
                    </button>
                    {workHubOpen && (
                      <>
                        <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setWorkHubOpen(false)} />
                        <div role="menu" aria-label="업무 허브" className="absolute left-[62px] top-1/2 -translate-y-1/2 z-50 w-[204px] p-2 rounded-2xl" style={chromeSurface('hi')}>
                          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-bold tracking-wide" style={{ color: T1B.groupLbl }}>업무 허브</div>
                          {WORK_HUB_HREFS.map((href) => {
                            const item = NAV_ITEMS.find((n) => n.href === href);
                            if (!item) return null;
                            return (
                              <Link
                                key={href}
                                href={href}
                                onClick={() => setWorkHubOpen(false)}
                                className="flex items-center gap-2.5 h-9 px-2.5 rounded-xl text-[12.5px] font-medium transition-colors"
                                style={{ color: T1B.text1 }}
                              >
                                <span style={{ color: T1B.icon }}><StrokeIcon d={WORK_HUB_ICON[href]} size={16} /></span>
                                {item.label}
                              </Link>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                  {/* 3) 회의실 예약 */}
                  <Link href="/meetings" title="회의실예약" aria-label="회의실예약" className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors" style={{ color: T1B.icon }}>
                    <StrokeIcon d={RAIL_ICON.cal} size={20} />
                  </Link>
                  {/* 4) 커뮤니케이션 */}
                  <Link href="/chat" title="커뮤니케이션" aria-label="커뮤니케이션" className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors" style={{ color: T1B.icon }}>
                    <StrokeIcon d={RAIL_ICON.chat} size={20} />
                  </Link>
                  {/* 5) 근태 · 출장 */}
                  <Link href="/trip" title="근태 · 출장" aria-label="근태 · 출장" className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors" style={{ color: T1B.icon }}>
                    <StrokeIcon d={RAIL_ICON.clock} size={20} />
                  </Link>
                  <div className="w-[26px] h-px my-0.5" style={{ background: 'rgba(255,255,255,0.10)' }} />
                  {/* 더보기 — 설정 + 관리 콘솔(역할 게이트) */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => { setMoreOpen((o) => !o); setWorkHubOpen(false); }}
                      title="더보기 — 설정 · 관리 콘솔"
                      aria-label="더보기"
                      aria-haspopup="true"
                      aria-expanded={moreOpen}
                      className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E3B23C]/60"
                      style={{ background: moreOpen ? T1B.hover : 'rgba(255,255,255,0.07)', color: T1B.icon }}
                    >
                      <StrokeIcon d={RAIL_ICON.more} size={20} />
                    </button>
                    {moreOpen && (
                      <>
                        <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMoreOpen(false)} />
                        <div role="menu" aria-label="더보기" className="absolute left-[62px] bottom-0 z-50 w-[220px] p-2 rounded-2xl" style={chromeSurface('hi')}>
                          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-bold tracking-wide" style={{ color: T1B.groupLbl }}>더보기</div>
                          <Link href="/settings" onClick={() => setMoreOpen(false)} className="flex items-center gap-2.5 h-9 px-2.5 rounded-xl text-[12.5px] font-medium transition-colors" style={{ color: T1B.text1 }}>
                            <span style={{ color: T1B.icon }}><StrokeIcon d={RAIL_ICON.gear} size={16} /></span> 설정
                          </Link>
                          {adminItems.length > 0 && (
                            <>
                              <div className="h-px my-1.5 mx-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                              <div className="flex items-center gap-1.5 px-2.5 pb-1">
                                <span style={{ color: T1B.groupLbl }}><StrokeIcon d="M10 3.5 4.5 5.5v4.5c0 3.5 2.4 5.5 5.5 6.5 3.1-1 5.5-3 5.5-6.5V5.5z" size={14} /></span>
                                <span className="text-[11px] font-bold tracking-wide" style={{ color: T1B.groupLbl }}>관리 콘솔</span>
                                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: 'rgba(227,178,60,0.16)', color: T1B.mustard }}>ADMIN</span>
                              </div>
                              {adminItems.map((item) => (
                                <Link
                                  key={item.href}
                                  href={item.href}
                                  onClick={() => setMoreOpen(false)}
                                  className="flex items-center gap-2.5 h-[34px] px-2.5 rounded-xl text-[12.5px] font-medium transition-colors"
                                  style={{ color: T1B.text1 }}
                                >
                                  <span style={{ color: T1B.icon }}><StrokeIcon d={RAIL_MORE_ICON[item.href] ?? RAIL_ICON.grid4} size={16} /></span>
                                  {item.label}
                                </Link>
                              ))}
                              <div className="px-2.5 pt-1 text-[10px]" style={{ color: T1B.text2 }}>역할 게이트 — 관리자에게만 노출</div>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 회의 화상 그리드 (상단 중앙) — 연결 시 참가자 비디오/오디오 표시(C3) */}
          {activeRoom && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
              <MeetingStage room={activeRoom} />
            </div>
          )}

          {/* D33: 우측 패널 접힘 시 가장자리 핸들 — 구성원 패널 열기(1b 웜 블랙) */}
          {!showPanel && (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              title="구성원 패널 열기"
              aria-label="구성원 패널 열기"
              aria-expanded={false}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1.5 py-3 px-1 rounded-l-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E3B23C]/60"
              style={{ ...chromeSurface(), borderRight: 'none', color: T1B.text2 }}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              <span className="text-[10px] font-semibold" style={{ writingMode: 'vertical-rl' }}>
                구성원 {onlineCount}
              </span>
            </button>
          )}

          {/* ── 메뉴 페이지 오버레이 창 (D29 셸 단일화) ──
              좌측 메뉴의 모든 페이지는 /office 셸 위 창으로 렌더 → 디자인 연속 + 뷰포트/실시간 연결 유지 */}
          {!isOffice && (
            <div className="absolute inset-0 z-20 flex" style={{ background: 'rgba(8,13,26,0.30)', backdropFilter: 'blur(1.5px)' }}>
              {/* 창을 플로팅 미니 레일(좌)·상단 크롬 아래로 인셋 → 오피스가 프레임 주위로 보이게(가볍게 띄움) */}
              <div className="flex-1 mt-[72px] ml-[76px] mr-4 mb-4 rounded-2xl border border-border-subtle overflow-hidden flex flex-col shadow-2xl" style={{ background: 'rgb(var(--color-bg-base))' }}>
                <div className="h-11 flex-shrink-0 flex items-center justify-between px-4 border-b border-border-subtle" style={{ background: 'rgb(var(--color-bg-surface))' }}>
                  <span className="text-[13px] font-semibold text-text-primary">{overlayItem?.label ?? ''}</span>
                  <Link
                    href="/office"
                    aria-label="닫기 — 오피스로 돌아가기"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-surface-raised transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  </Link>
                </div>
                <div className="flex-1 overflow-y-auto" style={{ background: 'rgb(var(--color-bg-base))' }}>{children}</div>
              </div>
            </div>
          )}
        </div>

        {/* 대시보드 3카드 행 — 시안 B: 씬 영역이 화면 전체라 숨김. 복원하려면 hidden 제거 */}
        <div className="hidden">
          <div className="grid grid-cols-3 gap-3 h-full min-h-[220px]">
            {/* ─ 카드 1: 오늘의 업무 ─ */}
            <Card title="오늘의 업무" action="전체 보기 ›" className="h-full">
              <div className="p-3 flex flex-col gap-1.5 overflow-y-auto h-full">
                {loadingWork ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-text-muted text-[12px]">로딩 중...</span>
                  </div>
                ) : workLogs.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-text-muted text-[12px]">오늘 등록된 업무가 없습니다</span>
                  </div>
                ) : (
                  workLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-bg-surface-raised transition-colors"
                    >
                      <span
                        className={[
                          'mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0',
                          log.status === 'done' ? 'bg-status-online' : 'bg-primary',
                        ].join(' ')}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-text-primary truncate">{log.title}</div>
                        <div className="text-[11px] text-text-muted mt-0.5">{formatTime(log.logged_at)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* ─ 카드 2: 나의 KPI ─ */}
            <Card title="나의 KPI 현황" action="상세 보기 ›" className="h-full">
              <div className="p-3 flex gap-4 h-full overflow-y-auto">
                {loadingKpi ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-text-muted text-[12px]">로딩 중...</span>
                  </div>
                ) : kpiResults.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-text-muted text-[12px]">KPI 데이터가 없습니다</span>
                  </div>
                ) : (
                  <>
                    {/* 도넛 게이지 */}
                    <div className="flex items-center justify-center flex-shrink-0">
                      <KpiGauge score={avgScore} maxScore={100} size={110} />
                    </div>
                    {/* 지표 progress bars */}
                    <div className="flex-1 min-w-0 flex flex-col gap-2 justify-center">
                      {kpiResults.slice(0, 4).map((r) => (
                        <ProgressMetric
                          key={r.metric}
                          label={r.metric}
                          value={Math.round(_kpiVal(r))}
                          max={r.unit === 'count' ? Math.max(10, Math.round(_kpiVal(r))) : 100}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Card>

            {/* ─ 카드 3: 진행중 화상회의 ─ */}
            <Card title="진행중 화상회의" action="회의실 보기 ›" className="h-full">
              <div className="p-3 h-full overflow-y-auto">
                {loadingMeet ? (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-text-muted text-[12px]">로딩 중...</span>
                  </div>
                ) : meetings.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-text-muted text-[12px]">진행중인 화상회의 없음</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {meetings.slice(0, 4).map((m) => (
                      <div
                        key={m.id}
                        className="rounded-lg bg-bg-surface-raised border border-border-subtle p-2.5 flex flex-col gap-1"
                      >
                        <div className="text-[12px] font-semibold text-text-primary truncate">{m.title}</div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] text-text-muted">
                            {formatTime(m.scheduled_at)}
                          </span>
                          {m.participant_count != null && (
                            <span className="text-[10px] text-status-meeting font-medium">
                              {m.participant_count}명
                            </span>
                          )}
                        </div>
                        {/* 컨트롤 버튼 최소 */}
                        <button className="mt-1 w-full rounded bg-primary text-white text-[10px] font-medium py-1 hover:bg-primary-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                          입장
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </main>

      {/* ── 우 패널 — 그 외 라우트=280px 컬럼 · /office(railMode)=플로팅 웜 블랙 글래스(1b) ── */}
      {showPanel && (
      <aside
        data-tour="presence"
        className={
          railMode
            ? 'absolute right-4 top-20 bottom-[86px] z-30 w-[276px] flex flex-col rounded-2xl overflow-hidden'
            : 'w-80 flex-shrink-0 flex flex-col border-l border-border-subtle overflow-y-auto'
        }
        style={railMode ? chromeSurface() : { background: '#161F32' }}
      >
        {/* ── 사용자 목록 ── */}
        <section
          className={railMode ? 'flex-shrink-0 flex flex-col min-h-0' : 'flex-shrink-0 border-b border-border-subtle'}
          style={railMode ? { borderBottom: 'none' } : undefined}
        >
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="text-[13.5px] font-extrabold" style={railMode ? { color: T1B.text1 } : undefined}>구성원</span>
              <span
                className="text-[11px] font-bold rounded-full px-2 py-0.5"
                style={railMode ? { background: 'rgba(255,255,255,0.07)', color: T1B.text2 } : { background: 'rgb(var(--color-bg-surface-raised))', color: 'rgb(var(--color-text-muted))' }}
              >
                {employees.length}
              </span>
            </span>
            <div className="flex items-center gap-1.5">
              {!railMode && <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-surface-raised">실시간</span>}
              {isOffice && (
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  title="패널 접기"
                  aria-label="패널 접기"
                  className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                  style={railMode ? { color: T1B.text2 } : undefined}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className={['w-3.5 h-3.5', railMode ? '' : 'text-text-muted hover:text-text-primary'].join(' ')}><path fillRule="evenodd" d="M8.707 5.293a1 1 0 010 1.414L5.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0zm6 0a1 1 0 010 1.414L11.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                </button>
              )}
            </div>
          </div>
          {/* 팔레트 연동 검색 트리거(스펙 IA §3) — 클릭 시 커맨드 팔레트 오픈 */}
          {railMode && (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="mx-3 mb-2 flex items-center gap-2 h-[34px] rounded-xl px-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E3B23C]/60"
              style={{ background: T1B.hover, color: T1B.text2 }}
            >
              <StrokeIcon d={RAIL_ICON.search} size={14} />
              <span className="text-[11.5px] truncate">이름 · 팀 검색 — 팔레트와 연동</span>
            </button>
          )}
          {/* 헤더 검색어 활성 표시(06 §1.2) — 필터 결과 수 + 지우기 */}
          {normalizedQuery && (
            <div className="px-4 pb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] truncate" style={railMode ? { color: T1B.mustard } : undefined}>
                <span className={railMode ? '' : 'text-primary'}>검색: {searchQuery.trim()} ({filteredEmployees.length}명)</span>
              </span>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                style={railMode ? { background: T1B.hover, color: T1B.text2 } : undefined}
              >
                <span className={railMode ? '' : 'text-text-muted hover:text-text-primary bg-bg-surface-raised'}>지우기</span>
              </button>
            </div>
          )}
          {/* 상태 필터 탭 */}
          <div
            className="flex"
            role="tablist"
            aria-label="상태 필터"
            style={railMode ? { borderBottom: '1px solid rgba(255,255,255,0.08)' } : { borderBottom: '1px solid rgb(var(--color-border-subtle))' }}
          >
            {FILTER_TABS.map((t) => {
              const on = presenceFilter === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPresenceFilter(t.key)}
                  className="flex-1 py-1.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                  style={
                    railMode
                      ? on
                        ? { color: T1B.mustard, borderBottom: `2px solid ${T1B.mustard}`, marginBottom: -1 }
                        : { color: T1B.text2 }
                      : undefined
                  }
                >
                  <span className={railMode ? '' : on ? 'text-primary border-b-2 border-primary -mb-px' : 'text-text-muted hover:text-text-secondary'}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
          <div className={railMode ? 'flex-1 min-h-0 py-1 overflow-y-auto' : 'py-1 max-h-72 overflow-y-auto'}>
            {loadingEmp ? (
              <div className="px-4 py-3 text-[12px]" style={railMode ? { color: T1B.text2 } : undefined}><span className={railMode ? '' : 'text-text-muted'}>로딩 중...</span></div>
            ) : filteredEmployees.length === 0 ? (
              <div className="px-4 py-3 text-[12px]" style={railMode ? { color: T1B.text2 } : undefined}>
                <span className={railMode ? '' : 'text-text-muted'}>{normalizedQuery ? '검색 결과가 없습니다' : '해당 상태 사용자 없음'}</span>
              </div>
            ) : (
              PRESENCE_GROUPS.map((g) => {
                const members = filteredEmployees.filter((e) => g.statuses.includes(e.status));
                if (members.length === 0) return null;
                return (
                  <div key={g.key} className="mb-0.5">
                    {/* 상태 그룹 헤더 (시안: 재실 · N) */}
                    <div className="px-4 pt-2 pb-1 flex items-center gap-1.5">
                      <span className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: g.color }} />
                      <span className="text-[11px] font-bold tracking-wide" style={railMode ? { color: T1B.groupLbl } : undefined}>
                        <span className={railMode ? '' : 'text-text-muted uppercase tracking-wider text-[10px] font-semibold'}>{g.label}</span>
                      </span>
                      <span className="text-[10.5px] font-bold" style={railMode ? { color: T1B.groupLbl } : undefined}>
                        <span className={railMode ? '' : 'text-text-muted'}>{railMode ? members.length : `· ${members.length}`}</span>
                      </span>
                    </div>
                    {members.map((emp) =>
                      railMode ? (
                        // 1b: 씬 배지 규격 아바타(r8 타일 + 이니셜 + 상태 도트) + 자리/상태 부제
                        <button
                          key={emp.id}
                          type="button"
                          onClick={() => { setSearchQuery(emp.name); setPresenceFilter('all'); }}
                          className="w-full flex items-center gap-2.5 h-[42px] px-2.5 mx-1.5 rounded-xl text-left transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E3B23C]/60"
                          style={{ width: 'calc(100% - 12px)' }}
                        >
                          <SceneBadge name={emp.name} status={emp.status} size={30} photoUrl={memberPhotos[emp.id]} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-semibold truncate" style={{ color: T1B.text1 }}>{emp.name}</div>
                            <div className="text-[10.5px] truncate" style={{ color: T1B.text2 }}>{emp.team_name ?? PRESENCE_META_LABEL[emp.status] ?? ''}</div>
                          </div>
                        </button>
                      ) : (
                        <ListItem
                          key={emp.id}
                          leading={
                            // Avatar 상태 점은 6종 union만 지원 — working은 online 점으로 표시(뱃지는 업무중)
                            <Avatar name={emp.name} status={emp.status === 'working' ? 'online' : emp.status} size="sm" />
                          }
                          primary={emp.name}
                          secondary={emp.team_name ?? ''}
                          trailing={<StatusBadge status={emp.status} showDot={false} />}
                        />
                      ),
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ── 오늘의 일정 · 공지 — 그 외 라우트 컬럼에서만(railMode 씬은 게시판/서류함 핫스팟으로 흡수) ── */}
        {!railMode && (<>
        <section className="flex-shrink-0 border-b border-border-subtle">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-text-primary">오늘의 일정</span>
            <span className="text-[11px] text-text-muted">
              {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
            </span>
          </div>
          <div className="py-1 max-h-40 overflow-y-auto">
            {loadingMeet ? (
              <div className="px-4 py-3 text-[12px] text-text-muted">로딩 중...</div>
            ) : todayMeetings.length === 0 ? (
              <div className="px-4 py-3 text-[12px] text-text-muted">오늘 일정이 없습니다</div>
            ) : (
              todayMeetings.map((m) => (
                <Link
                  key={m.id}
                  href="/meetings"
                  className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                >
                  <ListItem
                    leading={
                      <span className="w-8 text-center text-[11px] text-text-muted font-medium leading-tight">
                        {formatTime(m.scheduled_at)}
                      </span>
                    }
                    primary={m.title}
                    secondary={`${formatTime(m.scheduled_at)} – ${formatTime(meetingEndsAt(m))}`}
                    trailing={
                      m.status === 'in_progress' ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(239,68,68,0.15)] text-status-meeting font-medium">
                          진행중
                        </span>
                      ) : null
                    }
                  />
                </Link>
              ))
            )}
          </div>
        </section>

        {/* ── 공지사항 (GET /api/notices, 14-spec §2.8) ── */}
        <section className="flex-shrink-0">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-text-primary">공지사항</span>

          </div>
          <div className="py-1">
            {notices.map((n) => (
              <ListItem
                key={n.id}
                primary={n.title}
                secondary={`${n.author} · ${n.created_at?.slice(0, 10).replace(/-/g, '.')}`}
                leading={
                  <span className="w-1 h-6 rounded-full bg-primary flex-shrink-0" />
                }
              />
            ))}
          </div>
        </section>
        </>)}
      </aside>
      )}
      </div>
    </div>
  );
}
