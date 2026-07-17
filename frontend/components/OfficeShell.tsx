'use client';

// OfficeShell — 통합 오피스 셸 ((protected)/layout.tsx 공통 레이아웃, D29 셸 단일화)
// 모든 메뉴 페이지(children)는 /office 셸 위 오버레이 창으로 렌더 → 디자인 연속 + 실시간 연결 유지
// @SPEC docs/planning/14-virtual-office-spec.md §1 §2.8
// @SPEC docs/3d-design/design-style-analysis.md §3 §4

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { getUser, logout, type User, type UserRole } from '@/lib/auth';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge, type EmployeePresenceStatus } from '@/components/ui/StatusBadge';
import { KpiGauge } from '@/components/ui/KpiGauge';
import { ProgressMetric } from '@/components/ui/ProgressMetric';
import { MediaBar } from '@/components/ui/MediaBar';
import { MeetingStage } from '@/components/ui/MeetingStage';
import { connectToMeeting, disconnectRoom } from '@/lib/livekit';
import type { Room } from 'livekit-client';
import { ListItem } from '@/components/ui/ListItem';
import { ROOMS as VIEWPORT_ROOMS } from '@/lib/office2d';
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
];

// ─────────────────────────────────────────────
// 층 선택기 (정적 UI)
// ─────────────────────────────────────────────
const FLOORS = ['4F', '3F', '2F', '1F', 'B1F'];

