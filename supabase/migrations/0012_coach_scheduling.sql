-- ============================================================
-- Milestone 5 — coach_availability + coach_blocks
-- ============================================================
-- Run AFTER 0009_coach_identity_rpc.sql. Recurring weekly availability
-- and one-off blocked time are deliberately SEPARATE tables, not one
-- table with nullable "recurring OR specific date" columns — they are
-- different shapes (a recurring rule vs. an absolute timestamp range) and
-- conflating them would be exactly the premature complexity this
-- milestone is scoped to avoid. No recurrence engine, no slot
-- calculation, and no overlap-prevention constraint are introduced here
-- — availability/blocks are just data; turning them into bookable slots
-- is explicitly a later milestone's problem.
--
-- WRITE MODEL: a coach has full CRUD on their OWN rows in both tables
-- (unlike coach_services, nothing here is business-sensitive pricing
-- data the academy controls — this is the coach's own calendar, so no
-- RPC gateway is needed). Administrators have full CRUD on any coach's
-- rows within their org. coach_id/organization_id are immutable after
-- insert for every actor, same as 0010/0011. Physician: no access at
-- all, on either table. No anonymous policy on either table.
--
-- DO NOT RUN AGAINST PRODUCTION YET — see 0009's header; same posture.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. COACH_AVAILABILITY (recurring weekly pattern)
--    Reuses the existing day_of_week enum (0000) — no new enum needed.
-- ─────────────────────────────────────────────
create table if not exists coach_availability (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  coach_id         uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  day_of_week      day_of_week NOT NULL,
  start_time       time NOT NULL,
  end_time         time NOT NULL,
  is_active        boolean NOT NULL DEFAULT TRUE,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time),
  CONSTRAINT coach_availability_org_coach_fk
    FOREIGN KEY (organization_id, coach_id) REFERENCES staff_profiles(organization_id, id)
);
-- is_active lets a recurring window be paused (e.g. a seasonal break)
-- without deleting the row. coach_id uses ON DELETE RESTRICT, consistent
-- with 0010/0011's historical-integrity reasoning, not CASCADE.

create index if not exists coach_availability_coach_idx on coach_availability (coach_id, day_of_week);

drop trigger if exists coach_availability_updated_at on coach_availability;
create trigger coach_availability_updated_at
  before update on coach_availability
  for each row execute procedure set_updated_at();

create or replace function protect_coach_availability_identity_fields()
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

revoke execute on function protect_coach_availability_identity_fields() from public;

drop trigger if exists coach_availability_protect_identity on coach_availability;
create trigger coach_availability_protect_identity
  before update on coach_availability
  for each row execute procedure protect_coach_availability_identity_fields();

alter table coach_availability enable row level security;

drop policy if exists "Staff org access - coach_availability" on coach_availability;
create policy "Staff org access - coach_availability"
  on coach_availability for all to authenticated
  using (
    (organization_id = current_org_id() and (is_org_administrator() or coach_id = current_staff_profile_id()))
    or is_super_user()
  )
  with check (
    (organization_id = current_org_id() and (is_org_administrator() or coach_id = current_staff_profile_id()))
    or is_super_user()
  );
-- A single FOR ALL policy suffices here (unlike coach_services): a coach
-- has full CRUD on their own rows, with no column restricted, so there is
-- no need to split SELECT from the write commands. is_org_physician()
-- does not appear in this predicate — a physician has zero access.

-- Explicit table privileges — same reasoning as 0010/0011: override
-- Supabase's default anon grant for this hard-"no anonymous access" table.
grant select, insert, update, delete on coach_availability to authenticated;
revoke all on coach_availability from anon;

-- ─────────────────────────────────────────────
-- 2. COACH_BLOCKS (one-off blocked time / time off)
--    A separate entity from coach_availability by design (see header) —
--    an absolute date/time range, not a recurring rule.
-- ─────────────────────────────────────────────
create table if not exists coach_blocks (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  coach_id         uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  start_at         timestamptz NOT NULL,
  end_at           timestamptz NOT NULL,
  reason           text,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  CHECK (end_at > start_at),
  CONSTRAINT coach_blocks_org_coach_fk
    FOREIGN KEY (organization_id, coach_id) REFERENCES staff_profiles(organization_id, id)
);
-- updated_at added on audit review: the original "matches
-- assigned_exercises' precedent, a one-off record not edited in place"
-- justification didn't actually hold up — this table's own RLS policy
-- below grants FOR ALL (including UPDATE) to the owning coach and any
-- admin in the org, and is tested that way, so it IS a mutable record in
-- practice, unlike assigned_exercises (which the real application only
-- ever deletes and recreates). Every other mutable table in this
-- migration set already has updated_at; this was the one unjustified
-- exception.

create index if not exists coach_blocks_coach_idx on coach_blocks (coach_id, start_at);

drop trigger if exists coach_blocks_updated_at on coach_blocks;
create trigger coach_blocks_updated_at
  before update on coach_blocks
  for each row execute procedure set_updated_at();

create or replace function protect_coach_block_identity_fields()
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

revoke execute on function protect_coach_block_identity_fields() from public;

drop trigger if exists coach_blocks_protect_identity on coach_blocks;
create trigger coach_blocks_protect_identity
  before update on coach_blocks
  for each row execute procedure protect_coach_block_identity_fields();

alter table coach_blocks enable row level security;

drop policy if exists "Staff org access - coach_blocks" on coach_blocks;
create policy "Staff org access - coach_blocks"
  on coach_blocks for all to authenticated
  using (
    (organization_id = current_org_id() and (is_org_administrator() or coach_id = current_staff_profile_id()))
    or is_super_user()
  )
  with check (
    (organization_id = current_org_id() and (is_org_administrator() or coach_id = current_staff_profile_id()))
    or is_super_user()
  );

-- Explicit table privileges — same reasoning as 0010/0011.
grant select, insert, update, delete on coach_blocks to authenticated;
revoke all on coach_blocks from anon;

COMMIT;
