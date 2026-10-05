'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { getStaffContext, type StaffContextResult } from '@/lib/auth/getStaffContext';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { CheckingScreen, NotLinkedScreen, ForbiddenScreen } from '@/components/shell/StaffGuardScreens';
import { LayoutDashboard, Dumbbell, CalendarClock } from 'lucide-react';

const NAV: NavItem[] = [
  { href: '/coach', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/coach/services', label: 'My Services', icon: Dumbbell },
  { href: '/coach/availability', label: 'Availability', icon: CalendarClock },
];

type GuardState = 'checking' | 'authorized' | 'not_linked' | 'forbidden';

/**
 * Coach Portal auth guard (Milestone 4) — mirrors admin/layout.tsx's shape
 * exactly, reusing the same getStaffContext()/AppShell plumbing rather than
 * introducing a second auth system. There is no /coach/login: login still
 * only exists under /admin/login, same Supabase Auth session either portal
 * reads via getStaffContext().
 *
 * Allowed: coach, administrator, Super User. Denied: a plain physician —
 * the mirror image of admin/layout.tsx denying a plain coach. RLS (0008)
 * is the real security boundary for the underlying data tables; this
 * guard is only the corresponding UX boundary for this portal shell,
 * which today has no data of its own to protect yet.
 */
export default function CoachLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GuardState>('checking');
  const [context, setContext] = useState<Extract<StaffContextResult, { status: 'ok' }> | null>(null);

  useEffect(() => {
    let cancelled = false;

    getStaffContext().then(result => {
      if (cancelled) return;
      if (result.status === 'no_session') {
        router.replace('/admin/login');
      } else if (result.status === 'not_linked') {
        setState('not_linked');
      } else if (result.role === 'physician' && !result.isSuperUser) {
        setState('forbidden');
      } else {
        setContext(result);
        setState('authorized');
      }
    });

    return () => { cancelled = true; };
  }, [router]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/admin/login');
  }

  if (state === 'checking') return <CheckingScreen />;
  if (state === 'not_linked') return <NotLinkedScreen onLogout={handleLogout} />;
  if (state === 'forbidden') return (
    <ForbiddenScreen
      onLogout={handleLogout}
      message="This account is registered as a physician/trainer. The Coach Portal isn't available to physician/trainer accounts — use the Physician/Trainer portal instead."
    />
  );

  return (
    <AppShell nav={NAV} userEmail={context?.email ?? ''} role={context?.role} onLogout={handleLogout}>
      {children}
    </AppShell>
  );
}
