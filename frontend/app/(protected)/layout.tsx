'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import OfficeShell from '@/components/OfficeShell';
import { FeedbackProvider } from '@/components/ui/feedback';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    setChecked(true);
  }, [router]);

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0E1626' }}>
        <div className="text-sm text-text-muted">로딩 중...</div>
      </div>
    );
  }

  // D29 셸 단일화: 모든 (protected) 라우트가 하나의 오피스 셸 안에서 렌더.
  // 메뉴 페이지는 셸 위 오버레이 창(children) → 라우트 이동에도 뷰포트·실시간 연결·디자인 유지.
  return (
    <FeedbackProvider>
      <OfficeShell>{children}</OfficeShell>
    </FeedbackProvider>
  );
}
