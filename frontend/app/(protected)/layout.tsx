'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser, logout, User } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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

  const role = user?.role ?? 'employee';
  // Normalize super_admin → admin for sidebar
  const sidebarRole = role === 'super_admin' ? 'admin' : role;

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <Sidebar role={sidebarRole as 'admin' | 'leader' | 'employee'} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">VirtualOffice</span>
            <span className="text-gray-300">/</span>
            <span className="text-sm font-medium text-gray-700">관리콘솔</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium text-gray-700">{user?.name ?? '—'}</div>
              <div className="text-xs text-gray-400">{user?.email ?? ''}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold">
              {user?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <button
              onClick={logout}
              className="text-sm text-gray-500 hover:text-red-500 transition-colors"
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
