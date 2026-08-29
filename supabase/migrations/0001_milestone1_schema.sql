-- ============================================================
-- Milestone 1 — Schema (additive only)
-- ============================================================
-- Introduces organizations, staff roles, Super User separation, an
-- audit trail, and a hardened/rate-limited temporary athlete PIN bridge.
--
-- SAFE TO APPLY AT ANY TIME: every statement here is additive (new
-- tables, new nullable columns, new functions/triggers). It does not
-- alter the behavior of any existing table, policy, or application
-- code path. RLS is enabled on every new table with ZERO policies for
-- now (default-deny) — the actual policies are added deliberately in
-- 0003_milestone1_rls.sql, after data has been backfilled (0002) and
-- verified.
--
-- Do NOT run this against production yet. See the rollout plan
-- delivered alongside this migration for the exact apply order and
-- verification gates.
--
-- STEP 2 HARDENING PASS — rerunnability & transactional safety:
--   - Every statement in this file is verified transaction-safe (no
--     CREATE INDEX CONCURRENTLY, no ALTER TYPE ... ADD VALUE, no VACUUM/
--     CREATE DATABASE — none of which can run inside a transaction block).
--     The whole file is therefore wrapped in BEGIN/COMMIT below: if any
--     statement fails, Postgres rolls back everything that ran before it
--     in this same script automatically — there is no partially-applied
--     state to clean up or reason about.
--   - Rerunnability is still hardened independently of the transaction
--     wrapper, for the case where this file is (successfully or
--     partially) applied once and then re-run later: the enum type now
--     uses a guarded DO block (CREATE TYPE has no IF NOT EXISTS form in
--     Postgres), and every trigger uses DROP TRIGGER IF EXISTS before
--     CREATE TRIGGER (CREATE OR REPLACE TRIGGER requires Postgres 14+,
--     which this project's exact version wasn't confirmed, so the
--     universally-compatible drop-then-create pattern is used instead).
-- ============================================================

BEGIN;

