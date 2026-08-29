-- ============================================================
-- 🛑 EMERGENCY ROLLBACK for 0001_milestone1_schema.sql ONLY
-- DO NOT RUN UNLESS STEP 2 (applying 0001) FAILED OR MUST BE UNDONE.
-- ============================================================
-- SCOPE: this rollback is valid ONLY if 0001 is the last Milestone 1
-- migration applied — i.e., 0002 and 0003 have NOT been run yet. If 0002
-- or 0003 have already been applied on top of 0001, this script will fail
-- (0003's RLS policies reference the functions this script drops, and
-- Postgres tracks that as a real catalog dependency) — a different,
-- later-stage rollback is required at that point instead.
--
-- Removes everything 0001 added: the 5 new tables, the 3 columns it added
-- to existing tables, the 10 functions, and the staff_role enum. Does NOT
-- touch athletes/exercises/weekly_plans/assigned_exercises data, existing
-- RLS policies, auth.users, or storage configuration.
--
-- Ordered specifically to require ZERO use of CASCADE — every DROP is
-- preceded by removing whatever would otherwise block it (see comments),
-- so there is no possibility of a CASCADE reaching into a pre-existing
-- production object.
--
-- Wrapped in a transaction: if any statement here fails, nothing commits
-- and production is left exactly as it was, not partially rolled back.
-- ============================================================

BEGIN;

-- 1. Drop the columns 0001 added to EXISTING tables first. This removes
--    their foreign-key references to `organizations` — necessary so
--    `organizations` itself can be dropped later without CASCADE (a plain
--    DROP TABLE is blocked by ANY table still holding a FK to it,
--    including these three pre-existing production tables).
alter table athletes     drop column if exists organization_id;
alter table exercises    drop column if exists organization_id;
alter table weekly_plans drop column if exists organization_id;

-- 2. Drop the 5 new tables, in dependency order (the table being
--    referenced always comes AFTER the table(s) that reference it), so no
--    CASCADE is ever required:
--      - athlete_access_attempts: nothing references it. Drop anytime.
--      - audit_events: references organizations. Drop before organizations.
--      - staff_profiles: references organizations; self-references itself
--        via invited_by (never blocks dropping the same table). Drop
--        before organizations. Its 5 triggers are removed automatically
--        as part of dropping the table (triggers are owned by their
--        table, not blocked by RESTRICT).
--      - platform_admins: self-references itself via created_by (same
--        non-issue as above). No other table references it.
--      - organizations: dropped LAST, once nothing above still points to
--        it, so this succeeds with a plain DROP TABLE (no CASCADE).
drop table if exists athlete_access_attempts;
drop table if exists audit_events;
drop table if exists staff_profiles;
drop table if exists platform_admins;
drop table if exists organizations;

-- 3. Drop the 10 functions. By this point staff_profiles (and its
--    triggers) are already gone, so nothing still references these —
--    plain DROP FUNCTION works, no CASCADE needed.
drop function if exists get_athlete_by_code(text, text);
drop function if exists update_athlete_photo_by_code(text, text, text);
drop function if exists audit_staff_profile_changes();
drop function if exists protect_staff_profile_identity_fields();
drop function if exists prevent_last_administrator_delete();
drop function if exists prevent_last_administrator_removal();
drop function if exists log_audit_event(uuid, text, text, uuid, jsonb);
drop function if exists is_org_administrator();
drop function if exists is_super_user(uuid);
drop function if exists current_org_id();

-- 4. Drop the enum, now that staff_profiles (its only user) is gone.
drop type if exists staff_role;

-- Deliberately NOT included: dropping the "uuid-ossp" extension. It
-- already existed in production before this migration (confirmed in the
-- Step 1 inventory) and is used by the primary keys of the existing
-- tables — dropping it would be destructive far beyond undoing 0001.
--
-- Deliberately NOT included: DROP TRIGGER statements. Every trigger 0001
-- created lives on a table this script drops in step 2 — dropping the
-- table already removes its triggers; explicit DROP TRIGGER would either
-- be redundant or (if ordered wrong) error on an already-gone table.

COMMIT;
