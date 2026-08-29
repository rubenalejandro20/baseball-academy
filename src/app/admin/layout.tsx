'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { getStaffContext, type StaffContextResult } from '@/lib/auth/getStaffContext';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import {
  LayoutDashboard, Users, Dumbbell, Layers, Activity, QrCode
} from 'lucide-react';

const NAV: NavItem[] = [
  { href: '/admin/dashboard', label: 'Dashboard',       icon: LayoutDashboard },
  { href: '/admin/athletes',  label: 'Athletes',         icon: Users },
  { href: '/admin/exercises', label: 'Exercise Library', icon: Dumbbell },
  { href: '/admin/routines',  label: 'Routines',         icon: Layers },
  { href: '/admin/qrcodes',   label: 'QR Codes',         icon: QrCode },
];

type GuardState = 'checking' | 'authorized' | 'not_linked';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [state, setState]         = useState<GuardState>('checking');
  const [context, setContext]     = useState<Extract<StaffContextResult, { status: 'ok' }> | null>(null);

  useEffect(() => {
    if (pathname === '/admin/login') {
      setState('authorized');
      return;
    }

    let cancelled = false;

    getStaffContext().then(result => {
      if (cancelled) return;
      if (result.status === 'no_session') {
        router.replace('/admin/login');
      } else if (result.status === 'not_linked') {
        setState('not_linked');
      } else {
        setContext(result);
        setState('authorized');
      }
    });

    return () => { cancelled = true; };
  }, [router, pathname]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/admin/login');
  }

  if (state === 'checking') return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B1426]">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // A valid Supabase session exists, but no active staff_profiles row was
  // found for it. Surfaced explicitly rather than silently bounced to
  // /admin/login, which would look identical to a wrong password and hide
  // the real cause (e.g. the Milestone 1 backfill hasn't run for this
  // account, or the account was deactivated).
  if (state === 'not_linked') return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B1426] px-4">
      <div className="card p-8 max-w-sm text-center">
        <h1 className="font-display text-xl font-bold text-white tracking-wide mb-2">
          ACCOUNT NOT LINKED
        </h1>
        <p className="text-sm text-slate-400">
          Your login was successful, but this account isn&apos;t linked to an academy yet.
          Contact your administrator or platform support.
        </p>
        <button onClick={handleLogout} className="btn-secondary mt-6 mx-auto">
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <AppShell nav={NAV} userEmail={context?.email ?? ''} role={context?.role} onLogout={handleLogout}>
      {children}
    </AppShell>
  );
}
