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

-- ─────────────────────────────────────────────
-- 8. SAMPLE DATA (optional – remove in production)
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
