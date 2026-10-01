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

### Two distinct user flows

**Admin/Physician side** (`/admin/`) — Protected by Supabase Auth, dark navy + emerald theme:
- `layout.tsx` is the auth guard — it calls `getStaffContext()` (below) in a client-side `useEffect` and redirects unauthenticated sessions to `/admin/login`. A session that resolves to no active `staff_profiles` row is shown an "Account not linked" screen instead of being bounced to login (so it isn't mistaken for a wrong password).
- Sidebar/mobile chrome lives in [src/components/shell/AppShell.tsx](src/components/shell/AppShell.tsx), shared by `admin/layout.tsx` for all staff roles.
- Nav covers: dashboard stats, athlete CRUD, exercise library CRUD, routine management (24 slots, backed by `activity_routines` — see below), QR code generation.
- `/admin/assignments` and `/admin/assignments/[athleteId]` are a second, older per-athlete weekly planner (day-of-week × session-type grid backed by `weekly_plans`/`assigned_exercises`). It has no sidebar entry but is still fully wired up — linked from the dashboard, the athletes list, and each athlete's detail page — so treat it as live code, not dead code, despite `assigned_exercises`/`weekly_plans` being called "legacy" in the DB schema comments.

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

App code resolves the current user's org/role via [src/lib/auth/getStaffContext.ts](src/lib/auth/getStaffContext.ts), which calls the `current_org_id()` / `is_org_administrator()` / `is_super_user()` SECURITY DEFINER RPCs rather than querying `staff_profiles` directly. `staff_profiles` carries a read policy only (added in 0003 §6, live in production) — there is still no INSERT/UPDATE/DELETE policy on it, so this RPC-based approach remains the only path to identity/role info; a direct write from the client will not work. Milestone 1 only distinguishes "administrator or not" — a real coach/physician distinction needs a follow-up RPC once staff management needs it.

### PIN bridge (`/api/athlete/*`)

`get_athlete_by_code` and `update_athlete_photo_by_code` are rate-limited Postgres RPCs (backed by `athlete_access_attempts`) that replaced the previously wide-open anonymous RLS policies on `athletes`. [src/app/api/athlete/lookup/route.ts](src/app/api/athlete/lookup/route.ts) and [src/app/api/athlete/photo/route.ts](src/app/api/athlete/photo/route.ts) are the **only** Route Handlers in the app, and exist solely to read a trustworthy client IP (`x-forwarded-for`) server-side to pass into the rate limiter — a browser calling the RPC directly can't supply an unspoofable IP. Everything else still queries Supabase directly from page components. This bridge is intentionally temporary, to be retired once athlete auth moves to email OTP.

Note also: the `athlete-photos` storage bucket exists but `storage.objects` has zero RLS policies in production, so the athlete selfie upload currently fails closed for everyone — a pre-existing non-functional feature, not a regression.

### Key shared modules

- [src/lib/types.ts](src/lib/types.ts) — Single source of truth for all TypeScript interfaces, enums (`ExerciseCategory`, `ActivityType`, `StaffRole`), and UI helper constants (`CATEGORY_LABELS`, `CATEGORY_COLORS`, `ACTIVITY_LABELS`, `ACTIVITIES`, `SESSION_TYPES`) plus utility functions (`formatDuration`)
- [src/lib/supabase.ts](src/lib/supabase.ts) — Supabase client factory using `@supabase/auth-helpers-nextjs`
- [src/lib/auth/getStaffContext.ts](src/lib/auth/getStaffContext.ts) — resolves the signed-in user's org/role context; see above

### Database schema

`supabase/schema.sql` is historical documentation of the pre-Milestone-1 schema only — it does not reflect the live database. The actual current schema is `schema.sql` + the three numbered migrations in `supabase/migrations/`. Tables:

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

RLS: authenticated staff have org-scoped access (not yet role-differentiated beyond administrator vs. not); anonymous users go through the PIN-bridge RPCs for athlete data and routine/exercise data (`get_athlete_by_code`, `update_athlete_photo_by_code`, `get_athlete_routines`) plus the ability to upload athlete photos (currently broken at the storage layer, see above) — there is no direct anonymous table access to `exercises` (or `activity_routines`) at all; see [MILESTONE3_STATUS.md](MILESTONE3_STATUS.md). Super Users (`platform_admins`) see across all organizations.

### Styling

- Admin: dark theme (`#0B1426` background, `#22c55e` emerald accents), defined via CSS variables in [src/app/globals.css](src/app/globals.css)
- Athlete: light theme applied via the `.athlete-page` class added by the athlete layout
- Tailwind custom theme (brand/navy palette, `fade-in`/`slide-up`/`slide-in-right` animations) in [tailwind.config.ts](tailwind.config.ts)
- Fonts: Barlow Condensed (display) + DM Sans (body) via Google Fonts

### Component structure

Most admin/athlete page logic is inline within page files, but a shared UI kit exists under [src/components/ui/](src/components/ui/) (`Badge`, `BottomSheet`, `Button`, `Card`, `ConfirmDialog`, `EmptyState`, `Input`, `Select`, `Skeleton`, `StatCard`, `Toast`) and is used across admin pages — prefer it over inline markup for new admin UI. Other shared components:
- [src/components/shell/AppShell.tsx](src/components/shell/AppShell.tsx) — authenticated shell chrome (sidebar + mobile topbar), shared across staff roles
- [src/components/admin/AthleteAvatar.tsx](src/components/admin/AthleteAvatar.tsx) — shows athlete photo or initials fallback

`src/components/athlete/` and `src/hooks/` are currently empty.
