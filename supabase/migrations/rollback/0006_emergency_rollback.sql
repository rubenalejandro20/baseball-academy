-- ============================================================
-- Emergency rollback for 0006_exercise_anon_policy_removal.sql
-- ============================================================
-- Recreates the exact previous policy, verbatim, restoring anonymous
-- SELECT access to active exercises across ALL organizations. This is a
-- pure access-control toggle — no table, column, or row is ever touched
-- by 0006 or by this rollback, so there is no data-loss risk either way.
--
-- Does NOT touch the staff policy ("Staff org access - exercises") or any
-- other object from 0001/0002/0003/0004/0005 — this file only restores
-- the single policy 0006 removed.
--
-- Run this if, after deploying 0006, something unexpected depends on
-- anonymous direct table access to exercises (see 0006's own header for
-- why inspection found no such dependency in this codebase, and the
-- residual out-of-band-caller caveat that can't be ruled out from code
-- alone).
-- ============================================================

BEGIN;

drop policy if exists "Public read exercises" on exercises;

create policy "Public read exercises"
  on exercises for select to anon
  using (is_active = true);

COMMIT;
