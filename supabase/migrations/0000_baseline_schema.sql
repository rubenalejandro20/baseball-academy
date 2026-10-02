-- ============================================================
-- Baseline Schema — canonical starting point for a fresh, EMPTY database
-- ============================================================
-- Derived from the historical `supabase/schema.sql` (sections 1-6 only:
-- the pre-Milestone-1 `athletes` / `exercises` / `weekly_plans` /
-- `assigned_exercises` tables, their enums, their shared `set_updated_at()`
-- trigger function, and RLS enablement). This file exists so a brand-new
-- automated database (local dev, CI, a disposable test instance) can be
-- constructed entirely from `supabase/migrations/` in numeric order —
-- 0000 -> 0001 -> 0003 -> 0004 -> 0005 -> 0006 — WITHOUT ever loading
-- `supabase/schema.sql` directly. See CLAUDE.md for the distinction:
-- `schema.sql` remains historical reference/documentation only;
-- `0000_baseline_schema.sql` is the canonical machine-applied baseline.
--
-- Deliberately DOES NOT include:
--   - the legacy anon/"Admin full access" RLS POLICIES that schema.sql
--     originally defined (section 6 there). Those policies are superseded
--     by 0003_milestone1_rls.sql's cutover, which uses
--     `DROP POLICY IF EXISTS` for every one of them before creating the
--     org-scoped replacements — safe to run whether or not the legacy
--     policy name ever existed. Creating them here just to have 0003 drop
--     them again would be pure churn.
--   - `activity_routines` / `activity_type` (schema.sql's commented-out
--     section 8) — that table is created for real by Milestone 2's
--     0004_milestone2_activity_routines_schema.sql, not here.
--   - sample/seed data (schema.sql's section 10) — out of scope for this
--     change; see CLAUDE.md.
--   - organizations/staff/platform-admin/audit tables — those are
--     Milestone 1's 0001_milestone1_schema.sql, additive on top of this
--     file.
--
-- Idempotent/rerunnable by the same conventions as 0001/0004: CREATE TYPE
-- has no IF NOT EXISTS form in Postgres, so each enum is guarded by a DO
-- block; tables use IF NOT EXISTS; triggers use DROP TRIGGER IF EXISTS
-- before CREATE TRIGGER. Wrapped in BEGIN/COMMIT so a failure partway
-- through rolls back cleanly rather than leaving a half-applied baseline.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- 1. ENUMS
-- ─────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'exercise_category') then
    create type exercise_category as enum (
      'pre_training',
      'post_training',
      'recovery',
      'mobility',
      'strength',
      'injury_prevention'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'day_of_week') then
    create type day_of_week as enum (
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
    );
  end if;
end $$;

-- ─────────────────────────────────────────────
-- 2. ATHLETES
-- ─────────────────────────────────────────────
create table if not exists athletes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name   text NOT NULL,
  age         integer,
  weight_lbs  numeric(5, 1),
  "position"  text,
  access_code text UNIQUE NOT NULL,
  photo_url   text,
  notes       text,
  is_active   boolean NOT NULL DEFAULT TRUE,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 3. EXERCISE LIBRARY
-- ─────────────────────────────────────────────
create table if not exists exercises (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text NOT NULL,
  category     exercise_category NOT NULL,
  description  text,
  sets         integer,
  reps         integer,
  duration_sec integer,
  video_url    text,
  is_active    boolean NOT NULL DEFAULT TRUE,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 4. WEEKLY PLANS
-- ─────────────────────────────────────────────
create table if not exists weekly_plans (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id  uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  week_start  date NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (athlete_id, week_start)
);

-- ─────────────────────────────────────────────
-- 5. ASSIGNED EXERCISES (line items inside a weekly plan)
-- ─────────────────────────────────────────────
create table if not exists assigned_exercises (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  weekly_plan_id         uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  exercise_id            uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  day                    day_of_week NOT NULL,
  session_type           exercise_category NOT NULL,
  sets_override          integer,
  reps_override          integer,
  duration_sec_override  integer,
  notes                  text,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 6. SHARED updated_at TRIGGER FUNCTION
--    Referenced by this file's own triggers below AND by
--    0001_milestone1_schema.sql's organizations_updated_at /
--    staff_profiles_updated_at triggers — must exist before 0001 runs.
-- ─────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists athletes_updated_at on athletes;
create trigger athletes_updated_at
  before update on athletes
  for each row execute procedure set_updated_at();

drop trigger if exists exercises_updated_at on exercises;
create trigger exercises_updated_at
  before update on exercises
  for each row execute procedure set_updated_at();

drop trigger if exists weekly_plans_updated_at on weekly_plans;
create trigger weekly_plans_updated_at
  before update on weekly_plans
  for each row execute procedure set_updated_at();

-- ─────────────────────────────────────────────
-- 7. ROW LEVEL SECURITY
--    Enabled with NO policies here, matching 0001's "default-deny until a
--    later migration adds policies deliberately" convention.
--    0003_milestone1_rls.sql supplies the real, org-scoped policies for all
--    four of these tables.
-- ─────────────────────────────────────────────
alter table athletes           enable row level security;
alter table exercises          enable row level security;
alter table weekly_plans       enable row level security;
alter table assigned_exercises enable row level security;

COMMIT;
