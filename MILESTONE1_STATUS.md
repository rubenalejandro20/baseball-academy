# Milestone 1 — Verified Production Status

**Read this before touching any file in `supabase/migrations/` or `supabase/schema.sql`.**

This document records the CURRENT, manually verified state of the production Supabase project as of the date below. There is no automated migration-history table backing this — the numbered files in `supabase/migrations/` are hand-run SQL, not a tracked/idempotent migration chain. This file is the only record of what has actually been applied. If it is ever wrong, fix it after re-verifying against production directly — do not guess, and do not re-run a migration file to "find out."

Last verified: 2026-09-29.

---

## 1. Milestone 1 database rollout status

| File / Section | Status |
|---|---|
| `0001_milestone1_schema.sql` | **Applied** (full file) |
| `0002_milestone1_backfill.sql` | **Applied** (one-shot bootstrap; running it again is expected to abort, not no-op — see the file's own preconditions) |
| `0003_milestone1_rls.sql` — Section 1 (`athletes`) | **Applied and verified** |
| `0003_milestone1_rls.sql` — Section 2 (`exercises`) | **Applied and verified** |
| `0003_milestone1_rls.sql` — Section 3 (`weekly_plans`) | **Applied and verified** |
| `0003_milestone1_rls.sql` — Section 4 (`assigned_exercises`) | **Applied and verified** |
| `0003_milestone1_rls.sql` — Section 5 (`activity_routines`) | **Intentionally not part of 0003** — at the time 0003 was written, this table did not exist in production, so there was nothing to alter there. `activity_routines` has since been created and secured separately, via Milestone 2 (`0004`/`0005`), not by amending 0003. See [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md) for its current status. |
| `0003_milestone1_rls.sql` — Section 6 (`organizations`, `staff_profiles`, `platform_admins`, `audit_events` read policies) | **Applied and verified** |
| `athlete_access_attempts` RLS | Enabled with **zero policies**, intentionally — it is only ever written by the `SECURITY DEFINER` functions `get_athlete_by_code` / `update_athlete_photo_by_code`, never directly by `anon` or `authenticated`. |

Net effect: **all of 0001, 0002, and 0003 that can apply (i.e. everything except the never-existent Section 5) is live in production.** 0003 is not "partially applied" in the sense of being unfinished — it is fully applied for every table that actually exists.

## 2. Application verification completed

The following were manually verified against the local dev server connected to the real production Supabase project:

- `npm install` succeeds
- `npm run dev` succeeds
- Application loads locally
- Supabase production connection works
- Admin authentication works
- Admin dashboard loads
- Athlete PIN/code lookup works
- Athlete portal loads
- Athlete exercise plan loads

The routine builder screens (`/admin/routines/*`) and the athlete wizard's routine view, which depend on `activity_routines`, were not yet functional at the time this file was first written — that has since been resolved via Milestone 2. See [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md).

## 3. Important warnings

- **Do NOT rerun `0001_milestone1_schema.sql`, `0002_milestone1_backfill.sql`, or any already-applied section of `0003_milestone1_rls.sql` against production.** 0001 is written to be safely re-runnable, but 0002 is a one-shot bootstrap that will deliberately abort (not no-op) on a second run against a populated database, and re-running 0003 sections would `DROP POLICY` and recreate policies that are already correct — unnecessary and risky against a live database with real traffic.
- **Do not assume 0003 is unapplied just because there is no automated migration-history table.** This project does not use a migration runner; "applied" means "manually run against production and manually verified," as recorded in this file, not "tracked by tooling."
- **Any production database change requires explicit review before execution** — no migration, RLS policy change, or backfill should be run against production without first being reviewed against this file's recorded state and the target migration file's own preconditions/assertions.
- **`.env.local` contains local credentials and must remain gitignored.** It already is (see `.gitignore`) — do not remove that entry or commit a `.env.local`/`.env` file.
- **Never commit Supabase secret/service-role credentials.** Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (both anon-scoped, RLS-constrained) belong in this app's environment — there is no service-role key in use anywhere in the codebase, and none should be added without a specific, reviewed reason.

## 4. Known remaining issues

- ~~`activity_routines` does not currently exist in production~~ — **resolved via Milestone 2.** See [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md) for the current rollout status.
- ~~`exercises` still has the temporary org-unscoped anonymous SELECT policy~~ — **resolved via Milestone 3.** See [MILESTONE3_STATUS.md](MILESTONE3_STATUS.md) for the current rollout status.
- **Staff management writes are deferred.** `staff_profiles` has a read policy only — no INSERT/UPDATE/DELETE policy exists, and no invite/role-change/deactivate UI exists in the app. This is explicitly scoped to a future phase.
- **Role fidelity beyond administrator/non-administrator is deferred.** `getStaffContext()` can only answer "administrator or not" via `is_org_administrator()` — a real coach/physician distinction needs a dedicated RPC that doesn't exist yet.
- **Athlete photo/storage policy work remains incomplete.** The `athlete-photos` storage bucket exists (public) but `storage.objects` has zero RLS policies in production, so photo uploads fail closed for every caller today. This is a pre-existing non-functional feature, not a regression.
- **Automated UI/E2E coverage is not yet present.** `npm run test:db` covers the database/RLS/RPC layer only (via an embedded PGlite Postgres); there is no automated test coverage for the Next.js UI.

## 5. Architecture summary

Next.js 14 (App Router) + Supabase (Postgres + Auth + Storage), no separate backend server. Two independent access paths into the same database:

- **Admin/staff** (`/admin/*`) — real Supabase Auth sessions (email + password). `src/app/admin/layout.tsx` guards every admin route by calling `getStaffContext()` (`src/lib/auth/getStaffContext.ts`), which resolves the signed-in user's organization and role via three `SECURITY DEFINER` RPCs (`current_org_id`, `is_org_administrator`, `is_super_user`) rather than reading `staff_profiles` directly — that table has RLS enabled but only a read policy, so this RPC-based approach gives correct answers whether or not further staff-facing policies exist yet. Once past the guard, admin pages query Supabase tables directly from the client; Row Level Security (org-scoped as of Milestone 1) is what actually enforces access, not application logic.
- **Athlete** (`/athlete/*`) — no authentication at all. Athletes identify themselves with a short PIN (`access_code`). Because a browser can't be trusted to report its own IP, two Next.js Route Handlers (`src/app/api/athlete/lookup/route.ts`, `src/app/api/athlete/photo/route.ts`) sit in front of two rate-limited `SECURITY DEFINER` RPCs (`get_athlete_by_code`, `update_athlete_photo_by_code`) purely to forward a trustworthy `x-forwarded-for` IP into the rate limiter. These are the only Route Handlers in the app; every other page does direct Supabase queries. This PIN-based path is explicitly temporary, intended to be retired once athlete identity moves to email OTP.

Everything else — exercise library, weekly plan builder, QR code generation, the routine builder (see [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md)) — is CRUD against Supabase tables from admin page components, org-scoped by RLS.

## 6. Recommended next development sequence

Documented for planning purposes only — nothing below has been implemented or scheduled yet.

**A.** ~~Resolve `activity_routines` architecture.~~ **Done — see [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md).**

**B.** ~~Harden athlete/exercise organization isolation.~~ **Done — see [MILESTONE3_STATUS.md](MILESTONE3_STATUS.md).**

**C. Finish athlete photo/storage flow.** Add the missing `storage.objects` RLS policy (scoped to an athlete's own upload path, mirroring the `update_athlete_photo_by_code` column-level check already in place) so the selfie-upload feature actually functions.

**D. Staff/role management.** Design and implement the controlled write path for `staff_profiles` (invite, role change, deactivate/reactivate) — almost certainly as privileged Server Actions rather than a raw client-writable RLS policy, per the reasoning already recorded in `0003`'s comments. The last-administrator guard and identity-protection triggers already in `0001` will continue to backstop this regardless of the write path chosen.

**E. Automated application tests.** Extend test coverage beyond the existing `npm run test:db` (DB/RLS layer) to the Next.js application layer — component and/or end-to-end coverage for the admin and athlete flows that are currently only verified manually.
