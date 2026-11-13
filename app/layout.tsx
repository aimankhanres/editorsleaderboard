import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Editor Leaderboard', description: 'Meta spend by editor, from ClickUp briefs' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
