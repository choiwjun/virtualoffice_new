'use client';

// [임시] v8 리깅 에셋 육안 확인용 공개 프리뷰. 확인 후 삭제 예정. (인증/백엔드 불필요)
import dynamic from 'next/dynamic';

const OfficeViewport = dynamic(() => import('@/components/OfficeViewport'), { ssr: false });

export default function OfficePreview() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0d1b36' }}>
      <OfficeViewport />
    </div>
  );
}
