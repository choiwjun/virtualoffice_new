'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, getUser, logout, User } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    setChecked(true);
  }, [router]);

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">로딩 중...</div>
      </div>
    );
  }

  // /office(및 하위)는 자체 D27 셸(좌내비+3D 뷰포트+우패널)이 전체 화면을 채움
  // → 콘솔 Sidebar/header 미표시(이중 사이드바 제거). 인증 체크는 위에서 이미 통과.
  if (pathname?.startsWith('/office')) {
    return <div className="h-screen w-screen overflow-hidden">{children}</div>;
  }

  const role = user?.role ?? 'employee';
  // Normalize super_admin → admin for sidebar
  const sidebarRole = role === 'super_admin' ? 'admin' : role;

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <Sidebar role={sidebarRole as 'admin' | 'leader' | 'employee'} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header — /office 셸과 동일한 다크 토큰(라우트 이동 시 헤더 디자인 일관) */}
        <header className="flex-shrink-0 bg-bg-base border-b border-border-subtle px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">VirtualOffice</span>
            <span className="text-text-muted">/</span>
            <span className="text-sm font-medium text-text-secondary">관리콘솔</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium text-text-primary">{user?.name ?? '—'}</div>
              <div className="text-xs text-text-muted">{user?.email ?? ''}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold">
              {user?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <button
              onClick={logout}
              className="text-sm text-text-muted hover:text-danger transition-colors"
            >
              로그아웃
            </button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
