'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { getStaffContext, type StaffContextResult } from '@/lib/auth/getStaffContext';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { CheckingScreen, NotLinkedScreen, ForbiddenScreen } from '@/components/shell/StaffGuardScreens';
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

type GuardState = 'checking' | 'authorized' | 'not_linked' | 'forbidden';

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
      } else if (result.role === 'coach' && !result.isSuperUser) {
        // Milestone 4: a plain coach is denied the Physician/Trainer
        // portal's UX, mirroring the Coach Portal denying a plain
        // physician. RLS (0008) is the real security boundary — every
        // query on this portal's pages would already return zero rows
        // for a coach account — this is only the matching explained
        // denial screen instead of a confusing, data-less admin UI.
        setState('forbidden');
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

  if (state === 'checking') return <CheckingScreen />;

  // A valid Supabase session exists, but no active staff_profiles row was
  // found for it. Surfaced explicitly rather than silently bounced to
  // /admin/login, which would look identical to a wrong password and hide
  // the real cause (e.g. the Milestone 1 backfill hasn't run for this
  // account, or the account was deactivated).
  if (state === 'not_linked') return <NotLinkedScreen onLogout={handleLogout} />;

  if (state === 'forbidden') return (
    <ForbiddenScreen
      onLogout={handleLogout}
      message="This account is registered as a coach. The Physician/Trainer portal isn't available to coach accounts — use the Coach Portal instead."
    />
  );

  return (
    <AppShell nav={NAV} userEmail={context?.email ?? ''} role={context?.role} onLogout={handleLogout}>
      {children}
    </AppShell>
  );
}