// 사이드바 하단 층 도면 카드 (레퍼런스: Floor 2 map + People Online)
// 실시간 아바타 위치 점은 이동서버 미니맵 배선 후 — 현재 도면만(가짜 점 없음).
function FloorMapCard({
  active,
  onChange,
  online,
}: {
  active: string;
  onChange: (f: string) => void;
  online: number;
}) {
  return (
    <div className="mx-3 mb-2 rounded-lg bg-bg-base border border-border-subtle p-2.5 flex flex-col gap-2 flex-shrink-0">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-text-secondary">{active} 도면</span>
        <span className="text-[9px] text-text-muted px-1 py-0.5 rounded bg-bg-surface-raised leading-none">위치 준비중</span>
      </div>
      <svg viewBox="0 0 80 46" className="w-full rounded" style={{ background: '#0E1626' }}>
        <rect x="2" y="2" width="35" height="18" rx="2" fill="#1E2940" stroke="#273350" strokeWidth="0.5" />
        <rect x="42" y="2" width="36" height="18" rx="2" fill="#1E2940" stroke="#273350" strokeWidth="0.5" />
        <rect x="2" y="24" width="24" height="20" rx="2" fill="#1E2940" stroke="#273350" strokeWidth="0.5" />
        <rect x="30" y="24" width="48" height="20" rx="2" fill="#1E2940" stroke="#273350" strokeWidth="0.5" />
      </svg>
      <div className="flex gap-1">
        {FLOORS.map((f) => (
          <button
            key={f}
            onClick={() => onChange(f)}
            aria-pressed={active === f}
            className={[
              'flex-1 py-1 rounded text-[10px] font-semibold transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
              active === f ? 'bg-primary text-white' : 'bg-bg-surface-raised text-text-muted hover:text-text-secondary',
            ].join(' ')}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-status-online inline-block" />
        {online}명 온라인
      </div>
    </div>
  );
}

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
const PRESENCE_GROUPS: { key: string; label: string; color: string; statuses: EmployeePresenceStatus[] }[] = [
  { key: 'office',   label: '사무실 재실', color: '#22C55E', statuses: ['online', 'working', 'focus'] },
  { key: 'meeting',  label: '회의중',      color: '#EF4444', statuses: ['meeting'] },
  { key: 'away',     label: '자리비움',    color: '#94A3B8', statuses: ['away'] },
  { key: 'external', label: '외근·출장',   color: '#F59E0B', statuses: ['external'] },
  { key: 'offline',  label: '오프라인',    color: '#64748B', statuses: ['offline'] },
];

// ─────────────────────────────────────────────
// 오피스 셸 (모든 (protected) 라우트의 상주 레이아웃)
// ─────────────────────────────────────────────
export default function OfficeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<User | null>(null);
  const [activeFloor, setActiveFloor] = useState('2F');
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>('all');

  // 헤더 검색(06 §1.2) — 우측 패널 직원 목록 이름/팀 필터. 셸에서 공유.
  const [searchQuery, setSearchQuery] = useState('');
  // 알림 드롭다운 + 마지막 확인 시각(localStorage 'notices_seen_at')
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticesSeenAt, setNoticesSeenAt] = useState<string | null>(null);

  // 역할 게이트 관리 메뉴 + 오버레이(비-/office 라우트) 타이틀
  const role = (me?.role ?? 'employee') as UserRole;
  const adminItems = ADMIN_ITEMS.filter((i) => i.roles.includes(role));
  const isOffice = pathname === '/office';
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

  const handleJoinMeeting = useCallback(async (meetingId: string) => {
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
  }, []);

  const handleLeaveMeeting = useCallback(async () => {
    await disconnectRoom(activeRoom);
    setActiveRoom(null);
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

  // 내비 링크 렌더러 — 기본/관리 섹션 공용
  const renderNav = (item: NavItem) => {
    const isActive = !item.disabled && (pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)));
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
  return (
    <div
      className="flex flex-col h-screen overflow-hidden font-sans"
      style={{ background: '#0E1626' }}
    >
      {/* ── 상단 헤더 (시안) ── */}
      <header className="flex-shrink-0 h-14 flex items-center justify-between px-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-sm">V</div>
          <span className="text-text-primary font-semibold text-[15px]">Virtual Office</span>
          <button className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-bg-surface-raised text-text-secondary text-[13px] transition-colors">
            본사 (HQ) <span className="text-text-muted">▾</span>
          </button>
        </div>
        <div className="flex-1 max-w-md mx-6 hidden md:block">
          {/* 헤더 검색(06 §1.2) — 우측 패널 직원 목록을 이름/팀으로 필터.
              뷰포트 아바타 강조·카메라 팬은 스코프 외(후속). */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-surface text-text-muted text-[13px] border border-border-subtle focus-within:ring-2 focus-within:ring-accent-cyan">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="구성원 검색 (이름·팀)"
              aria-label="구성원 검색"
              className="flex-1 min-w-0 bg-transparent outline-none text-text-primary placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="검색어 지우기"
                className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan rounded"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
            )}
          </div>
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
                  style={{ background: '#161F32' }}
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

      {/* ── 본문 3열 ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── 좌 내비 240px ── */}
      <aside
        className="w-60 flex-shrink-0 flex flex-col border-r border-border-subtle"
        style={{ background: '#161F32' }}
      >
        {/* 로고 */}
        <div className="px-5 py-4 border-b border-border-subtle flex-shrink-0">
          <div className="text-[10px] text-text-muted uppercase tracking-widest mb-0.5">VirtualOffice</div>
          <div className="text-base font-bold text-text-primary">가상 오피스</div>
        </div>

        {/* 내비 메뉴 */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-0.5" aria-label="주 메뉴">
          {NAV_ITEMS.map(renderNav)}
          {adminItems.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">관리</div>
              {adminItems.map(renderNav)}
            </>
          )}
        </nav>

        {/* 층 도면 카드 (레퍼런스: 사이드바 하단 Floor map) */}
        <FloorMapCard
          active={activeFloor}
          onChange={setActiveFloor}
          online={employees.filter((e) => e.status !== 'offline').length}
        />

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

      {/* ── 중앙 영역 ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 가상오피스 씬 = 2.5D 클린 플레이트 + 실시간 아바타 (v2.2 팩 + realtime Colyseus) */}
        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0 overflow-hidden" style={{ background: '#0d1b36' }}>
            <OfficeViewport2D onJoinMeeting={handleViewportJoin} />
          </div>

          {/* 회의 화상 그리드 (상단 중앙) — 연결 시 참가자 비디오/오디오 표시(C3) */}
          {activeRoom && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
              <MeetingStage room={activeRoom} />
            </div>
          )}

          {/* 미디어 바 (하단 중앙) — 회의 연결 시 실제 마이크/카메라 제어(C3) */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
            <MediaBar room={activeRoom} onLeave={handleLeaveMeeting} />
          </div>

          {/* 진행중 화상회의 오버레이 + 입장 실패/회의 없음 인라인 배너 — 세로 스택으로
              배너가 진행중 회의 유무와 무관하게 노출되도록 구성 */}
          {(meetings.length > 0 || joinError) && (
            <div className="absolute right-3 bottom-3 z-10 flex flex-col items-end gap-2">
              {/* 회의 입장 실패/해당 방 회의 없음 사유 인라인 배너 */}
              {joinError && (
                <div
                  role="alert"
                  className="w-56 rounded-xl border border-border-subtle px-3 py-2 text-[10px] text-danger leading-snug"
                  style={{ background: 'rgba(13,27,54,0.92)', backdropFilter: 'blur(6px)' }}
                >
                  {joinError}
                </div>
              )}
              {/* 진행중 화상회의 — 실 데이터(GET /api/meetings?status=in_progress). C3: 입장 시 LiveKit 연결 */}
              {meetings.length > 0 && (
                <div
                  className="w-56 rounded-xl border border-border-subtle overflow-hidden"
                  style={{ background: 'rgba(13,27,54,0.92)', backdropFilter: 'blur(6px)' }}
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0 animate-pulse" />
                      <span className="text-[11px] font-semibold text-text-primary truncate">{meetings[0].title}</span>
                    </div>
                    <span className="text-[9px] font-bold text-danger tracking-wider flex-shrink-0">● LIVE</span>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-text-secondary truncate">
                      {activeRoom
                        ? '회의 연결됨'
                        : meetings[0].participant_count != null
                          ? `${meetings[0].participant_count}명 참여중`
                          : '진행중'}
                    </span>
                    {activeRoom ? (
                      <span className="text-[10px] text-status-online font-medium flex-shrink-0">● 연결됨</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleJoinMeeting(meetings[0].id)}
                        disabled={joining}
                        className="text-[10px] font-medium px-2 py-1 rounded bg-primary text-white hover:bg-primary-hover disabled:opacity-50 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                      >
                        {joining ? '연결 중…' : '입장하기'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 메뉴 페이지 오버레이 창 (D29 셸 단일화) ──
              좌측 메뉴의 모든 페이지는 /office 셸 위 창으로 렌더 → 디자인 연속 + 뷰포트/실시간 연결 유지 */}
          {!isOffice && (
            <div className="absolute inset-0 z-20 flex" style={{ background: 'rgba(8,13,26,0.55)', backdropFilter: 'blur(2px)' }}>
              <div className="flex-1 m-3 md:m-5 rounded-xl border border-border-subtle overflow-hidden flex flex-col shadow-2xl" style={{ background: '#0E1626' }}>
                <div className="h-11 flex-shrink-0 flex items-center justify-between px-4 border-b border-border-subtle" style={{ background: '#161F32' }}>
                  <span className="text-[13px] font-semibold text-text-primary">{overlayItem?.label ?? ''}</span>
                  <Link
                    href="/office"
                    aria-label="닫기 — 오피스로 돌아가기"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-surface-raised transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  </Link>
                </div>
                <div className="flex-1 overflow-y-auto bg-gray-100">{children}</div>
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

      {/* ── 우 패널 320px ── */}
      <aside
        className="w-80 flex-shrink-0 flex flex-col border-l border-border-subtle overflow-y-auto"
        style={{ background: '#161F32' }}
      >
        {/* ── 사용자 목록 ── */}
        <section className="flex-shrink-0 border-b border-border-subtle">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-text-primary">구성원 ({employees.length})</span>
            <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-surface-raised">실시간</span>
          </div>
          {/* 헤더 검색어 활성 표시(06 §1.2) — 필터 결과 수 + 지우기 */}
          {normalizedQuery && (
            <div className="px-4 pb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-primary truncate">
                검색: {searchQuery.trim()} ({filteredEmployees.length}명)
              </span>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="flex-shrink-0 text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded bg-bg-surface-raised transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
              >
                지우기
              </button>
            </div>
          )}
          {/* 상태 필터 탭 */}
          <div className="flex border-b border-border-subtle" role="tablist" aria-label="상태 필터">
            {FILTER_TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={presenceFilter === t.key}
                onClick={() => setPresenceFilter(t.key)}
                className={[
                  'flex-1 py-1.5 text-[11px] font-medium transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
                  presenceFilter === t.key
                    ? 'text-primary border-b-2 border-primary -mb-px'
                    : 'text-text-muted hover:text-text-secondary',
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="py-1 max-h-72 overflow-y-auto">
            {loadingEmp ? (
              <div className="px-4 py-3 text-[12px] text-text-muted">로딩 중...</div>
            ) : filteredEmployees.length === 0 ? (
              <div className="px-4 py-3 text-[12px] text-text-muted">
                {normalizedQuery ? '검색 결과가 없습니다' : '해당 상태 사용자 없음'}
              </div>
            ) : (
              PRESENCE_GROUPS.map((g) => {
                const members = filteredEmployees.filter((e) => g.statuses.includes(e.status));
                if (members.length === 0) return null;
                return (
                  <div key={g.key} className="mb-0.5">
                    {/* 상태 그룹 헤더 (시안: In Office · N) */}
                    <div className="px-4 pt-2 pb-1 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: g.color }} />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{g.label}</span>
                      <span className="text-[10px] text-text-muted">· {members.length}</span>
                    </div>
                    {members.map((emp) => (
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
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ── 오늘의 일정 ── */}
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
      </aside>
      </div>
    </div>
  );
}
