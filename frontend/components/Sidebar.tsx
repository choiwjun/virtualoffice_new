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

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();

  const visibleItems = MENU_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <aside className="w-56 flex-shrink-0 bg-gray-900 text-white flex flex-col">
      <div className="px-5 py-5 border-b border-gray-700">
        <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">VirtualOffice</div>
        <div className="font-bold text-white text-base">관리콘솔</div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {/* D26 WorkAdventure 외부링크(가상 오피스 입장 → localhost:8090) 제거 —
            D27에서 가상오피스는 앱 내 R3F 뷰포트(/office)로 대체됨. WA 별도앱/OIDC 폐기. */}
        {visibleItems.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-3 border-t border-gray-700">
        <div className="text-xs text-gray-500">
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
