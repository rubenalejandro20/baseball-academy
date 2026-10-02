-- ============================================================
-- Emergency rollback for 0005_milestone2_activity_routines_rls_rpc.sql
-- ============================================================
-- Reverses ONLY the RLS policy and RPC added by 0005. Leaves the
-- activity_routines table, activity_type enum, and all its data fully
-- intact — this is a policy/function-only rollback, not a data-loss
-- operation. Does NOT touch any Milestone 1 (0001/0002/0003) object.
--
-- Run this BEFORE 0004's rollback if you intend to fully remove Milestone
-- 2 (0005's objects depend on 0004's table/enum existing; there is no
-- reverse dependency, so this file alone is also a safe, complete
-- rollback if you only want to revoke RLS/RPC access while keeping the
-- table and its data for later re-enablement).
--
-- After this runs: activity_routines still exists, RLS is still enabled
-- on it, but with ZERO policies again (default-deny for everyone,
-- including staff) — the same safe intermediate state 0004 alone leaves
-- it in. No anon table policy existed before this rollback and none is
-- added by it.
-- ============================================================

BEGIN;

-- DROP FUNCTION removes the object and its grants together; no separate
-- REVOKE step is needed (and REVOKE has no IF EXISTS form in Postgres).
drop function if exists get_athlete_routines(text, activity_type[], exercise_category);

drop policy if exists "Staff org access - activity_routines" on activity_routines;

COMMIT;
