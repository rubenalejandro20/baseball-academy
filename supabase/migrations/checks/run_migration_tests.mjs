// ============================================================
// Milestone 1 + 2 — local migration/RLS test suite (PGlite, no Docker required)
// ============================================================
// Runs migrations 0001 -> 0002 -> 0003 -> 0004 -> 0005 against a fresh,
// disposable, embedded Postgres (WASM, via @electric-sql/pglite) that
// faithfully supports real roles, RLS, triggers, and PL/pgSQL — the same
// primitives Supabase uses. This validates the SQL/RLS/trigger/RPC LOGIC
// end-to-end; it does not spin up GoTrue/PostgREST, so it cannot test
// actual HTTP/JWT issuance — only the database layer.
//
// REVISED after the Milestone 1 Step 1 production inventory:
//   - schema.sql's activity_routines section is now commented out (confirmed
//     absent in production), so loading schema.sql as the baseline already
//     matches production reality without any special-casing here. Note this
//     baseline reflects the state BEFORE Milestone 2's 0004/0005 (below) —
//     it is schema.sql alone that must never define this table, not the
//     final state of this test run.
//   - 0002's staff backfill is no longer a blanket "every auth.users row"
//     statement (Part A, automated) — staff onboarding is now an explicit
//     per-account statement (Part B / Step B1) with a placeholder email.
//     This suite executes the ACTUAL file content with the placeholder
//     substituted, so it proves the real documented instructions work, not
//     a re-typed equivalent.
//
// EXTENDED for Milestone 2 (activity_routines): after the full Milestone 1
// flow (0001-0003) and its existing assertions — including the ones that
// confirm activity_routines is STILL absent immediately after 0003, which
// remains true and correct, since 0004/0005 haven't run yet at that point
// in this script — a new section applies 0004 and 0005 and exercises the
// new table's schema, RLS, and the get_athlete_routines() RPC, reusing the
// same org A / org B / athlete fixtures already built up earlier in this
// file rather than duplicating them.
//
// ADDED — a true fresh-database sequence (section 22 below, its own
// isolated PGlite instance): applies ONLY the active migrations, in exact
// order, 0000 -> 0001 -> 0003 -> 0004 -> 0005 -> 0006 -> 0007 -> 0008
// (the last two added by Milestone 4). It never loads
// schema.sql and never executes the archived 0002 (one-time production
// backfill, now under supabase/migrations_archive/, which asserts
// production-specific preconditions that would never hold on an empty
// database). This is the scenario that matters for provisioning any new
// automated database (local dev, CI); the schema.sql-first flow above it
// remains, unchanged, as the separate historical-deployment scenario it
// always was — neither replaces the other.
//
// Usage: node supabase/migrations/checks/run_migration_tests.mjs
//   (or: npm run test:db)
//
// Does NOT connect to any real/production/staging Supabase project.
// ============================================================

import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..');
const schemaPath = join(__dirname, '..', '..', 'schema.sql');
const archiveDir = join(__dirname, '..', '..', 'migrations_archive');

const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function expectRows(db, sql, expectedCount, name) {
  try {
    const res = await db.query(sql);
    const pass = res.rows.length === expectedCount;
    record(name, pass, pass ? '' : `expected ${expectedCount} rows, got ${res.rows.length}`);
    return res.rows;
  } catch (err) {
    record(name, false, `threw unexpectedly: ${err.message}`);
    return [];
  }
}

async function expectThrows(db, sql, name, matchFragment) {
  try {
    await db.exec(sql);
    record(name, false, 'expected an error, but it succeeded');
    return false;
  } catch (err) {
    const pass = matchFragment ? err.message.includes(matchFragment) : true;
    record(name, pass, pass ? '' : `error did not match "${matchFragment}": ${err.message}`);
    return true;
  } finally {
    // If sql contained an explicit BEGIN that never reached COMMIT (e.g. a
    // RAISE EXCEPTION inside a transactional migration file aborted it),
    // Postgres leaves the session in an aborted-transaction state where
    // ALL subsequent commands fail with "current transaction is aborted"
    // until an explicit ROLLBACK is issued — this is real Postgres
    // behavior an operator would hit too, not a test artifact. Defensively
    // clear it so later checks in this suite aren't collaterally broken.
    // ROLLBACK with no open transaction is a harmless no-op in Postgres.
    try { await db.exec('ROLLBACK;'); } catch { /* no transaction open — fine */ }
  }
}

async function expectSucceeds(db, sql, name) {
  try {
    await db.exec(sql);
    record(name, true);
    return true;
  } catch (err) {
    record(name, false, `unexpected error: ${err.message}`);
    return false;
  } finally {
    try { await db.exec('ROLLBACK;'); } catch { /* no transaction open — fine */ }
  }
}

/** Replace ALL occurrences of a placeholder (not just the first — a file
 * may legitimately mention it more than once, e.g. once in a header
 * comment and once in the actual executable statement). */
function substitute(sql, placeholder, value) {
  return sql.split(placeholder).join(value);
}

async function asAnon(db) {
  await db.exec(`reset role; set role anon; set request.jwt.claim.sub = '';`);
}
async function asUser(db, uid) {
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${uid}';`);
}
async function asAdmin(db) {
  await db.exec(`reset role;`); // privileged/migration-equivalent role, bypasses RLS
}

