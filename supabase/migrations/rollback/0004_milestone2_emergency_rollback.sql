-- ============================================================
-- Emergency rollback for 0004_milestone2_activity_routines_schema.sql
-- ============================================================
-- Removes, in full, everything 0004 added:
--   - activity_routines (and, with it, ALL routine data — this IS a
--     data-loss operation, unlike 0005's rollback)
--   - its trigger, activity_routines_exercise_org_guard (dropped
--     implicitly: triggers belong to the table and disappear with it —
--     see the DROP TABLE note below)
--   - the trigger function it called, enforce_activity_routine_exercise_org()
--     (dropped explicitly below — see why this one needs an explicit drop
--     while the trigger itself does not)
--   - the activity_type enum
-- Does NOT touch any Milestone 1 (0001/0002/0003) object — athletes,
-- exercises, weekly_plans, assigned_exercises, organizations,
-- staff_profiles, platform_admins, audit_events, athlete_access_attempts
-- and all their policies/functions/triggers are completely untouched.
--
-- RUN 0005's ROLLBACK FIRST if it has been applied. Dropping the table
-- directly also drops any policies attached to it (policies belong to the
-- table, not the other way around) with no CASCADE needed for that part.
-- The get_athlete_routines() function from 0005 is NOT automatically
-- dropped by this file — Postgres does not track a hard dependency on a
-- table referenced only inside a plpgsql function body, so if 0005 was
-- applied and its rollback was skipped, get_athlete_routines() would be
-- left behind as a dangling function that errors at call time once the
-- table is gone. Always roll back 0005 before 0004 to avoid that.
--
-- enforce_activity_routine_exercise_org() is different from
-- get_athlete_routines() in exactly this respect, which is why THIS file
-- (unlike 0005's rollback) does explicitly drop it: it was only ever
-- reachable as activity_routines' own trigger function, with no other
-- caller and no purpose independent of that table, so there is no
-- scenario where leaving it behind is useful the way leaving
-- get_athlete_routines() behind temporarily (pending 0005's rollback)
-- might be tolerated. The DROP FUNCTION below is ordered AFTER DROP TABLE
-- specifically so the table-owned trigger referencing this function is
-- already gone by the time the function itself is dropped.
--
-- NO CASCADE is used or needed here: nothing else in the schema holds a
-- foreign key INTO activity_routines (it only references OUT to
-- organizations and exercises), so a plain DROP TABLE is sufficient and
-- cannot ripple into unrelated objects.
-- ============================================================

BEGIN;

drop table if exists activity_routines;

drop function if exists enforce_activity_routine_exercise_org();

drop type if exists activity_type;

COMMIT;
