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
      <body>{children}</body>
    </html>
  );
}
