# Milestone 2 (Activity Routines) — Verified Production Status

**Read this alongside [MILESTONE1_STATUS.md](MILESTONE1_STATUS.md) before touching any file in `supabase/migrations/`.**

This document records the CURRENT, manually verified state of the production Supabase project with respect to the Milestone 2 (`activity_routines`) work. As with Milestone 1, there is no automated migration-history table backing this — "applied" means manually run against production and manually verified, as recorded here, not tracked by tooling. If this file is ever wrong, fix it after re-verifying against production directly — do not guess, and do not re-run a migration file to "find out."

Last verified: 2026-10-01.

---

## 1. Milestone 2 database rollout status

| File | Status |
|---|---|
| `0004_milestone2_activity_routines_schema.sql` | **Applied to production** |
| `0005_milestone2_activity_routines_rls_rpc.sql` | **Applied to production** |

Net effect: `activity_routines` now exists in production, with RLS enabled, a staff org-scoped policy, the cross-organization exercise integrity trigger, and the athlete-facing `get_athlete_routines()` RPC — all live. See [CLAUDE.md](CLAUDE.md) for the architectural description of how this fits into the rest of the app.

## 2. Production verification results

**Post-0004 verification (before 0005 was applied):**
- `activity_routines` exists
- RLS enabled = true
- Policy count = 0 (correct, default-deny intermediate state — matches the staged rollout design: 0004 is schema-only, 0005 adds access)

**Post-0005 security verification:**
- Staff `activity_routines` policy exists (`"Staff org access - activity_routines"`)
- `get_athlete_routines` RPC exists
- `anon` **can** execute the RPC
- `authenticated` **cannot** execute the RPC
- `PUBLIC` **cannot** execute the RPC

This matches the intended design exactly: staff reach `activity_routines` through RLS-scoped direct table access (no RPC needed), and the anonymous athlete portal reaches it **only** through the RPC, never through a table policy.

## 3. Pre-deployment testing (completed before production application)

- `npm run test:db`: **134/134 checks passed** locally (PGlite-based migration/RLS/RPC suite, including the Milestone 2 schema, RLS, RPC, and cross-organization integrity-guard coverage)
- `npm run build`: **succeeded** (clean compile, type-check, and static generation of all routes)

Both were green before 0004/0005 were run against production.

## 4. Manual application verification (post-deployment, against production)

**Admin:**
- `/admin/routines` loads successfully
- Created one Pitching → Pre-Training routine exercise
- The routine persisted after a full page refresh

**Athlete:**
- Logged in through the existing PIN flow
- Selected Pitching → Pre-Training
- The newly-created routine exercise displayed successfully, served through `get_athlete_routines`

**End-to-end path confirmed working in production:**
Admin UI → RLS-protected `activity_routines` write → production database → secure athlete RPC (`get_athlete_routines`) → athlete UI.

## 5. Security properties now active in production

- **Cross-organization exercise integrity trigger is active.** `activity_routines_exercise_org_guard` (calling `enforce_activity_routine_exercise_org()`, `SECURITY DEFINER`) fires on every `INSERT`/`UPDATE` and rejects any row whose `organization_id` doesn't match its `exercise_id`'s own `organization_id`, unless that exercise is shared/global (`exercises.organization_id IS NULL`). This is enforced at the database level, not just in the admin UI.
- **No anonymous SELECT policy exists on `activity_routines`.** Unlike the old (never-applied) design in `schema.sql` §8, there is no `FOR SELECT TO anon USING (TRUE)` policy on this table, and none should ever be added — see `0005`'s own header comment for why that would reproduce a cross-organization data leak.
- **All athlete access to routine data goes through `get_athlete_routines()`.** This `SECURITY DEFINER` RPC resolves the caller's organization server-side from a validated, active access code — the browser never supplies or influences `organization_id`. It also independently filters the joined exercise by organization (`e.organization_id = v_org_id OR e.organization_id IS NULL`) as defense-in-depth, so a cross-organization exercise can never be surfaced even if a bad row somehow existed.

## 6. Rollback files and required rollback order

| File | Scope |
|---|---|
| `supabase/migrations/rollback/0005_milestone2_emergency_rollback.sql` | Drops the staff RLS policy and `get_athlete_routines()` only. Table and all data remain intact — no data loss. |
| `supabase/migrations/rollback/0004_milestone2_emergency_rollback.sql` | Drops `activity_routines` (all routine data lost), its trigger (dropped implicitly with the table), `enforce_activity_routine_exercise_org()` (dropped explicitly), and the `activity_type` enum. |

**Required order: roll back 0005 before 0004.** `0005`'s objects (the RPC, the policy) depend on `0004`'s table/enum existing; rolling back `0004` first while `0005` is still applied would leave `get_athlete_routines()` behind as a dangling function that errors at call time once the table is gone. `0004`'s rollback file explicitly notes this and orders its own `DROP FUNCTION enforce_activity_routine_exercise_org()` after `DROP TABLE activity_routines`, for the same reason (the trigger must already be gone before the function it called is dropped).

Neither rollback file touches any Milestone 1 (`0001`/`0002`/`0003`) object.

## 7. Important warnings (same posture as Milestone 1)

- **Do NOT rerun `0004` or `0005` against production.** Both are written to be safely re-runnable (idempotent `IF NOT EXISTS`/`CREATE OR REPLACE`/`DROP ... IF EXISTS` patterns), but there is no reason to re-apply already-live, already-verified objects against a database with real traffic.
- **Do not assume 0004/0005 are unapplied just because there is no automated migration-history table.** This file is the record of what has actually been run.
- **Any further production database change requires explicit review before execution**, same as Milestone 1.
