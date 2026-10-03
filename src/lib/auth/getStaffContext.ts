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
 * Instead this calls the SECURITY DEFINER helper functions
 * (current_org_id, is_org_administrator, is_org_coach, is_org_physician,
 * is_super_user) — these bypass table-level RLS entirely by design, which
 * is what avoids the staff_profiles-has-RLS-but-no-policy trap described
 * above. This is an architectural property of how role/org resolution
 * works, not a deployment-sequencing accommodation: this project's
 * deployment strategy deploys Milestone 4 application code only once its
 * required migrations (0001, 0003, 0007, 0008) are already applied, so
 * this function is not required to tolerate being deployed ahead of them.
 *
 * "not_linked" means a valid Supabase Auth session exists but
 * current_org_id() resolved to nothing — no active staff_profiles row for
 * this account (e.g. the dormant second account, or a Super User with no
 * academy membership). Surfaced as a distinct state so it doesn't look
 * like a wrong password.
 *
 * Role fidelity note (resolved as of Milestone 4): is_org_coach() and
 * is_org_physician() are STRICT, single-role checks — an administrator
 * gets false from both, by design (see 0007's header comment). `role`
 * below is therefore resolved administrator-first, matching how RLS
 * policies compose these same booleans with OR in 0008
 * (`is_org_administrator() OR is_org_physician()`).
 */
export async function getStaffContext(): Promise<StaffContextResult> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) return { status: 'no_session' };

  const [orgResult, adminResult, coachResult, physicianResult, superUserResult] = await Promise.all([
    supabase.rpc('current_org_id'),
    supabase.rpc('is_org_administrator'),
    supabase.rpc('is_org_coach'),
    supabase.rpc('is_org_physician'),
    supabase.rpc('is_super_user'),
  ]);

  // Fail closed on ANY of these erroring, not just orgResult. A silent
  // "treat an errored RPC's .data as falsy" would misclassify the caller
  // on a transient failure — e.g. a plain physician whose
  // is_org_physician() call errors would fall through to role: null and
  // be WRONGLY authorized at /coach (whose guard only denies an explicit
  // role === 'physician'); a coach/administrator whose is_super_user()
  // call errors would wrongly lose the Super User override the /admin
  // guard depends on. Both are real violations of Milestone 4's access
  // boundaries caused purely by a network/RPC hiccup, not an actual role
  // decision, so every one of these must fail closed into the same
  // not_linked state rather than silently resolving to an under- or
  // over-privileged context.
  if (
    orgResult.error || !orgResult.data ||
    adminResult.error || coachResult.error || physicianResult.error || superUserResult.error
  ) return { status: 'not_linked' };

  return {
    status: 'ok',
    organizationId: orgResult.data as string,
    role: adminResult.data
      ? 'administrator'
      : coachResult.data
      ? 'coach'
      : physicianResult.data
      ? 'physician'
      : null,
    email: session.user.email ?? '',
    isSuperUser: Boolean(superUserResult.data),
  };
}
