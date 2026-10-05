-- ============================================================
-- Milestone 5 — coach_profiles (booking/public-facing coach config)
-- ============================================================
-- Run AFTER 0009_coach_identity_rpc.sql. Introduces a SEPARATE entity from
-- staff_profiles for booking-facing coach configuration, deliberately not
-- added as columns on staff_profiles: staff_profiles is an IDENTITY table
-- (who can log in as what role), already client-read-only with no write
-- policy of its own; coach_profiles is CONFIGURATION (display name, bio,
-- online-booking toggle) with its own, different write rules. Mixing the
-- two would mean widening staff_profiles' write surface for a concern
-- that has nothing to do with authentication/role identity.
--
-- Schema AND its own initial RLS are introduced together, atomically, in
-- this one file — per the project's current standardization on formal,
-- atomic, CLI-tracked migrations, there is no deliberate "RLS-enabled,
-- zero policies" intermediate state here (that was an artifact of an
-- older, section-by-section production-rollout posture this project has
-- moved away from, not something to keep reproducing for its own sake).
--
-- NOT AUTO-CREATED: no trigger creates a coach_profiles row when a
-- staff_profiles row with role = 'coach' is created. A row simply does
-- not exist until an administrator or Super User explicitly creates one.
--
-- WRITE MODEL (deliberately asymmetric from coach_services, see 0011):
--   - Administrator / Super User: full CRUD (create, read, update,
--     delete) on any coach's profile in their org.
--   - Coach: SELECT and UPDATE their OWN existing row only. No INSERT,
--     no DELETE policy exists for coach at all — those commands are
--     denied by default (no policy authorizes them), not by an explicit
--     negative rule. display_name/bio/is_bookable_online are fully
--     coach-editable at the RLS layer (unlike coach_services, nothing
--     here is business-sensitive pricing data, so no RPC gateway is
--     needed) — the one thing that must NOT change (coach_id,
--     organization_id) is protected unconditionally by a trigger below,
--     for every actor including administrators, not by RLS.
--   - Physician: no access at all. is_org_physician() appears nowhere in
--     this file's policies.
--   - No anonymous policy of any kind. Public/anonymous access to coach
--     profiles remains completely deferred to a future milestone.
--
-- DO NOT RUN AGAINST PRODUCTION YET — see 0009's header; same posture.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. COMPOSITE ORGANIZATION-INTEGRITY SUPPORT
--    staff_profiles.id is already globally unique (its PK), so adding a
--    composite UNIQUE(organization_id, id) is a harmless, always-satisfied
--    addition — it exists purely so coach_profiles (and, in 0011,
--    coach_services) can carry a composite FK that makes "this row's
--    organization_id always matches its coach's actual organization" a
--    hard constraint, enforced by Postgres itself, with no trigger. This
--    is possible here (unlike activity_routines' exercise_id, which
--    needed a trigger in 0004) only because neither side is nullable.
-- ─────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_profiles_org_id_unique'
  ) then
    alter table staff_profiles add constraint staff_profiles_org_id_unique unique (organization_id, id);
  end if;
end $$;

-- ─────────────────────────────────────────────
-- 2. COACH_PROFILES TABLE
-- ─────────────────────────────────────────────
create table if not exists coach_profiles (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  coach_id            uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  display_name        text NOT NULL,
  bio                 text,
  is_bookable_online  boolean NOT NULL DEFAULT TRUE,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (coach_id),
  CONSTRAINT coach_profiles_org_coach_fk
    FOREIGN KEY (organization_id, coach_id) REFERENCES staff_profiles(organization_id, id)
);
-- coach_id/organization_id use ON DELETE RESTRICT, not CASCADE: a booking
-- domain record is exactly the kind of row a future bookings table may
-- need to reference historically, so removing a coach must never silently
-- cascade away configuration out from under it. This project's existing,
-- dominant convention is deactivate-via-is_active, never hard-delete a
-- business entity (athletes.is_active, exercises.is_active,
-- staff_profiles.is_active) — RESTRICT makes that convention a hard
-- backstop here too, rather than something a cascading delete could
-- silently violate the one time someone attempts a hard delete.

