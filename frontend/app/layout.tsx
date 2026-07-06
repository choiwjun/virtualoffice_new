import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VirtualOffice 관리콘솔',
  description: 'VirtualOffice Web Admin Console',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
