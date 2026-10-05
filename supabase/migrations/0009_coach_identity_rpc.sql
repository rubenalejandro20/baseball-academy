-- ============================================================
-- Milestone 5 — current_staff_profile_id()
-- ============================================================
-- First migration of the booking/scheduling domain (Coach Portal
-- foundation: coach profiles, services, coach-service offerings,
-- recurring availability, blocked time). This file adds a single,
-- additive, reusable identity primitive that every subsequent Milestone 5
-- migration's RLS depends on — separated into its own file for the same
-- reason 0007 (is_org_coach/is_org_physician) preceded 0008: it is a
-- cross-cutting primitive, not something scoped to one table, so it
-- belongs on its own rather than bundled into a specific entity's file.
--
-- Every existing role RPC (current_org_id, is_org_administrator,
-- is_org_coach, is_org_physician, is_super_user) answers "what is true
-- about the caller" without ever returning *which* staff_profiles row the
-- caller is. The booking domain is the first place RLS needs that:
-- "is this row mine specifically" (a coach's own availability/blocks/
-- profile/service-offering), not just "is this row in my org." This RPC
-- is the one small, atomic addition that makes that expressible.
--
-- SAFE TO APPLY AT ANY TIME: purely additive, same SECURITY DEFINER /
-- empty search_path / explicit-grant pattern as every prior role RPC.
-- Zero behavioral change to any existing table or query — nothing
-- references this function until 0010 onward.
--
-- DO NOT RUN AGAINST PRODUCTION YET. Developed and tested entirely
-- locally (npm run test:db), same posture as every prior migration before
-- its own, later, explicitly authorized production application.
-- ============================================================

BEGIN;

create or replace function current_staff_profile_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select id from public.staff_profiles
  where auth_user_id = auth.uid() and is_active = true
  limit 1;
$$;

-- Same explicit EXECUTE privilege audit as every prior role RPC: revoke
-- the PUBLIC default, grant only to the role that needs it. `authenticated`
-- needs this for RLS policy expressions (0010 onward); `anon` never
-- resolves a staff identity and gets no grant.
revoke execute on function current_staff_profile_id() from public;
grant execute on function current_staff_profile_id() to authenticated;

COMMIT;
