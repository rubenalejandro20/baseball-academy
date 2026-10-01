-- ============================================================
-- Milestone 2 — Activity Routines (schema only, additive)
-- ============================================================
-- Resolves the Milestone 1 Step 1 finding recorded in schema.sql §8 and
-- MILESTONE1_STATUS.md: `activity_routines` was documented (commented out
-- in schema.sql) and queried unconditionally by application code
-- (src/app/admin/routines/*, src/app/athlete/[code]/page.tsx), but was
-- never actually created in production. This migration creates it for
-- real, as an organization-scoped table from day one — unlike the
-- Milestone 1 tables, there is no pre-existing production data to backfill
-- here, so no separate "schema then backfill" split is needed the way
-- 0001/0002 required.
--
-- DO NOT RUN AGAINST PRODUCTION YET. This is local-repo/local-test-only
-- work pending review. See MILESTONE1_STATUS.md for the review gate this
-- must pass before manual production application.
--
-- SAFE, ADDITIVE, DOES NOT TOUCH MILESTONE 1: every statement here is a
-- new enum / new table / new index. It does not alter athletes, exercises,
-- weekly_plans, assigned_exercises, organizations, staff_profiles,
-- platform_admins, audit_events, athlete_access_attempts, or any of their
-- existing policies/functions/triggers from 0001/0002/0003 — none of those
-- files are modified or re-run by this one.
--
-- STAGED ROLLOUT, MIRRORING THE 0001 -> 0003 PATTERN: RLS is enabled here
-- with ZERO policies for any role (default-deny), for BOTH `authenticated`
-- and `anon` — nobody can read or write this table yet after this file
-- alone. The staff policy and the athlete-facing RPC are added separately
-- in 0005_milestone2_activity_routines_rls_rpc.sql, so the "table exists
-- but is reachable by no one" state is itself a safe, reviewable
-- intermediate checkpoint.
--
-- Wrapped in BEGIN/COMMIT (all statements here are transaction-safe) and
-- hardened for rerunnability the same way 0001 was: CREATE TYPE has no
-- IF NOT EXISTS form, so it's guarded with a DO block; the table and index
-- use IF NOT EXISTS.
--
-- HARDENED after pre-production senior-engineer review: a trigger-based
-- cross-organization exercise integrity guard was added (section 3 below)
-- before this file was ever applied anywhere — see that section's comment
-- for the full rationale (why a trigger rather than a composite FK or a
-- CHECK constraint).
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. ACTIVITY TYPE ENUM
--    Matches the ActivityType union already declared in src/lib/types.ts
--    and the values already used throughout the admin/athlete UI
--    (ACTIVITIES constant): pitching, catching, hitting, fielding.
-- ─────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'activity_type') then
    create type activity_type as enum ('pitching', 'catching', 'hitting', 'fielding');
  end if;
end $$;

-- ─────────────────────────────────────────────
-- 2. ACTIVITY_ROUTINES TABLE
--
--    Reconstructed from the commented-out design in schema.sql §8, plus
--    the organization_id requirement the app's own insert code already
--    imposes (src/app/admin/routines/[activity]/[sessionType]/page.tsx
--    already sends organization_id: staffContext.organizationId on every
--    insert, unconditionally — this table has no "global/shared routine"
--    concept the way exercises.organization_id (nullable) does).
--
--    UNIQUE constraint is (organization_id, activity, session_type,
--    exercise_id) rather than schema.sql §8's original
--    (activity, session_type, exercise_id) — without organization_id in
--    the constraint, two different organizations could never both map the
--    same shared/global exercise (exercises.organization_id IS NULL) to
--    the same activity/session slot, which must be allowed.
--
--    exercise_id -> exercises(id) ON DELETE CASCADE: matches schema.sql
--    §8's original assumption, and matches app behavior — the UI does a
--    non-null assertion (`routine.exercise!`) on the joined exercise, i.e.
--    it never expects an activity_routines row to outlive its exercise.
--
--    organization_id -> organizations(id) ON DELETE RESTRICT: matches the
--    FK behavior already chosen for staff_profiles in 0001 — an
--    organization should not be deletable out from under rows that still
--    reference it.
-- ─────────────────────────────────────────────
create table if not exists activity_routines (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  activity               activity_type NOT NULL,
  session_type           exercise_category NOT NULL,
  exercise_id            UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  sets_override          INTEGER,
  reps_override          INTEGER,
  duration_sec_override  INTEGER,
  notes                  TEXT,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, activity, session_type, exercise_id)
);

-- Matches the exact filter/order shape used by every read site: admin's
-- slot page (.eq('activity').eq('session_type').order('sort_order')), the
-- admin list page's per-slot counts, and the athlete-facing RPC added in
-- 0005 (organization_id + activity [IN] + session_type, ordered by
-- activity then sort_order).
create index if not exists activity_routines_lookup_idx
  on activity_routines (organization_id, activity, session_type, sort_order);

-- ─────────────────────────────────────────────
-- 3. CROSS-ORGANIZATION EXERCISE INTEGRITY GUARD (trigger)
--
--    A plain FOREIGN KEY on exercise_id only guarantees the referenced
--    exercise EXISTS — it says nothing about which organization that
--    exercise belongs to. Without this guard, nothing in the schema would
--    stop an activity_routines row from mapping org A's activity/session
--    slot to an exercise privately owned by org B.
--
--    WHY A TRIGGER, NOT A COMPOSITE FOREIGN KEY OR A CHECK CONSTRAINT:
--    The natural-looking alternative — a composite FK
--      (organization_id, exercise_id) REFERENCES exercises(organization_id, id)
--    — cannot express this table's actual rule. exercises.organization_id
--    is nullable (NULL = shared/global exercise, usable by EVERY
--    organization — see 0001's note on exercises.organization_id). A
--    composite FK only matches when the child's value equals the parent's
--    value; it has no way to say "OR the parent's organization_id is
--    NULL", so it would incorrectly REJECT the legitimate, required case
--    of an org attaching a shared/global exercise to one of its routine
--    slots. A CHECK constraint is even less capable here: CHECK
--    constraints cannot query another table at all. A BEFORE INSERT/UPDATE
--    trigger is the smallest mechanism in Postgres that can express
--    "allowed if the exercise belongs to the SAME org, OR the exercise
--    belongs to NO org" — exactly this table's rule — and it follows the
--    exact pattern already established in 0001
--    (prevent_last_administrator_removal/_delete,
--    protect_staff_profile_identity_fields) for business rules that
--    neither a FK nor RLS alone can express.
--
--    SECURITY DEFINER is required here (unlike 0001's staff_profiles
--    triggers, which only ever read OLD/NEW and need no elevated access):
--    this function must read the TRUE organization_id of the referenced
--    exercise regardless of whether the CALLING role's own RLS view of
--    `exercises` would show that row. Without SECURITY DEFINER, an org A
--    staff member's own "Staff org access - exercises" policy (0003)
--    would hide an org B-owned exercise from this lookup entirely, making
--    it resolve to "no row found" — which this guard would then
--    (incorrectly) treat the same as "nothing to compare", silently
--    defeating the check for exactly the cross-org case it exists to
--    catch. SECURITY DEFINER plus a fully schema-qualified, empty
--    search_path read of exercises gets the real answer irrespective of
--    the caller's own row visibility.
--
--    Enforced on BOTH insert AND update: repointing an existing row's
--    exercise_id (or organization_id) into a mismatched pair must be
--    caught the same way as inserting one in the first place.
-- ─────────────────────────────────────────────
create or replace function enforce_activity_routine_exercise_org()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_exercise_org_id uuid;
begin
  select organization_id into v_exercise_org_id
    from public.exercises
    where id = new.exercise_id;

  if v_exercise_org_id is not null and v_exercise_org_id <> new.organization_id then
    raise exception
      'activity_routines.organization_id (%) does not match exercises.organization_id (%) for exercise_id % — a routine may only reference its own organization''s exercises or a shared/global exercise (exercises.organization_id IS NULL)',
      new.organization_id, v_exercise_org_id, new.exercise_id;
  end if;

  return new;
end;
$$;

revoke execute on function enforce_activity_routine_exercise_org() from public;
-- No explicit grant to anyone: trigger invocation does not require the
-- DML-issuing role to hold EXECUTE on the trigger function (see 0001's
-- identical note for prevent_last_administrator_removal/_delete and
-- protect_staff_profile_identity_fields) — it fires regardless of which
-- role or policy authorized the INSERT/UPDATE itself.

drop trigger if exists activity_routines_exercise_org_guard on activity_routines;
create trigger activity_routines_exercise_org_guard
  before insert or update on activity_routines
  for each row execute procedure enforce_activity_routine_exercise_org();

alter table activity_routines enable row level security;
-- No policies yet, for authenticated OR anon — added deliberately in
-- 0005_milestone2_activity_routines_rls_rpc.sql. Until that file runs,
-- this table is unreachable by everyone (default-deny), including staff.

COMMIT;
