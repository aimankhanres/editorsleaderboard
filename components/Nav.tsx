'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/', title: 'Attribution', sub: 'Ad spend credited to each editor' },
  { href: '/capacity', title: 'Capacity', sub: 'Edits done vs KPI, spare capacity' },
];

const WIDE = '(min-width: 1180px)';

/**
 * Burger button + menu at the left of every page header. On wide screens the menu is a sidebar that is open by
 * default (the burger collapses it, remembered per browser); on narrow screens it slides out over the page.
 */
export default function Nav() {
  const [open, setOpen] = useState(false); // narrow screens: slide-out open
  const [pinned, setPinned] = useState(true); // wide screens: sidebar shown
  const [wide, setWide] = useState(false);
  const path = usePathname();
  useEffect(() => {
    try { if (localStorage.getItem('navPinned') === '0') setPinned(false); } catch { /* storage unavailable */ }
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const sidebar = wide && pinned;
  useEffect(() => {
    document.body.classList.toggle('nav-pinned', sidebar);
    return () => document.body.classList.remove('nav-pinned');
  }, [sidebar]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => setOpen(false), [path]);
  const pin = (v: boolean) => { setPinned(v); try { localStorage.setItem('navPinned', v ? '1' : '0'); } catch { /* ignore */ } };
  const toggle = () => (wide ? pin(!pinned) : setOpen(true));
  const close = () => (wide ? pin(false) : setOpen(false));
  const shown = sidebar || open;

  return (
    <>
      <button className="burger" aria-label={shown ? 'Hide menu' : 'Open menu'} aria-expanded={shown} onClick={toggle}>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      <div className={`drawer-scrim ${open && !wide ? 'on' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className={`drawer ${shown ? 'on' : ''} ${sidebar ? 'pinned' : ''}`} aria-label="Menu" aria-hidden={!shown}>
        <div className="drawer-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span>Editor Dashboard</span>
          <button className="drawer-close" aria-label="Hide menu" onClick={close} tabIndex={shown ? 0 : -1}>×</button>
        </div>
        <nav className="drawer-links">
          {LINKS.map(l => (
            <Link key={l.href} href={l.href} className={path === l.href ? 'on' : ''} tabIndex={shown ? 0 : -1}>
              <strong>{l.title}</strong>
              <span>{l.sub}</span>
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
