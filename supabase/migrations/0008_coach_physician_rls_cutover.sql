-- ============================================================
-- Milestone 4 — Coach/Physician RLS cutover on physician/trainer-domain
-- tables
-- ============================================================
-- Run AFTER 0007_coach_physician_role_rpcs.sql. This is the actual
-- privacy enforcement: today, "Staff org access - X" on each of the five
-- tables below grants identical access to EVERY authenticated staff role
-- in the organization — administrator, coach, and physician alike. That
-- is the exact gap the Milestone 4 plan requires closed: a plain coach
-- must no longer be able to read OR write athlete/exercise/training data.
--
-- ONE ATOMIC MIGRATION, applied as a single transaction (BEGIN/COMMIT
-- below) — this project now standardizes on the formal migration chain
-- (`supabase/migrations/`, tracked via the Supabase CLI) rather than
-- manual, section-by-section production execution. The five sections
-- below remain for readability and review ONLY: each is a self-contained,
-- independently-understandable unit of the overall change, with its own
-- "what this section does" comment and its own documented rollback
-- predicate — but all five apply together, as one migration, or not at
-- all. There is no supported path that applies only some of them.
--
-- Each section replaces a policy UNDER THE SAME NAME it already has —
-- the policy's PURPOSE (org-scoped staff access) hasn't changed, only
-- WHICH roles satisfy it — so this keeps one canonical policy name per
-- table across the project's history. The inline "ROLLBACK for this
-- section only" comments document the pre-0008 predicate for each table
-- individually (useful if a future, separate rollback migration needs to
-- revert just one table's policy) — they are reference material, not
-- standalone statements meant to be run during this migration's own
-- application.
--
-- WHAT DOES NOT CHANGE: `organizations` ("Staff read own organization"),
-- `staff_profiles` ("Staff read own or org profiles"), `audit_events`
-- (already administrator/super-user-only), and `platform_admins` are not
-- touched here — none of them are physician/trainer-sensitive training
-- data, and `audit_events` already excludes plain coaches with no change
-- needed. Staff-management writes remain out of scope (Academy
-- Administration is explicitly deferred, not part of Milestone 4).
--
-- WHAT STAYS UNAFFECTED BY DESIGN: the athlete-facing experience.
-- `get_athlete_routines()` (0005) is SECURITY DEFINER and reads
-- `activity_routines`/`exercises` bypassing table-level RLS entirely —
-- none of these policy changes touch that RPC's own internal query, so
-- the athlete PIN portal and Activity Routines routine view keep working
-- identically after this file is applied.
--
-- DO NOT RUN AGAINST PRODUCTION YET — see 0007's header; same posture.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- SECTION 1 — athletes
-- Expected end state: administrator, physician, and Super User keep
-- exactly the access they had; a plain coach gets none (read or write).
-- ─────────────────────────────────────────────
drop policy if exists "Staff org access - athletes" on athletes;

create policy "Staff org access - athletes"
  on athletes for all to authenticated
  using ((organization_id = current_org_id() and (is_org_administrator() or is_org_physician())) or is_super_user())
  with check ((organization_id = current_org_id() and (is_org_administrator() or is_org_physician())) or is_super_user());

-- ROLLBACK for this section only, if needed:
--   drop policy if exists "Staff org access - athletes" on athletes;
--   create policy "Staff org access - athletes" on athletes for all to authenticated
--     using (organization_id = current_org_id() or is_super_user())
--     with check (organization_id = current_org_id() or is_super_user());


-- ─────────────────────────────────────────────
-- SECTION 2 — exercises
-- Preserves the existing global/shared-exercise clause
-- (`organization_id IS NULL`) for the role-permitted read side; the
-- WITH CHECK side (writes) has no such clause today either, unchanged.
-- ─────────────────────────────────────────────
drop policy if exists "Staff org access - exercises" on exercises;

create policy "Staff org access - exercises"
  on exercises for all to authenticated
  using (((organization_id = current_org_id() or organization_id is null) and (is_org_administrator() or is_org_physician())) or is_super_user())
  with check ((organization_id = current_org_id() and (is_org_administrator() or is_org_physician())) or is_super_user());

-- ROLLBACK for this section only, if needed:
--   drop policy if exists "Staff org access - exercises" on exercises;
--   create policy "Staff org access - exercises" on exercises for all to authenticated
--     using (organization_id = current_org_id() or organization_id is null or is_super_user())
--     with check (organization_id = current_org_id() or is_super_user());


-- ─────────────────────────────────────────────
-- SECTION 3 — weekly_plans
-- ─────────────────────────────────────────────
drop policy if exists "Staff org access - weekly_plans" on weekly_plans;

create policy "Staff org access - weekly_plans"
  on weekly_plans for all to authenticated
  using ((organization_id = current_org_id() and (is_org_administrator() or is_org_physician())) or is_super_user())
  with check ((organization_id = current_org_id() and (is_org_administrator() or is_org_physician())) or is_super_user());

-- ROLLBACK for this section only, if needed:
--   drop policy if exists "Staff org access - weekly_plans" on weekly_plans;
--   create policy "Staff org access - weekly_plans" on weekly_plans for all to authenticated
--     using (organization_id = current_org_id() or is_super_user())
--     with check (organization_id = current_org_id() or is_super_user());


-- ─────────────────────────────────────────────
-- SECTION 4 — assigned_exercises
-- Scoped via its parent weekly_plans row (no own organization_id column,
-- same shape 0003 originally used) — the role check is added inside the
-- same EXISTS subquery rather than against a column on this table.
-- ─────────────────────────────────────────────
drop policy if exists "Staff org access - assigned_exercises" on assigned_exercises;

create policy "Staff org access - assigned_exercises"
  on assigned_exercises for all to authenticated
  using (
    exists (
      select 1 from weekly_plans wp
      where wp.id = assigned_exercises.weekly_plan_id
        and ((wp.organization_id = current_org_id() and (is_org_administrator() or is_org_physician())) or is_super_user())
    )
  )
  with check (
    exists (
      select 1 from weekly_plans wp
      where wp.id = assigned_exercises.weekly_plan_id
        and ((wp.organization_id = current_org_id() and (is_org_administrator() or is_org_physician())) or is_super_user())
    )
  );

-- ROLLBACK for this section only, if needed:
--   drop policy if exists "Staff org access - assigned_exercises" on assigned_exercises;
--   create policy "Staff org access - assigned_exercises" on assigned_exercises for all to authenticated
--     using (exists (select 1 from weekly_plans wp where wp.id = assigned_exercises.weekly_plan_id and (wp.organization_id = current_org_id() or is_super_user())))
--     with check (exists (select 1 from weekly_plans wp where wp.id = assigned_exercises.weekly_plan_id and (wp.organization_id = current_org_id() or is_super_user())));


-- ─────────────────────────────────────────────
-- SECTION 5 — activity_routines
-- ─────────────────────────────────────────────
drop policy if exists "Staff org access - activity_routines" on activity_routines;

create policy "Staff org access - activity_routines"
  on activity_routines for all to authenticated
  using ((organization_id = current_org_id() and (is_org_administrator() or is_org_physician())) or is_super_user())
  with check ((organization_id = current_org_id() and (is_org_administrator() or is_org_physician())) or is_super_user());

-- ROLLBACK for this section only, if needed:
--   drop policy if exists "Staff org access - activity_routines" on activity_routines;
--   create policy "Staff org access - activity_routines" on activity_routines for all to authenticated
--     using (organization_id = current_org_id() or is_super_user())
--     with check (organization_id = current_org_id() or is_super_user());

COMMIT;
