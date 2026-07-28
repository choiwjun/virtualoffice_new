import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/components/I18nProvider';

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
      <body className="font-sans antialiased">
        {/* 공개(로그인·가입)와 보호 트리를 모두 덮어야 해서 루트에 둔다.
            `lang`은 여기서 ko로 시작하고 프로바이더가 마운트 후 실제 로케일로 바꾼다 —
            서버에는 사용자 선택(localStorage)이 없어 이게 하이드레이션을 깨지 않는 유일한 방법이다. */}
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
