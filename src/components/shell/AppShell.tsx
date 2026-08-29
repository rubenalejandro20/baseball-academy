'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, X, Activity, LogOut } from 'lucide-react';
import { type StaffRole } from '@/lib/types';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface AppShellProps {
  nav: NavItem[];
  userEmail: string;
  role?: StaffRole | null;
  onLogout: () => void;
  children: React.ReactNode;
}

/**
 * Shared authenticated-shell chrome (sidebar + mobile topbar) used by every
 * staff role. This is a direct extraction of the markup that previously
 * lived inline in admin/layout.tsx — behavior and appearance are unchanged;
 * it is now reusable so future role-specific nav sets (coach, physician)
 * don't require a second copy of this layout.
 */
export function AppShell({ nav, userEmail, role, onLogout, children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    if (nav[0]?.href === href) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] fixed h-full z-20">
        <SidebarContent nav={nav} isActive={isActive} userEmail={userEmail} role={role} onLogout={onLogout} />
      </aside>

      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="relative w-60 h-full border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col animate-slide-in-right">
            <SidebarContent
              nav={nav} isActive={isActive} userEmail={userEmail} role={role}
              onLogout={onLogout} onClose={() => setOpen(false)}
            />
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
  nav, isActive, userEmail, role, onLogout, onClose,
}: {
  nav: NavItem[];
  isActive: (href: string) => boolean;
  userEmail: string;
  role?: StaffRole | null;
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
          <p className="text-[11px] text-slate-600 capitalize">{role ?? 'Staff'}</p>
        </div>
        <button onClick={onLogout} className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all">
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </>
  );
}