create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- 1. ORGANIZATIONS (the academy/tenant root)
-- ─────────────────────────────────────────────
create table if not exists organizations (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE,
  timezone    TEXT NOT NULL DEFAULT 'America/New_York',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

drop trigger if exists organizations_updated_at on organizations;
create trigger organizations_updated_at
  before update on organizations
  for each row execute procedure set_updated_at();

alter table organizations enable row level security;
-- No policies yet — added in 0003 once staff_profiles is populated.

-- ─────────────────────────────────────────────
-- 2. STAFF ROLES
-- ─────────────────────────────────────────────
-- CREATE TYPE has no IF NOT EXISTS form in Postgres — guarded explicitly
-- so re-running this file after a prior successful (or partial) apply
-- doesn't error on "type already exists".
do $$ begin
  if not exists (select 1 from pg_type where typname = 'staff_role') then
    create type staff_role as enum ('administrator', 'coach', 'physician');
  end if;
end $$;

create table if not exists staff_profiles (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  role            staff_role NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  invited_by      UUID REFERENCES staff_profiles(id),
  invited_at      TIMESTAMPTZ,
  joined_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- auth_user_id is globally UNIQUE (not composite with organization_id) per the
-- V1 decision: one staff account belongs to exactly one academy. All lookups
-- of "which org / role is this user" go through current_org_id()/role checks
-- below rather than being inlined elsewhere, so introducing a future
-- staff_organization_memberships model only requires changing those helpers.

create index if not exists staff_profiles_org_idx on staff_profiles(organization_id);

drop trigger if exists staff_profiles_updated_at on staff_profiles;
create trigger staff_profiles_updated_at
  before update on staff_profiles
  for each row execute procedure set_updated_at();

alter table staff_profiles enable row level security;
-- No policies yet — added in 0003.

-- ─────────────────────────────────────────────
-- 3. SUPER USER REGISTRY — architecturally separate from staff_role.
--    No INSERT/UPDATE/DELETE policy is ever granted to anon/authenticated
--    (see 0003) — the only way to add a row is via a trusted service-role
--    or direct SQL connection. Academy users have no code path to this table.
-- ─────────────────────────────────────────────
create table if not exists platform_admins (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES platform_admins(id)
);

alter table platform_admins enable row level security;
-- No policies yet — added in 0003 (self-read only).

-- ─────────────────────────────────────────────
-- 4. AUDIT TRAIL — append-only. All writes go through log_audit_event()
--    below; no direct INSERT/UPDATE/DELETE grant is given to anyone.
-- ─────────────────────────────────────────────
create table if not exists audit_events (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id      UUID REFERENCES organizations(id),
  actor_auth_user_id   UUID,
  actor_role           TEXT,
  action               TEXT NOT NULL,
  target_type          TEXT,
  target_id            UUID,
  metadata             JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

create index if not exists audit_events_org_idx on audit_events(organization_id, created_at desc);

alter table audit_events enable row level security;
-- No policies yet — added in 0003 (administrator/super-user read only).

-- ─────────────────────────────────────────────
-- 5. TEMPORARY ATHLETE PIN ABUSE TRACKING
--    Bridge-only: retired along with the PIN flow once email OTP ships.
--    RLS enabled with ZERO policies for any role — this table is only ever
--    written by the SECURITY DEFINER functions below (which run with the
--    function owner's privilege, bypassing RLS), never directly by anon
--    or authenticated callers.
-- ─────────────────────────────────────────────
create table if not exists athlete_access_attempts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  action          TEXT NOT NULL DEFAULT 'lookup',   -- 'lookup' | 'photo_update'
  code_attempted  TEXT NOT NULL,
  ip_address      TEXT,
  succeeded       BOOLEAN NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

create index if not exists athlete_access_attempts_code_idx
  on athlete_access_attempts(code_attempted, action, created_at desc);
create index if not exists athlete_access_attempts_ip_idx
  on athlete_access_attempts(ip_address, action, created_at desc);

alter table athlete_access_attempts enable row level security;
-- Intentionally NO policies at all for anon/authenticated.

-- ─────────────────────────────────────────────
-- 6. ORGANIZATION-SCOPING COLUMNS (nullable; backfilled in 0002)
--    assigned_exercises intentionally gets no organization_id — it is
--    scoped via weekly_plans.organization_id in 0003's RLS policy instead,
--    since it has no anonymous-access requirement to justify the extra
--    denormalized column.
-- ─────────────────────────────────────────────
alter table athletes          add column if not exists organization_id uuid references organizations(id);
alter table exercises         add column if not exists organization_id uuid references organizations(id);
alter table weekly_plans      add column if not exists organization_id uuid references organizations(id);
-- exercises.organization_id stays nullable permanently: NULL = platform/shared
-- exercise, set = academy-private exercise (hybrid global/per-academy library).
--
-- activity_routines is deliberately NOT touched here. Confirmed via the
-- Milestone 1 Step 1 production inventory that this table (and the
-- activity_type enum it depends on) do not exist in production, despite
-- being documented in schema.sql and queried by the application code —
-- see the drift note in schema.sql section 8 for the full explanation.
-- Altering a table that doesn't exist would abort this entire migration.

-- ─────────────────────────────────────────────
-- 7. HELPER FUNCTIONS used throughout RLS (0003) and application code
--
--    SEARCH-PATH HARDENING: every SECURITY DEFINER function below sets
--    `search_path = ''` (empty) and fully qualifies every object reference
--    with its schema (`public.`, `auth.`). This is the stronger of the two
--    accepted hardening patterns (the alternative, `search_path = public`,
--    is not used) — with an empty search_path there is no schema-resolution
--    ambiguity left at all for an unqualified name to be hijacked through,
--    regardless of what schemas might exist or what a caller's session
--    search_path is set to. auth.uid() is still reachable because it is
--    always referenced with its explicit schema.
-- ─────────────────────────────────────────────
create or replace function current_org_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select organization_id from public.staff_profiles
  where auth_user_id = auth.uid() and is_active = true
  limit 1;
$$;

create or replace function is_super_user(uid uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists(select 1 from public.platform_admins where auth_user_id = uid);
$$;

create or replace function is_org_administrator()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.staff_profiles
    where auth_user_id = auth.uid() and role = 'administrator' and is_active = true
  );
$$;
-- SECURITY DEFINER is what lets these three functions read staff_profiles /
-- platform_admins without themselves being subject to those tables' own RLS
-- (avoiding recursive-policy issues) while still only ever answering "what is
-- true for the CURRENT caller" (auth.uid()) unless a uid is explicitly passed.
-- is_org_administrator() is defined now but not yet referenced by any policy
-- in 0003 (staff_profiles is client-read-only in Milestone 1) — reserved for
-- Phase 2's staff-management write path.

-- log_audit_event() is intentionally NOT exposed to anon/authenticated at all
-- (see the REVOKE/GRANT block at the end of this file). It must only ever be
-- reachable via `perform log_audit_event(...)` from another SECURITY DEFINER
-- function/trigger owned by the same (migration-running) role, e.g.
-- audit_staff_profile_changes() below — that internal call is authorized
-- because a SECURITY DEFINER function executes as its OWNER, and an owner
-- always has implicit EXECUTE on its own functions regardless of grants. If
-- this were reachable by a normal authenticated/anon caller, anyone could
-- fabricate arbitrary audit_events rows (wrong org, fake action, forged
-- actor) and destroy the trail's integrity.
create or replace function log_audit_event(
  p_org uuid, p_action text, p_target_type text, p_target_id uuid, p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.audit_events(organization_id, actor_auth_user_id, actor_role, action, target_type, target_id, metadata)
  values (
    p_org,
    auth.uid(),
    (select role::text from public.staff_profiles where auth_user_id = auth.uid() and organization_id = p_org),
    p_action, p_target_type, p_target_id, p_metadata
  );
end;
$$;

-- ─────────────────────────────────────────────
-- 8. LAST-ACTIVE-ADMINISTRATOR GUARD (database-enforced, not just app-level)
--
--    NOT security definer: these fire on writes to staff_profiles that the
--    invoking role must already be authorized to make (today: nothing, since
--    staff_profiles has no client write policy at all — see 0003; later:
--    whatever privileged path Phase 2 introduces). Running with the
--    invoker's own privileges is correct here and avoids giving this trigger
--    more power than the write itself already required. Object references
--    are still schema-qualified for clarity and consistency.
-- ─────────────────────────────────────────────
create or replace function prevent_last_administrator_removal()
returns trigger language plpgsql as $$
begin
  if (old.role = 'administrator' and old.is_active = true)
     and (new.role <> 'administrator' or new.is_active = false)
  then
    if (select count(*) from public.staff_profiles
        where organization_id = old.organization_id
          and role = 'administrator' and is_active = true
          and id <> old.id) = 0
    then
      raise exception 'Cannot remove or demote the last active administrator for this academy';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_profiles_last_admin_guard on staff_profiles;
create trigger staff_profiles_last_admin_guard
  before update on staff_profiles
  for each row execute procedure prevent_last_administrator_removal();

create or replace function prevent_last_administrator_delete()
returns trigger language plpgsql as $$
begin
  if old.role = 'administrator' and old.is_active = true then
    if (select count(*) from public.staff_profiles
        where organization_id = old.organization_id
          and role = 'administrator' and is_active = true
          and id <> old.id) = 0
    then
      raise exception 'Cannot delete the last active administrator for this academy';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists staff_profiles_last_admin_delete_guard on staff_profiles;
create trigger staff_profiles_last_admin_delete_guard
  before delete on staff_profiles
  for each row execute procedure prevent_last_administrator_delete();

-- ─────────────────────────────────────────────
-- 8b. IDENTITY-FIELD PROTECTION on staff_profiles (defense-in-depth)
--
--    Milestone 1 ships NO client write policy on staff_profiles at all (see
--    0003) — it is read-only from the app. This trigger exists anyway, as a
--    hard backstop independent of whatever RLS policy Phase 2 eventually
--    adds for controlled staff mutation: no writer, however it is
--    authorized, may change an existing row's identity or move it between
--    organizations. This cannot be bypassed by a future overly-broad policy
--    since a trigger fires regardless of which policy allowed the UPDATE.
-- ─────────────────────────────────────────────
create or replace function protect_staff_profile_identity_fields()
returns trigger language plpgsql as $$
begin
  if new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'auth_user_id cannot be changed';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id cannot be changed (staff cannot be moved between academies)';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at cannot be changed';
  end if;
  if new.invited_by is distinct from old.invited_by then
    raise exception 'invited_by cannot be changed';
  end if;
  if new.invited_at is distinct from old.invited_at then
    raise exception 'invited_at cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_profiles_protect_identity on staff_profiles;
create trigger staff_profiles_protect_identity
  before update on staff_profiles
  for each row execute procedure protect_staff_profile_identity_fields();

-- ─────────────────────────────────────────────
-- 9. AUTOMATIC AUDIT LOGGING for staff role/activation changes
--    Fires regardless of which future UI (or direct SQL) makes the change.
--    SECURITY DEFINER so it can call log_audit_event() (see note above).
-- ─────────────────────────────────────────────
create or replace function audit_staff_profile_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    perform public.log_audit_event(
      new.organization_id,
      case
        when new.is_active is distinct from old.is_active and new.is_active = false then 'staff.deactivated'
        when new.is_active is distinct from old.is_active and new.is_active = true  then 'staff.reactivated'
        else 'staff.role_changed'
      end,
      'staff_profile', new.id,
      jsonb_build_object(
        'old_role', old.role, 'new_role', new.role,
        'old_is_active', old.is_active, 'new_is_active', new.is_active
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists staff_profiles_audit on staff_profiles;
create trigger staff_profiles_audit
  after update on staff_profiles
  for each row execute procedure audit_staff_profile_changes();

-- ─────────────────────────────────────────────
-- 10. HARDENED, RATE-LIMITED ATHLETE PIN BRIDGE (temporary — see note above)
--
--     Design (see the accompanying implementation report for the full
--     threat-model writeup — summarized here):
--
--     - Returns ONLY the fields the existing athlete UI actually renders
--       (id, full_name, position, photo_url) — not the full row, not the
--       access_code, not age/weight/notes.
--     - EXECUTE is granted to `anon` ONLY (see REVOKE/GRANT block below) —
--       this is also, unavoidably, reachable by ANYONE holding the public
--       anon key calling PostgREST directly, bypassing the Next.js Route
--       Handler entirely. The IP parameter is therefore NOT a trusted
--       security boundary — see below.
--     - Two independent counters, both keyed off athlete_access_attempts:
--         * per-IP (best-effort only): 20 attempts / rolling 10 minutes.
--           Only meaningful when the caller genuinely goes through the
--           Route Handler (which supplies a real x-forwarded-for value);
--           trivially defeated by a caller invoking the RPC directly with a
--           fabricated or omitted p_ip. Included because it still raises
--           the cost of casual/naive abuse through the real product UI, but
--           it is NOT what actually protects this endpoint.
--         * per-CODE (the real, non-bypassable boundary): 10 FAILED
--           attempts / rolling 10 minutes, counted purely from
--           `code_attempted`, independent of p_ip. A direct-RPC caller
--           cannot spoof or omit their way around this, because it does not
--           read p_ip at all.
--     - Only FAILED attempts count toward either threshold (successes are
--       still logged, for audit/telemetry, but never contribute to a
--       lockout). This is what prevents a legitimate athlete from ever
--       being locked out of their OWN correct code through normal repeat
--       use, AND it closes the "grief a specific athlete" scenario: an
--       attacker who does not know the real code can only ever exhaust the
--       budget for the (wrong) code they are guessing, never the athlete's
--       real one; an attacker who DOES know the real code and submits it
--       only ever produces successes, which never deplete the budget.
--     - No automated retention/cleanup job is included (would be
--       disproportionate for a bridge with a defined retirement date) — a
--       manual periodic `delete from athlete_access_attempts where
--       created_at < now() - interval '30 days'` is sufficient, and the
--       table is dropped outright when the PIN bridge is retired in the
--       email-OTP phase.
--     - Explicitly accepted residual risk: a direct-RPC caller who
--       distributes guesses across MANY different codes (rather than
--       repeating one) is not meaningfully throttled, since each individual
--       code's own counter never crosses the threshold. A global
--       (all-codes) counter was considered and deliberately rejected: it
--       would let one bad actor deny the lookup entirely for every
--       legitimate athlete, which is a worse outcome than the risk it
--       prevents, given (a) the access_code keyspace is large enough
--       (36^6 ≈ 2.18 billion) that scanning it is not practically
--       productive even fully unthrottled, and (b) a successful hit only
--       discloses non-sensitive fields (name/position/photo), not
--       access_code, medical notes, age, or weight. This is a deliberate,
--       proportionate choice for a bridge being retired by email OTP, not
--       an oversight.
-- ─────────────────────────────────────────────
create or replace function get_athlete_by_code(p_code text, p_ip text default null)
returns table(id uuid, full_name text, "position" text, photo_url text)
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_ip_attempts int;
  v_code_attempts int;
  v_match record;
begin
  if length(v_code) = 0 or length(v_code) > 12 then
    return;
  end if;

  select count(*) into v_ip_attempts from public.athlete_access_attempts
    where action = 'lookup' and p_ip is not null and ip_address = p_ip and succeeded = false
      and created_at > now() - interval '10 minutes';

  select count(*) into v_code_attempts from public.athlete_access_attempts
    where action = 'lookup' and code_attempted = v_code and succeeded = false
      and created_at > now() - interval '10 minutes';

  if v_ip_attempts >= 20 or v_code_attempts >= 10 then
    insert into public.athlete_access_attempts(action, code_attempted, ip_address, succeeded)
      values ('lookup', v_code, p_ip, false);
    raise exception 'Too many attempts. Please try again later.';
  end if;

  select a.id, a.full_name, a.position, a.photo_url into v_match
    from public.athletes a where a.access_code = v_code and a.is_active = true;

  insert into public.athlete_access_attempts(action, code_attempted, ip_address, succeeded)
    values ('lookup', v_code, p_ip, v_match.id is not null);

  if v_match.id is not null then
    id := v_match.id;
    full_name := v_match.full_name;
    "position" := v_match.position;
    photo_url := v_match.photo_url;
    return next;
  end if;
  return;
end;
$$;

create or replace function update_athlete_photo_by_code(p_code text, p_photo_url text, p_ip text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_athlete_id uuid;
  v_ip_attempts int;
  v_code_attempts int;
  v_expected_marker text;
begin
  if length(v_code) = 0 or length(v_code) > 12
     or p_photo_url is null or length(p_photo_url) > 2048 then
    return false;
  end if;

  select count(*) into v_ip_attempts from public.athlete_access_attempts
    where action = 'photo_update' and p_ip is not null and ip_address = p_ip and succeeded = false
      and created_at > now() - interval '10 minutes';

  select count(*) into v_code_attempts from public.athlete_access_attempts
    where action = 'photo_update' and code_attempted = v_code and succeeded = false
      and created_at > now() - interval '10 minutes';

  if v_ip_attempts >= 20 or v_code_attempts >= 10 then
    insert into public.athlete_access_attempts(action, code_attempted, ip_address, succeeded)
      values ('photo_update', v_code, p_ip, false);
    raise exception 'Too many attempts. Please try again later.';
  end if;

  select id into v_athlete_id from public.athletes
    where access_code = v_code and is_active = true;

  if v_athlete_id is null then
    insert into public.athlete_access_attempts(action, code_attempted, ip_address, succeeded)
      values ('photo_update', v_code, p_ip, false);
    return false;
  end if;

  -- The photo must reference an object already uploaded under this athlete's
  -- OWN storage path (athletes/<athlete_id>.*). This prevents the RPC from
  -- being used to point an athlete's profile photo at an arbitrary external
  -- URL or another athlete's uploaded photo.
  v_expected_marker := 'athlete-photos/athletes/' || v_athlete_id::text;
  if position(v_expected_marker in p_photo_url) = 0 then
    insert into public.athlete_access_attempts(action, code_attempted, ip_address, succeeded)
      values ('photo_update', v_code, p_ip, false);
    raise exception 'Invalid photo reference.';
  end if;

  update public.athletes set photo_url = p_photo_url where id = v_athlete_id;

  insert into public.athlete_access_attempts(action, code_attempted, ip_address, succeeded)
    values ('photo_update', v_code, p_ip, true);

  return true;
end;
$$;

-- ─────────────────────────────────────────────
-- 11. EXPLICIT EXECUTE PRIVILEGES
--
--    Postgres grants EXECUTE on new functions to PUBLIC by default. Every
--    function above is revoked from PUBLIC first, then granted ONLY to the
--    specific role(s) that actually need it — this is the explicit audit
--    the review asked for, not an assumption.
--
--      current_org_id / is_super_user / is_org_administrator:
--        authenticated only. These are invoked from inside RLS policy
--        expressions evaluated as the `authenticated` role (see 0003), so
--        that role needs EXECUTE for those policies to work at all. `anon`
--        does not use them in any policy and gets no grant.
--
--      log_audit_event:
--        NO grant to anon or authenticated at all. Only reachable via an
--        internal call from another same-owner SECURITY DEFINER function
--        (audit_staff_profile_changes), which does not require a grant to
--        the original caller.
--
--      prevent_last_administrator_removal / _delete,
--      protect_staff_profile_identity_fields, audit_staff_profile_changes:
--        trigger functions. Trigger invocation does not require the
--        DML-issuing role to hold EXECUTE on the trigger function (this is
--        different from RLS policy expressions) — granted to nobody.
--
--      get_athlete_by_code / update_athlete_photo_by_code:
--        anon only. This is the intended, sole entry point for the
--        temporary PIN bridge. Not granted to authenticated: staff never
--        need this path (they have full RLS-scoped table access already),
--        so least-privilege says don't grant what isn't used.
-- ─────────────────────────────────────────────
revoke execute on function current_org_id() from public;
revoke execute on function is_super_user(uuid) from public;
revoke execute on function is_org_administrator() from public;
revoke execute on function log_audit_event(uuid, text, text, uuid, jsonb) from public;
revoke execute on function prevent_last_administrator_removal() from public;
revoke execute on function prevent_last_administrator_delete() from public;
revoke execute on function protect_staff_profile_identity_fields() from public;
revoke execute on function audit_staff_profile_changes() from public;
revoke execute on function get_athlete_by_code(text, text) from public;
revoke execute on function update_athlete_photo_by_code(text, text, text) from public;

grant execute on function current_org_id() to authenticated;
grant execute on function is_super_user(uuid) to authenticated;
grant execute on function is_org_administrator() to authenticated;
grant execute on function get_athlete_by_code(text, text) to anon;
grant execute on function update_athlete_photo_by_code(text, text, text) to anon;
-- log_audit_event and the trigger functions are granted to nobody by design.

COMMIT;
