-- ============================================================
-- Milestone 2 (activity_routines) — Verification checklist (manual, run
-- against the target Supabase project after each rollout step)
-- ============================================================
-- These are NOT automated tests — see run_migration_tests.mjs for the
-- automated PGlite coverage (npm run test:db), which exercises this exact
-- sequence locally. This file is for confirming the SAME expectations
-- against the real target project by hand, the same way
-- milestone1_checks.sql does for Milestone 1. Run the "as anon" / "as
-- athlete" blocks using ONLY the project's anon key (PostgREST/curl, or
-- the SQL editor's "Run as" role switcher) — never the SQL editor's
-- default postgres/service-role connection, which bypasses RLS entirely
-- and would give false negatives.
-- ============================================================

-- ── After 0004 (schema only), BEFORE 0005 (RLS + RPC) ─────────────────

-- Expect: a non-null regclass (table now exists)
select to_regclass('public.activity_routines');

-- Expect: true (RLS is enabled)
select relrowsecurity from pg_class where relname = 'activity_routines';

-- Expect: 0 policies (nothing created yet — table is default-deny for
-- EVERYONE, including authenticated staff, until 0005 runs)
select count(*) from pg_policies where tablename = 'activity_routines';

-- As an authenticated staff member: expect 0 rows (not an error) — RLS
-- enabled with zero policies filters everything out.
--   select * from activity_routines;

-- ── After 0005 (RLS + RPC) ─────────────────────────────────────────────

-- Expect: exactly 1 policy ("Staff org access - activity_routines")
select policyname from pg_policies where tablename = 'activity_routines';

-- Expect: get_athlete_routines exists.
select routine_name from information_schema.routines
  where routine_name = 'get_athlete_routines';

-- EXECUTE privilege check — use has_function_privilege() rather than
-- counting rows in information_schema.routine_privileges. That view also
-- lists the function's OWNER as an implicit grantee (ownership carries all
-- privileges regardless of any explicit GRANT), so "exactly one row" is
-- NOT a valid test — it was wrongly specified that way in an earlier draft
-- of this checklist and has been corrected here. The actual security
-- property to verify is per-role, not a row count:
select has_function_privilege('anon', 'get_athlete_routines(text, activity_type[], exercise_category)', 'EXECUTE');
-- Expect: true

select has_function_privilege('authenticated', 'get_athlete_routines(text, activity_type[], exercise_category)', 'EXECUTE');
-- Expect: false

select has_function_privilege('public', 'get_athlete_routines(text, activity_type[], exercise_category)', 'EXECUTE');
-- Expect: false (PUBLIC was explicitly revoked in 0005, before the anon
-- grant was added)

-- As an authenticated staff member (your own org): expect to see and be
-- able to insert/delete only YOUR org's rows.
--   select * from activity_routines;                          -- own org only
--   insert into activity_routines (organization_id, activity, session_type, exercise_id)
--     values ('<your-org-id>', 'pitching', 'strength', '<an-exercise-id>');   -- succeeds
--   insert into activity_routines (organization_id, activity, session_type, exercise_id)
--     values ('<SOME OTHER org-id>', 'pitching', 'strength', '<an-exercise-id>'); -- REJECTED

-- As anon, directly against the table: expect 0 rows / rejected — there is
-- NO anon table policy, by design.
--   select * from activity_routines;                          -- expect: 0 rows

-- As anon, via the RPC with a REAL active access_code from your project:
-- expect rows scoped to THAT athlete's organization only.
--   select * from get_athlete_routines('<REAL_ACTIVE_CODE>', array['pitching']::activity_type[], 'strength');

-- As anon, via the RPC with a bogus code: expect 0 rows, no error, no
-- indication of whether the code exists (same shape as an empty routine).
--   select * from get_athlete_routines('ZZZZZZ', array['pitching']::activity_type[], 'strength');

-- Cross-org isolation (requires a second organization/athlete to exist in
-- the target project): confirm an athlete's code from org A never returns
-- a row whose exercise/routine was created under org B, even for the same
-- activity/session_type combination org B also populated.

-- Duplicate mapping: expect the SECOND identical insert to be REJECTED.
--   insert into activity_routines (organization_id, activity, session_type, exercise_id)
--     values ('<org-id>', 'pitching', 'strength', '<same-exercise-id>');  -- succeeds once
--   -- repeating the exact same statement again -> expect a unique-constraint violation

-- Same exercise, different orgs, same slot: expect BOTH inserts to succeed
-- (organization_id is part of the unique constraint).
--   insert into activity_routines (organization_id, activity, session_type, exercise_id)
--     values ('<org-A-id>', 'catching', 'mobility', '<shared-global-exercise-id>');
--   insert into activity_routines (organization_id, activity, session_type, exercise_id)
--     values ('<org-B-id>', 'catching', 'mobility', '<shared-global-exercise-id>');


-- ── Application-level checks (manual UI pass) ─────────────────────────

-- Admin: /admin/routines shows per-slot counts without error; opening a
-- slot, adding an exercise, and removing it all work and persist across
-- a reload; a genuine load failure (e.g. simulate by revoking a grant
-- temporarily) shows a visible error state, NOT a silent "0 exercises".

-- Athlete: /athlete/[code] -> pick activity/activities -> pick session
-- type -> (pre/post + multiple activities -> pick primary) -> routine view
-- renders real exercises (not "NO EXERCISES YET") when the org has
-- routines configured for that slot; a genuine RPC failure shows a
-- distinct error state, not the same empty-state copy used for a
-- genuinely empty routine.