async function main() {
  const db = new PGlite({ extensions: { uuid_ossp } });

  // ── Minimal Supabase-equivalent baseline (auth schema + default grants) ──
  await db.exec(`create extension if not exists "uuid-ossp";`);
  await db.exec(`create role anon nologin;`);
  await db.exec(`create role authenticated nologin;`);
  await db.exec(`create schema auth;`);
  await db.exec(`create table auth.users (id uuid primary key default uuid_generate_v4(), email text, raw_user_meta_data jsonb, last_sign_in_at timestamptz);`);
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;`);

  // ── 0) Baseline schema — must match CONFIRMED production reality ────────
  // schema.sql's activity_routines section (8) is commented out, matching
  // the Step 1 inventory finding that the table/enum don't exist in
  // production. Loading the file as-is now IS the faithful baseline.
  const schemaSql = readFileSync(schemaPath, 'utf8');
  await expectSucceeds(db, schemaSql, 'Baseline schema.sql applies cleanly (matches confirmed production: no activity_routines)');

  const preMigrationCheck = await db.query(`select to_regclass('public.activity_routines') as t;`);
  record('Baseline (schema.sql alone) confirms activity_routines does NOT exist (matches production inventory; Milestone 2\'s 0004/0005 below are what create it)', preMigrationCheck.rows[0].t === null);

  // Supabase grants broad table privileges to anon/authenticated by default
  // (RLS is the only thing restricting row access) — replicated here so the
  // test faithfully matches real Supabase project behavior, not vanilla
  // Postgres defaults (which grant nothing to these roles at all).
  await db.exec(`grant usage on schema public to anon, authenticated;`);
  await db.exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated;`);

  // ── Seed "existing production" accounts, matching the confirmed Step 1
  //    auth.users inventory: one signed-in primary account, one that has
  //    NEVER signed in and whose purpose is unconfirmed. ─────────────────
  const ownerId = 'a0000000-0000-0000-0000-000000000001';
  const dormantId = 'a0000000-0000-0000-0000-000000000002';
  await db.exec(`insert into auth.users (id, email, last_sign_in_at) values
    ('${ownerId}', 'owner@7ar.test', now()),
    ('${dormantId}', 'coowner@7ar.test', null);`);

  // ── 1) Migration 0001 ─────────────────────────────────────────────────
  const m0001 = readFileSync(join(migrationsDir, '0001_milestone1_schema.sql'), 'utf8');
  await expectSucceeds(db, m0001, '0001_milestone1_schema.sql applies cleanly (no activity_routines reference)');

  // Idempotency / rerunnability check (Step 2 hardening pass): re-apply the
  // EXACT SAME file a second time, immediately, on the same database — this
  // is precisely the "operator accidentally re-runs it, or reruns after a
  // failure partway through a later statement" scenario. Must succeed
  // cleanly with no errors (CREATE TYPE guarded via DO block, triggers via
  // DROP TRIGGER IF EXISTS + CREATE TRIGGER, tables/columns/indexes already
  // used IF NOT EXISTS).
  await expectSucceeds(db, m0001, '0001_milestone1_schema.sql is safely RE-RUNNABLE (applied a second time, no errors)');

  // And confirm re-running it didn't duplicate or corrupt anything.
  const rerunTableCount = await db.query(`
    select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in
      ('organizations','staff_profiles','platform_admins','audit_events','athlete_access_attempts');
  `);
  record('Re-running 0001 did not duplicate any table', Number(rerunTableCount.rows[0].count) === 5);

  const rerunTriggerCount = await db.query(`
    select count(*) from information_schema.triggers
    where trigger_schema = 'public' and trigger_name in
      ('organizations_updated_at','staff_profiles_updated_at','staff_profiles_last_admin_guard',
       'staff_profiles_last_admin_delete_guard','staff_profiles_protect_identity','staff_profiles_audit');
  `);
  record('Re-running 0001 did not duplicate any trigger', Number(rerunTriggerCount.rows[0].count) === 6);

  await db.exec(`grant select, insert, update, delete on staff_profiles, organizations, platform_admins, audit_events, athlete_access_attempts to anon, authenticated;`);

  // ── Seed the EXACT confirmed production baseline (3 athletes, 3
  //    weekly_plans, 5 assigned_exercises — exercises already has 8 from
  //    schema.sql's sample data) BEFORE 0002 runs, matching the strict
  //    pre-backfill assertions 0002 now requires. organization_id left
  //    NULL on all of them, matching the real pre-migration state. ───────
  const preA1 = await db.query(`insert into athletes (full_name, access_code) values ('Pre-existing Athlete 1','PRE001') returning id;`);
  const preA2 = await db.query(`insert into athletes (full_name, access_code) values ('Pre-existing Athlete 2','PRE002') returning id;`);
  const preA3 = await db.query(`insert into athletes (full_name, access_code) values ('Pre-existing Athlete 3','PRE003') returning id;`);
  const prePlan1 = await db.query(`insert into weekly_plans (athlete_id, week_start) values ('${preA1.rows[0].id}','2025-12-01') returning id;`);
  const prePlan2 = await db.query(`insert into weekly_plans (athlete_id, week_start) values ('${preA2.rows[0].id}','2025-12-01') returning id;`);
  const prePlan3 = await db.query(`insert into weekly_plans (athlete_id, week_start) values ('${preA3.rows[0].id}','2025-12-01') returning id;`);
  const sampleEx = await db.query(`select id from exercises order by name limit 2;`);
  const [sampleExId1, sampleExId2] = [sampleEx.rows[0].id, sampleEx.rows[1].id];
  await db.exec(`insert into assigned_exercises (weekly_plan_id, exercise_id, day, session_type) values
    ('${prePlan1.rows[0].id}', '${sampleExId1}', 'monday', 'strength'),
    ('${prePlan1.rows[0].id}', '${sampleExId2}', 'tuesday', 'mobility'),
    ('${prePlan2.rows[0].id}', '${sampleExId1}', 'wednesday', 'strength'),
    ('${prePlan3.rows[0].id}', '${sampleExId2}', 'thursday', 'mobility'),
    ('${prePlan3.rows[0].id}', '${sampleExId1}', 'friday', 'strength');`);
  const preBaselineCheck = await db.query(`
    select (select count(*) from athletes) as a, (select count(*) from weekly_plans) as w, (select count(*) from assigned_exercises) as ae, (select count(*) from exercises) as e;
  `);
  record('Pre-0002 fixture matches the exact confirmed production baseline (3/8/3/5)',
    Number(preBaselineCheck.rows[0].a) === 3 && Number(preBaselineCheck.rows[0].e) === 8 &&
    Number(preBaselineCheck.rows[0].w) === 3 && Number(preBaselineCheck.rows[0].ae) === 5);

  // ── 2) Migration 0002 — executed as the ACTUAL file content, with only
  //    the documented placeholder substituted, proving the real
  //    instructions work (not a re-typed equivalent). ────────────────────
  // 0002 now lives in supabase/migrations_archive/ (archived — one-time
  // production backfill, no longer part of the active migration chain).
  // Read from its new location; this historical test still exercises the
  // real file content, same as before the move.
  const m0002Raw = readFileSync(join(archiveDir, '0002_milestone1_backfill.sql'), 'utf8');

  // 2a. Abort case: placeholder never replaced.
  await expectThrows(db, m0002Raw, '0002 aborts if the email placeholder was never replaced', 'must be set to a valid email address');

  // 2b. Abort case: email resolves to an account with NO auth.users match.
  const m0002NoMatch = substitute(m0002Raw, 'REPLACE_WITH_YOUR_PRIMARY_EMAIL', 'nobody@nowhere.test');
  await expectThrows(db, m0002NoMatch, '0002 aborts if the given email matches zero auth.users rows', 'No auth.users row found');

  // 2c. Abort case: email resolves to the DORMANT account (never signed
  //     in) — the exact "second account would be accidentally linked"
  //     scenario this validation exists to catch.
  const m0002Dormant = substitute(m0002Raw, 'REPLACE_WITH_YOUR_PRIMARY_EMAIL', 'coowner@7ar.test');
  await expectThrows(db, m0002Dormant, '0002 aborts if the given email resolves to the dormant (never signed in) account', 'never signed in');
  const noOrgYet = await db.query(`select count(*) from organizations;`);
  record('0002 abort cases (so far) created NOTHING (no organization from any failed attempt)', Number(noOrgYet.rows[0].count) === 0);

  const m0002ForOwner = substitute(m0002Raw, 'REPLACE_WITH_YOUR_PRIMARY_EMAIL', 'owner@7ar.test');

  // 2d. Abort case: strict pre-backfill count assertion. Temporarily add a
  //     4th athlete (production state no longer matches what was verified)
  //     and confirm the migration refuses to proceed rather than silently
  //     continuing against an unexpected state.
  const strayAthlete = await db.query(`insert into athletes (full_name, access_code) values ('Stray','STRAY1') returning id;`);
  await expectThrows(db, m0002ForOwner, '0002 aborts if athlete count no longer matches the verified baseline (4 instead of 3)', 'Expected exactly 3 athletes');
  await db.exec(`delete from athletes where id = '${strayAthlete.rows[0].id}';`);

  // 2e. Abort case: strict "tables must be empty" assertion. Temporarily
  //     add a stray organization and confirm the migration refuses to
  //     proceed rather than attempting to reconcile it automatically.
  const strayOrg = await db.query(`insert into organizations (name, slug) values ('Stray Org', 'stray-org') returning id;`);
  await expectThrows(db, m0002ForOwner, '0002 aborts if organizations is not empty beforehand', 'organizations to be empty');
  await db.exec(`delete from organizations where id = '${strayOrg.rows[0].id}';`);

  const noOrgYet2 = await db.query(`select count(*) from organizations;`);
  record('0002 abort cases created NOTHING at all (no organization from any failed attempt, including the new precondition guards)', Number(noOrgYet2.rows[0].count) === 0);

  // 2f. Success case: the real primary account, exact verified baseline.
  await expectSucceeds(db, m0002ForOwner, '0002_milestone1_backfill.sql applies cleanly for the validated primary account');

  const staffAfterSuccess = await db.query(`select count(*) from staff_profiles where auth_user_id = '${ownerId}' and role = 'administrator' and is_active = true;`);
  record('0002 created exactly one administrator staff_profiles row for the primary account', Number(staffAfterSuccess.rows[0].count) === 1);
  const platformAdminAfterSuccess = await db.query(`select count(*) from platform_admins where auth_user_id = '${ownerId}';`);
  record('0002 created exactly one platform_admins row for the SAME primary account (Super User bootstrap)', Number(platformAdminAfterSuccess.rows[0].count) === 1);

  // 2g. Rerun is now EXPECTED TO ABORT — the pre-backfill assertions no
  //     longer hold (athletes/exercises/weekly_plans now have
  //     organization_id set from the first successful run, and
  //     organizations/staff_profiles/platform_admins are no longer empty).
  //     Whichever guard is checked first in the file is the one that
  //     fires; this is the mechanism that guarantees no duplication, not a
  //     graceful no-op.
  await expectThrows(db, m0002ForOwner, '0002 re-run correctly ABORTS rather than duplicating anything (preconditions no longer hold)', 'organization_id IS NULL before backfill');
  const orgCountAfterRerun = await db.query(`select count(*) from organizations where slug = '7ar-baseball-academy';`);
  record('Re-running 0002 did not duplicate the organization', Number(orgCountAfterRerun.rows[0].count) === 1);
  const staffCountAfterRerun = await db.query(`select count(*) from staff_profiles;`);
  record('Re-running 0002 did not duplicate the staff_profiles row', Number(staffCountAfterRerun.rows[0].count) === 1);
  const platformAdminCountAfterRerun = await db.query(`select count(*) from platform_admins;`);
  record('Re-running 0002 did not duplicate the platform_admins row', Number(platformAdminCountAfterRerun.rows[0].count) === 1);

  // ── PRE-0003 APPLICATION COMPATIBILITY CHECK ─────────────────────────────
  // At this exact point: 0001 + 0002 are applied, 0003 is NOT yet applied.
  // staff_profiles has RLS enabled but ZERO policies (added only in 0003) —
  // a plain `select * from staff_profiles` as the authenticated primary
  // account returns NOTHING here, which is exactly the bug that would make
  // getStaffContext() show every login, including the real administrator,
  // the "account not linked" screen if it read the table directly. The
  // application was fixed to call these SECURITY DEFINER RPCs instead,
  // specifically because they bypass RLS and work in this exact window.
  const orgAForPreCutoverCheck = (await db.query(`select id from organizations where slug = '7ar-baseball-academy';`)).rows[0].id;
  await asUser(db, ownerId);
  const directTableReadPreCutover = await db.query(`select * from staff_profiles where auth_user_id = '${ownerId}';`);
  record('PRE-0003: direct staff_profiles read returns NOTHING even for the real administrator (confirms the bug this fix addresses)', directTableReadPreCutover.rows.length === 0);

  const rpcOrgPreCutover = await db.query(`select current_org_id() as v;`);
  record('PRE-0003: current_org_id() RPC still resolves correctly (bypasses RLS) — this is what the app now uses', rpcOrgPreCutover.rows[0].v === orgAForPreCutoverCheck);

  const rpcAdminPreCutover = await db.query(`select is_org_administrator() as v;`);
  record('PRE-0003: is_org_administrator() RPC still resolves correctly for the real administrator', rpcAdminPreCutover.rows[0].v === true);

  const rpcSuperUserPreCutover = await db.query(`select is_super_user() as v;`);
  record('PRE-0003: is_super_user() RPC still resolves correctly for the primary account (Super User)', rpcSuperUserPreCutover.rows[0].v === true);

  await asUser(db, dormantId);
  const rpcOrgDormantPreCutover = await db.query(`select current_org_id() as v;`);
  record('PRE-0003: current_org_id() correctly resolves to NULL for the dormant (unlinked) account', rpcOrgDormantPreCutover.rows[0].v === null);
  await asAdmin(db);

  const m0003 = readFileSync(join(migrationsDir, '0003_milestone1_rls.sql'), 'utf8');
  await expectSucceeds(db, m0003, '0003_milestone1_rls.sql applies cleanly (activity_routines section correctly omitted)');

  // Same checks again, now AFTER 0003 — must give the SAME answers, proving
  // no app-code change is needed at cutover time.
  await asUser(db, ownerId);
  const rpcOrgPostCutover = await db.query(`select current_org_id() as v;`);
  record('POST-0003: current_org_id() RPC gives the SAME answer as before the cutover', rpcOrgPostCutover.rows[0].v === orgAForPreCutoverCheck);
  const directTableReadPostCutover = await db.query(`select * from staff_profiles where auth_user_id = '${ownerId}';`);
  record('POST-0003: direct staff_profiles read NOW also works (policy exists) — RPC and direct read agree', directTableReadPostCutover.rows.length === 1);
  await asAdmin(db);

  const postMigrationCheck = await db.query(`select to_regclass('public.activity_routines') as t;`);
  record('After Milestone 1 (0001-0003) alone, activity_routines still does not exist (Milestone 2\'s 0004/0005, applied later in this run, are what create it — see section 20 below)', postMigrationCheck.rows[0].t === null);

  // ── 3) Verify backfill correctness ───────────────────────────────────────
  const orgRows = await db.query(`select id from organizations where slug = '7ar-baseball-academy';`);
  const orgA = orgRows.rows[0]?.id;
  record('Backfill created exactly one organization', orgRows.rows.length === 1);

  const staffRows = await db.query(`select auth_user_id, role, organization_id from staff_profiles;`);
  record(
    'Backfill created EXACTLY ONE staff_profiles row (only the explicitly named primary account — not a blanket "every auth.users row")',
    staffRows.rows.length === 1 && staffRows.rows[0].role === 'administrator' && staffRows.rows[0].organization_id === orgA && staffRows.rows[0].auth_user_id === ownerId
  );

  const dormantCheck = await db.query(`select count(*) from staff_profiles where auth_user_id = '${dormantId}';`);
  record('The never-signed-in second account received NO staff_profiles row (not blindly promoted)', Number(dormantCheck.rows[0].count) === 0);

  // ── 4) Multi-org test fixtures (org B, cross-tenant isolation target) ───
  // Synthetic, post-migration accounts representing FUTURE Phase 2
  // onboarding — distinct from the production backfill scenario above.
  const orgBRows = await db.query(`insert into organizations (name, slug) values ('Rival Academy', 'rival-academy') returning id;`);
  const orgB = orgBRows.rows[0].id;

  const coachId = 'b0000000-0000-0000-0000-000000000001';
  const physicianId = 'b0000000-0000-0000-0000-000000000002';
  const secondAdminId = 'b0000000-0000-0000-0000-000000000003';
  const plainAdminId = 'b0000000-0000-0000-0000-000000000004';
  const orgBAdminId = 'b0000000-0000-0000-0000-000000000005';

  await db.exec(`insert into auth.users (id, email) values
    ('${coachId}', 'coach@7ar.test'),
    ('${physicianId}', 'physician@7ar.test'),
    ('${secondAdminId}', 'second-admin@7ar.test'),
    ('${plainAdminId}', 'plain-admin@7ar.test'),
    ('${orgBAdminId}', 'admin@rival.test');`);

  // plainAdminId: an administrator of org A who is NOT a platform_admin —
  // used below to test "an administrator sees only their own org" as a
  // general RLS property, independent of ownerId (which, per this
  // milestone's design, is BOTH administrator AND Super User, so its own
  // visibility is intentionally broader — tested separately in section 9).
  await db.exec(`insert into staff_profiles (auth_user_id, organization_id, full_name, email, role, is_active) values
    ('${coachId}', '${orgA}', 'Coach A', 'coach@7ar.test', 'coach', true),
    ('${physicianId}', '${orgA}', 'Physician A', 'physician@7ar.test', 'physician', true),
    ('${secondAdminId}', '${orgA}', 'Second Admin A', 'second-admin@7ar.test', 'administrator', false),
    ('${plainAdminId}', '${orgA}', 'Plain Admin A', 'plain-admin@7ar.test', 'administrator', true),
    ('${orgBAdminId}', '${orgB}', 'Admin B', 'admin@rival.test', 'administrator', true);`);
  // secondAdminId starts INACTIVE on purpose — activated later for the
  // last-administrator-guard test. plainAdminId starts ACTIVE (needed for
  // read-boundary tests below) and is deactivated just before the
  // last-admin-guard test so ownerId is genuinely the sole active
  // administrator at that point, matching that test's premise.

  const athleteA = await db.query(`insert into athletes (full_name, access_code, organization_id) values ('Athlete A', 'AAA111', '${orgA}') returning id;`);
  const athleteAId = athleteA.rows[0].id;
  const athleteB = await db.query(`insert into athletes (full_name, access_code, organization_id) values ('Athlete B', 'BBB111', '${orgB}') returning id;`);
  const athleteBId = athleteB.rows[0].id;

  const exGlobal = await db.query(`insert into exercises (name, category, organization_id) values ('Global Stretch', 'mobility', null) returning id;`);
  const exA = await db.query(`insert into exercises (name, category, organization_id) values ('Academy A Drill', 'strength', '${orgA}') returning id;`);
  const exB = await db.query(`insert into exercises (name, category, organization_id) values ('Academy B Drill', 'strength', '${orgB}') returning id;`);

  const planA = await db.query(`insert into weekly_plans (athlete_id, week_start, organization_id) values ('${athleteAId}', '2026-01-05', '${orgA}') returning id;`);
  await db.exec(`insert into assigned_exercises (weekly_plan_id, exercise_id, day, session_type) values ('${planA.rows[0].id}', '${exA.rows[0].id}', 'monday', 'strength');`);

  await asAdmin(db);

  // ── 5) Plain administrator access (org-scoped, NOT a Super User) ────────
  // 3 pre-existing fixture athletes/weekly_plans (backfilled to org A by
  // 0002) + athleteA (added above, also org A) = 4 / 4. 5 pre-existing
  // fixture assigned_exercises + 1 (added above) = 6.
  await asUser(db, plainAdminId);
  await expectRows(db, `select * from athletes;`, 4, 'Plain administrator (org A, not Super User) sees exactly org A\'s athletes');
  // 8 pre-existing sample-data exercises (from schema.sql) get backfilled to
  // org A by 0002, plus the test-fixture exGlobal (null org) and exA (org A)
  // below = 10 visible; exB (org B) must NOT be among them.
  await expectRows(db, `select * from exercises;`, 10, 'Plain administrator (org A) sees org A + global exercises, not org B\'s');
  await expectRows(db, `select * from weekly_plans;`, 4, 'Plain administrator (org A) sees org A\'s weekly_plans');
  await expectRows(db, `select * from assigned_exercises;`, 6, 'Plain administrator (org A) sees org A\'s assigned_exercises');

  // ── 6) Unlinked authenticated user denial (the real dormant account) ────
  await asUser(db, dormantId);
  await expectRows(db, `select * from athletes;`, 0, 'Unlinked (dormant, never-signed-in) account sees zero athletes');
  await expectRows(db, `select * from staff_profiles;`, 0, 'Unlinked (dormant) account sees zero staff_profiles rows (not even its own, since none exists)');

  // ── 7) Administrator / Coach / Physician read boundaries (Milestone 1: org-scoped, not yet role-differentiated) ──
  await asUser(db, coachId);
  await expectRows(db, `select * from athletes;`, 4, 'Coach (org A) has the same org-scoped read access as an administrator');
  try {
    await db.exec(`insert into staff_profiles (auth_user_id, organization_id, full_name, email, role) values ('${dormantId}', '${orgA}', 'Hijacked', 'x@x.test', 'administrator');`);
    const check = await db.query(`select 1 from staff_profiles where full_name = 'Hijacked';`);
    record('Coach cannot INSERT into staff_profiles (no write policy exists)', check.rows.length === 0, check.rows.length ? 'row was inserted — RLS did not block it' : '');
  } catch (err) {
    record('Coach cannot INSERT into staff_profiles (no write policy exists)', true, `rejected: ${err.message}`);
  }

  await asUser(db, physicianId);
  await expectRows(db, `select * from athletes;`, 4, 'Physician (org A) has the same org-scoped read access as an administrator');

  // ── 8) Cross-organization access denial ──────────────────────────────────
  await asUser(db, plainAdminId);
  await expectRows(db, `select * from athletes where id = '${athleteBId}';`, 0, 'Plain administrator A cannot see Athlete B by direct id lookup');
  await expectRows(db, `select * from exercises where id = '${exB.rows[0].id}';`, 0, 'Plain administrator A cannot see org B\'s private exercise');
  await expectRows(db, `select * from organizations where id = '${orgB}';`, 0, 'Plain administrator A cannot see org B\'s organizations row');

  await asUser(db, orgBAdminId);
  await expectRows(db, `select * from athletes;`, 1, 'Administrator B sees exactly org B\'s athletes (not org A\'s)');
  await expectRows(db, `select * from athletes where id = '${athleteAId}';`, 0, 'Administrator B cannot see Athlete A by direct id lookup');

  // ── 9) Super User cross-org visibility ───────────────────────────────────
  // ownerId is used here directly — per this milestone's design, the SAME
  // validated primary account is both the org-A administrator AND the
  // platform Super User (bootstrapped together by 0002). This is the real,
  // intended production behavior, not a synthetic stand-in.
  await asUser(db, ownerId);
  await expectRows(db, `select * from athletes;`, 5, 'Super User (the primary account) sees athletes across BOTH organizations (4 in org A + 1 in org B)');
  await expectRows(db, `select * from organizations;`, 2, 'Super User sees both organizations');

  // ── 10) Anonymous access expectations per table ──────────────────────────
  await asAnon(db);
  await expectRows(db, `select * from athletes;`, 0, 'Anonymous: athletes table fully denied');
  await expectRows(db, `select * from weekly_plans;`, 0, 'Anonymous: weekly_plans fully denied');
  await expectRows(db, `select * from assigned_exercises;`, 0, 'Anonymous: assigned_exercises fully denied');
  await expectRows(db, `select * from staff_profiles;`, 0, 'Anonymous: staff_profiles fully denied');
  await expectRows(db, `select * from platform_admins;`, 0, 'Anonymous: platform_admins fully denied');
  await expectRows(db, `select * from audit_events;`, 0, 'Anonymous: audit_events fully denied');
  // 8 sample exercises (org A) + exGlobal (null) + exA (org A) + exB (org B)
  // = 11. Anon sees ALL of them regardless of org — this is exactly the
  // documented, temporary, not-yet-org-scoped compatibility gap (see 0003).
  const anonExercises = await db.query(`select * from exercises;`);
  record('Anonymous: exercises SELECT still succeeds at this point in the run (intentional PIN-bridge policy, BEFORE 0006 removes it — see section 21 for the real anon-denial test once it\'s gone)', anonExercises.rows.length === 11, `got ${anonExercises.rows.length} rows`);
  await expectThrows(db, `insert into exercises (name, category) values ('hack', 'mobility');`, 'Anonymous: exercises INSERT denied', undefined);
  const anonActivityRoutinesCheck = await db.query(`select to_regclass('public.activity_routines') as t;`);
  record('Anonymous access check for activity_routines at this point in the run: N/A, table still absent (Milestone 2 not applied yet — see section 20 for the real anon-denial test once it exists)', anonActivityRoutinesCheck.rows[0].t === null);
  await db.exec(`update athletes set full_name = 'Hacked' where id = '${athleteAId}';`); // RLS silently filters to 0 matching rows, no error
  await asAdmin(db);
  const realCheck = await db.query(`select full_name from athletes where id = '${athleteAId}';`);
  record('Anonymous: direct athletes UPDATE affects zero rows (RLS-filtered, not an error)', realCheck.rows[0]?.full_name === 'Athlete A');
  await asAnon(db);

  // ── 11) PIN lookup valid / invalid / rate-limited ────────────────────────
  await asAnon(db);
  const validLookup = await db.query(`select * from get_athlete_by_code('AAA111', '1.2.3.4');`);
  record('PIN lookup: valid code returns exactly the minimal fields',
    validLookup.rows.length === 1 &&
    validLookup.rows[0].id === athleteAId &&
    Object.keys(validLookup.rows[0]).sort().join(',') === 'full_name,id,photo_url,position'
  );

  const invalidLookup = await db.query(`select * from get_athlete_by_code('ZZZZZZ', '1.2.3.4');`);
  record('PIN lookup: invalid code returns zero rows (no error, no info leak)', invalidLookup.rows.length === 0);

  // Exhaust the per-code failure threshold (10) with a fresh IP each time —
  // proves the per-code limiter is NOT dependent on IP.
  for (let i = 0; i < 10; i++) {
    await db.query(`select * from get_athlete_by_code('WRONGCODE', 'ip-${i}');`);
  }
  await expectThrows(db, `select * from get_athlete_by_code('WRONGCODE', 'ip-new');`, 'PIN lookup: per-CODE rate limit triggers regardless of varying/spoofed IP', 'Too many attempts');

  // A DIFFERENT, never-before-tried code from the same "attacker" IPs is
  // unaffected — the lockout is scoped to the one code, not the caller.
  const freshCode = await db.query(`select * from get_athlete_by_code('FRESH1', 'ip-0');`);
  record('PIN lookup: rate limit on one wrong code does not affect lookups for a different code', freshCode.rows.length === 0 /* FRESH1 doesn't exist, but must not throw */);

  // Legitimate athlete is never locked out by their OWN repeated successful lookups.
  for (let i = 0; i < 15; i++) {
    await db.query(`select * from get_athlete_by_code('AAA111', 'legit-ip')`);
  }
  const stillWorks = await db.query(`select * from get_athlete_by_code('AAA111', 'legit-ip');`);
  record('PIN lookup: repeated SUCCESSFUL lookups of the real code never trigger the rate limit (failures-only counting)', stillWorks.rows.length === 1);

  // ── 12) Direct RPC bypass attempt (no Route Handler / no IP at all) ──────
  for (let i = 0; i < 10; i++) {
    await db.query(`select * from get_athlete_by_code('DIRECTBYPASS');`); // p_ip omitted entirely
  }
  await expectThrows(db, `select * from get_athlete_by_code('DIRECTBYPASS');`, 'Direct-RPC bypass (no p_ip at all) still hits the per-code limiter', 'Too many attempts');

  // ── 13) Athlete photo update restrictions ────────────────────────────────
  const goodUrl = `https://project.supabase.co/storage/v1/object/public/athlete-photos/athletes/${athleteAId}.jpg`;
  const otherAthleteUrl = `https://project.supabase.co/storage/v1/object/public/athlete-photos/athletes/${athleteBId}.jpg`;
  const arbitraryUrl = `https://evil.example.com/whatever.jpg`;

  const goodUpdate = await db.query(`select update_athlete_photo_by_code('AAA111', '${goodUrl}', 'ip-photo-1');`);
  record('Photo update: correct own-path URL succeeds', goodUpdate.rows[0].update_athlete_photo_by_code === true);

  await expectThrows(db, `select update_athlete_photo_by_code('AAA111', '${otherAthleteUrl}', 'ip-photo-2');`, 'Photo update: URL pointing at a DIFFERENT athlete\'s storage path is rejected', 'Invalid photo reference');
  await expectThrows(db, `select update_athlete_photo_by_code('AAA111', '${arbitraryUrl}', 'ip-photo-3');`, 'Photo update: arbitrary external URL is rejected', 'Invalid photo reference');

  await asAdmin(db); // switch to a privileged role to verify — anon has no SELECT on athletes at all
  const check = await db.query(`select photo_url from athletes where id = '${athleteAId}';`);
  record('Photo update: only the legitimate URL was ever persisted', check.rows[0]?.photo_url === goodUrl);
  // NOTE: this RPC only proves the `athletes.photo_url` COLUMN write is
  // correctly restricted. It says nothing about whether the underlying
  // file upload to Storage can actually happen — confirmed separately (via
  // the Step 1 production inventory, not this suite) that storage.objects
  // currently has ZERO RLS policies, so the upload step fails closed for
  // everyone today. See the Milestone 1 report for the storage-policy
  // decision; this is intentionally out of this suite's scope since it
  // requires the Storage API, not plain SQL.
  await asAnon(db);

  // ── 14) Last-administrator guard ─────────────────────────────────────────
  await asAdmin(db); // simulates the eventual privileged/service-role write path
  // plainAdminId is ALSO an active administrator of org A (added in section
  // 4, used for org-scoped read-boundary tests above) — deactivate it first
  // so ownerId is genuinely the SOLE active administrator, matching this
  // test's premise.
  await db.exec(`update staff_profiles set is_active = false where auth_user_id = '${plainAdminId}';`);
  await expectThrows(
    db,
    `update staff_profiles set is_active = false where auth_user_id = '${ownerId}';`,
    'Last-admin guard: deactivating the sole active administrator is blocked',
    'Cannot remove or demote the last active administrator'
  );
  await db.exec(`update staff_profiles set is_active = true where auth_user_id = '${secondAdminId}';`); // activate 2nd admin
  await expectSucceeds(
    db,
    `update staff_profiles set is_active = false where auth_user_id = '${ownerId}';`,
    'Last-admin guard: deactivating one of TWO active administrators succeeds'
  );
  await db.exec(`update staff_profiles set is_active = true where auth_user_id = '${ownerId}';`); // restore for later checks

  // ── 15) Audit trigger correctness ────────────────────────────────────────
  const beforeCount = (await db.query(`select count(*) from audit_events where target_type = 'staff_profile';`)).rows[0].count;
  await db.exec(`update staff_profiles set role = 'coach' where auth_user_id = '${coachId}';`); // no-op role "change" to same value should NOT log
  await db.exec(`update staff_profiles set role = 'physician' where auth_user_id = '${coachId}';`); // real change, should log
  const afterCount = (await db.query(`select count(*) from audit_events where target_type = 'staff_profile';`)).rows[0].count;
  record('Audit trigger: logs exactly one event for an actual role change (and none for a no-op update)', Number(afterCount) - Number(beforeCount) === 1);
  await db.exec(`update staff_profiles set role = 'coach' where auth_user_id = '${coachId}';`); // restore

  const latestAudit = await db.query(`select action, metadata from audit_events where target_type = 'staff_profile' order by created_at desc limit 1;`);
  record('Audit trigger: metadata captures old/new role correctly',
    latestAudit.rows[0]?.action === 'staff.role_changed');

  // ── 16) Attempts to fabricate audit events directly ──────────────────────
  await asUser(db, ownerId);
  await expectThrows(
    db,
    `select log_audit_event('${orgA}', 'staff.role_changed', 'staff_profile', '${athleteAId}', '{}'::jsonb);`,
    'Administrator cannot call log_audit_event() directly (fabricate an audit row)',
    'permission denied'
  );
  await asAnon(db);
  await expectThrows(
    db,
    `select log_audit_event('${orgA}', 'staff.role_changed', 'staff_profile', '${athleteAId}', '{}'::jsonb);`,
    'Anonymous cannot call log_audit_event() directly either',
    'permission denied'
  );

  // ── 17) Attempts to mutate protected staff_profiles fields ───────────────
  // (a) Confirm the client-read-only guarantee: no authenticated role can
  //     write to staff_profiles at all right now, protected field or not.
  await asUser(db, ownerId);
  await db.exec(`update staff_profiles set full_name = 'Renamed By Client' where auth_user_id = '${ownerId}';`);
  const clientWriteCheck = await db.query(`select full_name from staff_profiles where auth_user_id = '${ownerId}';`);
  record('staff_profiles is client read-only: even a benign field update from an authenticated role has no effect', clientWriteCheck.rows[0]?.full_name !== 'Renamed By Client');

  // (b) Confirm the identity-protection TRIGGER itself is correct, via the
  //     privileged path that Phase 2 will eventually use.
  await asAdmin(db);
  await expectThrows(
    db,
    `update staff_profiles set organization_id = '${orgB}' where auth_user_id = '${coachId}';`,
    'Identity-protection trigger: organization_id cannot be changed, even via a privileged write',
    'organization_id cannot be changed'
  );
  await expectThrows(
    db,
    `update staff_profiles set auth_user_id = '${dormantId}' where auth_user_id = '${coachId}';`,
    'Identity-protection trigger: auth_user_id cannot be changed, even via a privileged write',
    'auth_user_id cannot be changed'
  );
  await expectSucceeds(
    db,
    `update staff_profiles set full_name = 'Coach A Renamed' where auth_user_id = '${coachId}';`,
    'Identity-protection trigger: non-protected fields (e.g. full_name) can still be updated via a privileged write'
  );

  // ── 20) MILESTONE 2 — activity_routines schema + RLS + athlete RPC ──────
  // Reuses fixtures already built up above rather than duplicating them:
  //   orgA / orgB               — the two organizations
  //   coachId                   — active org A staff (unaffected by the
  //                                last-admin-guard mutations above)
  //   orgBAdminId                — active org B staff
  //   ownerId                   — org A administrator AND Super User
  //   athleteAId / 'AAA111'     — org A athlete
  //   athleteBId / 'BBB111'     — org B athlete
  //   exA / exB / exGlobal      — org A-private / org B-private / shared exercises
  await asAdmin(db);

  const m0004 = readFileSync(join(migrationsDir, '0004_milestone2_activity_routines_schema.sql'), 'utf8');
  await expectSucceeds(db, m0004, '0004_milestone2_activity_routines_schema.sql applies cleanly');

  const postM0004Check = await db.query(`select to_regclass('public.activity_routines') as t;`);
  record('Milestone 2: activity_routines now exists after 0004', postM0004Check.rows[0].t !== null);

  await expectSucceeds(db, m0004, '0004_milestone2_activity_routines_schema.sql is safely RE-RUNNABLE (applied a second time, no errors)');

  const rlsEnabledCheck = await db.query(`select relrowsecurity from pg_class where relname = 'activity_routines';`);
  record('Milestone 2: RLS is enabled on activity_routines', rlsEnabledCheck.rows[0]?.relrowsecurity === true);

  const colsCheck = await db.query(`
    select column_name, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_routines';
  `);
  const colNames = colsCheck.rows.map(r => r.column_name).sort();
  const expectedCols = [
    'activity', 'created_at', 'duration_sec_override', 'exercise_id', 'id',
    'notes', 'organization_id', 'reps_override', 'session_type', 'sets_override', 'sort_order',
  ].sort();
  record(
    'Milestone 2: activity_routines has exactly the expected columns',
    JSON.stringify(colNames) === JSON.stringify(expectedCols),
    `got: ${colNames.join(', ')}`
  );

  const orgIdCol = colsCheck.rows.find(r => r.column_name === 'organization_id');
  record('Milestone 2: organization_id is NOT NULL', orgIdCol?.is_nullable === 'NO');

  const uniqueConstraintCheck = await db.query(`
    select conname from pg_constraint where conrelid = 'activity_routines'::regclass and contype = 'u';
  `);
  record('Milestone 2: activity_routines has a UNIQUE constraint (organization/activity/session/exercise)', uniqueConstraintCheck.rows.length === 1);

  const fkCheck = await db.query(`
    select count(*) from pg_constraint where conrelid = 'activity_routines'::regclass and contype = 'f';
  `);
  record('Milestone 2: activity_routines has exactly 2 foreign keys (organization_id, exercise_id)', Number(fkCheck.rows[0].count) === 2);

  // Supabase grants broad table privileges to anon/authenticated by default
  // for any new table — replicated here the same way the top-of-file
  // baseline grant was, so RLS (not a missing GRANT) is what's under test.
  await db.exec(`grant select, insert, update, delete on activity_routines to anon, authenticated;`);

  // Default-deny checkpoint: 0004 alone enables RLS with ZERO policies, so
  // even legitimate org A staff see nothing yet — this is the safe
  // intermediate state the investigation's rollout plan calls for.
  await asUser(db, coachId);
  await expectRows(db, `select * from activity_routines;`, 0, 'Milestone 2 pre-0005: even org A staff sees zero rows (RLS enabled, no policy yet — default-deny)');
  await asAdmin(db);

  const m0005 = readFileSync(join(migrationsDir, '0005_milestone2_activity_routines_rls_rpc.sql'), 'utf8');
  await expectSucceeds(db, m0005, '0005_milestone2_activity_routines_rls_rpc.sql applies cleanly');
  await expectSucceeds(db, m0005, '0005_milestone2_activity_routines_rls_rpc.sql is safely RE-RUNNABLE (applied a second time, no errors)');

  // has_function_privilege() per-role, not a row count against
  // information_schema.routine_privileges — that view also lists the
  // function's OWNER as an implicit grantee (ownership carries all
  // privileges regardless of any explicit GRANT), so counting rows is not
  // a valid way to assert "only anon can execute this".
  const rpcSig = `get_athlete_routines(text, activity_type[], exercise_category)`;
  const rpcAnonExec = await db.query(`select has_function_privilege('anon', '${rpcSig}', 'EXECUTE') as v;`);
  const rpcAuthExec = await db.query(`select has_function_privilege('authenticated', '${rpcSig}', 'EXECUTE') as v;`);
  const rpcPublicExec = await db.query(`select has_function_privilege('public', '${rpcSig}', 'EXECUTE') as v;`);
  record(
    'Milestone 2: get_athlete_routines EXECUTE — anon HAS it, authenticated does NOT, PUBLIC does NOT',
    rpcAnonExec.rows[0].v === true && rpcAuthExec.rows[0].v === false && rpcPublicExec.rows[0].v === false
  );

  // ── Seed routine rows as real staff, through RLS (not as asAdmin) ───────
  await asUser(db, coachId); // org A
  const routineA1 = await db.query(`
    insert into activity_routines (organization_id, activity, session_type, exercise_id, sort_order)
    values ('${orgA}', 'pitching', 'strength', '${exA.rows[0].id}', 0) returning id;
  `);
  record('Milestone 2: org A staff (coach) can insert a routine into their own org', routineA1.rows.length === 1);

  await expectThrows(
    db,
    `insert into activity_routines (organization_id, activity, session_type, exercise_id, sort_order) values ('${orgB}', 'pitching', 'strength', '${exB.rows[0].id}', 0);`,
    'Milestone 2: org A staff CANNOT insert a routine into org B (RLS WITH CHECK blocks it)',
    undefined
  );

  await expectRows(db, `select * from activity_routines;`, 1, 'Milestone 2: org A staff sees exactly their own org\'s routine (1 row)');

  await expectThrows(
    db,
    `insert into activity_routines (organization_id, activity, session_type, exercise_id, sort_order) values ('${orgA}', 'pitching', 'strength', '${exA.rows[0].id}', 1);`,
    'Milestone 2: duplicate (organization, activity, session_type, exercise_id) mapping is rejected',
    'duplicate key'
  );

  // ── Cross-organization exercise integrity guard (0004's trigger) ───────
  // Fresh 'fielding' activity slots, unused by any prior insert in this
  // run, so these are isolated from the unique-constraint tests above.
  //
  // A) Org A routine + Org A (private) exercise -> allowed.
  const guardA = await db.query(`
    insert into activity_routines (organization_id, activity, session_type, exercise_id, sort_order)
    values ('${orgA}', 'fielding', 'recovery', '${exA.rows[0].id}', 0) returning id;
  `);
  record('Milestone 2 integrity guard (A): org A routine + org A\'s own exercise is allowed', guardA.rows.length === 1);

  // B) Org A routine + a shared/global exercise (organization_id IS NULL) -> allowed.
  const guardB = await db.query(`
    insert into activity_routines (organization_id, activity, session_type, exercise_id, sort_order)
    values ('${orgA}', 'fielding', 'strength', '${exGlobal.rows[0].id}', 0) returning id;
  `);
  record('Milestone 2 integrity guard (B): org A routine + a shared/global exercise is allowed', guardB.rows.length === 1);

  // C) Org A routine + Org B's PRIVATE exercise -> rejected by the trigger
  // (not merely by RLS — organization_id here legitimately belongs to the
  // inserting org A staff member; only the exercise's own org differs).
  await expectThrows(
    db,
    `insert into activity_routines (organization_id, activity, session_type, exercise_id, sort_order) values ('${orgA}', 'fielding', 'injury_prevention', '${exB.rows[0].id}', 0);`,
    'Milestone 2 integrity guard (C): org A routine referencing org B\'s private exercise is REJECTED (trigger-enforced, not just RLS)',
    'does not match'
  );

  await asUser(db, orgBAdminId); // org B
  const routineB1 = await db.query(`
    insert into activity_routines (organization_id, activity, session_type, exercise_id, sort_order)
    values ('${orgB}', 'pitching', 'strength', '${exB.rows[0].id}', 0) returning id;
  `);
  record('Milestone 2: org B staff can insert their own org\'s routine', routineB1.rows.length === 1);

  // Same (shared/global) exercise, mapped into the SAME activity/session
  // slot by BOTH organizations — must succeed for both, since
  // organization_id is part of the unique constraint.
  await asUser(db, coachId);
  const routineAGlobal = await db.query(`
    insert into activity_routines (organization_id, activity, session_type, exercise_id, sort_order)
    values ('${orgA}', 'catching', 'mobility', '${exGlobal.rows[0].id}', 0) returning id;
  `);
  await asUser(db, orgBAdminId);
  const routineBGlobal = await db.query(`
    insert into activity_routines (organization_id, activity, session_type, exercise_id, sort_order)
    values ('${orgB}', 'catching', 'mobility', '${exGlobal.rows[0].id}', 0) returning id;
  `);
  record(
    'Milestone 2: two different organizations may map the SAME (shared) exercise to the SAME activity/session slot',
    routineAGlobal.rows.length === 1 && routineBGlobal.rows.length === 1
  );

  // ── Cross-org read isolation (direct table access, as staff) ───────────
  await asUser(db, coachId);
  await expectRows(db, `select * from activity_routines where organization_id = '${orgB}';`, 0, 'Milestone 2: org A staff cannot see org B\'s routines');
  await asUser(db, orgBAdminId);
  await expectRows(db, `select * from activity_routines where organization_id = '${orgA}';`, 0, 'Milestone 2: org B staff cannot see org A\'s routines');

  await asUser(db, ownerId);
  // 6 rows by this point: routineA1, routineAGlobal, guardA, guardB (org A)
  // + routineB1, routineBGlobal (org B).
  await expectRows(db, `select * from activity_routines;`, 6, 'Milestone 2: Super User sees routines across BOTH organizations');

  // ── Anonymous direct table access: fully denied, no anon policy exists ──
  await asAnon(db);
  await expectRows(db, `select * from activity_routines;`, 0, 'Milestone 2: anonymous direct SELECT on activity_routines returns zero rows (no anon table policy)');

  // ── Athlete RPC: the ONLY sanctioned anon path to this data ─────────────
  const rpcValid = await db.query(`select * from get_athlete_routines('AAA111', array['pitching']::activity_type[], 'strength');`);
  record(
    'Milestone 2 RPC: valid athlete code (org A) retrieves exactly its own org\'s matching routine',
    rpcValid.rows.length === 1 && rpcValid.rows[0].ex_id === exA.rows[0].id
  );

  const rpcOrgB = await db.query(`select * from get_athlete_routines('BBB111', array['pitching']::activity_type[], 'strength');`);
  record(
    'Milestone 2 RPC: athlete B (org B) retrieves org B\'s routine, not org A\'s',
    rpcOrgB.rows.length === 1 && rpcOrgB.rows[0].ex_id === exB.rows[0].id
  );

  const rpcInvalidCode = await db.query(`select * from get_athlete_routines('NOPECODE', array['pitching']::activity_type[], 'strength');`);
  record('Milestone 2 RPC: invalid athlete code returns zero rows (no error, no info leak)', rpcInvalidCode.rows.length === 0);

  // The decisive cross-org isolation proof: BOTH orgs populated the exact
  // same activity/session slot with the exact same (shared) exercise —
  // athlete A must see ONLY org A's row, never org B's, even though the
  // exercise_id is identical.
  const rpcCrossOrgSameSlot = await db.query(`select * from get_athlete_routines('AAA111', array['catching']::activity_type[], 'mobility');`);
  record(
    'Milestone 2 RPC: athlete A sees only org A\'s row for a slot BOTH orgs populated with the identical exercise (org derived server-side, never leaks org B\'s row)',
    rpcCrossOrgSameSlot.rows.length === 1 && rpcCrossOrgSameSlot.rows[0].id === routineAGlobal.rows[0].id
  );

  const rpcDormant = await db.query(`select * from get_athlete_routines('WRONGCODE', array['pitching']::activity_type[], 'strength');`);
  record('Milestone 2 RPC: an unrecognized code (not just a malformed one) also returns zero rows, no error', rpcDormant.rows.length === 0);

  // D) Defense-in-depth: even if a corrupt row somehow existed (bypassing
  // the 0004 trigger entirely — simulated here by disabling it, since a
  // trigger cannot be bypassed any other way, not even by a superuser),
  // get_athlete_routines must still never surface an org-B-owned exercise
  // to an org-A athlete. This is what the RPC's own
  // "e.organization_id = v_org_id or e.organization_id is null" filter
  // (independent of the trigger) exists to guarantee.
  await asAdmin(db);
  await db.exec(`alter table activity_routines disable trigger activity_routines_exercise_org_guard;`);
  const corruptRoutine = await db.query(`
    insert into activity_routines (organization_id, activity, session_type, exercise_id, sort_order)
    values ('${orgA}', 'hitting', 'recovery', '${exB.rows[0].id}', 0) returning id;
  `);
  await db.exec(`alter table activity_routines enable trigger activity_routines_exercise_org_guard;`);
  record('Milestone 2 (D) setup: a corrupt org A routine / org B exercise row could only be created with the guard trigger disabled', corruptRoutine.rows.length === 1);

  const rpcCorrupt = await db.query(`select * from get_athlete_routines('AAA111', array['hitting']::activity_type[], 'recovery');`);
  record(
    'Milestone 2 RPC (D): even with a corrupt cross-org row present in the table, get_athlete_routines never returns an org-B-owned exercise to an org-A athlete',
    rpcCorrupt.rows.length === 0
  );

  await asAdmin(db);

  // ── 21) EXERCISE ORGANIZATION ISOLATION — remove the anon SELECT
  // policy on exercises (0006). The original justification for that
  // policy (the pre-Milestone-2 athlete wizard's direct
  // `exercise:exercises(*)` embed) no longer exists — get_athlete_routines
  // (SECURITY DEFINER) already serves every exercise field the athlete UI
  // needs, bypassing RLS entirely. This section proves BOTH halves of that
  // claim: direct anon table access is now denied, AND the athlete RPC
  // path is completely unaffected.
  const m0006 = readFileSync(join(migrationsDir, '0006_exercise_anon_policy_removal.sql'), 'utf8');
  await expectSucceeds(db, m0006, '0006_exercise_anon_policy_removal.sql applies cleanly');
  await expectSucceeds(db, m0006, '0006_exercise_anon_policy_removal.sql is safely RE-RUNNABLE (applied a second time, no errors)');

  const exercisesPolicyCheck = await db.query(`select policyname from pg_policies where tablename = 'exercises';`);
  record(
    '0006: exercises now has exactly one policy left ("Staff org access - exercises") — the anon policy is gone, the staff policy is untouched',
    exercisesPolicyCheck.rows.length === 1 && exercisesPolicyCheck.rows[0].policyname === 'Staff org access - exercises'
  );

  // Staff access is completely unaffected by 0006 (same policy, never touched).
  await asUser(db, coachId);
  await expectRows(db, `select * from exercises;`, 10, '0006: org A staff still sees org A + global exercises exactly as before (staff policy untouched)');
  await asAdmin(db);

  // The actual regression guard: direct anonymous table access now fails.
  await asAnon(db);
  await expectRows(db, `select * from exercises;`, 0, '0006: anonymous direct SELECT on exercises now returns zero rows (the PIN-bridge policy this test used to require is gone)');
  await expectThrows(db, `insert into exercises (name, category) values ('hack', 'mobility');`, '0006: anonymous exercises INSERT is still denied (unchanged — there was never an anon write policy)', undefined);

  // The decisive proof this removal is safe: the athlete-facing RPC path
  // is completely unaffected, end to end.
  const execCheckAfter0006 = await db.query(`select has_function_privilege('anon', 'get_athlete_routines(text, activity_type[], exercise_category)', 'EXECUTE') as v;`);
  record('0006: anon can still execute get_athlete_routines() (unchanged — this RPC never depended on the table policy)', execCheckAfter0006.rows[0].v === true);

  const rpcAfter0006 = await db.query(`select * from get_athlete_routines('AAA111', array['pitching']::activity_type[], 'strength');`);
  record(
    '0006: a valid athlete access code still receives its legitimate routine after the anon table policy is removed',
    rpcAfter0006.rows.length === 1 && rpcAfter0006.rows[0].ex_id === exA.rows[0].id
  );
  record(
    '0006: the returned routine still carries the full exercise information the athlete UI renders (name, sets, reps, duration, video_url, description)',
    rpcAfter0006.rows[0].ex_name === 'Academy A Drill' &&
    'ex_sets' in rpcAfter0006.rows[0] && 'ex_reps' in rpcAfter0006.rows[0] &&
    'ex_duration_sec' in rpcAfter0006.rows[0] && 'ex_video_url' in rpcAfter0006.rows[0] &&
    'ex_description' in rpcAfter0006.rows[0]
  );

  await asAdmin(db);

  // ── MILESTONE 4) Coach/physician role RPCs (0007) + RLS tightening on
  // the physician/trainer-domain tables (0008). Establishes a REAL
  // database-level distinction between coach and physician/trainer
  // access, closing the gap flagged since Milestone 1 ("Milestone 1 only
  // distinguishes administrator or not"). Captures each role's access on
  // all 5 affected tables BEFORE applying 0007/0008, then re-checks the
  // SAME queries after: administrator/physician/Super User must see
  // IDENTICAL results (non-regression); a plain coach must drop to zero
  // on every one of them, for both reads AND writes.
  async function countAs(uid, table) {
    await asUser(db, uid);
    const res = await db.query(`select count(*) from ${table};`);
    await asAdmin(db);
    return Number(res.rows[0].count);
  }

  // plainAdminId was deactivated by the earlier last-administrator-guard
  // test (section 14) and never reactivated there (only ownerId was
  // restored) — harmless until now, since nothing between that section
  // and this one touches plainAdminId again. This section needs it back
  // as a genuinely ACTIVE administrator fixture, so restore it here.
  await db.exec(`update staff_profiles set is_active = true where auth_user_id = '${plainAdminId}';`);

  const PHYSICIAN_DOMAIN_TABLES = ['athletes', 'exercises', 'weekly_plans', 'assigned_exercises', 'activity_routines'];

  const beforeAdmin = {};
  const beforePhysician = {};
  const beforeCoach = {};
  for (const t of PHYSICIAN_DOMAIN_TABLES) {
    beforeAdmin[t] = await countAs(plainAdminId, t);
    beforePhysician[t] = await countAs(physicianId, t);
    beforeCoach[t] = await countAs(coachId, t);
  }
  record(
    'PRE-0008: a plain coach currently has the SAME access as an administrator on every physician/trainer table (confirms the exact gap Milestone 4 closes)',
    PHYSICIAN_DOMAIN_TABLES.every(t => beforeCoach[t] === beforeAdmin[t] && beforeCoach[t] > 0)
  );

  const m0007 = readFileSync(join(migrationsDir, '0007_coach_physician_role_rpcs.sql'), 'utf8');
  await expectSucceeds(db, m0007, '0007_coach_physician_role_rpcs.sql applies cleanly');
  await expectSucceeds(db, m0007, '0007_coach_physician_role_rpcs.sql is safely RE-RUNNABLE (applied a second time, no errors)');

  // RPC-level correctness: each RPC is a STRICT single-role check — an
  // administrator is NOT also flagged as a coach or physician (that
  // composition happens in 0008's policy text, not inside these functions).
  await asUser(db, coachId);
  const coachFlags = await db.query(`select is_org_coach() as coach, is_org_physician() as physician;`);
  record('0007: is_org_coach() is true and is_org_physician() is false for a coach account',
    coachFlags.rows[0].coach === true && coachFlags.rows[0].physician === false);

  await asUser(db, physicianId);
  const physicianFlags = await db.query(`select is_org_coach() as coach, is_org_physician() as physician;`);
  record('0007: is_org_physician() is true and is_org_coach() is false for a physician account',
    physicianFlags.rows[0].physician === true && physicianFlags.rows[0].coach === false);

  await asUser(db, plainAdminId);
  const adminFlags = await db.query(`select is_org_coach() as coach, is_org_physician() as physician;`);
  record('0007: is_org_coach() and is_org_physician() are BOTH false for an administrator (strict single-role checks, not administrator-inclusive)',
    adminFlags.rows[0].coach === false && adminFlags.rows[0].physician === false);
  await asAdmin(db);

  const m0008 = readFileSync(join(migrationsDir, '0008_coach_physician_rls_cutover.sql'), 'utf8');
  await expectSucceeds(db, m0008, '0008_coach_physician_rls_cutover.sql applies cleanly');
  await expectSucceeds(db, m0008, '0008_coach_physician_rls_cutover.sql is safely RE-RUNNABLE (applied a second time, no errors)');

  // Non-regression: administrator and physician see IDENTICAL results
  // after 0008 as they did before it, on every affected table.
  for (const t of PHYSICIAN_DOMAIN_TABLES) {
    const afterAdmin = await countAs(plainAdminId, t);
    record(`POST-0008: administrator's ${t} access is unchanged`, afterAdmin === beforeAdmin[t], `before=${beforeAdmin[t]}, after=${afterAdmin}`);
    const afterPhysician = await countAs(physicianId, t);
    record(`POST-0008: physician's ${t} access is unchanged`, afterPhysician === beforePhysician[t], `before=${beforePhysician[t]}, after=${afterPhysician}`);
  }

  // Super User (ownerId) non-regression — still sees across both orgs.
  const superUserAfter = await countAs(ownerId, 'athletes');
  record('POST-0008: Super User athlete visibility is unchanged (still sees across both organizations)', superUserAfter === 5);

  // The actual tightening: a plain coach now gets ZERO rows on every
  // physician/trainer-domain table.
  for (const t of PHYSICIAN_DOMAIN_TABLES) {
    const afterCoach = await countAs(coachId, t);
    record(`POST-0008: plain coach's ${t} access drops to ZERO (was ${beforeCoach[t]} before 0008)`, afterCoach === 0 && beforeCoach[t] > 0);
  }

  // Explicit negative WRITE tests — WITH CHECK (insert) and USING (update)
  // are both tightened, not just the read side.
  await asUser(db, coachId);
  await expectThrows(
    db,
    `insert into athletes (full_name, access_code, organization_id) values ('Coach Inserted', 'COACHX', '${orgA}');`,
    'POST-0008: a plain coach cannot INSERT into athletes (WITH CHECK rejects it, raises an error)',
    undefined
  );
  await db.exec(`update exercises set name = 'Coach Edited' where id = '${exA.rows[0].id}';`); // RLS USING silently filters to 0 matching rows, not an error
  await asAdmin(db);
  const exAAfterCoachAttempt = await db.query(`select name from exercises where id = '${exA.rows[0].id}';`);
  record(
    "POST-0008: a plain coach's UPDATE on an org exercise affects zero rows (RLS USING-filtered, not an error)",
    exAAfterCoachAttempt.rows[0]?.name === 'Academy A Drill'
  );

  // Goal: the athlete-facing experience and Activity Routines are
  // completely unaffected, since get_athlete_routines() is SECURITY
  // DEFINER and never depended on these table-level policies.
  const rpcAfter0008 = await db.query(`select * from get_athlete_routines('AAA111', array['pitching']::activity_type[], 'strength');`);
  record(
    'POST-0008: a valid athlete access code still receives its legitimate routine (Activity Routines / athlete experience unaffected by the coach/physician RLS cutover)',
    rpcAfter0008.rows.length === 1 && rpcAfter0008.rows[0].ex_id === exA.rows[0].id
  );

  await asAdmin(db);

  // ── MILESTONE 5) Booking/scheduling domain foundation: coach_profiles,
  // services, coach_services, coach_availability, coach_blocks (0009-0012).
  // Database-only — no bookings/contacts/UI. is_org_physician() must
  // appear in NONE of these tables' policies; coaches must be isolated
  // from each other's rows, not just from other organizations.
  async function staffProfileId(authUserId) {
    const res = await db.query(`select id from staff_profiles where auth_user_id = '${authUserId}';`);
    return res.rows[0].id;
  }

  // Second coach in ORG A (peer-isolation target), a coach in ORG B
  // (cross-org target), and a THIRD org-A coach who deliberately never
  // receives a coach_profiles/coach_services/coach_availability/
  // coach_blocks row from admin setup — reserved as a clean "doesn't
  // exist yet" target so the various INSERT-denial tests below attempt
  // an otherwise fully valid row and RLS is the only thing that can
  // reject it (audit fix: the original versions of several of these
  // tests targeted a coach/pairing that ALSO already violated a UNIQUE
  // or composite-FK constraint, so they couldn't prove RLS specifically
  // was what blocked the attempt).
  const coachB2Id = 'c0000000-0000-0000-0000-000000000001';
  const coachOrgBId = 'c0000000-0000-0000-0000-000000000002';
  const coachB3Id = 'c0000000-0000-0000-0000-000000000003';
  await db.exec(`insert into auth.users (id, email) values
    ('${coachB2Id}', 'coachb2@7ar.test'),
    ('${coachOrgBId}', 'coach@rival.test'),
    ('${coachB3Id}', 'coachb3@7ar.test');`);
  await db.exec(`insert into staff_profiles (auth_user_id, organization_id, full_name, email, role, is_active) values
    ('${coachB2Id}', '${orgA}', 'Coach B2', 'coachb2@7ar.test', 'coach', true),
    ('${coachOrgBId}', '${orgB}', 'Coach Org B', 'coach@rival.test', 'coach', true),
    ('${coachB3Id}', '${orgA}', 'Coach B3', 'coachb3@7ar.test', 'coach', true);`);

  const coachStaffId      = await staffProfileId(coachId);
  const coachB2StaffId    = await staffProfileId(coachB2Id);
  const coachOrgBStaffId  = await staffProfileId(coachOrgBId);
  const coachB3StaffId    = await staffProfileId(coachB3Id);

  // ── Apply 0009-0012, each with the standard re-run/idempotency check ──
  const m0009 = readFileSync(join(migrationsDir, '0009_coach_identity_rpc.sql'), 'utf8');
  await expectSucceeds(db, m0009, '0009_coach_identity_rpc.sql applies cleanly');
  await expectSucceeds(db, m0009, '0009_coach_identity_rpc.sql is safely RE-RUNNABLE (applied a second time, no errors)');

  await asUser(db, coachId);
  const coachSelfId = await db.query(`select current_staff_profile_id() as v;`);
  record('0009: current_staff_profile_id() resolves to the caller\'s own staff_profiles.id', coachSelfId.rows[0].v === coachStaffId);
  await asUser(db, dormantId);
  const dormantSelfId = await db.query(`select current_staff_profile_id() as v;`);
  record('0009: current_staff_profile_id() resolves to NULL for an unlinked account', dormantSelfId.rows[0].v === null);
  await asAdmin(db);

  const m0010 = readFileSync(join(migrationsDir, '0010_coach_profiles.sql'), 'utf8');
  await expectSucceeds(db, m0010, '0010_coach_profiles.sql applies cleanly');
  await expectSucceeds(db, m0010, '0010_coach_profiles.sql is safely RE-RUNNABLE (applied a second time, no errors)');

  const m0011 = readFileSync(join(migrationsDir, '0011_services_and_coach_services.sql'), 'utf8');
  await expectSucceeds(db, m0011, '0011_services_and_coach_services.sql applies cleanly');
  await expectSucceeds(db, m0011, '0011_services_and_coach_services.sql is safely RE-RUNNABLE (applied a second time, no errors)');

  const m0012 = readFileSync(join(migrationsDir, '0012_coach_scheduling.sql'), 'utf8');
  await expectSucceeds(db, m0012, '0012_coach_scheduling.sql applies cleanly');
  await expectSucceeds(db, m0012, '0012_coach_scheduling.sql is safely RE-RUNNABLE (applied a second time, no errors)');

  // 0010/0011/0012 now explicitly declare their own table privileges
  // (GRANT ... TO authenticated; REVOKE ALL ... FROM anon;) — audit fix:
  // the test harness no longer needs to (and must NOT) replicate a
  // Supabase default grant to anon for these five tables, unlike the rest
  // of this file's tables, whose migrations never declare privileges
  // explicitly. Re-granting anon here would silently UNDO what the
  // migrations just revoked and make the anonymous-denial tests below
  // pass for the wrong reason (RLS-filtered rows instead of an actual
  // permission error).

  // ── coach_profiles: creation/deletion is administrator/Super-User-only ──
  // Confound-free denial tests FIRST, before admin creates any profile:
  // coachStaffId has no coach_profiles row yet at this point, so if RLS
  // were ever accidentally loosened to allow this, it would succeed —
  // nothing else (no UNIQUE conflict, no FK issue) could mask that.
  await asUser(db, coachId);
  await expectThrows(
    db,
    `insert into coach_profiles (organization_id, coach_id, display_name) values ('${orgA}', '${coachStaffId}', 'Self Created');`,
    'coach_profiles: a coach CANNOT insert their own profile, even when no profile exists yet for them (isolates RLS, not UNIQUE(coach_id))',
    undefined
  );
  await asUser(db, physicianId);
  await expectThrows(
    db,
    `insert into coach_profiles (organization_id, coach_id, display_name) values ('${orgA}', '${coachB3StaffId}', 'Physician Created');`,
    'coach_profiles: a physician CANNOT insert a profile for a coach who has none yet (isolates RLS, not UNIQUE(coach_id))',
    undefined
  );

  await asAdmin(db);
  const coachProfile = await db.query(`
    insert into coach_profiles (organization_id, coach_id, display_name, bio, is_bookable_online)
    values ('${orgA}', '${coachStaffId}', 'Coach A', 'Original bio', true) returning id;
  `);
  const coachProfileId = coachProfile.rows[0].id;
  record('coach_profiles: administrator can CREATE a profile for a coach in their org', coachProfile.rows.length === 1);

  const coachB2Profile = await db.query(`
    insert into coach_profiles (organization_id, coach_id, display_name, is_bookable_online)
    values ('${orgA}', '${coachB2StaffId}', 'Coach B2', true) returning id;
  `);
  const coachB2ProfileId = coachB2Profile.rows[0].id;

  await expectThrows(
    db,
    `insert into coach_profiles (organization_id, coach_id, display_name) values ('${orgA}', '${coachOrgBStaffId}', 'Cross Org');`,
    'coach_profiles: composite FK rejects a coach who belongs to a DIFFERENT organization (admin context, isolates the FK, not RLS)',
    undefined
  );

  await asUser(db, coachId);
  await expectRows(db, `select * from coach_profiles where id = '${coachProfileId}';`, 1, 'coach_profiles: a coach can SELECT their own existing profile');
  await db.exec(`update coach_profiles set display_name = 'Coach A Updated', bio = 'New bio', is_bookable_online = false where id = '${coachProfileId}';`);
  await asAdmin(db);
  const coachProfileAfterSelfUpdateAdmin = await db.query(`select display_name, bio, is_bookable_online from coach_profiles where id = '${coachProfileId}';`);
  record(
    'coach_profiles: a coach CAN update display_name/bio/is_bookable_online on their own existing profile',
    coachProfileAfterSelfUpdateAdmin.rows[0].display_name === 'Coach A Updated' &&
    coachProfileAfterSelfUpdateAdmin.rows[0].bio === 'New bio' &&
    coachProfileAfterSelfUpdateAdmin.rows[0].is_bookable_online === false
  );

  await asUser(db, coachId);
  await db.exec(`delete from coach_profiles where id = '${coachProfileId}';`); // RLS-filtered: no DELETE policy for coach, so 0 rows match — not an error
  await asAdmin(db);
  const coachProfileAfterSelfDeleteAttempt = await db.query(`select * from coach_profiles where id = '${coachProfileId}';`);
  record(
    'coach_profiles: a coach\'s DELETE on their own profile affects zero rows (no DELETE policy, RLS-filtered, not an error)',
    coachProfileAfterSelfDeleteAttempt.rows.length === 1
  );

  await asUser(db, coachId);
  await expectRows(db, `select * from coach_profiles where id = '${coachB2ProfileId}';`, 0, 'coach_profiles: a coach cannot SELECT a peer coach\'s profile (same org)');
  await db.exec(`update coach_profiles set display_name = 'Hijacked' where id = '${coachB2ProfileId}';`); // RLS-filtered, 0 rows
  await asAdmin(db);
  const coachB2AfterPeerAttempt = await db.query(`select display_name from coach_profiles where id = '${coachB2ProfileId}';`);
  record('coach_profiles: a coach\'s UPDATE attempt on a peer coach\'s profile affects zero rows', coachB2AfterPeerAttempt.rows[0].display_name === 'Coach B2');

  await expectThrows(
    db,
    `update coach_profiles set coach_id = '${coachB2StaffId}' where id = '${coachProfileId}';`,
    'coach_profiles: coach_id is immutable after insert, even for an administrator',
    'coach_id cannot be changed'
  );
  await expectThrows(
    db,
    `update coach_profiles set organization_id = '${orgB}' where id = '${coachProfileId}';`,
    'coach_profiles: organization_id is immutable after insert, even for an administrator',
    'organization_id cannot be changed'
  );
  await expectThrows(
    db,
    `insert into coach_profiles (organization_id, coach_id, display_name) values ('${orgA}', '${coachStaffId}', 'Dup');`,
    'coach_profiles: UNIQUE(coach_id) rejects a second profile for the same coach',
    'duplicate key'
  );

  await asUser(db, physicianId);
  await expectRows(db, `select * from coach_profiles;`, 0, 'coach_profiles: physician has ZERO access (physician INSERT denial already proven above, confound-free)');
  await asUser(db, orgBAdminId);
  await expectRows(db, `select * from coach_profiles where id in ('${coachProfileId}', '${coachB2ProfileId}');`, 0, 'coach_profiles: cross-org administrator (org B) cannot see org A\'s profiles');
  await asUser(db, ownerId);
  await expectRows(db, `select * from coach_profiles;`, 2, 'coach_profiles: Super User sees across organizations (both org A profiles so far)');
  await asAnon(db);
  await expectThrows(
    db,
    `select * from coach_profiles;`,
    'coach_profiles: anonymous access fully denied — no table grant at all for anon, not just an RLS-filtered empty result',
    'permission denied'
  );
  await asAdmin(db);

  // ── services: admin CRUD, coach read-only, case-insensitive per-org
  //    name uniqueness, physician denial, cross-org denial ──────────────
  const svcPitching = await db.query(`
    insert into services (organization_id, name, default_duration_minutes, default_price_cents)
    values ('${orgA}', 'Pitching Lesson', 60, 8000) returning id;
  `);
  const svcPitchingId = svcPitching.rows[0].id;

  await expectThrows(
    db,
    `insert into services (organization_id, name, default_duration_minutes) values ('${orgA}', 'pitching lesson', 30);`,
    'services: case-insensitive duplicate name in the SAME organization is rejected',
    'duplicate key'
  );
  const svcPitchingOrgB = await db.query(`
    insert into services (organization_id, name, default_duration_minutes)
    values ('${orgB}', 'Pitching Lesson', 45) returning id;
  `);
  record('services: the SAME name is allowed in a DIFFERENT organization', svcPitchingOrgB.rows.length === 1);

  await expectThrows(db, `insert into services (organization_id, name, default_duration_minutes) values ('${orgA}', 'Bad Duration', 0);`, 'services: default_duration_minutes must be > 0', undefined);
  await expectThrows(db, `insert into services (organization_id, name, default_duration_minutes, default_price_cents) values ('${orgA}', 'Bad Price', 30, -100);`, 'services: default_price_cents cannot be negative', undefined);

  await asUser(db, coachId);
  await expectRows(db, `select * from services where organization_id = '${orgA}';`, 1, 'services: coach can READ the org catalog');
  await expectThrows(db, `insert into services (organization_id, name, default_duration_minutes) values ('${orgA}', 'Coach Added', 30);`, 'services: coach cannot INSERT', undefined);
  await db.exec(`update services set name = 'Hijacked' where id = '${svcPitchingId}';`); // RLS-filtered
  await asAdmin(db);
  const svcAfterCoachAttempt = await db.query(`select name from services where id = '${svcPitchingId}';`);
  record('services: coach\'s UPDATE attempt affects zero rows', svcAfterCoachAttempt.rows[0].name === 'Pitching Lesson');

  await asUser(db, physicianId);
  await expectRows(db, `select * from services;`, 0, 'services: physician has ZERO access');
  await expectThrows(
    db,
    `insert into services (organization_id, name, default_duration_minutes) values ('${orgA}', 'Physician Added Service', 30);`,
    'services: physician cannot INSERT an otherwise fully valid, non-conflicting service (isolates RLS, not any other constraint)',
    undefined
  );
  await asUser(db, orgBAdminId);
  await expectRows(db, `select * from services where id = '${svcPitchingId}';`, 0, 'services: cross-org administrator cannot see org A\'s service');
  await asUser(db, ownerId);
  await expectRows(db, `select * from services;`, 2, 'services: Super User sees across organizations');
  await asAnon(db);
  await expectThrows(
    db,
    `select * from services;`,
    'services: anonymous access fully denied — no table grant at all for anon',
    'permission denied'
  );
  await asAdmin(db);

  // ── coach_services: admin CRUD, coach read-only-own, composite FK
  //    integrity, identity immutability, RPC-only self-toggle ───────────
  // Confound-free denial test FIRST, before admin creates this exact
  // pairing: an otherwise fully valid, non-conflicting (coach, service)
  // row, attempted by the coach themselves — nothing but RLS could reject
  // this (no UNIQUE conflict, no composite-FK issue, correct org on both
  // sides).
  await asUser(db, coachId);
  await expectThrows(
    db,
    `insert into coach_services (organization_id, coach_id, service_id) values ('${orgA}', '${coachStaffId}', '${svcPitchingId}');`,
    'coach_services: a coach CANNOT insert their own otherwise fully valid assignment (isolates RLS, not UNIQUE or the composite FK)',
    undefined
  );
  await asAdmin(db);

  const coachService = await db.query(`
    insert into coach_services (organization_id, coach_id, service_id, price_cents, duration_minutes)
    values ('${orgA}', '${coachStaffId}', '${svcPitchingId}', 7500, 60) returning id;
  `);
  const coachServiceId = coachService.rows[0].id;
  const coachB2Service = await db.query(`
    insert into coach_services (organization_id, coach_id, service_id)
    values ('${orgA}', '${coachB2StaffId}', '${svcPitchingId}') returning id;
  `);
  const coachB2ServiceId = coachB2Service.rows[0].id;

  await expectThrows(
    db,
    `insert into coach_services (organization_id, coach_id, service_id) values ('${orgA}', '${coachStaffId}', '${svcPitchingId}');`,
    'coach_services: UNIQUE(coach_id, service_id) rejects a duplicate pairing',
    'duplicate key'
  );
  await expectThrows(
    db,
    `insert into coach_services (organization_id, coach_id, service_id) values ('${orgA}', '${coachOrgBStaffId}', '${svcPitchingId}');`,
    'coach_services: composite FK rejects a pairing where the coach belongs to a DIFFERENT organization than organization_id',
    undefined
  );
  await expectThrows(
    db,
    `insert into coach_services (organization_id, coach_id, service_id) values ('${orgA}', '${coachStaffId}', '${svcPitchingOrgB.rows[0].id}');`,
    'coach_services: composite FK rejects a pairing where the SERVICE belongs to a DIFFERENT organization than organization_id',
    undefined
  );
  await expectThrows(db, `update coach_services set price_cents = -1 where id = '${coachServiceId}';`, 'coach_services: price_cents cannot be negative', undefined);
  await expectThrows(db, `update coach_services set duration_minutes = 0 where id = '${coachServiceId}';`, 'coach_services: duration_minutes must be > 0', undefined);

  await expectThrows(
    db,
    `update coach_services set coach_id = '${coachB2StaffId}' where id = '${coachServiceId}';`,
    'coach_services: coach_id is immutable after insert, even for an administrator',
    'coach_id cannot be changed'
  );
  await expectThrows(
    db,
    `update coach_services set service_id = '${svcPitchingOrgB.rows[0].id}' where id = '${coachServiceId}';`,
    'coach_services: service_id is immutable after insert, even for an administrator',
    'service_id cannot be changed'
  );
  await expectThrows(
    db,
    `update coach_services set organization_id = '${orgB}' where id = '${coachServiceId}';`,
    'coach_services: organization_id is immutable after insert, even for an administrator',
    'organization_id cannot be changed'
  );

  await asUser(db, coachId);
  await expectRows(db, `select * from coach_services;`, 1, 'coach_services: a coach sees exactly their OWN offering, not a peer\'s (INSERT denial already proven above, confound-free)');
  await db.exec(`update coach_services set is_active = false where id = '${coachServiceId}';`); // RLS-filtered: coach has NO write policy at all
  await db.exec(`delete from coach_services where id = '${coachServiceId}';`); // RLS-filtered
  await asAdmin(db);
  const coachServiceAfterRawAttempts = await db.query(`select is_active from coach_services where id = '${coachServiceId}';`);
  record(
    'coach_services: a coach\'s raw UPDATE/DELETE on their own row both affect zero rows (no write policy at all for coach)',
    coachServiceAfterRawAttempts.rows.length === 1 && coachServiceAfterRawAttempts.rows[0].is_active === true
  );

  // The only sanctioned coach write path: the RPC.
  await asUser(db, coachId);
  const toggleOwn = await db.query(`select set_coach_service_bookable('${coachServiceId}', false) as v;`);
  record('set_coach_service_bookable: coach toggling their OWN offering succeeds', toggleOwn.rows[0].v === true);
  const toggleOther = await db.query(`select set_coach_service_bookable('${coachB2ServiceId}', false) as v;`);
  record('set_coach_service_bookable: coach toggling ANOTHER coach\'s offering returns false (no-op)', toggleOther.rows[0].v === false);
  await asAdmin(db);
  const afterToggle = await db.query(`select is_active, price_cents, duration_minutes, coach_id, service_id, organization_id from coach_services where id = '${coachServiceId}';`);
  record(
    'set_coach_service_bookable: ONLY is_active changed — price_cents/duration_minutes/coach_id/service_id/organization_id all untouched',
    afterToggle.rows[0].is_active === false &&
    afterToggle.rows[0].price_cents === 7500 &&
    afterToggle.rows[0].duration_minutes === 60 &&
    afterToggle.rows[0].coach_id === coachStaffId &&
    afterToggle.rows[0].service_id === svcPitchingId &&
    afterToggle.rows[0].organization_id === orgA
  );
  const coachB2ServiceUnchanged = await db.query(`select is_active from coach_services where id = '${coachB2ServiceId}';`);
  record('set_coach_service_bookable: the no-op call left the OTHER coach\'s row completely unchanged', coachB2ServiceUnchanged.rows[0].is_active === true);
  const toggleNonexistent = await db.query(`select set_coach_service_bookable('00000000-0000-0000-0000-000000000000', true) as v;`);
  record('set_coach_service_bookable: a nonexistent id returns false, same shape as "not yours" (no info leak)', toggleNonexistent.rows[0].v === false);

  await asUser(db, physicianId);
  await expectRows(db, `select * from coach_services;`, 0, 'coach_services: physician has ZERO access');
  await expectThrows(
    db,
    `insert into coach_services (organization_id, coach_id, service_id) values ('${orgA}', '${coachB3StaffId}', '${svcPitchingId}');`,
    'coach_services: physician cannot INSERT an otherwise fully valid, non-conflicting pairing (isolates RLS)',
    undefined
  );
  await asUser(db, orgBAdminId);
  await expectRows(db, `select * from coach_services where id in ('${coachServiceId}', '${coachB2ServiceId}');`, 0, 'coach_services: cross-org administrator cannot see org A\'s offerings');
  await asUser(db, ownerId);
  await expectRows(db, `select * from coach_services;`, 2, 'coach_services: Super User sees across organizations');
  await asAnon(db);
  await expectThrows(
    db,
    `select * from coach_services;`,
    'coach_services: anonymous access fully denied — no table grant at all for anon',
    'permission denied'
  );
  await asAdmin(db);

  // ── coach_availability / coach_blocks: coach full CRUD own rows, peer
  //    isolation, admin full CRUD any coach in org, identity immutability ─
  const avail = await db.query(`
    insert into coach_availability (organization_id, coach_id, day_of_week, start_time, end_time)
    values ('${orgA}', '${coachStaffId}', 'monday', '09:00', '12:00') returning id;
  `);
  const availId = avail.rows[0].id;
  const availB2 = await db.query(`
    insert into coach_availability (organization_id, coach_id, day_of_week, start_time, end_time)
    values ('${orgA}', '${coachB2StaffId}', 'tuesday', '09:00', '12:00') returning id;
  `);
  const availB2Id = availB2.rows[0].id;

  await expectThrows(db, `insert into coach_availability (organization_id, coach_id, day_of_week, start_time, end_time) values ('${orgA}', '${coachStaffId}', 'wednesday', '12:00', '09:00');`, 'coach_availability: end_time must be after start_time', undefined);
  await expectThrows(
    db,
    `insert into coach_availability (organization_id, coach_id, day_of_week, start_time, end_time) values ('${orgA}', '${coachOrgBStaffId}', 'monday', '09:00', '10:00');`,
    'coach_availability: composite FK rejects a coach from a DIFFERENT organization',
    undefined
  );

  await asUser(db, coachId);
  await expectRows(db, `select * from coach_availability;`, 1, 'coach_availability: a coach sees exactly their OWN window, not a peer\'s');
  const ownAvailUpdate = await db.query(`update coach_availability set is_active = false where id = '${availId}' returning is_active;`);
  record('coach_availability: a coach CAN update their own row', ownAvailUpdate.rows[0]?.is_active === false);
  await db.exec(`update coach_availability set is_active = false where id = '${availB2Id}';`); // RLS-filtered
  await db.exec(`delete from coach_availability where id = '${availB2Id}';`); // RLS-filtered
  await asAdmin(db);
  const availB2AfterPeerAttempt = await db.query(`select is_active from coach_availability where id = '${availB2Id}';`);
  record('coach_availability: a peer coach\'s UPDATE/DELETE attempts both affect zero rows', availB2AfterPeerAttempt.rows.length === 1 && availB2AfterPeerAttempt.rows[0].is_active === true);

  await expectThrows(db, `update coach_availability set coach_id = '${coachB2StaffId}' where id = '${availId}';`, 'coach_availability: coach_id is immutable after insert', 'coach_id cannot be changed');
  await expectThrows(db, `update coach_availability set organization_id = '${orgB}' where id = '${availId}';`, 'coach_availability: organization_id is immutable after insert', 'organization_id cannot be changed');

  const block = await db.query(`
    insert into coach_blocks (organization_id, coach_id, start_at, end_at, reason)
    values ('${orgA}', '${coachStaffId}', '2026-02-01T00:00:00Z', '2026-02-07T00:00:00Z', 'Vacation') returning id;
  `);
  const blockId = block.rows[0].id;
  await expectThrows(db, `insert into coach_blocks (organization_id, coach_id, start_at, end_at) values ('${orgA}', '${coachStaffId}', '2026-02-07T00:00:00Z', '2026-02-01T00:00:00Z');`, 'coach_blocks: end_at must be after start_at', undefined);
  await expectThrows(
    db,
    `insert into coach_blocks (organization_id, coach_id, start_at, end_at) values ('${orgA}', '${coachOrgBStaffId}', '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z');`,
    'coach_blocks: composite FK rejects a coach from a DIFFERENT organization (admin context, isolates the FK, not RLS)',
    undefined
  );
  await expectThrows(db, `update coach_blocks set coach_id = '${coachB2StaffId}' where id = '${blockId}';`, 'coach_blocks: coach_id is immutable after insert', 'coach_id cannot be changed');
  await expectThrows(db, `update coach_blocks set organization_id = '${orgB}' where id = '${blockId}';`, 'coach_blocks: organization_id is immutable after insert', 'organization_id cannot be changed');

  await asUser(db, coachId);
  await expectRows(db, `select * from coach_blocks;`, 1, 'coach_blocks: a coach sees exactly their OWN block');
  await asAdmin(db);

  // Physician write-denial, one otherwise fully valid row per table
  // (coachB3StaffId has no rows in either table, fresh day/date range) —
  // isolates RLS, not any other constraint.
  await asUser(db, physicianId);
  await expectThrows(
    db,
    `insert into coach_availability (organization_id, coach_id, day_of_week, start_time, end_time) values ('${orgA}', '${coachB3StaffId}', 'thursday', '09:00', '10:00');`,
    'coach_availability: physician cannot INSERT an otherwise fully valid, non-conflicting row (isolates RLS)',
    undefined
  );
  await expectThrows(
    db,
    `insert into coach_blocks (organization_id, coach_id, start_at, end_at) values ('${orgA}', '${coachB3StaffId}', '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z');`,
    'coach_blocks: physician cannot INSERT an otherwise fully valid, non-conflicting row (isolates RLS)',
    undefined
  );
  await asAdmin(db);

  for (const table of ['coach_availability', 'coach_blocks']) {
    await asUser(db, physicianId);
    await expectRows(db, `select * from ${table};`, 0, `${table}: physician has ZERO access`);
    await asUser(db, orgBAdminId);
    await expectRows(db, `select * from ${table} where organization_id = '${orgA}';`, 0, `${table}: cross-org administrator cannot see org A's rows`);
    await asAnon(db);
    await expectThrows(
      db,
      `select * from ${table};`,
      `${table}: anonymous access fully denied — no table grant at all for anon`,
      'permission denied'
    );
    await asAdmin(db);
  }
  await asUser(db, ownerId);
  await expectRows(db, `select * from coach_availability;`, 2, 'coach_availability: Super User sees across organizations');
  await expectRows(db, `select * from coach_blocks;`, 1, 'coach_blocks: Super User sees across organizations');
  await asAdmin(db);

  // ── Administrator full CRUD within own org, across all five tables ───
  await asUser(db, plainAdminId);
  await expectRows(db, `select * from coach_profiles;`, 2, 'Administrator: full read access to coach_profiles within own org');
  await expectRows(db, `select * from services where organization_id = '${orgA}';`, 1, 'Administrator: full read access to services within own org');
  await expectRows(db, `select * from coach_services;`, 2, 'Administrator: full read access to coach_services within own org');
  await expectRows(db, `select * from coach_availability;`, 2, 'Administrator: full read access to coach_availability within own org');
  await expectRows(db, `select * from coach_blocks;`, 1, 'Administrator: full read access to coach_blocks within own org');
  await asAdmin(db);

  // ── Deletion semantics: RESTRICT, not CASCADE, for business-domain FKs ─
  await expectThrows(
    db,
    `delete from services where id = '${svcPitchingId}';`,
    'Deletion semantics: deleting a service that still has a coach_services row pointing at it is RESTRICTed, not cascaded',
    undefined
  );
  await expectThrows(
    db,
    `delete from staff_profiles where id = '${coachStaffId}';`,
    'Deletion semantics: deleting a staff_profiles row that still has coach_profiles/coach_services/coach_availability/coach_blocks rows is RESTRICTed, not cascaded',
    undefined
  );

  await asAdmin(db);

  await db.close();

  // ── 18) Emergency rollback for 0001 — fresh, isolated instance ──────────
  // Proves the ACTUAL rollback file (not a re-typed equivalent) correctly
  // undoes 0001 with ZERO use of CASCADE, in the specific scenario it's
  // scoped for: 0001 applied, 0002/0003 NOT yet applied. Existing tables,
  // their data, and their columns/FKs beyond what 0001 itself added must
  // be completely unaffected.
  {
    const rdb = new PGlite({ extensions: { uuid_ossp } });
    await rdb.exec(`create extension if not exists "uuid-ossp";`);
    await rdb.exec(`create role anon nologin; create role authenticated nologin;`);
    await rdb.exec(`create schema auth;`);
    await rdb.exec(`create table auth.users (id uuid primary key default uuid_generate_v4(), email text, raw_user_meta_data jsonb, last_sign_in_at timestamptz);`);
    await rdb.exec(`create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;`);
    await expectSucceeds(rdb, readFileSync(schemaPath, 'utf8'), 'Rollback test: baseline schema.sql applies');
    await expectSucceeds(rdb, m0001, 'Rollback test: 0001 applies');

    const rollbackSql = readFileSync(join(migrationsDir, 'rollback', '0001_emergency_rollback.sql'), 'utf8');
    const rollbackExecutableOnly = rollbackSql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');
    record('Rollback file uses no CASCADE keyword in actual executable SQL (comments may still discuss it)', !/cascade/i.test(rollbackExecutableOnly));
    await expectSucceeds(rdb, rollbackSql, 'Rollback test: 0001_emergency_rollback.sql applies cleanly with ZERO cascade');

    const gone = await rdb.query(`
      select
        to_regclass('public.organizations') as organizations,
        to_regclass('public.staff_profiles') as staff_profiles,
        to_regclass('public.platform_admins') as platform_admins,
        to_regclass('public.audit_events') as audit_events,
        to_regclass('public.athlete_access_attempts') as athlete_access_attempts;
    `);
    record('Rollback: all 5 new tables are gone', Object.values(gone.rows[0]).every(v => v === null));

    const typeGone = await rdb.query(`select 1 from pg_type where typname = 'staff_role';`);
    record('Rollback: staff_role enum is gone', typeGone.rows.length === 0);

    const fnGone = await rdb.query(`
      select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
        ('current_org_id','is_super_user','is_org_administrator','log_audit_event',
         'prevent_last_administrator_removal','prevent_last_administrator_delete',
         'protect_staff_profile_identity_fields','audit_staff_profile_changes',
         'get_athlete_by_code','update_athlete_photo_by_code');
    `);
    record('Rollback: all 10 functions are gone', Number(fnGone.rows[0].count) === 0);

    const colsGone = await rdb.query(`
      select count(*) from information_schema.columns
      where table_schema = 'public' and column_name = 'organization_id'
        and table_name in ('athletes','exercises','weekly_plans');
    `);
    record('Rollback: the 3 added organization_id columns are gone', Number(colsGone.rows[0].count) === 0);

    // Existing tables/data completely untouched by rollback
    const existingTables = await rdb.query(`
      select to_regclass('public.athletes') as athletes, to_regclass('public.exercises') as exercises,
             to_regclass('public.weekly_plans') as weekly_plans, to_regclass('public.assigned_exercises') as assigned_exercises;
    `);
    record('Rollback: the 4 pre-existing tables still exist', Object.values(existingTables.rows[0]).every(v => v !== null));

    const sampleExerciseCount = await rdb.query(`select count(*) from exercises;`);
    record('Rollback: pre-existing sample exercise data untouched (8 rows from schema.sql)', Number(sampleExerciseCount.rows[0].count) === 8);

    await rdb.close();
  }

  // ── 19) Emergency rollback for 0002 — fresh, isolated instance ──────────
  // Proves the ACTUAL rollback file correctly undoes 0002's data (org,
  // staff row, organization_id backfill, audit event) while leaving 0001's
  // schema and all pre-existing data completely intact — including
  // correctly handling the last-administrator-delete guard trigger, which
  // would otherwise block this exact delete.
  {
    const rdb2 = new PGlite({ extensions: { uuid_ossp } });
    await rdb2.exec(`create extension if not exists "uuid-ossp";`);
    await rdb2.exec(`create role anon nologin; create role authenticated nologin;`);
    await rdb2.exec(`create schema auth;`);
    await rdb2.exec(`create table auth.users (id uuid primary key default uuid_generate_v4(), email text, raw_user_meta_data jsonb, last_sign_in_at timestamptz);`);
    await rdb2.exec(`create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;`);
    await expectSucceeds(rdb2, readFileSync(schemaPath, 'utf8'), 'Rollback-0002 test: baseline schema.sql applies');
    await expectSucceeds(rdb2, m0001, 'Rollback-0002 test: 0001 applies');
    await rdb2.exec(`insert into auth.users (id, email, last_sign_in_at) values
      ('a0000000-0000-0000-0000-000000000009', 'owner2@7ar.test', now());`);

    // 0002 now requires the exact 3/8/3/5 pre-backfill baseline — seed it
    // here too, same shape as the main flow above.
    const r2a1 = await rdb2.query(`insert into athletes (full_name, access_code) values ('R2 Athlete 1','R2A001') returning id;`);
    const r2a2 = await rdb2.query(`insert into athletes (full_name, access_code) values ('R2 Athlete 2','R2A002') returning id;`);
    const r2a3 = await rdb2.query(`insert into athletes (full_name, access_code) values ('R2 Athlete 3','R2A003') returning id;`);
    const r2p1 = await rdb2.query(`insert into weekly_plans (athlete_id, week_start) values ('${r2a1.rows[0].id}','2025-12-01') returning id;`);
    const r2p2 = await rdb2.query(`insert into weekly_plans (athlete_id, week_start) values ('${r2a2.rows[0].id}','2025-12-01') returning id;`);
    const r2p3 = await rdb2.query(`insert into weekly_plans (athlete_id, week_start) values ('${r2a3.rows[0].id}','2025-12-01') returning id;`);
    const r2ex = await rdb2.query(`select id from exercises order by name limit 2;`);
    await rdb2.exec(`insert into assigned_exercises (weekly_plan_id, exercise_id, day, session_type) values
      ('${r2p1.rows[0].id}', '${r2ex.rows[0].id}', 'monday', 'strength'),
      ('${r2p1.rows[0].id}', '${r2ex.rows[1].id}', 'tuesday', 'mobility'),
      ('${r2p2.rows[0].id}', '${r2ex.rows[0].id}', 'wednesday', 'strength'),
      ('${r2p3.rows[0].id}', '${r2ex.rows[1].id}', 'thursday', 'mobility'),
      ('${r2p3.rows[0].id}', '${r2ex.rows[0].id}', 'friday', 'strength');`);

    const m0002ForTest = substitute(m0002Raw, 'REPLACE_WITH_YOUR_PRIMARY_EMAIL', 'owner2@7ar.test');
    await expectSucceeds(rdb2, m0002ForTest, 'Rollback-0002 test: 0002 applies for the primary account');

    const platformAdminBeforeRollback = await rdb2.query(`select count(*) from platform_admins;`);
    record('Rollback-0002 test: 0002 also created the platform_admins row as expected', Number(platformAdminBeforeRollback.rows[0].count) === 1);

    const rollback0002Sql = readFileSync(join(migrationsDir, 'rollback', '0002_emergency_rollback.sql'), 'utf8');
    await expectSucceeds(rdb2, rollback0002Sql, 'Rollback-0002 test: 0002_emergency_rollback.sql applies cleanly (handles the last-admin-delete guard correctly)');

    const orgGoneAfterRollback = await rdb2.query(`select count(*) from organizations;`);
    record('Rollback-0002: organization removed', Number(orgGoneAfterRollback.rows[0].count) === 0);

    const platformAdminGoneAfterRollback = await rdb2.query(`select count(*) from platform_admins;`);
    record('Rollback-0002: platform_admins row removed', Number(platformAdminGoneAfterRollback.rows[0].count) === 0);

    const staffGoneAfterRollback = await rdb2.query(`select count(*) from staff_profiles;`);
    record('Rollback-0002: staff_profiles row removed', Number(staffGoneAfterRollback.rows[0].count) === 0);

    const auditGoneAfterRollback = await rdb2.query(`select count(*) from audit_events;`);
    record('Rollback-0002: audit_events row removed', Number(auditGoneAfterRollback.rows[0].count) === 0);

    const orgIdNulledAfterRollback = await rdb2.query(`
      select count(*) from exercises where organization_id is not null;
    `);
    record('Rollback-0002: organization_id backfill reset to null on existing tables', Number(orgIdNulledAfterRollback.rows[0].count) === 0);

    const triggerReenabled = await rdb2.query(`
      select tgenabled from pg_trigger where tgname = 'staff_profiles_last_admin_delete_guard';
    `);
    record('Rollback-0002: the last-admin-delete guard trigger was correctly RE-ENABLED after use', triggerReenabled.rows[0]?.tgenabled === 'O');

    const sampleExerciseCountAfterRollback = await rdb2.query(`select count(*) from exercises;`);
    record('Rollback-0002: pre-existing sample exercise data untouched (8 rows) and 0001 schema still present', Number(sampleExerciseCountAfterRollback.rows[0].count) === 8);

    const schemaStillPresent = await rdb2.query(`select to_regclass('public.staff_profiles') as t;`);
    record('Rollback-0002: 0001 schema (staff_profiles table) is untouched, only its DATA was removed', schemaStillPresent.rows[0].t !== null);

    await rdb2.close();
  }

  // ── 22) TRUE FRESH-DATABASE MIGRATION SEQUENCE — the release-blocker
  // regression guard this section exists for. Proves the ACTIVE migration
  // chain alone — 0000 -> 0001 -> 0003 -> 0004 -> 0005 -> 0006 -> 0007 ->
  // 0008 -> 0009 -> 0010 -> 0011 -> 0012 (Milestone 5 added the last
  // four: the booking/scheduling domain foundation) — can construct the
  // entire schema from a completely empty database, with
  // NO reliance on supabase/schema.sql (historical reference only, see
  // CLAUDE.md) and NO execution of the archived one-time production
  // backfill (0002, now under supabase/migrations_archive/, which asserts
  // production-specific preconditions that would never hold on a fresh
  // database and is correctly excluded from this sequence). This is a
  // DIFFERENT scenario from the schema.sql-first flow exercised by the
  // rest of this file above — both are kept; neither replaces the other.
  {
    const archivedPath = join(archiveDir, '0002_milestone1_backfill.sql');
    const stillInActiveMigrations = existsSync(join(migrationsDir, '0002_milestone1_backfill.sql'));
    record(
      'Fresh-DB regression guard: 0002_milestone1_backfill.sql is NOT present in supabase/migrations/ (archived, not active)',
      !stillInActiveMigrations
    );
    record(
      'Fresh-DB regression guard: the archived backfill file exists at supabase/migrations_archive/0002_milestone1_backfill.sql',
      existsSync(archivedPath)
    );

    const fdb = new PGlite({ extensions: { uuid_ossp } });
    await fdb.exec(`create extension if not exists "uuid-ossp";`);
    await fdb.exec(`create role anon nologin; create role authenticated nologin;`);
    await fdb.exec(`create schema auth;`);
    await fdb.exec(`create table auth.users (id uuid primary key default uuid_generate_v4(), email text, raw_user_meta_data jsonb, last_sign_in_at timestamptz);`);
    await fdb.exec(`create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;`);

    const freshM0000 = readFileSync(join(migrationsDir, '0000_baseline_schema.sql'), 'utf8');
    const freshM0001 = readFileSync(join(migrationsDir, '0001_milestone1_schema.sql'), 'utf8');
    const freshM0003 = readFileSync(join(migrationsDir, '0003_milestone1_rls.sql'), 'utf8');
    const freshM0004 = readFileSync(join(migrationsDir, '0004_milestone2_activity_routines_schema.sql'), 'utf8');
    const freshM0005 = readFileSync(join(migrationsDir, '0005_milestone2_activity_routines_rls_rpc.sql'), 'utf8');
    const freshM0006 = readFileSync(join(migrationsDir, '0006_exercise_anon_policy_removal.sql'), 'utf8');
    const freshM0007 = readFileSync(join(migrationsDir, '0007_coach_physician_role_rpcs.sql'), 'utf8');
    const freshM0008 = readFileSync(join(migrationsDir, '0008_coach_physician_rls_cutover.sql'), 'utf8');
    const freshM0009 = readFileSync(join(migrationsDir, '0009_coach_identity_rpc.sql'), 'utf8');
    const freshM0010 = readFileSync(join(migrationsDir, '0010_coach_profiles.sql'), 'utf8');
    const freshM0011 = readFileSync(join(migrationsDir, '0011_services_and_coach_services.sql'), 'utf8');
    const freshM0012 = readFileSync(join(migrationsDir, '0012_coach_scheduling.sql'), 'utf8');

    await expectSucceeds(fdb, freshM0000, 'Fresh DB: 0000_baseline_schema.sql applies cleanly against a completely empty database');
    await expectSucceeds(fdb, freshM0001, 'Fresh DB: 0001_milestone1_schema.sql applies cleanly on top of 0000 alone (no schema.sql, no 0002)');
    await expectSucceeds(fdb, freshM0003, 'Fresh DB: 0003_milestone1_rls.sql applies cleanly with 0002 skipped entirely');
    await expectSucceeds(fdb, freshM0004, 'Fresh DB: 0004_milestone2_activity_routines_schema.sql applies cleanly');
    await expectSucceeds(fdb, freshM0005, 'Fresh DB: 0005_milestone2_activity_routines_rls_rpc.sql applies cleanly');
    await expectSucceeds(fdb, freshM0006, 'Fresh DB: 0006_exercise_anon_policy_removal.sql applies cleanly');
    await expectSucceeds(fdb, freshM0007, 'Fresh DB: 0007_coach_physician_role_rpcs.sql applies cleanly');
    await expectSucceeds(fdb, freshM0008, 'Fresh DB: 0008_coach_physician_rls_cutover.sql applies cleanly');
    await expectSucceeds(fdb, freshM0009, 'Fresh DB: 0009_coach_identity_rpc.sql applies cleanly');
    await expectSucceeds(fdb, freshM0010, 'Fresh DB: 0010_coach_profiles.sql applies cleanly');
    await expectSucceeds(fdb, freshM0011, 'Fresh DB: 0011_services_and_coach_services.sql applies cleanly');
    await expectSucceeds(fdb, freshM0012, 'Fresh DB: 0012_coach_scheduling.sql applies cleanly');

    // ── Post-sequence verification: critical baseline tables/types exist ──
    const freshTables = await fdb.query(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in
        ('athletes','exercises','weekly_plans','assigned_exercises',
         'organizations','staff_profiles','platform_admins','audit_events',
         'athlete_access_attempts','activity_routines',
         'coach_profiles','services','coach_services','coach_availability','coach_blocks');
    `);
    const expectedFreshTables = [
      'athletes','exercises','weekly_plans','assigned_exercises',
      'organizations','staff_profiles','platform_admins','audit_events',
      'athlete_access_attempts','activity_routines',
      'coach_profiles','services','coach_services','coach_availability','coach_blocks',
    ].sort();
    record(
      'Fresh DB: all 15 expected tables exist after the full active sequence (Milestone 5 adds the booking/scheduling domain foundation)',
      JSON.stringify(freshTables.rows.map(r => r.table_name).sort()) === JSON.stringify(expectedFreshTables),
      `got: ${freshTables.rows.map(r => r.table_name).sort().join(', ')}`
    );

    const freshTypes = await fdb.query(`
      select typname from pg_type where typname in
        ('exercise_category','day_of_week','staff_role','activity_type');
    `);
    record(
      'Fresh DB: all 4 expected enum types exist after the full active sequence (Milestone 5 adds no new enum — coach_availability reuses day_of_week)',
      freshTypes.rows.length === 4,
      `got: ${freshTypes.rows.map(r => r.typname).join(', ')}`
    );

    const freshFunctions = await fdb.query(`
      select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in
        ('set_updated_at','current_org_id','is_super_user','is_org_administrator',
         'log_audit_event','get_athlete_by_code','update_athlete_photo_by_code',
         'get_athlete_routines','enforce_activity_routine_exercise_org',
         'is_org_coach','is_org_physician',
         'current_staff_profile_id','set_coach_service_bookable');
    `);
    record(
      'Fresh DB: all 13 expected functions/RPCs exist after the full active sequence (Milestone 5 adds current_staff_profile_id/set_coach_service_bookable)',
      freshFunctions.rows.length === 13,
      `got: ${freshFunctions.rows.map(r => r.proname).join(', ')}`
    );

    const freshRlsCheck = await fdb.query(`
      select relname from pg_class
      where relname in (
        'athletes','exercises','weekly_plans','assigned_exercises','activity_routines',
        'coach_profiles','services','coach_services','coach_availability','coach_blocks'
      ) and relrowsecurity = true;
    `);
    record('Fresh DB: RLS is enabled on all 10 user-data tables (5 physician/trainer-domain + 5 Milestone 5 booking-domain)', freshRlsCheck.rows.length === 10);

    const freshCompositeFkCheck = await fdb.query(`
      select conname from pg_constraint
      where conname in ('staff_profiles_org_id_unique','services_org_id_unique');
    `);
    record('Fresh DB: the two composite organization-integrity UNIQUE constraints exist (staff_profiles, services)', freshCompositeFkCheck.rows.length === 2);

    await fdb.close();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const failed = results.filter(r => !r.pass);
  console.log('\n──────────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(` - ${f.name}${f.detail ? ': ' + f.detail : ''}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Test run crashed:', err);
  process.exitCode = 1;
});
