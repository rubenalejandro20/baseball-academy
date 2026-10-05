# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Next.js development server
npm run build    # Build for production
npm start        # Start production server
npm run lint     # Run ESLint
npm run test:db  # Run the migration/RLS test suite (PGlite, no Docker/Supabase needed)
```

`npm run test:db` runs [supabase/migrations/checks/run_migration_tests.mjs](supabase/migrations/checks/run_migration_tests.mjs), which spins up an embedded Postgres (via `@electric-sql/pglite`) and applies `schema.sql` + the numbered migrations against it, then asserts on RLS behavior, RPC rate limiting, triggers, and rollback correctness. There is no framework for testing UI/component code.

## Environment Setup

Copy `.env.example` to `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`

## Architecture

Next.js 14 App Router app using Supabase (PostgreSQL + Auth + Storage) as the backend. Data access is direct Supabase queries from page components in most places; there are two Route Handlers (`src/app/api/athlete/`) that proxy specific rate-limited RPCs — see "PIN bridge" below. Row Level Security enforces access control.

### Three distinct user flows

**Admin/Physician side** (`/admin/`) — Protected by Supabase Auth, dark navy + emerald theme:
- `layout.tsx` is the auth guard — it calls `getStaffContext()` (below) in a client-side `useEffect` and redirects unauthenticated sessions to `/admin/login`. A session that resolves to no active `staff_profiles` row is shown an "Account not linked" screen instead of being bounced to login (so it isn't mistaken for a wrong password). As of Milestone 4, a plain `coach` account is shown a distinct "Access not available" screen instead — RLS (0008) already blocks the underlying data for a coach, this is just the matching UX denial instead of a confusing, data-less admin UI. Administrators, physicians, and Super Users are unaffected.
- Sidebar/mobile chrome lives in [src/components/shell/AppShell.tsx](src/components/shell/AppShell.tsx), shared by `admin/layout.tsx` and `coach/layout.tsx`. The "checking"/"not linked"/"forbidden" full-screen states are shared via [src/components/shell/StaffGuardScreens.tsx](src/components/shell/StaffGuardScreens.tsx) (Milestone 4), so both guards render identical denial/explanation UI rather than duplicating the markup.
- Nav covers: dashboard stats, athlete CRUD, exercise library CRUD, routine management (24 slots, backed by `activity_routines` — see below), QR code generation.
- `/admin/assignments` and `/admin/assignments/[athleteId]` are a second, older per-athlete weekly planner (day-of-week × session-type grid backed by `weekly_plans`/`assigned_exercises`). It has no sidebar entry but is still fully wired up — linked from the dashboard, the athletes list, and each athlete's detail page — so treat it as live code, not dead code, despite `assigned_exercises`/`weekly_plans` being called "legacy" in the DB schema comments.

**Coach Portal** (`/coach/`) — Milestone 4, protected by the same Supabase Auth session as `/admin/`:
- `layout.tsx` reuses `getStaffContext()`/`AppShell`/`StaffGuardScreens` exactly like `admin/layout.tsx` — there is no separate `/coach/login`; both portals authenticate through the one existing `/admin/login`.
- Allowed: `coach`, `administrator`, Super User. A plain `physician` is shown the "Access not available" screen — the mirror image of the admin guard denying a plain coach.
- Currently a single minimal placeholder page (`/coach`) proving the role-gated shell works end to end. Milestone 5 added the booking/scheduling **database** foundation (`coach_profiles`, `services`, `coach_services`, `coach_availability`, `coach_blocks` — see below) but deliberately no UI for any of it yet — no `/coach/services`, `/coach/availability`, bookings, contacts, or public booking surface exist. See [MILESTONE5_STATUS.md](MILESTONE5_STATUS.md) for exact scope boundaries.

**Athlete side** (`/athlete/`) — No authentication, light mobile-first theme:
- Athletes identify themselves via a PIN/access code (not user accounts)
- `/athlete` — PIN entry form
- `/athlete/[code]` — Multi-step activity selection flow → routine view (athletes can also upload a selfie photo)
  1. Step 1: Select activities (multi-select: Pitching, Catching, Hitting, Fielding)
  2. Step 2: Select session type (Pre-Training, Post-Training, Recovery, Mobility, Strength, Injury Prevention)
  3. Step 3 (conditional): If multiple activities + Pre/Post → pick primary activity ("first" or "last")
  4. Routine view: read-only exercise list from `activity_routines`

The root `/` redirects to `/admin/login`.

### `activity_routines` (Milestone 2)

`schema.sql` §8's commented-out `activity_routines` table + `activity_type` enum was, for a long time, never actually applied to production even though the application code (`src/app/admin/routines/*`, `src/app/athlete/[code]/page.tsx`) queried it unconditionally. **This has been resolved as of Milestone 2** — the table now exists in production, created via [supabase/migrations/0004_milestone2_activity_routines_schema.sql](supabase/migrations/0004_milestone2_activity_routines_schema.sql) and secured via [supabase/migrations/0005_milestone2_activity_routines_rls_rpc.sql](supabase/migrations/0005_milestone2_activity_routines_rls_rpc.sql), not by editing `schema.sql` (still historical-only, see below). See [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md) at the repo root for full rollout/verification detail.

Key points: `activity_routines` has `organization_id NOT NULL` and a cross-organization integrity trigger (`enforce_activity_routine_exercise_org`) that rejects any row whose exercise belongs to a different organization (unless the exercise is shared/global, i.e. `exercises.organization_id IS NULL`). Staff reach it via a normal org-scoped RLS policy; there is **no anonymous SELECT policy** on this table at all — the athlete portal reads it exclusively through the `get_athlete_routines()` `SECURITY DEFINER` RPC, which resolves the caller's organization server-side from a validated access code rather than trusting anything the browser supplies.

### Multi-tenant auth layer (Milestone 1)

An organizations/staff-roles layer was added on top of the original single-tenant schema, as three ordered migrations rather than edits to `schema.sql` (which is now historical documentation of the pre-Milestone-1 schema and does **not** reflect the live database):

- [supabase/migrations/0001_milestone1_schema.sql](supabase/migrations/0001_milestone1_schema.sql) — additive schema: `organizations`, `staff_profiles` (`auth_user_id` ↔ `organization_id` ↔ `role`, role = `administrator`/`coach`/`physician`), `platform_admins` (Super User registry, architecturally separate from any org role), `audit_events` (append-only, written only via `log_audit_event()`), nullable `organization_id` on `athletes`/`exercises`/`weekly_plans`.
- [supabase/migrations/0002_milestone1_backfill.sql](supabase/migrations/0002_milestone1_backfill.sql) — one-time data backfill; requires substituting a placeholder email and asserts strict pre-conditions (aborts rather than silently reconciling if the DB doesn't match the expected baseline).
- [supabase/migrations/0003_milestone1_rls.sql](supabase/migrations/0003_milestone1_rls.sql) — RLS cutover onto the new tables, applied section-by-section. **Verified status: sections 1–4 and 6 are live in production; section 5 (`activity_routines`) was never part of this file's scope — that table didn't exist when 0003 was written, and was created/secured separately under Milestone 2 (`0004`/`0005`) instead.** See [MILESTONE1_STATUS.md](MILESTONE1_STATUS.md) and [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md) at the repo root for the full, authoritative rollout record — check them (and update if verified state changes) before assuming any migration file is or isn't applied to production. There is no automated migration-history table backing this; "applied" means manually run and manually verified.
- `supabase/migrations/rollback/000{1,2}_emergency_rollback.sql` — hand-written, CASCADE-free rollbacks for 0001/0002, exercised by the test suite.

App code resolves the current user's org/role via [src/lib/auth/getStaffContext.ts](src/lib/auth/getStaffContext.ts), which calls the `current_org_id()` / `is_org_administrator()` / `is_org_coach()` / `is_org_physician()` / `is_super_user()` SECURITY DEFINER RPCs rather than querying `staff_profiles` directly. `staff_profiles` carries a read policy only (added in 0003 §6, live in production) — there is still no INSERT/UPDATE/DELETE policy on it, so this RPC-based approach remains the only path to identity/role info; a direct write from the client will not work. Milestone 1 only distinguished "administrator or not" — the real coach/physician distinction was added in Milestone 4, see below.

### Coach/physician role differentiation (Milestone 4)

Until Milestone 4, every authenticated staff role (administrator, coach, physician) had identical org-scoped access to every physician/trainer-domain table — `is_org_administrator()` was the only role-check RPC. This is now closed:

- [supabase/migrations/0007_coach_physician_role_rpcs.sql](supabase/migrations/0007_coach_physician_role_rpcs.sql) — adds `is_org_coach()` / `is_org_physician()`, same `SECURITY DEFINER`/empty-`search_path` pattern as `is_org_administrator()`. Both are **strict, single-role checks** — an administrator gets `false` from both; "administrators also keep physician-domain access" is a policy-composition decision made in 0008's policy text (`is_org_administrator() OR is_org_physician()`), not baked into these functions.
- [supabase/migrations/0008_coach_physician_rls_cutover.sql](supabase/migrations/0008_coach_physician_rls_cutover.sql) — tightens the `"Staff org access - X"` policy on exactly five tables (`athletes`, `exercises`, `weekly_plans`, `assigned_exercises`, `activity_routines`) so a plain coach can no longer read or write any of them (both `USING` and `WITH CHECK`). Administrators, physicians, and Super Users retain exactly the access they had. `organizations`, `staff_profiles`, `audit_events`, and `platform_admins` are untouched — not physician/trainer-sensitive, and `audit_events` already excluded coaches. The athlete-facing `get_athlete_routines()` RPC is `SECURITY DEFINER` and was never subject to these table policies, so the athlete PIN portal and Activity Routines routine view are unaffected by design.
- **Not yet applied to production** — developed and verified entirely via `npm run test:db` (see [MILESTONE4_STATUS.md](MILESTONE4_STATUS.md)); production application is a separate, later, explicitly authorized step, same posture 0004/0005/0006 originally had.

### Booking/scheduling domain foundation (Milestone 5)

Database-only — no UI. Lays the minimum schema for the eventual Coach → Service → Date/Time booking flow, without building bookings themselves yet.

- [supabase/migrations/0009_coach_identity_rpc.sql](supabase/migrations/0009_coach_identity_rpc.sql) — adds `current_staff_profile_id()`, the first RPC that resolves *which* `staff_profiles` row the caller is (every prior role RPC only answered *what is true about* the caller). Every migration below depends on it.
- [supabase/migrations/0010_coach_profiles.sql](supabase/migrations/0010_coach_profiles.sql) — `coach_profiles`: booking-facing coach configuration (`display_name`, `bio`, `is_bookable_online`), deliberately separate from `staff_profiles` (identity) rather than columns bolted onto it. **Not auto-created** — only an administrator or Super User may create or delete a row; a coach may `SELECT`/`UPDATE` their own existing row (editable fields only) but cannot `INSERT` or `DELETE`. `coach_id`/`organization_id` are immutable after insert for every actor, enforced by a trigger, not RLS.
- [supabase/migrations/0011_services_and_coach_services.sql](supabase/migrations/0011_services_and_coach_services.sql) — `services` (the academy's catalog; administrator-managed, coach read-only; name uniqueness is per-organization and **case-insensitive**, via a `lower(name)` unique index, not the `citext` extension) and `coach_services` (coach↔service pairings with per-pairing `price_cents`/`duration_minutes` overrides and an `is_active` bookable flag). A coach has **no write policy at all** on `coach_services` — the only way a coach can pause/resume their own offering is the new `set_coach_service_bookable(id, bool)` `SECURITY DEFINER` RPC, whose narrow signature makes it structurally incapable of touching price, duration, or any identity column. See that migration's own header comment for why ordinary RLS and column-level `GRANT`s were both rejected as mechanisms for this.
- [supabase/migrations/0012_coach_scheduling.sql](supabase/migrations/0012_coach_scheduling.sql) — `coach_availability` (recurring weekly windows, reusing the existing `day_of_week` enum) and `coach_blocks` (one-off blocked time, including `updated_at` — it supports full `UPDATE` via RLS just like the other four tables, so it gets the same last-modified tracking) — deliberately separate tables, not one with nullable "recurring or specific" columns. A coach has full CRUD on their own rows in both; administrators manage any coach's rows within their org.
- **Organization integrity via composite foreign keys, not triggers**: `coach_profiles`, `coach_services`, `coach_availability`, and `coach_blocks` all carry a composite FK of the shape `(organization_id, coach_id) REFERENCES staff_profiles(organization_id, id)` (and, for `coach_services`, an equivalent against `services`). This makes a cross-organization pairing a hard constraint-level impossibility with no trigger needed — possible here (unlike Milestone 2's `enforce_activity_routine_exercise_org` trigger) only because none of these FK columns are nullable.
- **Deletion semantics**: every new `coach_id`/`service_id` foreign key uses `ON DELETE RESTRICT`, not `CASCADE` — these are booking-domain records a future `bookings` table will likely reference for historical integrity, so nothing here may be silently cascaded away. This matches the project's existing, dominant convention of deactivating (`is_active`) rather than hard-deleting a business entity.
- **Peer-coach isolation** is new: every prior RLS policy in this project was org-scoped; these are the first tables where a coach is also isolated from *other coaches in the same organization*, via `coach_id = current_staff_profile_id()`.
- **Explicit table privileges, not just RLS**: unlike every earlier migration in this project (which all rely on Supabase's default privilege grant to `anon`/`authenticated` and use RLS as the only boundary), all five Milestone 5 tables carry an explicit `GRANT ... TO authenticated` plus `REVOKE ALL ... FROM anon` in their own migration file. These five tables have a hard "zero anonymous access" requirement, so that's made a property of the migration itself — a second, independent layer under RLS — rather than an assumption about platform configuration that happens to currently be safe only because no policy mentions `anon`.
- **Identity-protection triggers also guard `created_at`**, matching `0001`'s `protect_staff_profile_identity_fields()` precedent exactly (an earlier draft of these triggers omitted it — caught in post-implementation audit).
- `is_org_physician()` appears in none of this milestone's policies, and none of these tables carry an anonymous policy — both deliberately, matching the explicit privacy boundary Milestone 4 established, applied here in the other direction.
- **Not yet applied to production** — same posture as Milestone 4. See [MILESTONE5_STATUS.md](MILESTONE5_STATUS.md).

### PIN bridge (`/api/athlete/*`)

`get_athlete_by_code` and `update_athlete_photo_by_code` are rate-limited Postgres RPCs (backed by `athlete_access_attempts`) that replaced the previously wide-open anonymous RLS policies on `athletes`. [src/app/api/athlete/lookup/route.ts](src/app/api/athlete/lookup/route.ts) and [src/app/api/athlete/photo/route.ts](src/app/api/athlete/photo/route.ts) are the **only** Route Handlers in the app, and exist solely to read a trustworthy client IP (`x-forwarded-for`) server-side to pass into the rate limiter — a browser calling the RPC directly can't supply an unspoofable IP. Everything else still queries Supabase directly from page components. This bridge is intentionally temporary, to be retired once athlete auth moves to email OTP.

Note also: the `athlete-photos` storage bucket exists but `storage.objects` has zero RLS policies in production, so the athlete selfie upload currently fails closed for everyone — a pre-existing non-functional feature, not a regression.

### Key shared modules

- [src/lib/types.ts](src/lib/types.ts) — Single source of truth for all TypeScript interfaces, enums (`ExerciseCategory`, `ActivityType`, `StaffRole`), and UI helper constants (`CATEGORY_LABELS`, `CATEGORY_COLORS`, `ACTIVITY_LABELS`, `ACTIVITIES`, `SESSION_TYPES`) plus utility functions (`formatDuration`)
- [src/lib/supabase.ts](src/lib/supabase.ts) — Supabase client factory using `@supabase/auth-helpers-nextjs`
- [src/lib/auth/getStaffContext.ts](src/lib/auth/getStaffContext.ts) — resolves the signed-in user's org/role context; see above

### Database schema

`supabase/schema.sql` is historical documentation of the pre-Milestone-1 schema only — it does not reflect the live database and is never applied by automated tooling. For a fresh, empty database (local dev, CI, a disposable test instance), the canonical, machine-applied baseline is [supabase/migrations/0000_baseline_schema.sql](supabase/migrations/0000_baseline_schema.sql) — it reconstructs the same pre-Milestone-1 objects (`athletes`/`exercises`/`weekly_plans`/`assigned_exercises`, their enums, the shared `set_updated_at()` trigger function, RLS enablement) from `schema.sql`'s sections 1–6, minus schema.sql's legacy anon/admin policies (superseded by 0003) and its sample data. The full active migration chain that can build DugoutOS from nothing is, in exact order: `0000 → 0001 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008 → 0009 → 0010 → 0011 → 0012` (`0007`/`0008` added by Milestone 4; `0009`–`0012` added by Milestone 5). `0002_milestone1_backfill.sql` has been moved to `supabase/migrations_archive/` — it was a one-time production data backfill (hardcoded row counts, a specific account email) that intentionally aborts rather than runs against an empty database, so it does not participate in this chain; it is kept only as the historical record of what was actually run against production. See [supabase/migrations/checks/run_migration_tests.mjs](supabase/migrations/checks/run_migration_tests.mjs) for the automated test of both the historical (`schema.sql`-first) and the fresh-database (`0000`-first) deployment paths. Tables:

| Table | Purpose |
|-------|---------|
| `athletes` | Athlete profiles; `access_code` is the PIN athletes use; `is_active` for soft deletes; `organization_id` added by 0001 |
| `exercises` | Exercise library; `category` is `exercise_category` enum; `organization_id` added by 0001 |
| `weekly_plans` | One row per athlete per week; still editable via `/admin/assignments/[athleteId]` but not surfaced to athletes |
| `assigned_exercises` | Exercises assigned to a `weekly_plans` row for a given day + session type; same caveat as above |
| `activity_routines` | 24-slot (activity × session type) routine mapping to exercises, `organization_id` NOT NULL; added via Milestone 2 — see [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md) |
| `organizations` | Academy/tenant root (Milestone 1) |
| `staff_profiles` | `auth_user_id` ↔ `organization_id` ↔ `role`; client read-only, no write policy exists yet |
| `platform_admins` | Super User registry, separate from org roles |
| `audit_events` | Append-only audit log, written only via `log_audit_event()` |
| `athlete_access_attempts` | Backs the PIN-bridge rate limiter |
| `coach_profiles` | Booking-facing coach config (`display_name`/`bio`/`is_bookable_online`); separate from `staff_profiles` identity; added via Milestone 5 — see [MILESTONE5_STATUS.md](MILESTONE5_STATUS.md) |
| `services` | Academy service catalog; `name` unique per org, case-insensitively; added via Milestone 5 |
| `coach_services` | Coach↔service pairings with per-pairing price/duration overrides and an `is_active` bookable flag; added via Milestone 5 |
| `coach_availability` | Recurring weekly availability windows (reuses the `day_of_week` enum); added via Milestone 5 |
| `coach_blocks` | One-off blocked time / time off, incl. `updated_at`; added via Milestone 5 |

RLS: authenticated staff have org-scoped access; as of Milestone 4, `athletes`/`exercises`/`weekly_plans`/`assigned_exercises`/`activity_routines` are also **role-differentiated** — only administrator, physician, and Super User roles pass, a plain coach gets none (see [MILESTONE4_STATUS.md](MILESTONE4_STATUS.md)). `organizations`/`staff_profiles`/`audit_events`/`platform_admins` remain org-scoped-but-not-role-differentiated (not physician/trainer-sensitive). The five Milestone 5 booking-domain tables are role-differentiated the other way: administrator/Super User manage everything within scope, a coach is further isolated to their **own rows only** (not just their own org), and a physician has **zero** access to any of them — see [MILESTONE5_STATUS.md](MILESTONE5_STATUS.md). Anonymous users go through the PIN-bridge RPCs for athlete data and routine/exercise data (`get_athlete_by_code`, `update_athlete_photo_by_code`, `get_athlete_routines`) plus the ability to upload athlete photos (currently broken at the storage layer, see above) — there is no direct anonymous table access to `exercises` (or `activity_routines`), and no anonymous access of any kind to the Milestone 5 booking-domain tables; see [MILESTONE3_STATUS.md](MILESTONE3_STATUS.md). Super Users (`platform_admins`) see across all organizations.

### Styling

- Admin: dark theme (`#0B1426` background, `#22c55e` emerald accents), defined via CSS variables in [src/app/globals.css](src/app/globals.css)
- Athlete: light theme applied via the `.athlete-page` class added by the athlete layout
- Tailwind custom theme (brand/navy palette, `fade-in`/`slide-up`/`slide-in-right` animations) in [tailwind.config.ts](tailwind.config.ts)
- Fonts: Barlow Condensed (display) + DM Sans (body) via Google Fonts

### Component structure

Most admin/athlete page logic is inline within page files, but a shared UI kit exists under [src/components/ui/](src/components/ui/) (`Badge`, `BottomSheet`, `Button`, `Card`, `ConfirmDialog`, `EmptyState`, `Input`, `Select`, `Skeleton`, `StatCard`, `Toast`) and is used across admin pages — prefer it over inline markup for new admin UI. Other shared components:
- [src/components/shell/AppShell.tsx](src/components/shell/AppShell.tsx) — authenticated shell chrome (sidebar + mobile topbar), shared across staff roles
- [src/components/shell/StaffGuardScreens.tsx](src/components/shell/StaffGuardScreens.tsx) — shared "checking"/"not linked"/"forbidden" full-screen states used by both `admin/layout.tsx` and `coach/layout.tsx` (Milestone 4)
- [src/components/admin/AthleteAvatar.tsx](src/components/admin/AthleteAvatar.tsx) — shows athlete photo or initials fallback

`src/components/athlete/` and `src/hooks/` are currently empty.
