-- ============================================================
-- Milestone 2 — Activity Routines: RLS + athlete RPC
-- ============================================================
-- Run AFTER 0004_milestone2_activity_routines_schema.sql. Adds the staff
-- org-scoped RLS policy on activity_routines, and a SECURITY DEFINER RPC
-- (get_athlete_routines) that gives the anonymous athlete PIN portal a
-- safe way to read routine data WITHOUT any anonymous table-level SELECT
-- policy on activity_routines — none is created here, deliberately.
--
-- DO NOT RUN AGAINST PRODUCTION YET. Local-repo/local-test-only pending
-- review, same as 0004.
--
-- WHY NO ANON TABLE POLICY (this is the central design decision):
-- The old, never-applied design in schema.sql §8 included
--   CREATE POLICY "Public read activity_routines" ON activity_routines
--     FOR SELECT TO anon USING (TRUE);
-- Reusing that policy verbatim would reproduce, in a WORSE form, the exact
-- cross-org data leak already flagged and deliberately left open (as a
-- required future fix, not an oversight) for `exercises` in
-- 0003_milestone1_rls.sql Section 2: any anonymous caller — including one
-- calling PostgREST directly with just the public anon key, no PIN
-- required at all — could read every organization's entire routine
-- library. That is strictly worse than the exercises case, which at least
-- only exposes generic exercise-library content with no organization
-- boundary implied by the UI. This migration does not repeat that mistake:
-- activity_routines gets NO anon policy, full stop. All athlete access
-- goes through get_athlete_routines() below, which derives the caller's
-- organization_id itself from a server-validated access code and never
-- trusts anything the browser claims about which organization it belongs
-- to.
--
-- Wrapped in BEGIN/COMMIT; policy/function creation is idempotent via
-- DROP POLICY IF EXISTS / CREATE OR REPLACE FUNCTION, matching 0003/0001's
-- conventions.
--
-- HARDENED after pre-production senior-engineer review: get_athlete_routines
-- now also filters the joined exercise by organization (e.organization_id =
-- v_org_id OR e.organization_id IS NULL), as defense-in-depth alongside the
-- 0004 trigger guard. The 0004 trigger is what PREVENTS a mismatched row
-- from ever being written; this RPC-level filter is what guarantees the
-- athlete-facing read path can never SURFACE a mismatched exercise even if
-- one somehow existed (pre-trigger legacy data, a manual/service-role edit,
-- a future bug) — belt-and-suspenders, not a substitute for the trigger.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. STAFF RLS POLICY — org-scoped, matching the athletes/weekly_plans
--    pattern from 0003 Section 1/3 (NOT the exercises pattern, since
--    activity_routines.organization_id is NOT NULL — there is no
--    global/shared-routine concept for staff to write to).
-- ─────────────────────────────────────────────
drop policy if exists "Staff org access - activity_routines" on activity_routines;

create policy "Staff org access - activity_routines"
  on activity_routines for all to authenticated
  using (organization_id = current_org_id() or is_super_user())
  with check (organization_id = current_org_id() or is_super_user());

-- No anon policy on this table. See header note above.

