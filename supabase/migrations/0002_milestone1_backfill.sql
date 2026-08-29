-- ============================================================
-- Milestone 1 — Data backfill (production-safe, final)
-- ============================================================
-- Run AFTER 0001_milestone1_schema.sql has been applied and verified.
-- Old RLS policies are still fully in effect while this runs — this file
-- makes no RLS-visible behavior change on its own, it only populates the
-- new tables/columns so 0003 has correct data to enforce against.
--
-- THIS IS A ONE-SHOT BOOTSTRAP, NOT AN IDEMPOTENT/REPEATABLE MIGRATION.
-- It asserts organizations/staff_profiles/platform_admins are all EMPTY
-- before writing anything, and hardcodes the exact row counts
-- independently verified in production immediately after 0001 (see the
-- Step 2 inventory). If ANY precondition differs — even by one row — it
-- aborts outright rather than attempting to reconcile or repair an
-- unexpected state automatically. A second run of this exact file after a
-- successful first run is EXPECTED to abort (organizations is no longer
-- empty) — that abort, not a silent no-op, is what guarantees this can
-- never duplicate the organization, the staff profile, or the Super User
-- registration.
--
-- SAFETY DESIGN:
--   - Wrapped in BEGIN/COMMIT. Every statement is ordinary transactional
--     DDL/DML. Any RAISE EXCEPTION anywhere aborts the entire migration
--     atomically; nothing partially commits.
--   - The primary account is validated BEFORE anything is written:
--       1. Exactly one auth.users row must match the email you provide
--          (0 or >1 matches aborts the migration).
--       2. That row's last_sign_in_at must NOT be null. Per the Step 1
--          inventory, the dormant/unconfirmed second account has NEVER
--          signed in — if the email you typed resolves to an account
--          that has never signed in, this looks like the wrong account
--          and the migration aborts rather than risk onboarding it.
--   - The SAME validated account receives BOTH an administrator
--     staff_profiles row (academy-level authority) AND a platform_admins
--     row (platform-level Super User authority) — these are two
--     architecturally distinct tables/decisions, deliberately bootstrapped
--     together here rather than as a separate loose statement.
--   - Does not touch auth.users, storage, existing RLS policies,
--     activity_routines, or activity_type.
--
-- BEFORE RUNNING: replace REPLACE_WITH_YOUR_PRIMARY_EMAIL below with your
-- primary account's exact email address, confirmed from your Step 1
-- auth.users inventory.
-- ============================================================

BEGIN;

do $$
declare
  v_org_id                 uuid;
  v_primary_email          text := 'REPLACE_WITH_YOUR_PRIMARY_EMAIL';
  v_primary_user_id        uuid;
  v_primary_last_sign_in   timestamptz;
  v_match_count            int;
