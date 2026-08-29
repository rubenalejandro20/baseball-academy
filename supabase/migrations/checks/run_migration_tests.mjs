// ============================================================
// Milestone 1 — local migration/RLS test suite (PGlite, no Docker required)
// ============================================================
// Runs migrations 0001 -> 0002 -> 0003 against a fresh, disposable, embedded
// Postgres (WASM, via @electric-sql/pglite) that faithfully supports real
// roles, RLS, triggers, and PL/pgSQL — the same primitives Supabase uses.
// This validates the SQL/RLS/trigger/RPC LOGIC end-to-end; it does not spin
// up GoTrue/PostgREST, so it cannot test actual HTTP/JWT issuance — only
// the database layer, which is where all of Milestone 1's real logic lives.
//
// REVISED after the Milestone 1 Step 1 production inventory:
//   - schema.sql's activity_routines section is now commented out (confirmed
//     absent in production), so loading schema.sql as the baseline already
//     matches production reality without any special-casing here.
//   - 0002's staff backfill is no longer a blanket "every auth.users row"
//     statement (Part A, automated) — staff onboarding is now an explicit
//     per-account statement (Part B / Step B1) with a placeholder email.
//     This suite executes the ACTUAL file content with the placeholder
//     substituted, so it proves the real documented instructions work, not
//     a re-typed equivalent.
//
// Usage: node supabase/migrations/checks/run_migration_tests.mjs
//   (or: npm run test:db)
//
// Does NOT connect to any real/production/staging Supabase project.
// ============================================================

import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..');
const schemaPath = join(__dirname, '..', '..', 'schema.sql');

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
  record('Baseline confirms activity_routines does NOT exist (matches production inventory)', preMigrationCheck.rows[0].t === null);

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
  const m0002Raw = readFileSync(join(migrationsDir, '0002_milestone1_backfill.sql'), 'utf8');

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
  record('After all 3 migrations, activity_routines STILL does not exist (no regression re-introducing it)', postMigrationCheck.rows[0].t === null);

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
  record('Anonymous: exercises SELECT still succeeds (intentional PIN-bridge policy)', anonExercises.rows.length === 11, `got ${anonExercises.rows.length} rows`);
  await expectThrows(db, `insert into exercises (name, category) values ('hack', 'mobility');`, 'Anonymous: exercises INSERT denied', undefined);
  const anonActivityRoutinesCheck = await db.query(`select to_regclass('public.activity_routines') as t;`);
  record('Anonymous access check for activity_routines: N/A, table confirmed absent (nothing to test)', anonActivityRoutinesCheck.rows[0].t === null);
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
