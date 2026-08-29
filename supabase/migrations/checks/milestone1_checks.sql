-- ============================================================
-- Milestone 1 — Verification checklist (manual, run against the
-- target Supabase project after each rollout step)
-- ============================================================
-- These are NOT automated tests — there is no CI/local Supabase instance
-- wired up for this project (see the implementation report for why). Run
-- each block by hand: the "as anon" blocks must be run using ONLY the
-- project's anon key (e.g. via `curl` against the PostgREST endpoint, or
-- the Supabase SQL editor's "Run as" role switcher, NOT the SQL editor's
-- default postgres/service role connection, which bypasses RLS entirely
-- and would give false negatives).
--
-- CORRECTED EXPECTATION (do not test for "all anonymous access fails"):
-- exercises intentionally KEEPS anonymous SELECT during the PIN-bridge
-- period. Only athletes / weekly_plans / assigned_exercises are expected
-- to fully reject anonymous access. activity_routines does not exist in
-- production (confirmed via Step 1 inventory) — there is nothing to check
-- for it; if that ever changes, treat it like exercises.
-- ============================================================

-- ── After 0002 Part A (backfill), BEFORE Part B (staff onboarding) ────

-- Expect: exactly 0 rows (no staff onboarded yet at this point)
select count(*) from staff_profiles;

-- ── After 0002 Part B (staff onboarding), BEFORE 0003 (RLS) ───────────

-- Expect: 0
select count(*) as staff_profiles_missing_org from staff_profiles where organization_id is null;
-- Expect: 0
select count(*) as athletes_missing_org from athletes where organization_id is null;
-- Expect: 0
select count(*) as weekly_plans_missing_org from weekly_plans where organization_id is null;
-- Expect: one row per distinct auth_user_id (no duplicates)
select auth_user_id, count(*) from staff_profiles group by 1 having count(*) > 1;
-- Eyeball every row: expect ONLY the account(s) you deliberately onboarded
-- via Step B1 (and, only if you explicitly chose to, Step B2). The
-- never-signed-in second account must have NO row here unless you made a
-- deliberate, informed decision to add one.
select id, auth_user_id, email, full_name, role, is_active, organization_id from staff_profiles;
-- Cross-check explicitly: this must return 0 rows unless you intentionally
-- ran Step B2 for it.
select * from staff_profiles sp
join auth.users u on u.id = sp.auth_user_id
where u.last_sign_in_at is null;
-- Expect: exactly the platform owner's account, after the manual step in 0002
select pa.auth_user_id, u.email from platform_admins pa join auth.users u on u.id = pa.auth_user_id;


-- ── After each SECTION of 0003 (RLS), per-table expectations ─────────
-- Run these "as anon" (see header note above).

-- SECTION 1 — athletes: expect ALL of these to be REJECTED / return 0 rows.
--   select * from athletes limit 1;
--   update athletes set full_name = 'x' where id = '<any-id>';
-- Expect: SUCCEEDS and returns only {id, full_name, position, photo_url}
-- for a real, active access_code — run via the RPC, not the table:
--   select * from get_athlete_by_code('<REAL_ACTIVE_CODE>', null);
-- Expect: after 10 rapid calls with a WRONG code, the 11th raises
-- "Too many attempts" within the same 10-minute window:
--   select * from get_athlete_by_code('ZZZZZZ', null); -- repeat 11x

-- SECTION 2 — exercises: expect SELECT of active rows to still SUCCEED anonymously.
--   select id, name from exercises where is_active = true limit 1;   -- expect: rows returned
-- Expect: INSERT/UPDATE/DELETE anonymously REJECTED.
--   insert into exercises (name, category) values ('x', 'mobility'); -- expect: rejected

-- SECTION 3 — weekly_plans: expect ALL anonymous access REJECTED.
--   select * from weekly_plans limit 1;   -- expect: 0 rows / rejected

-- SECTION 4 — assigned_exercises: expect ALL anonymous access REJECTED.
--   select * from assigned_exercises limit 1;   -- expect: 0 rows / rejected

-- SECTION 5 — activity_routines: N/A. Table confirmed absent from
-- production; nothing to check. Confirm it's still absent (i.e. nothing
-- upstream accidentally created it):
--   select to_regclass('public.activity_routines');   -- expect: null

-- SECTION 6 — staff_profiles / platform_admins / audit_events / organizations
-- Run these as the migrated administrator's authenticated session:
--   select * from staff_profiles;               -- expect: sees own org's roster only
--   select * from organizations;                 -- expect: sees own org only
--   select * from audit_events;                  -- expect: sees own org's events only
-- Run as anon:
--   select * from platform_admins;                -- expect: 0 rows (no self-match)
--   select * from staff_profiles;                  -- expect: 0 rows / rejected
--   select * from audit_events;                    -- expect: 0 rows / rejected


-- ── Business-logic checks ─────────────────────────────────────────────

-- Last-administrator guard: with exactly one active administrator in the org,
-- expect this to raise an exception, NOT succeed:
--   update staff_profiles set is_active = false
--   where organization_id = '<org-id>' and role = 'administrator';
-- Then insert/promote a second active administrator in the same org and
-- retry the same statement against the FIRST administrator — expect success.

-- Audit trigger: change a staff member's role or is_active, then confirm a
-- matching row appears automatically:
--   select * from audit_events where target_type = 'staff_profile' order by created_at desc limit 5;
