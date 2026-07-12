'use client';

// @TASK P1 - 통합 대시보드 셸
// @SPEC docs/planning/14-virtual-office-spec.md §1 §2.8
// @SPEC docs/3d-design/design-style-analysis.md §3 §4

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { getUser, logout, type User } from '@/lib/auth';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge, type PresenceStatus } from '@/components/ui/StatusBadge';
import { KpiGauge } from '@/components/ui/KpiGauge';
import { ProgressMetric } from '@/components/ui/ProgressMetric';
import { MediaBar } from '@/components/ui/MediaBar';
import { ListItem } from '@/components/ui/ListItem';
import dynamic from 'next/dynamic';

// R3F Canvas는 클라이언트 전용(WebGL) → SSR 비활성 dynamic import
const OfficeViewport = dynamic(() => import('@/components/OfficeViewport'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
      3D 오피스 로딩 중…
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

interface KpiResult {
  metric: string;
  score: number;
  max_score: number;
  period_type: string;
  period_key: string;
}

interface Meeting {
  id: number;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  participant_count?: number;
}

interface EmployeePresence {
  id: number;
  name: string;
  team_name?: string;
  status: PresenceStatus;
  avatar_url?: string;
}

// 공지사항 (14-virtual-office-spec §2.8): GET /api/notices
interface Notice {
  id: string;
  title: string;
  created_at: string;
  author: string;
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
  { href: '/work-status',      label: '업무현황',      icon: <IconChart />,   disabled: true },
  { href: '/trip',             label: '출장관리',      icon: <IconCar />,     disabled: true },
  { href: '/kpi',              label: 'KPI평가',       icon: <IconKpi /> },
  { href: '/reports',          label: '보고서',        icon: <IconReport />,  disabled: true },
  { href: '/meetings',         label: '회의실예약',    icon: <IconMeetRoom /> },
  { href: '/chat',             label: '커뮤니케이션',  icon: <IconChat />,    disabled: true },
  { href: '/admin/employees',  label: '인사·근태',     icon: <IconHR /> },
  { href: '/settings',         label: '설정',          icon: <IconSettings />, disabled: true },
];

// ─────────────────────────────────────────────
// 층 선택기 (정적 UI)
// ─────────────────────────────────────────────
const FLOORS = ['4F', '3F', '2F', '1F', 'B1F'];

function FloorSelector({ active, onChange }: { active: string; onChange: (f: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {FLOORS.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={[
            'w-10 h-8 rounded text-[11px] font-semibold transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
            active === f
              ? 'bg-primary text-white'
              : 'bg-bg-surface-raised text-text-muted hover:text-text-secondary',
          ].join(' ')}
          aria-pressed={active === f}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// 미니맵 (정적 층 도면 스케치)
// 실시간 아바타 위치는 이동서버(Colyseus C1) 연동 후 표시 예정 → 현재는 가짜 점 미표시
// ─────────────────────────────────────────────
function MiniMap() {
  return (
    <div className="w-28 rounded-lg bg-bg-base border border-border-subtle p-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-text-muted font-medium">미니맵</span>
        <span className="text-[9px] text-text-muted px-1 py-0.5 rounded bg-bg-surface-raised leading-none">준비중</span>
      </div>
      {/* 정적 층 도면 (실시간 위치는 이동서버 연동 후) */}
      <svg viewBox="0 0 80 60" className="w-full rounded" style={{ background: '#0E1626' }}>
        {/* 방 영역들 */}
        <rect x="2" y="2" width="35" height="25" rx="2" fill="#1E2940" stroke="#273350" strokeWidth="0.5" />
        <rect x="42" y="2" width="36" height="25" rx="2" fill="#1E2940" stroke="#273350" strokeWidth="0.5" />
        <rect x="2" y="32" width="24" height="26" rx="2" fill="#1E2940" stroke="#273350" strokeWidth="0.5" />
        <rect x="30" y="32" width="48" height="26" rx="2" fill="#1E2940" stroke="#273350" strokeWidth="0.5" />
      </svg>
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

// 시안 People 패널: 상태 그룹 헤더(재실/회의중/자리비움/오프라인)
const PRESENCE_GROUPS: { key: string; label: string; color: string; statuses: PresenceStatus[] }[] = [
  { key: 'office',   label: '사무실 재실', color: '#22C55E', statuses: ['online', 'focus'] },
  { key: 'meeting',  label: '회의중',      color: '#EF4444', statuses: ['meeting'] },
  { key: 'away',     label: '자리비움',    color: '#F59E0B', statuses: ['away', 'external'] },
  { key: 'offline',  label: '오프라인',    color: '#64748B', statuses: ['offline'] },
];

// ─────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────
export default function OfficePage() {
  const pathname = usePathname();
  const [me, setMe] = useState<User | null>(null);
  const [activeFloor, setActiveFloor] = useState('2F');
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>('all');

  // 데이터 상태
  const [workLogs, setWorkLogs]       = useState<WorkLog[]>([]);
  const [kpiResults, setKpiResults]   = useState<KpiResult[]>([]);
  const [meetings, setMeetings]       = useState<Meeting[]>([]);
  const [employees, setEmployees]     = useState<EmployeePresence[]>([]);
  const [todayMeetings, setTodayMeetings] = useState<Meeting[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);

  const [loadingWork, setLoadingWork]     = useState(true);
  const [loadingKpi,  setLoadingKpi]      = useState(true);
  const [loadingMeet, setLoadingMeet]     = useState(true);
  const [loadingEmp,  setLoadingEmp]      = useState(true);

  useEffect(() => {
    setMe(getUser());
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
      const today = await api.get<Meeting[]>('/api/meetings?limit=5');
      setTodayMeetings(Array.isArray(today) ? today : []);
    } catch {
      setMeetings([]);
      setTodayMeetings([]);
    } finally {
      setLoadingMeet(false);
    }
  }, []);

  // 사용자 목록 (presence/employees)
  const fetchEmployees = useCallback(async () => {
    setLoadingEmp(true);
    try {
      const data = await api.get<EmployeePresence[]>('/api/presence/employees?limit=30');
      setEmployees(Array.isArray(data) ? data : []);
    } catch (err) {
      // presence API 없을 경우 employees 폴백
      if (err instanceof ApiError && err.status === 404) {
        try {
          const fallback = await api.get<{ id: number; name: string }[]>('/api/employees?limit=20');
          setEmployees(
            (Array.isArray(fallback) ? fallback : []).map((e) => ({
              ...e,
              status: 'online' as PresenceStatus,
            })),
          );
        } catch {
          setEmployees([]);
        }
      } else {
        setEmployees([]);
      }
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

  useEffect(() => {
    if (!me) return;
    fetchWorkLogs();
    fetchKpi();
    fetchMeetings();
    fetchEmployees();
    fetchNotices();
  }, [me, fetchWorkLogs, fetchKpi, fetchMeetings, fetchEmployees, fetchNotices]);

  // KPI 집계
  const avgScore = kpiResults.length
    ? Math.round(kpiResults.reduce((s, r) => s + r.score, 0) / kpiResults.length)
    : 0;

  // 사용자 필터
  const filteredEmployees = employees.filter((e) => {
    if (presenceFilter === 'all') return true;
    if (presenceFilter === 'office')   return e.status === 'online' || e.status === 'focus' || e.status === 'away';
    if (presenceFilter === 'meeting')  return e.status === 'meeting';
    if (presenceFilter === 'external') return e.status === 'external' || e.status === 'offline';
    return true;
  });

  const formatTime = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch { return iso; }
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
          {/* 검색 UI — 핸들러 미배선(준비중). 배선 시 aria-disabled/opacity 제거 */}
          <div
            title="준비중"
            aria-disabled="true"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-surface text-text-muted text-[13px] border border-border-subtle opacity-50 cursor-not-allowed select-none"
          >
            <span>🔍</span><span>검색...</span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-bg-surface-raised">준비중</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button title="준비중" aria-disabled="true" disabled className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted opacity-40 cursor-not-allowed">📅</button>
          <button title="준비중" aria-disabled="true" disabled className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted opacity-40 cursor-not-allowed">🔔</button>
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
          {NAV_ITEMS.map((item) => {
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
          })}
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

      {/* ── 중앙 영역 ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 3D 뷰포트 = 화면 전체 (시안: 메인이 가상사무실) */}
        <div className="relative flex-1 min-h-0">
          {/* 3D 뷰포트 = 실시간 R3F (스타일라이즈드 v1.1 에셋, 씬 + 걷는 캐릭터) */}
          <div className="absolute inset-0 overflow-hidden" style={{ background: '#0d1b36' }}>
            <OfficeViewport />
            {/* 상태 라벨 (좌상단) */}
            <div
              className="absolute left-3 top-3 z-10 px-3 py-1.5 rounded-lg border border-border-subtle pointer-events-none"
              style={{ background: 'rgba(13,27,54,0.78)', backdropFilter: 'blur(6px)' }}
            >
              <span className="text-accent-cyan text-[10px] font-medium uppercase tracking-widest">
                실시간 R3F · v10 PBR 리깅
              </span>
            </div>
          </div>

          {/* 층 선택기 (우측 세로 탭) */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10">
            <FloorSelector active={activeFloor} onChange={setActiveFloor} />
          </div>

          {/* 미니맵 (좌하단) */}
          <div className="absolute left-3 bottom-3 z-10">
            <MiniMap />
          </div>

          {/* 미디어 바 (하단 중앙) */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
            <MediaBar />
          </div>

          {/* 진행중 화상회의 오버레이 — 실 데이터(GET /api/meetings?status=in_progress). 진행중 회의 없으면 미표시 */}
          {meetings.length > 0 && (
            <Link
              href="/meetings"
              className="absolute right-3 bottom-3 z-10 w-56 rounded-xl border border-border-subtle overflow-hidden block hover:border-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
              style={{ background: 'rgba(13,27,54,0.92)', backdropFilter: 'blur(6px)' }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0 animate-pulse" />
                  <span className="text-[11px] font-semibold text-text-primary truncate">{meetings[0].title}</span>
                </div>
                <span className="text-[9px] font-bold text-danger tracking-wider flex-shrink-0">● LIVE</span>
              </div>
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-[11px] text-text-secondary">
                  {meetings[0].participant_count != null ? `${meetings[0].participant_count}명 참여중` : '진행중'}
                </span>
                <span className="text-[10px] text-primary font-medium">회의실 보기 ›</span>
              </div>
            </Link>
          )}

          {/* "회의실 앞에서 E" 힌트 (시안: bottom center) */}
          <div
            className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full border border-border-subtle pointer-events-none flex items-center gap-2"
            style={{ background: 'rgba(13,27,54,0.85)', backdropFilter: 'blur(6px)' }}
          >
            <kbd className="px-1.5 py-0.5 rounded bg-bg-surface-raised text-[10px] font-bold text-text-primary border border-border-subtle">
              E
            </kbd>
            <span className="text-[11px] text-text-secondary">회의실 앞에서 눌러 입장</span>
          </div>
        </div>

        {/* 대시보드 3카드 행 — 시안 B: 3D가 화면 전체라 숨김. 복원하려면 hidden 제거 */}
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
                          value={Math.round(r.score)}
                          max={Math.round(r.max_score) || 10}
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
                            {formatTime(m.start_time)}
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
            <span className="text-[13px] font-semibold text-text-primary">사용자 목록</span>
            <span className="text-[11px] text-text-muted">
              {employees.length}명
            </span>
          </div>
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
              <div className="px-4 py-3 text-[12px] text-text-muted">해당 상태 사용자 없음</div>
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
                        leading={<Avatar name={emp.name} status={emp.status} size="sm" />}
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
                <ListItem
                  key={m.id}
                  leading={
                    <span className="w-8 text-center text-[11px] text-text-muted font-medium leading-tight">
                      {formatTime(m.start_time)}
                    </span>
                  }
                  primary={m.title}
                  secondary={`${formatTime(m.start_time)} – ${formatTime(m.end_time)}`}
                  trailing={
                    m.status === 'in_progress' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(239,68,68,0.15)] text-status-meeting font-medium">
                        진행중
                      </span>
                    ) : null
                  }
                />
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
