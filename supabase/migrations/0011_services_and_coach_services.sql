-- ============================================================
-- Milestone 5 — services + coach_services (catalog and coach offerings)
-- ============================================================
-- Run AFTER 0009_coach_identity_rpc.sql. One coherent logical unit — the
-- academy's service catalog and each coach's specific offerings against
-- it — introduced together rather than split across two files; neither
-- table has an independent reason to be reviewed or rolled back
-- separately from the other.
--
-- MONEY CONVENTION: price_cents / default_price_cents are INTEGER CENTS,
-- not a float/numeric dollar amount — the first money columns in this
-- schema, and the convention every future money column should follow.
-- No payment processing exists or is implied by storing a price.
--
-- WRITE MODEL:
--   - services: administrators manage the catalog (full CRUD); coaches
--     get READ-ONLY access (they need to see what exists to know what
--     they could be assigned) via a dedicated SELECT policy, separate
--     from the administrator FOR ALL policy — the first table in this
--     schema where a role needs broader read access than write access.
--   - coach_services: administrators manage assignments/pricing/duration
--     (full CRUD). A coach gets READ-ONLY access to their OWN rows and
--     NOTHING ELSE — no INSERT, no UPDATE, no DELETE policy for coach at
--     all. The one capability a coach does have — pausing/resuming their
--     own existing offering — is deliberately NOT granted through RLS.
--     See section 4 below for why, and for set_coach_service_bookable().
--   - Physician: no access to either table. is_org_physician() appears
--     nowhere in this file's policies.
--   - No anonymous policy on either table.
--
-- DO NOT RUN AGAINST PRODUCTION YET — see 0009's header; same posture.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. SERVICES
-- ─────────────────────────────────────────────
-- gen_random_uuid(), not uuid_generate_v4() — see 0010's header comment.
-- pg_catalog builtin, no extension/schema dependency.
create table if not exists services (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name                      text NOT NULL,
  description               text,
  default_duration_minutes  integer NOT NULL CHECK (default_duration_minutes > 0),
  default_price_cents       integer CHECK (default_price_cents IS NULL OR default_price_cents >= 0),
  is_active                 boolean NOT NULL DEFAULT TRUE,
  created_at                timestamptz NOT NULL DEFAULT NOW(),
  updated_at                timestamptz NOT NULL DEFAULT NOW()
);
-- default_duration_minutes is a plain positive-integer check, not
-- restricted to 30/60 — those stay UI defaults, never a DB constraint.
-- No "shared/global service" concept (unlike exercises.organization_id,
-- which is nullable): every service belongs to exactly one academy.

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'services_org_id_unique'
  ) then
    alter table services add constraint services_org_id_unique unique (organization_id, id);
  end if;
end $$;

-- Case-insensitive, per-organization name uniqueness. A plain UNIQUE
-- table constraint cannot reference an expression (lower(name)), so this
-- is a unique INDEX instead — the standard, idiomatic Postgres mechanism
-- for expression-based uniqueness, enforcing the identical guarantee a
-- table constraint would. Deliberately NOT citext: that would require
-- `CREATE EXTENSION citext`, new infrastructure this project doesn't have
-- and doesn't need when the built-in lower() does the job. Scoped per
-- (organization_id, lower(name)), so the SAME name may exist in two
-- different organizations.
create unique index if not exists services_org_name_ci_unique on services (organization_id, lower(name));

drop trigger if exists services_updated_at on services;
create trigger services_updated_at
  before update on services
  for each row execute procedure set_updated_at();

alter table services enable row level security;

drop policy if exists "Staff org access - services" on services;
create policy "Staff org access - services"
  on services for all to authenticated
  using ((organization_id = current_org_id() and is_org_administrator()) or is_super_user())
  with check ((organization_id = current_org_id() and is_org_administrator()) or is_super_user());

-- Coach read-only access to the catalog — intentionally broader than the
-- write policy above. is_org_physician() does not appear here: a
-- physician has no access to this table at all.
drop policy if exists "Coach reads services" on services;
create policy "Coach reads services"
  on services for select to authenticated
  using ((organization_id = current_org_id() and (is_org_administrator() or is_org_coach())) or is_super_user());

-- ─────────────────────────────────────────────
-- 2. COACH_SERVICES (coach <-> service, with per-pairing overrides)
-- ─────────────────────────────────────────────
-- gen_random_uuid() — see 0010's header comment.
create table if not exists coach_services (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  coach_id          uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  service_id        uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  price_cents       integer CHECK (price_cents IS NULL OR price_cents >= 0),
  duration_minutes  integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  is_active         boolean NOT NULL DEFAULT TRUE,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (coach_id, service_id),
  CONSTRAINT coach_services_org_coach_fk
    FOREIGN KEY (organization_id, coach_id) REFERENCES staff_profiles(organization_id, id),
  CONSTRAINT coach_services_org_service_fk
    FOREIGN KEY (organization_id, service_id) REFERENCES services(organization_id, id)
);
-- price_cents/duration_minutes NULL = inherit the service's own default.
-- is_active is the coach-specific "is this coach currently offering this
-- service" bookable flag — independent of the service's own global
-- is_active. coach_id/service_id/organization_id use ON DELETE RESTRICT
-- for the same historical-integrity reasoning as coach_profiles above —
-- a future bookings table is likely to reference a specific coach_services
-- row (to snapshot which price/duration pairing a booking was made
-- against), so nothing here may be silently cascaded away.
--
-- The composite FKs above are what make a cross-organization pairing a
-- hard constraint-level impossibility (a coach and service belonging to
-- different organizations cannot be paired at all) — no trigger needed,
-- unlike 0004's enforce_activity_routine_exercise_org, because neither
-- side here is nullable.

