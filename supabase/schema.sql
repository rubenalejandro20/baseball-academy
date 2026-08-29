-- ============================================================
-- Baseball Academy – Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- 1. ATHLETES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS athletes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name   TEXT NOT NULL,
  age         INTEGER,
  weight_lbs  NUMERIC(5, 1),
  position    TEXT,
  access_code TEXT UNIQUE NOT NULL,           -- PIN / code for QR access
  photo_url   TEXT,                           -- selfie uploaded by athlete
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 2. EXERCISE LIBRARY
-- ─────────────────────────────────────────────
CREATE TYPE exercise_category AS ENUM (
  'pre_training',
  'post_training',
  'recovery',
  'mobility',
  'strength',
  'injury_prevention'
);

CREATE TABLE IF NOT EXISTS exercises (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  category     exercise_category NOT NULL,
  description  TEXT,
  sets         INTEGER,
  reps         INTEGER,
  duration_sec INTEGER,                       -- duration in seconds (nullable)
  video_url    TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 3. WEEKLY PLANS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_plans (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id  UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,                  -- Monday of the week (ISO week)
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (athlete_id, week_start)
);

-- ─────────────────────────────────────────────
-- 4. ASSIGNED EXERCISES (line items inside a weekly plan)
-- ─────────────────────────────────────────────
CREATE TYPE day_of_week AS ENUM (
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
);

CREATE TABLE IF NOT EXISTS assigned_exercises (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  weekly_plan_id  UUID NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  exercise_id     UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  day             day_of_week NOT NULL,
  session_type    exercise_category NOT NULL,
  sets_override   INTEGER,                    -- override library defaults
  reps_override   INTEGER,
  duration_sec_override INTEGER,
  notes           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 5. UPDATED_AT TRIGGER (shared function)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER athletes_updated_at
  BEFORE UPDATE ON athletes
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER exercises_updated_at
  BEFORE UPDATE ON exercises
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER weekly_plans_updated_at
  BEFORE UPDATE ON weekly_plans
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE athletes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises          ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE assigned_exercises ENABLE ROW LEVEL SECURITY;

-- Admin (authenticated users) can do everything
CREATE POLICY "Admin full access – athletes"
  ON athletes FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "Admin full access – exercises"
  ON exercises FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "Admin full access – weekly_plans"
  ON weekly_plans FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "Admin full access – assigned_exercises"
  ON assigned_exercises FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- Public (athletes via QR code) can SELECT their own data by access_code
-- No auth token required – read is allowed via anon key
CREATE POLICY "Public read athletes by code"
  ON athletes FOR SELECT TO anon
  USING (is_active = TRUE);

CREATE POLICY "Public read exercises"
  ON exercises FOR SELECT TO anon
  USING (is_active = TRUE);

CREATE POLICY "Public read weekly_plans"
  ON weekly_plans FOR SELECT TO anon
  USING (TRUE);

CREATE POLICY "Public read assigned_exercises"
  ON assigned_exercises FOR SELECT TO anon
  USING (TRUE);

-- Allow anon to update photo_url on athletes (athlete selfie upload)
CREATE POLICY "Athlete can upload photo"
  ON athletes FOR UPDATE TO anon
  USING (TRUE) WITH CHECK (TRUE);

-- ─────────────────────────────────────────────
-- 7. STORAGE BUCKET for athlete photos
-- ─────────────────────────────────────────────
-- Run this in Dashboard → Storage, or uncomment if using API:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('athlete-photos', 'athlete-photos', TRUE);
--
-- ⚠️ CONFIRMED via Milestone 1 Step 1 production inventory: the
-- `athlete-photos` bucket exists (public = true) but storage.objects has
-- ZERO RLS policies of any kind in production. RLS is enabled by default
-- on storage.objects with no exceptions, so with no policies at all,
-- INSERT/UPDATE/DELETE (and any SELECT that isn't via the bucket's public
-- URL) are denied to every role, including anon. Practical effect: the
-- athlete selfie-upload feature cannot currently succeed in production —
-- `supabase.storage.from('athlete-photos').upload(...)` fails closed for
-- every caller. This is a pre-existing non-functional feature, not a
-- security hole (nothing is open) and not something Milestone 1 broke.
-- Deliberately NOT given a storage policy in Milestone 1 — see the
-- Milestone 1 report for why a real fix needs actual athlete identity
-- (the OTP phase), not a broad bucket-wide anon write policy.

-- ─────────────────────────────────────────────
-- 8. ACTIVITY ROUTINES
-- ─────────────────────────────────────────────
-- ⚠️ REPO/PRODUCTION DRIFT — CONFIRMED ABSENT IN PRODUCTION as of the
-- Milestone 1 Step 1 inventory (to_regclass('public.activity_routines')
-- returned NULL; the activity_type enum is also absent). This section was
-- never actually applied to the live database, even though the application
-- code (src/app/admin/routines/*, src/app/athlete/[code]/page.tsx) queries
-- this table unconditionally. Practical effect in production: those screens
-- silently show "no exercises yet" for everyone (supabase-js resolves
-- {data: null, error} rather than throwing, and the code does
-- `setRoutines(data ?? [])`) — a pre-existing, silent bug, not something
-- Milestone 1 introduces or is responsible for fixing.
--
-- Left here (commented out, not deleted) as a record of the intended
-- design. Milestone 1 deliberately does NOT create this table or enum —
-- doing so would be introducing a feature, not preserving one, which is
-- out of Milestone 1's scope. If/when this feature is deliberately
-- restored, that should be its own explicit, reviewed migration.
--
-- CREATE TYPE activity_type AS ENUM ('pitching', 'catching', 'hitting', 'fielding');
--
-- CREATE TABLE IF NOT EXISTS activity_routines (
--   id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--   activity              activity_type NOT NULL,
--   session_type          exercise_category NOT NULL,
--   exercise_id           UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
--   sets_override         INTEGER,
--   reps_override         INTEGER,
--   duration_sec_override INTEGER,
--   notes                 TEXT,
--   sort_order            INTEGER NOT NULL DEFAULT 0,
--   created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--   UNIQUE (activity, session_type, exercise_id)
-- );
--
-- ALTER TABLE activity_routines ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY "Admin full access – activity_routines"
--   ON activity_routines FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
--
-- CREATE POLICY "Public read activity_routines"
--   ON activity_routines FOR SELECT TO anon USING (TRUE);

-- ─────────────────────────────────────────────
-- 9. MILESTONE 1 — ORGANIZATIONS, STAFF ROLES, AUDIT, PIN-BRIDGE HARDENING
-- ─────────────────────────────────────────────
-- This file reflects the schema as it existed BEFORE Milestone 1 and is
-- kept as historical documentation of the original single-tenant schema.
-- Editing this file does NOT change the production database (see
-- CLAUDE.md). The actual, reviewable Milestone 1 changes live as ordered,
-- explicit migration files:
--
--   supabase/migrations/0001_milestone1_schema.sql    (additive schema)
--   supabase/migrations/0002_milestone1_backfill.sql  (data backfill)
--   supabase/migrations/0003_milestone1_rls.sql       (RLS cutover, section-by-section)
--   supabase/migrations/checks/milestone1_checks.sql  (manual verification queries)
--
-- Summary of what they introduce: `organizations` (the academy/tenant
-- root), `staff_profiles` (auth_user_id ↔ organization ↔ role, role =
-- administrator/coach/physician), `platform_admins` (Super User registry,
-- architecturally separate from any academy role — no INSERT/UPDATE/DELETE
-- policy is ever granted to anon/authenticated), `audit_events` (append-only,
-- written only via log_audit_event()), a nullable `organization_id` on
-- `athletes`/`exercises`/`weekly_plans`/`activity_routines`, and a
-- rate-limited `athlete_access_attempts`-backed PIN bridge
-- (`get_athlete_by_code`/`update_athlete_photo_by_code`) that replaces the
-- previously wide-open anonymous RLS policies on `athletes`. See those
-- migration files for full detail and the exact policy changes.

-- ─────────────────────────────────────────────
-- 10. SAMPLE DATA (optional – remove in production)
-- ─────────────────────────────────────────────
INSERT INTO exercises (name, category, description, sets, reps, duration_sec) VALUES
  ('Hip Flexor Stretch',        'mobility',           'Kneel on one knee, push hips forward gently. Hold for 30 s each side.',                     3, NULL, 30),
  ('Banded Shoulder Rotation',  'pre_training',       'Attach band at elbow height. Rotate shoulder internally and externally.',                   3, 15,   NULL),
  ('Foam Roll Thoracic Spine',  'recovery',           'Place foam roller under mid-back. Extend over it slowly.',                                  2, NULL, 60),
  ('Single-Leg RDL',            'strength',           'Stand on one leg, hinge at hip, keep back flat. Squeeze glute to return.',                  3, 10,   NULL),
  ('90/90 Hip Stretch',         'mobility',           'Sit with both legs at 90°. Lean over front leg. Switch sides.',                             3, NULL, 45),
  ('Rotator Cuff Band Circuit', 'injury_prevention',  'Perform ER, IR, and scaption with light resistance band.',                                  3, 15,   NULL),
  ('Ice/Heat Contrast',         'post_training',      'Alternate ice 10 min / heat 10 min on target area. Finish with ice.',                       2, NULL, 600),
  ('Pallof Press',              'strength',           'Stand perpendicular to cable. Press band out, hold 2 s, return.',                           3, 12,   NULL);
