'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Navbar() {
  const pathname = usePathname();
  const isHome = pathname === '/';

  return (
    <nav
      className={
        isHome
          ? 'absolute inset-x-0 top-0 z-50 px-6 py-6'
          : 'sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/72 px-6 py-4 backdrop-blur-xl'
      }
    >
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <Link href="/" className="flex flex-col leading-tight">
          <span className="text-[11px] uppercase tracking-[0.22em] text-sky-200">Veliora</span>
          <span className="text-white font-semibold text-lg">BioMed Research Engine</span>
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className={`text-sm transition ${isHome ? 'text-slate-300 hover:text-white' : 'text-slate-400 hover:text-white'}`}
          >
            New Task
          </Link>
          <Link
            href="/jobs"
            className={`text-sm transition ${isHome ? 'text-slate-300 hover:text-white' : 'text-slate-400 hover:text-white'}`}
          >
            My Tasks
          </Link>
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>
      </div>
    </nav>
  );
}
