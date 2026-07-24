import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VirtualOffice 가상오피스',
  description: 'VirtualOffice Web Admin Console',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard(변수 동적 서브셋) 실제 로딩 — tailwind font-sans 정본.
            감사 23 A2: 이전엔 폰트가 선언만 되고 로드되지 않아 OS 기본 폰트로 렌더됐다. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
