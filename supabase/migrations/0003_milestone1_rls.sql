-- ============================================================
-- Milestone 1 — RLS cutover
-- ============================================================
-- Run AFTER 0001 (schema) and 0002 (backfill), and ONLY after the
-- verification queries in 0002 have been checked by eye.
--
-- ⚠️ RUN THIS ONLY AFTER THE MILESTONE-1 APPLICATION CODE IS ALREADY LIVE
-- IN PRODUCTION AND VERIFIED (RPC-based athlete lookup/photo update,
-- organization_id-aware inserts). Production is still running OLD RLS at
-- that point, which is what makes it safe to deploy the new code first —
-- the old permissive policies still satisfy whatever the new code needs.
-- Applying this file BEFORE the new code is live would break the athlete
-- PIN portal, because the OLD code depends on direct anonymous table
-- access that this file removes. Order: schema+backfill → deploy
-- compatible app code → verify in production → THIS FILE, section by
-- section → verify after each section.
--
-- ⚠️ APPLY SECTION BY SECTION, NOT AS ONE BLOCK, IN PRODUCTION.
-- Each numbered section below is written to be copy/pasted and run
-- independently. After each section, reload the live admin app and
-- confirm the corresponding feature still works before moving to the
-- next section. If a section causes a problem, immediately re-run the
-- single "ROLLBACK" statement printed at the end of that section — do
-- not proceed to the next section until the current one is confirmed
-- good. This file exists as one reviewable document; it is not meant
-- to be executed as a single transaction against production.
--
-- INTENTIONAL, NOT A BUG: the anonymous SELECT policy on `exercises` is
-- kept as-is. This is deliberate and temporary — see that section's
-- comment for why. Nothing here should be read as "close every anonymous
-- policy."
--
-- REVISED after the Milestone 1 Step 1 production inventory:
-- `activity_routines` does not exist in production (confirmed absent —
-- see 0001/schema.sql) and is NOT referenced anywhere in this file. The
-- section that would have handled it has been removed rather than left as
-- dead SQL that would fail against a nonexistent table.
--
-- ⚠️ TEMPORARY PIN-COMPATIBILITY POLICY — REMOVAL IS REQUIRED, NOT
-- OPTIONAL, BEFORE EITHER OF THE FOLLOWING BECOMES TRUE:
--   (a) a second organization is onboarded, or
--   (b) athletes move to email-OTP identity (the planned Phase 6/OTP work).
-- `exercises` carries an `organization_id` column, but its anonymous
-- SELECT policy (Section 2) is NOT scoped by it — any anon caller can
-- currently read EVERY organization's exercise library, not just one
-- academy's. This is harmless today only because exactly one organization
-- exists. It stops being harmless the moment academy #2 exists, and must
-- not be carried into that architecture unexamined.
--
-- A real fix requires an actual trust anchor for "which academy is this
-- anonymous caller's," which does not exist pre-OTP. The correct long-term
-- fix is a SECURITY DEFINER RPC analogous to get_athlete_by_code() that
-- re-validates the athlete's code and returns only that org's exercises —
-- mirroring how `athletes` itself was already closed in Section 1.
-- Deliberately NOT built in Milestone 1: it would require rewiring the
-- athlete wizard's exercise embed for a cross-academy risk that cannot yet
-- materialize with a single organization. It becomes a REQUIRED task — not
-- a nice-to-have — as part of whichever of (a) or (b) above happens first.
-- If activity_routines is ever deliberately (re)introduced, the same
-- requirement applies to it too.
-- ============================================================


-- ─────────────────────────────────────────────
-- SECTION 1 — athletes
-- Expected end state: NO anonymous access at all (SELECT or UPDATE).
-- All athlete lookups/photo updates now go exclusively through the
-- rate-limited get_athlete_by_code() / update_athlete_photo_by_code()
-- RPCs added in 0001, which bypass RLS by design (SECURITY DEFINER)
-- and do not need a table policy to keep working.
-- ─────────────────────────────────────────────
drop policy if exists "Admin full access – athletes" on athletes;
drop policy if exists "Public read athletes by code" on athletes;
drop policy if exists "Athlete can upload photo" on athletes;

create policy "Staff org access - athletes"
  on athletes for all to authenticated
  using (organization_id = current_org_id() or is_super_user())
  with check (organization_id = current_org_id() or is_super_user());

-- ROLLBACK for this section only, if needed:
--   drop policy if exists "Staff org access - athletes" on athletes;
--   create policy "Admin full access – athletes" on athletes for all to authenticated using (true) with check (true);
--   create policy "Public read athletes by code" on athletes for select to anon using (is_active = true);
--   create policy "Athlete can upload photo" on athletes for update to anon using (true) with check (true);


-- ─────────────────────────────────────────────
-- SECTION 2 — exercises
-- Expected end state: anonymous SELECT of ACTIVE exercises STILL WORKS
-- (kept intentionally) — the athlete routine wizard's embedded
-- `exercise:exercises(*)` join depends on it and carries no athlete PII,
-- only generic exercise-library content (name/description/video link).
-- Only INSERT/UPDATE/DELETE move from "any authenticated user" to
-- "authenticated user's own org (or a global/null-org exercise)".
-- ─────────────────────────────────────────────
drop policy if exists "Admin full access – exercises" on exercises;
-- "Public read exercises" is intentionally NOT dropped.

create policy "Staff org access - exercises"
  on exercises for all to authenticated
  using (organization_id = current_org_id() or organization_id is null or is_super_user())
  with check (organization_id = current_org_id() or is_super_user());

