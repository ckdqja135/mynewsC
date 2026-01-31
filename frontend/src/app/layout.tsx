import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'News Crawler',
  description: 'Search and browse news articles',
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
