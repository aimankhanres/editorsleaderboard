'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/', title: 'Attribution', sub: 'Ad spend credited to each editor' },
  { href: '/capacity', title: 'Capacity', sub: 'Edits done vs KPI, spare capacity' },
];

/** Burger button + slide-out menu, shown at the left of every page header */
export default function Nav() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => setOpen(false), [path]);

  return (
    <>
      <button className="burger" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      <div className={`drawer-scrim ${open ? 'on' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className={`drawer ${open ? 'on' : ''}`} aria-label="Menu" aria-hidden={!open}>
        <div className="drawer-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span>Editor Dashboard</span>
          <button className="drawer-close" aria-label="Close menu" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>×</button>
        </div>
        <nav className="drawer-links">
          {LINKS.map(l => (
            <Link key={l.href} href={l.href} className={path === l.href ? 'on' : ''} tabIndex={open ? 0 : -1}>
              <strong>{l.title}</strong>
              <span>{l.sub}</span>
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
