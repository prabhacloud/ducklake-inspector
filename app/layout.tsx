import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DuckLake Inspector',
  description: 'Read-only browser for DuckLake catalogs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased text-[14px] text-ink">{children}</body>
    </html>
  );
}