-- ROLLBACK for this section only, if needed:
--   drop policy if exists "Staff org access - exercises" on exercises;
--   create policy "Admin full access – exercises" on exercises for all to authenticated using (true) with check (true);


-- ─────────────────────────────────────────────
-- SECTION 3 — weekly_plans
-- Expected end state: NO anonymous access. Nothing in the live
-- application ever reads this table anonymously (only the authenticated
-- /admin/assignments screens use it), so this is a clean close with no
-- compatibility RPC required.
-- ─────────────────────────────────────────────
drop policy if exists "Admin full access – weekly_plans" on weekly_plans;
drop policy if exists "Public read weekly_plans" on weekly_plans;

create policy "Staff org access - weekly_plans"
  on weekly_plans for all to authenticated
  using (organization_id = current_org_id() or is_super_user())
  with check (organization_id = current_org_id() or is_super_user());

-- ROLLBACK for this section only, if needed:
--   drop policy if exists "Staff org access - weekly_plans" on weekly_plans;
--   create policy "Admin full access – weekly_plans" on weekly_plans for all to authenticated using (true) with check (true);
--   create policy "Public read weekly_plans" on weekly_plans for select to anon using (true);


-- ─────────────────────────────────────────────
-- SECTION 4 — assigned_exercises
-- Expected end state: NO anonymous access. Same rationale as
-- weekly_plans. Scoped via its parent weekly_plans row rather than a
-- denormalized organization_id column of its own (see 0001 notes).
-- ─────────────────────────────────────────────
drop policy if exists "Admin full access – assigned_exercises" on assigned_exercises;
drop policy if exists "Public read assigned_exercises" on assigned_exercises;

create policy "Staff org access - assigned_exercises"
  on assigned_exercises for all to authenticated
  using (
    exists (
      select 1 from weekly_plans wp
      where wp.id = assigned_exercises.weekly_plan_id
        and (wp.organization_id = current_org_id() or is_super_user())
    )
  )
  with check (
    exists (
      select 1 from weekly_plans wp
      where wp.id = assigned_exercises.weekly_plan_id
        and (wp.organization_id = current_org_id() or is_super_user())
    )
  );

-- ROLLBACK for this section only, if needed:
--   drop policy if exists "Staff org access - assigned_exercises" on assigned_exercises;
--   create policy "Admin full access – assigned_exercises" on assigned_exercises for all to authenticated using (true) with check (true);
--   create policy "Public read assigned_exercises" on assigned_exercises for select to anon using (true);


-- ─────────────────────────────────────────────
-- SECTION 5 — activity_routines — OMITTED, NOT SKIPPED BY ACCIDENT.
-- Confirmed absent from production via the Milestone 1 Step 1 inventory
-- (to_regclass('public.activity_routines') returned NULL). There is
-- nothing to apply here: no table exists to alter or write a policy
-- against, and attempting to would abort this migration. See schema.sql
-- section 8 and 0001's note for the full explanation. If this table is
-- ever deliberately introduced later, its RLS should follow the same
-- org-scoped pattern as Section 2 (exercises), including the same
-- temporary-anon-read caveat documented in this file's header.
-- ─────────────────────────────────────────────


-- ─────────────────────────────────────────────
-- SECTION 6 — new tables' own policies
-- ─────────────────────────────────────────────

-- organizations: staff can see their own academy; Super User sees all.
-- No write policy yet (org settings editing is out of Milestone 1 scope).
create policy "Staff read own organization"
  on organizations for select to authenticated
  using (id = current_org_id() or is_super_user());

-- staff_profiles: CLIENT READ-ONLY in Milestone 1. A staff member can
-- always read their own row; an administrator (or any staff role — read
-- access is not differentiated by role yet, only by org) can read every
-- row in their own org; Super User reads all.
create policy "Staff read own or org profiles"
  on staff_profiles for select to authenticated
  using (
    auth_user_id = auth.uid()
    or organization_id = current_org_id()
    or is_super_user()
  );

-- No INSERT/UPDATE/DELETE policy is created for staff_profiles at all.
-- Milestone 1 ships no feature that needs to mutate it (the migration
-- backfill in 0002 runs as a privileged/superuser connection, which is
-- unaffected by RLS either way). Controlled mutation — invite, role change,
-- deactivate/reactivate — is deferred to Phase 2's Server Actions, which
-- will run under a privileged server-side context with an explicit
-- allow-list of mutable fields, rather than a raw client-writable RLS
-- policy. Even once that path exists, the identity-protection trigger
-- added in 0001 (protect_staff_profile_identity_fields) remains as an
-- independent backstop: no writer, however it becomes authorized, can
-- change auth_user_id, organization_id, created_at, invited_by, or
-- invited_at on an existing row — regardless of how permissive a future
-- policy might turn out to be. An Administrator can therefore never move a
-- staff record between organizations or alter its identity through any
-- direct Supabase request, today or later.

-- platform_admins: self-read only. No write policy for anyone — the only
-- way to add/remove a row is a trusted direct SQL connection.
create policy "Super user reads own record"
  on platform_admins for select to authenticated
  using (auth_user_id = auth.uid());

-- audit_events: administrators read their own org's events; Super User
-- reads all. No write policy for anyone — all writes go through
-- log_audit_event() only.
create policy "Administrator reads org audit events"
  on audit_events for select to authenticated
  using (organization_id = current_org_id() or is_super_user());

-- athlete_access_attempts: intentionally NO policies at all (see 0001).
