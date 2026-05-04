'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import {
  LayoutDashboard, Users, Dumbbell, CalendarDays, LogOut, Menu, X, Activity, QrCode
} from 'lucide-react';

const NAV = [
  { href: '/admin/dashboard',  label: 'Dashboard',        icon: LayoutDashboard },
  { href: '/admin/athletes',   label: 'Athletes',          icon: Users },
  { href: '/admin/exercises',  label: 'Exercise Library',  icon: Dumbbell },
  { href: '/admin/assignments',label: 'Weekly Plans',      icon: CalendarDays },
  { href: '/admin/qrcodes',    label: 'QR Codes',          icon: QrCode },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [open, setOpen]           = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (pathname === '/admin/login') {
      setAuthorized(true);
      return;
    }
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/admin/login');
      } else {
        setUserEmail(session.user.email ?? '');
        setAuthorized(true);
      }
    });
  }, [router, pathname]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/admin/login');
  }

  function isActive(href: string) {
    if (href === '/admin/dashboard') return pathname === href;
    return pathname.startsWith(href);
  }

  if (!authorized) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B1426]">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] fixed h-full z-20">
        <SidebarContent nav={NAV} isActive={isActive} userEmail={userEmail} onLogout={handleLogout} />
      </aside>

      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="relative w-60 h-full border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col animate-slide-in-right">
            <SidebarContent nav={NAV} isActive={isActive} userEmail={userEmail} onLogout={handleLogout} onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col lg:ml-60 min-w-0">
        <header className="lg:hidden flex items-center justify-between px-4 h-14 border-b border-[var(--border)] bg-[var(--bg-secondary)] sticky top-0 z-10">
          <button onClick={() => setOpen(true)} className="p-2 rounded-lg hover:bg-white/10 text-slate-400" aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-brand-500" />
            <span className="font-display font-bold text-sm tracking-wide text-white">7AR BASEBALL ACADEMY</span>
          </div>
          <div className="w-9" />
        </header>
        <main className="flex-1 p-4 md:p-6 lg:p-8 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  nav, isActive, userEmail, onLogout, onClose,
}: {
  nav: typeof NAV;
  isActive: (href: string) => boolean;
  userEmail: string;
  onLogout: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-5 h-16 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-500/15 border border-brand-500/30 flex items-center justify-center">
            <img src="/7ARlogo.png" alt="7AR Baseball Academy" className="w-6 h-6 object-contain" />
          </div>
          <div>
            <p className="font-display font-bold text-sm tracking-widest text-white leading-none">7AR ACADEMY</p>
            <p className="text-[10px] text-slate-500 tracking-wide leading-none mt-0.5">PERFORMANCE</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} onClick={onClose}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
              isActive(href) ? 'bg-brand-500/15 text-brand-400 border border-brand-500/25' : 'text-slate-400 hover:text-white hover:bg-white/6'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-[var(--border)]">
        <div className="px-3 py-2 mb-2">
          <p className="text-xs text-slate-500 truncate">{userEmail}</p>
          <p className="text-[11px] text-slate-600">Physician / Admin</p>
        </div>
        <button onClick={onLogout} className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all">
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </>
  );
}