drop trigger if exists coach_profiles_updated_at on coach_profiles;
create trigger coach_profiles_updated_at
  before update on coach_profiles
  for each row execute procedure set_updated_at();

-- ─────────────────────────────────────────────
-- 3. IDENTITY-FIELD PROTECTION (coach_id, organization_id immutable)
--    NOT security definer: fires on writes the invoking role must already
--    be authorized to make (administrator, via the policy below) — same
--    reasoning as 0001's protect_staff_profile_identity_fields(). Applies
--    unconditionally, to every actor including administrators: once a
--    profile exists, which coach/org it belongs to can never change —
--    only delete-and-recreate. This is deliberately NOT delegated to RLS:
--    RLS can restrict which ROWS are reachable, not which COLUMNS within
--    an allowed row may change.
-- ─────────────────────────────────────────────
create or replace function protect_coach_profile_identity_fields()
returns trigger language plpgsql as $$
begin
  if new.coach_id is distinct from old.coach_id then
    raise exception 'coach_id cannot be changed';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id cannot be changed';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at cannot be changed';
  end if;
  return new;
end;
$$;

-- Same explicit EXECUTE audit as every function in this project (0001's
-- revoke-from-public block covers its own trigger functions too) — this
-- is not independently exploitable (Postgres refuses to invoke a
-- trigger-returning function via plain SELECT regardless of grants), but
-- the audit should be explicit rather than silently relying on that.
revoke execute on function protect_coach_profile_identity_fields() from public;

drop trigger if exists coach_profiles_protect_identity on coach_profiles;
create trigger coach_profiles_protect_identity
  before update on coach_profiles
  for each row execute procedure protect_coach_profile_identity_fields();

-- ─────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
alter table coach_profiles enable row level security;

-- Administrator (own org) / Super User: full CRUD, including create and
-- delete — the only roles permitted to create or remove a coach_profiles
-- row at all.
drop policy if exists "Staff org access - coach_profiles" on coach_profiles;
create policy "Staff org access - coach_profiles"
  on coach_profiles for all to authenticated
  using ((organization_id = current_org_id() and is_org_administrator()) or is_super_user())
  with check ((organization_id = current_org_id() and is_org_administrator()) or is_super_user());

-- Coach: read own row only.
drop policy if exists "Coach reads own coach_profiles" on coach_profiles;
create policy "Coach reads own coach_profiles"
  on coach_profiles for select to authenticated
  using (coach_id = current_staff_profile_id());

-- Coach: update own row only. No corresponding INSERT or DELETE policy —
-- those commands have no policy authorizing them for a coach and are
-- therefore denied by default, not by an explicit negative rule.
drop policy if exists "Coach updates own coach_profiles" on coach_profiles;
create policy "Coach updates own coach_profiles"
  on coach_profiles for update to authenticated
  using (coach_id = current_staff_profile_id())
  with check (coach_id = current_staff_profile_id());

-- No anonymous policy of any kind. No policy references is_org_physician()
-- anywhere in this file — a plain physician has zero access, by omission,
-- the same way 0008 excludes coaches from physician-domain tables.

-- ─────────────────────────────────────────────
-- 5. EXPLICIT TABLE PRIVILEGES
--    Supabase's platform-level default privileges would otherwise grant
--    anon the same broad table access as authenticated the moment this
--    table is created — that default is appropriate for tables like
--    exercises/activity_routines, which intentionally route some anon
--    access through RPCs, but Milestone 5 has a hard "zero anonymous
--    access" requirement for this table. REVOKE makes that a property of
--    this migration file itself rather than an assumption about platform
--    configuration, or an emergent property of "no current policy happens
--    to match anon" — a second, independent layer under RLS, not a
--    replacement for it.
-- ─────────────────────────────────────────────
grant select, insert, update, delete on coach_profiles to authenticated;
revoke all on coach_profiles from anon;

COMMIT;
