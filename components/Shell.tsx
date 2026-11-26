'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

type Item = { href: string; label: string; icon: string };
const SECTIONS: { title: string; items: Item[] }[] = [
  { title: 'Attribution', items: [
    { href: '/', label: 'Editors', icon: 'M4 20l6-6m0 0l3-9 7 7-9 3m-1-1l2 2' },
    { href: '/strategists', label: 'Strategists', icon: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4' },
    { href: '/teams', label: 'Teams', icon: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z' },
  ] },
  { title: 'Capacity', items: [
    { href: '/capacity', label: 'Editor capacity', icon: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { href: '/briefs', label: 'Briefs & pipeline', icon: 'M4 6h16M4 12h10M4 18h6' },
  ] },
  { title: 'People', items: [
    { href: '/bonus', label: 'Bonus', icon: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z' },
  ] },
  { title: 'Settings', items: [
    { href: '/settings', label: 'KPI rules', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z' },
  ] },
];
type Theme = 'light' | 'auto' | 'dark';

function applyTheme(t: Theme) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/** App frame: dark sidebar with the two sections (Attribution, Capacity) and the theme switch. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>('auto');
  const [frame, setFrame] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/frame/state').then(r => r.json()).then(setFrame).catch(() => {});
    const f = new URLSearchParams(window.location.search).get('frame');
    if (f) setNotice(f === 'connected' ? 'Frame.io connected. Minutes of video will appear after the next sync.'
      : f === 'already' ? 'Frame.io is already connected.' : `Frame.io sign-in didn't finish (${f}). Try again.`);
  }, []);
  useEffect(() => {
    try { const t = localStorage.getItem('theme') as Theme | null; if (t) setTheme(t); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => setOpen(false), [path]);
  const pick = (t: Theme) => {
    setTheme(t); applyTheme(t);
    try { if (t === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', t); } catch { /* ignore */ }
  };

  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Main menu">
        <div className="side-top">
          <Link href="/" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={30} height={30} />
            <span>Creative Ops</span>
          </Link>
          <button className="side-burger" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(o => !o)}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <nav className="side-nav">
          {SECTIONS.map(s => (
            <div key={s.title} className="side-sec">
              <div className="side-title">{s.title}</div>
              {s.items.map(i => (
                <Link key={i.href} href={i.href} className={`side-item ${path === i.href ? 'on' : ''}`} aria-current={path === i.href ? 'page' : undefined}>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d={i.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  {i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {frame?.configured && !frame.connected && (
            <a className="side-connect" href="/api/frame/connect">Connect Frame.io</a>
          )}
          <div className="theme-tg" role="group" aria-label="Theme">
            {(['light', 'auto', 'dark'] as Theme[]).map(t => (
              <button key={t} className={theme === t ? 'on' : ''} aria-pressed={theme === t} onClick={() => pick(t)}>
                {t === 'light' ? '☀ Light' : t === 'dark' ? '☾ Dark' : 'Auto'}
              </button>
            ))}
          </div>
        </div>
      </aside>
      <div className="shell-main">
        {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div>}
        {children}
      </div>
    </div>
  );
}