drop trigger if exists coach_services_updated_at on coach_services;
create trigger coach_services_updated_at
  before update on coach_services
  for each row execute procedure set_updated_at();

-- Identity-field protection: coach_id, service_id, and organization_id are
-- immutable after insert, for EVERY actor including administrators. If a
-- different pairing is wanted, create a new row — never repoint an
-- existing one. This directly protects the historical-integrity
-- requirement above: a row a future booking references must never change
-- which coach/service/org it actually represents.
create or replace function protect_coach_service_identity_fields()
returns trigger language plpgsql as $$
begin
  if new.coach_id is distinct from old.coach_id then
    raise exception 'coach_id cannot be changed';
  end if;
  if new.service_id is distinct from old.service_id then
    raise exception 'service_id cannot be changed';
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

-- Same explicit EXECUTE audit as 0001's trigger functions — not
-- independently exploitable (a trigger-returning function can't be
-- invoked via plain SELECT regardless of grants), but explicit rather
-- than silently relying on that.
revoke execute on function protect_coach_service_identity_fields() from public;

drop trigger if exists coach_services_protect_identity on coach_services;
create trigger coach_services_protect_identity
  before update on coach_services
  for each row execute procedure protect_coach_service_identity_fields();

alter table coach_services enable row level security;

drop policy if exists "Staff org access - coach_services" on coach_services;
create policy "Staff org access - coach_services"
  on coach_services for all to authenticated
  using ((organization_id = current_org_id() and is_org_administrator()) or is_super_user())
  with check ((organization_id = current_org_id() and is_org_administrator()) or is_super_user());

-- Coach: read own rows only. Deliberately NO insert/update/delete policy
-- for coach at all — a coach cannot create an assignment, cannot change
-- price/duration, cannot reassign coach_id/service_id, and (absent the
-- RPC below) cannot even toggle is_active via a raw UPDATE. This is
-- "secure by default": any column added to this table in the future is
-- automatically protected from coach writes with zero additional effort,
-- since there is no coach write policy to have omitted a check from.
drop policy if exists "Coach reads own coach_services" on coach_services;
create policy "Coach reads own coach_services"
  on coach_services for select to authenticated
  using (coach_id = current_staff_profile_id());

-- ─────────────────────────────────────────────
-- 3. SELF-SERVICE PAUSE/RESUME — WHY NOT ORDINARY RLS OR COLUMN GRANTS
--
-- The requirement: a coach may change ONLY is_active on their OWN
-- coach_services row — never price_cents, duration_minutes, coach_id,
-- service_id, or organization_id (those last three are also blocked
-- unconditionally by the trigger above, but the grant-level design below
-- means a coach has no UPDATE path to any of them in the first place).
--
-- Ordinary RLS cannot express "this role may set column A but not column
-- B within the same row" — USING/WITH CHECK decide which ROWS a
-- statement may touch, not which COLUMNS within an allowed row.
--
-- Column-level GRANT UPDATE (is_active) was considered and rejected: it
-- is a property of the database ROLE, not of the row or the caller's
-- application-level role. In this project, administrator/coach/physician
-- are not separate Postgres roles — all staff connect as the single
-- shared `authenticated` role, distinguished only by RLS-predicate
-- lookups into staff_profiles. A column grant restricting `authenticated`
-- to is_active-only would restrict administrators too, breaking
-- "administrators control pricing/duration." Column privileges cannot be
-- made conditional on row data the way RLS predicates can.
--
-- Instead: the coach has NO update policy on this table at all (section 2
-- above), and the ONLY path to flip is_active is this narrow RPC. Its
-- signature takes only an id and a boolean, so there is no parameter
-- through which it could ever touch any other column — safety here comes
-- from the function's shape, not from a runtime check that could be
-- gotten wrong, and no column added to this table later can accidentally
-- become coach-writable through this RPC.
-- ─────────────────────────────────────────────
create or replace function set_coach_service_bookable(p_coach_service_id uuid, p_is_active boolean)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_coach_id uuid;
  v_org_id   uuid;
begin
  select coach_id, organization_id into v_coach_id, v_org_id
    from public.coach_services where id = p_coach_service_id;

  -- Row doesn't exist. Fall through to the same `return false` an
  -- unauthorized-but-existing row produces below — a caller cannot
  -- distinguish "not yours" from "doesn't exist", matching the no-info-
  -- leak convention already used by get_athlete_by_code.
  if v_coach_id is null then
    return false;
  end if;

  if v_coach_id = public.current_staff_profile_id()
     or (v_org_id = public.current_org_id() and public.is_org_administrator())
     or public.is_super_user()
  then
    update public.coach_services set is_active = p_is_active, updated_at = now()
      where id = p_coach_service_id;
    return true;
  end if;

  return false;
end;
$$;

-- anon never calls this (staff-only mutation); authenticated only.
revoke execute on function set_coach_service_bookable(uuid, boolean) from public;
grant execute on function set_coach_service_bookable(uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────
-- 4. EXPLICIT TABLE PRIVILEGES
--    Same reasoning as 0010: Supabase's default privileges would
--    otherwise grant anon the same broad access as authenticated on
--    these tables by default. Both services and coach_services have a
--    hard "zero anonymous access" requirement, so that default is
--    explicitly overridden here rather than left as an assumption about
--    platform configuration — a second, independent layer under RLS.
-- ─────────────────────────────────────────────
grant select, insert, update, delete on services to authenticated;
revoke all on services from anon;

grant select, insert, update, delete on coach_services to authenticated;
revoke all on coach_services from anon;

COMMIT;
