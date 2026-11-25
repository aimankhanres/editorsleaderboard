import type { Metadata } from 'next';
import Shell from '@/components/Shell';
import './globals.css';

export const metadata: Metadata = { title: 'Creative Ops', description: 'Ad spend by editor and strategist, editing capacity and briefs' };

// Set the saved theme before first paint, so a dark-mode pick doesn't flash light
const THEME_INIT = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