-- ─────────────────────────────────────────────
-- 2. ATHLETE ROUTINE RPC
--
--    Mirrors get_athlete_by_code()'s trust model exactly: the caller
--    supplies an access code (not an organization id), and the function
--    itself resolves that code to an active athlete and that athlete's
--    organization_id server-side, via a SECURITY DEFINER query that
--    bypasses activity_routines' RLS by design (the whole point is that
--    anon has no table-level access at all). The browser cannot supply or
--    influence organization_id in any way — there is no such parameter.
--
--    Returns the routine row's own fields PLUS the joined exercise's
--    fields (flattened, ex_-prefixed, since a plpgsql function returns
--    tabular rows rather than a nested object) — includes the exercise's
--    full column set (not just the minimal subset get_athlete_by_code
--    uses for athletes) because exercise-library content carries no
--    athlete PII and the app already serves ALL active exercises to anon
--    directly via the existing (Milestone 1, intentionally temporary)
--    "Public read exercises" policy. No new exposure is introduced by
--    returning the same fields through this RPC instead.
--
--    No rate limiting / athlete_access_attempts logging here, unlike
--    get_athlete_by_code / update_athlete_photo_by_code. Those exist to
--    throttle CODE-GUESSING (an attacker without a valid code trying many
--    codes). This RPC requires an ALREADY-VALID code to return anything
--    non-empty, discloses no athlete PII, and an invalid code silently
--    returns zero rows exactly like an empty routine — there is no
--    incremental guessing surface here beyond what get_athlete_by_code
--    itself already gates. If that assessment ever changes (e.g. this
--    RPC starts returning athlete-identifying data), it should gain the
--    same rate-limiting treatment.
--
--    DEFENSE-IN-DEPTH ORG CHECK ON THE EXERCISE JOIN: the WHERE clause
--    below requires e.organization_id = v_org_id OR e.organization_id IS
--    NULL, in addition to ar.organization_id = v_org_id. Under normal
--    operation this is redundant with the 0004 trigger guard (which
--    already prevents such a row from being written in the first place),
--    but this RPC is the athlete-facing read boundary, so it does not rely
--    SOLELY on write-time enforcement elsewhere remaining intact forever —
--    if a mismatched row ever existed for any reason, this condition
--    guarantees it is silently excluded here rather than leaked to an
--    athlete in the wrong organization.
--
--    SEARCH-PATH HARDENING: search_path = '' with every reference fully
--    schema-qualified, matching every other SECURITY DEFINER function in
--    0001.
-- ─────────────────────────────────────────────
create or replace function get_athlete_routines(
  p_code text,
  p_activities activity_type[],
  p_session_type exercise_category
)
returns table(
  id                     uuid,
  activity               activity_type,
  session_type           exercise_category,
  exercise_id            uuid,
  sets_override          integer,
  reps_override          integer,
  duration_sec_override  integer,
  notes                  text,
  sort_order             integer,
  created_at             timestamptz,
  ex_id                  uuid,
  ex_name                text,
  ex_category            exercise_category,
  ex_description         text,
  ex_sets                integer,
  ex_reps                integer,
  ex_duration_sec        integer,
  ex_video_url           text,
  ex_is_active           boolean,
  ex_created_at          timestamptz,
  ex_updated_at          timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_code   text := upper(trim(coalesce(p_code, '')));
  v_org_id uuid;
begin
  if length(v_code) = 0 or length(v_code) > 12
     or p_activities is null or array_length(p_activities, 1) is null
     or p_session_type is null
  then
    return;
  end if;

  -- Resolve the caller's organization SERVER-SIDE from the validated code.
  -- The browser never supplies organization_id; there is no such
  -- parameter for it to spoof. An invalid/inactive code resolves to NULL
  -- here and the function returns zero rows below — same shape as a
  -- genuinely empty routine, no information leak about code validity.
  select a.organization_id into v_org_id
    from public.athletes a
    where a.access_code = v_code and a.is_active = true;

  if v_org_id is null then
    return;
  end if;

  return query
    select
      ar.id, ar.activity, ar.session_type, ar.exercise_id,
      ar.sets_override, ar.reps_override, ar.duration_sec_override,
      ar.notes, ar.sort_order, ar.created_at,
      e.id, e.name, e.category, e.description, e.sets, e.reps,
      e.duration_sec, e.video_url, e.is_active, e.created_at, e.updated_at
    from public.activity_routines ar
    join public.exercises e on e.id = ar.exercise_id
    where ar.organization_id = v_org_id            -- NEVER caller-supplied
      and (e.organization_id = v_org_id or e.organization_id is null)  -- defense-in-depth, see header note
      and ar.activity = any(p_activities)
      and ar.session_type = p_session_type
    order by ar.activity, ar.sort_order;
end;
$$;

-- ─────────────────────────────────────────────
-- 3. EXPLICIT EXECUTE PRIVILEGES — revoke the PUBLIC default first, then
--    grant only to anon (the sole intended caller, mirroring
--    get_athlete_by_code / update_athlete_photo_by_code exactly). Staff
--    never need this path — they have full RLS-scoped table access to
--    activity_routines already via the policy above.
-- ─────────────────────────────────────────────
revoke execute on function get_athlete_routines(text, activity_type[], exercise_category) from public;
grant execute on function get_athlete_routines(text, activity_type[], exercise_category) to anon;

COMMIT;
