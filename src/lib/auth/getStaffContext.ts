import { createClient } from '@/lib/supabase';
import { type StaffRole } from '@/lib/types';

export type StaffContextResult =
  | { status: 'ok'; organizationId: string; role: StaffRole | null; email: string; isSuperUser: boolean }
  | { status: 'no_session' }
  | { status: 'not_linked' };

/**
 * Resolves the currently authenticated user's academy/role context.
 *
 * IMPORTANT: this deliberately does NOT query `staff_profiles` directly.
 * That table has had RLS enabled since migration 0001, but carries no
 * policies of its own until 0003 is applied — until then, a plain
 * `.from('staff_profiles').select(...)` returns nothing for EVERYONE,
 * including the real administrator, which would show every login (not
 * just genuinely unlinked accounts) the "account not linked" screen.
 *
 * Instead this calls the SECURITY DEFINER helper functions already live
 * in production since 0001 (current_org_id, is_org_administrator,
 * is_super_user) — these bypass table-level RLS entirely by design, so
 * they return the correct answer identically whether 0003 has been
 * applied yet or not. This is what makes the app deployable *before* the
 * RLS cutover and still correct *after* it, with no code change needed at
 * cutover time.
 *
 * "not_linked" means a valid Supabase Auth session exists but
 * current_org_id() resolved to nothing — no active staff_profiles row for
 * this account (e.g. the dormant second account, or a Super User with no
 * academy membership). Surfaced as a distinct state so it doesn't look
 * like a wrong password.
 *
 * Role fidelity note: Milestone 1 only distinguishes "administrator or
 * not" (via is_org_administrator()) because that's the only role these
 * RPCs can currently answer without a table read, and every real account
 * onboarded so far is an administrator. A dedicated RPC returning the
 * full staff_profiles row (including a real coach/physician distinction)
 * would be a small, worthwhile follow-up migration once staff management
 * (Phase 2) needs it — not required for Milestone 1.
 */
export async function getStaffContext(): Promise<StaffContextResult> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) return { status: 'no_session' };

  const [orgResult, adminResult, superUserResult] = await Promise.all([
    supabase.rpc('current_org_id'),
    supabase.rpc('is_org_administrator'),
    supabase.rpc('is_super_user'),
  ]);

  if (orgResult.error || !orgResult.data) return { status: 'not_linked' };

  return {
    status: 'ok',
    organizationId: orgResult.data as string,
    // null (not a guess) when not an administrator — coach vs. physician
    // can't be distinguished without a dedicated RPC/table read, and no
    // such accounts exist yet. AppShell already falls back to a generic
    // "Staff" label when role is absent.
    role: adminResult.data ? 'administrator' : null,
    email: session.user.email ?? '',
    isSuperUser: Boolean(superUserResult.data),
  };
}
