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
          <div className="theme-tg" role="group" aria-label="Theme">
            {(['light', 'auto', 'dark'] as Theme[]).map(t => (
              <button key={t} className={theme === t ? 'on' : ''} aria-pressed={theme === t} onClick={() => pick(t)}>
                {t === 'light' ? '☀ Light' : t === 'dark' ? '☾ Dark' : 'Auto'}
              </button>
            ))}
          </div>
        </div>
      </aside>
      <div className="shell-main">{children}</div>
    </div>
  );
}
