'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserRole } from '@/lib/auth';

interface MenuItem {
  href: string;
  label: string;
  roles: UserRole[];
  icon: string;
}

const MENU_ITEMS: MenuItem[] = [
  {
    // D27: 앱 내 R3F 실시간 3D 오피스(WA 외부앱 대체)
    href: '/office',
    label: '가상 오피스',
    roles: ['admin', 'super_admin', 'leader', 'employee'],
    icon: '🏢',
  },
  {
    href: '/admin/employees',
    label: '직원명부',
    roles: ['admin', 'super_admin', 'leader', 'employee'],
    icon: '👥',
  },
  {
    href: '/work-log',
    label: '업무기록',
    roles: ['admin', 'super_admin', 'leader', 'employee'],
    icon: '📝',
  },
  {
    href: '/meetings',
    label: '회의/회의록',
    roles: ['admin', 'super_admin', 'leader', 'employee'],
    icon: '📅',
  },
  {
    href: '/kpi',
    label: '내 KPI',
    roles: ['admin', 'super_admin', 'leader', 'employee'],
    icon: '📊',
  },
  {
    href: '/admin/kpi',
    label: 'KPI 관리',
    roles: ['admin', 'super_admin', 'leader'],
    icon: '🏆',
  },
  {
    href: '/admin/org-chart',
    label: '조직도',
    roles: ['admin', 'super_admin'],
    icon: '🌐',
  },
  {
    href: '/admin/office-layout',
    label: '좌석 배치',
    roles: ['admin', 'super_admin'],
    icon: '🗺️',
  },
  {
    href: '/admin/sync',
    label: '동기화 모니터링',
    roles: ['admin', 'super_admin'],
    icon: '🔄',
  },
  {
    href: '/admin/audit',
    label: '감사 로그',
    roles: ['admin', 'super_admin'],
    icon: '📜',
  },
  {
    href: '/admin/notices',
    label: '공지 관리',
    roles: ['admin', 'super_admin'],
    icon: '📢',
  },
  {
    // C4: 아바타 커스터마이징 (06-screens §3.9)
    href: '/settings',
    label: '아바타 설정',
    roles: ['admin', 'super_admin', 'leader', 'employee'],
    icon: '🧑‍🎨',
  },
];

interface SidebarProps {
  role: UserRole;
}

// 콘솔 사이드바 — /office 셸과 동일한 디자인 토큰(다크 네이비)으로 통일.
// (design-style-analysis §1/§3 — 라우트 이동 시 헤더/네비 디자인이 바뀌지 않도록)
export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();

  const visibleItems = MENU_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <aside className="w-60 flex-shrink-0 bg-bg-surface text-text-primary border-r border-border-subtle flex flex-col">
      <div className="px-5 py-4 border-b border-border-subtle">
        <div className="text-[10px] text-text-muted uppercase tracking-widest mb-0.5">VirtualOffice</div>
        <div className="font-bold text-text-primary text-base">관리콘솔</div>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto" aria-label="주 메뉴">
        {visibleItems.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
                isActive
                  ? 'bg-[rgba(59,91,254,0.15)] text-primary border-l-2 border-primary pl-[10px]'
                  : 'text-text-secondary hover:bg-bg-surface-raised hover:text-text-primary',
              ].join(' ')}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-3 border-t border-border-subtle">
        <div className="text-xs text-text-muted">
          {role === 'admin' || role === 'super_admin'
            ? '관리자'
            : role === 'leader'
              ? '리더'
              : '직원'}
        </div>
      </div>
    </aside>
  );
}