begin
  -- 0. Guard: v_primary_email must look like a real email address.
  --    Deliberately NOT implemented as "does this equal the literal
  --    placeholder text" — that placeholder also appears as this
  --    variable's own default value above, so a normal find-and-replace-all
  --    (exactly how an operator edits this file) would replace BOTH
  --    occurrences identically, making an equality check against the
  --    placeholder always pass regardless of what was actually filled in.
  --    A shape-based check avoids that trap entirely and also catches
  --    other mistakes (blank value, stray whitespace, etc), not just the
  --    untouched placeholder.
  if v_primary_email is null or v_primary_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'v_primary_email must be set to a valid email address before running this migration (got: %).', v_primary_email;
  end if;

  -- 1. Validate the primary account exists, exactly once.
  select count(*) into v_match_count from auth.users where email = v_primary_email;
  if v_match_count = 0 then
    raise exception 'No auth.users row found with email %. Aborting — check the email and try again.', v_primary_email;
  elsif v_match_count > 1 then
    raise exception 'Multiple auth.users rows found with email % (expected exactly 1). Aborting.', v_primary_email;
  end if;

  select id, last_sign_in_at into v_primary_user_id, v_primary_last_sign_in
    from auth.users where email = v_primary_email;

  -- 2. Validate it is NOT the dormant/unconfirmed second account. Per the
  --    Step 1 inventory, that account has last_sign_in_at IS NULL. This
  --    catches a mistyped or wrong email resolving to the wrong account.
  if v_primary_last_sign_in is null then
    raise exception 'The account matched by % has never signed in (last_sign_in_at is null) — this looks like the dormant second account, not your primary account. Aborting.', v_primary_email;
  end if;

  -- 3. STRICT PRE-BACKFILL PRODUCTION ASSERTIONS.
  --    These hardcoded counts are NOT a general-purpose pattern — they are
  --    the exact, independently-verified production baseline confirmed
  --    immediately after 0001. This migration is a one-time, tightly
  --    scoped bootstrap tied to that specific, already-confirmed state.
  --    No attempt is made to reconcile or repair a mismatch — a human
  --    needs to look at it if any of these fire.
  if (select count(*) from athletes) <> 3 then
    raise exception 'Expected exactly 3 athletes, found %. Aborting — production state has changed since verification.', (select count(*) from athletes);
  end if;
  if (select count(*) from exercises) <> 8 then
    raise exception 'Expected exactly 8 exercises, found %. Aborting — production state has changed since verification.', (select count(*) from exercises);
  end if;
  if (select count(*) from weekly_plans) <> 3 then
    raise exception 'Expected exactly 3 weekly_plans, found %. Aborting — production state has changed since verification.', (select count(*) from weekly_plans);
  end if;
  if (select count(*) from assigned_exercises) <> 5 then
    raise exception 'Expected exactly 5 assigned_exercises, found %. Aborting — production state has changed since verification.', (select count(*) from assigned_exercises);
  end if;

  if (select count(*) from athletes where organization_id is not null) <> 0 then
    raise exception 'Expected all athletes to have organization_id IS NULL before backfill. Aborting.';
  end if;
  if (select count(*) from exercises where organization_id is not null) <> 0 then
    raise exception 'Expected all exercises to have organization_id IS NULL before backfill. Aborting.';
  end if;
  if (select count(*) from weekly_plans where organization_id is not null) <> 0 then
    raise exception 'Expected all weekly_plans to have organization_id IS NULL before backfill. Aborting.';
  end if;

  if (select count(*) from organizations) <> 0 then
    raise exception 'Expected organizations to be empty before this migration runs, found % row(s). Aborting — this migration may have already been applied; do not re-run it blindly.', (select count(*) from organizations);
  end if;
  if (select count(*) from staff_profiles) <> 0 then
    raise exception 'Expected staff_profiles to be empty before this migration runs, found % row(s). Aborting — this migration may have already been applied; do not re-run it blindly.', (select count(*) from staff_profiles);
  end if;
  if (select count(*) from platform_admins) <> 0 then
    raise exception 'Expected platform_admins to be empty before this migration runs, found % row(s). Aborting — this migration may have already been applied; do not re-run it blindly.', (select count(*) from platform_admins);
  end if;

  -- 4. Create the one real academy. Preconditions above already guarantee
  --    organizations is empty, so a plain INSERT is correct — no
  --    lookup-or-create needed, and none of that ambiguity is wanted here.
  insert into organizations (name, slug, timezone)
  values ('7AR Baseball Academy', '7ar-baseball-academy', 'America/New_York')
  returning id into v_org_id;

  -- 5. Create the ONE staff_profiles row — academy-level administrator
  --    authority — for the validated primary account. Preconditions
  --    already guarantee staff_profiles is empty.
  insert into staff_profiles (auth_user_id, organization_id, full_name, email, role, is_active, joined_at)
  select
    u.id,
    v_org_id,
    coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
    u.email,
    'administrator',
    true,
    now()
  from auth.users u
  where u.id = v_primary_user_id;

  -- 6. Create the ONE platform_admins row — platform-level Super User
  --    authority — for the SAME validated account. Deliberately bootstrapped
  --    here, not as a separate optional statement: Super User (platform)
  --    and Administrator (academy) are architecturally distinct tables and
  --    distinct kinds of authority, but for this rollout they are the same
  --    person, decided once, together, under the same validation. Preconditions
  --    already guarantee platform_admins is empty.
  insert into platform_admins (auth_user_id)
  values (v_primary_user_id);

  -- 7. Backfill organization_id onto existing academy-owned rows.
  --    activity_routines/activity_type intentionally not referenced —
  --    confirmed absent in production (see 0001's note).
  update athletes     set organization_id = v_org_id where organization_id is null;
  update exercises    set organization_id = v_org_id where organization_id is null;
  update weekly_plans set organization_id = v_org_id where organization_id is null;

  -- 8. Final sanity assertions before commit.
  if (select count(*) from organizations) <> 1 then
    raise exception 'Expected exactly 1 organization after insert, found %. Aborting.', (select count(*) from organizations);
  end if;

  if not exists (
    select 1 from staff_profiles
    where organization_id = v_org_id and auth_user_id = v_primary_user_id and role = 'administrator' and is_active = true
  ) or (select count(*) from staff_profiles) <> 1 then
    raise exception 'staff_profiles does not contain exactly one row matching the validated primary account as expected. Aborting.';
  end if;

  if not exists (select 1 from platform_admins where auth_user_id = v_primary_user_id)
     or (select count(*) from platform_admins) <> 1 then
    raise exception 'platform_admins does not contain exactly one row matching the validated primary account as expected. Aborting.';
  end if;

  if (select count(*) from athletes where organization_id is null) <> 0
     or (select count(*) from exercises where organization_id is null) <> 0
     or (select count(*) from weekly_plans where organization_id is null) <> 0 then
    raise exception 'organization_id backfill incomplete after update. Aborting.';
  end if;

  perform log_audit_event(
    v_org_id, 'system.migration_bootstrap', 'organization', v_org_id,
    jsonb_build_object(
      'primary_email', v_primary_email,
      'staff_profile_created', true,
      'platform_admin_created', true,
      'applied_at', now()
    )
  );
end $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- The second (dormant) auth.users account is deliberately left with NO
-- staff_profiles row and NO platform_admins row, and is not addressed
-- anywhere in this file. If you later decide to onboard it, that is a
-- distinct, future decision — do not add it here retroactively; do it as
-- its own explicit, reviewed action once you've confirmed what that
-- account actually is.
-- ─────────────────────────────────────────────────────────────
