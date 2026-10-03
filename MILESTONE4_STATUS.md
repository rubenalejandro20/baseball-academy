# Milestone 4 (Role & Coach Portal Foundation) — Status

**Read this alongside [MILESTONE1_STATUS.md](MILESTONE1_STATUS.md), [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md), and [MILESTONE3_STATUS.md](MILESTONE3_STATUS.md) before touching any file in `supabase/migrations/`.**

Unlike those three files, this one does **not** record a production rollout yet. Milestone 4's database changes (`0007`, `0008`) have been developed and verified entirely locally — against the PGlite test suite — and have **not** been applied to the real production Supabase project. Production application is a separate, later, explicitly authorized step. This file will be updated once (and only once) that happens, the same way Milestones 1–3 were.

Last updated: 2026-10-02 (local implementation only — see "Production rollout status" below).

---

## 1. What this milestone adds

A real, database-level distinction between `coach` and `physician` staff roles, closing a gap flagged since Milestone 1 ("Milestone 1 only distinguishes administrator or not"). Before this milestone, every authenticated staff role — administrator, coach, physician — had byte-for-byte identical org-scoped access to every physician/trainer-domain table. A plain coach could read and write athlete profiles, the exercise library, weekly plans, assigned exercises, and activity routines, exactly like an administrator or physician could.

This milestone also adds the minimum Coach Portal shell (`/coach`) needed to prove role-based routing/access actually works, and tightens the existing Physician/Trainer portal (`/admin`) to deny plain coaches at the UX layer, matching the new RLS boundary.

**Explicitly out of scope** (per the approved plan): booking, services, coach availability, Academy Administration UI, Platform UI, email, payments, and any production Supabase change.

## 2. Local database changes

| File | Status | Purpose |
|---|---|---|
| `supabase/migrations/0007_coach_physician_role_rpcs.sql` | **Written, tested locally, NOT applied to production** | Adds `is_org_coach()` / `is_org_physician()` — strict, single-role `SECURITY DEFINER` checks, same pattern as `is_org_administrator()` (0001). Purely additive; zero behavioral change until 0008 references them. |
| `supabase/migrations/0008_coach_physician_rls_cutover.sql` | **Written, tested locally, NOT applied to production** | Replaces the `"Staff org access - X"` policy (same name, tightened predicate) on exactly five tables: `athletes`, `exercises`, `weekly_plans`, `assigned_exercises`, `activity_routines`. Administrator/physician/Super User access is unchanged; a plain coach is denied both reads and writes on all five. `organizations`, `staff_profiles`, `audit_events`, `platform_admins` are untouched. |

Both files are idempotent/re-runnable (`CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` + `CREATE POLICY`), consistent with every prior migration's convention, and `0008` is written to be applied section-by-section in production, same discipline as `0003`.

## 3. Local application code changes

- [src/lib/auth/getStaffContext.ts](src/lib/auth/getStaffContext.ts) — now calls `is_org_coach()`/`is_org_physician()` alongside the existing three RPCs and correctly resolves `role` to `'administrator' | 'coach' | 'physician' | null` (previously always `'administrator' | null`).
- [src/components/shell/StaffGuardScreens.tsx](src/components/shell/StaffGuardScreens.tsx) — new. Shared `CheckingScreen`/`NotLinkedScreen`/`ForbiddenScreen` components, extracted from `admin/layout.tsx`'s previously-inline markup so the new Coach Portal guard doesn't duplicate it.
- [src/app/admin/layout.tsx](src/app/admin/layout.tsx) — now denies a plain coach (shown `ForbiddenScreen`) unless they are also a Super User. Administrator, physician, and Super User behavior is unchanged.
- [src/app/coach/layout.tsx](src/app/coach/layout.tsx) / [src/app/coach/page.tsx](src/app/coach/page.tsx) — new. Minimal Coach Portal: a guard mirroring `admin/layout.tsx` (allows coach/administrator/Super User, denies a plain physician) plus a placeholder dashboard page. No coach-domain data or features exist yet.

## 4. Route-guard behavior (UX boundary — RLS/0008 remains the real security boundary)

| Caller | `/admin` | `/coach` |
|---|---|---|
| Administrator | Allowed | Allowed |
| Physician | Allowed | **Denied** (`ForbiddenScreen`) |
| Coach | **Denied** (`ForbiddenScreen`) | Allowed |
| Super User | Allowed | Allowed |
| No session | Redirect to `/admin/login` | Redirect to `/admin/login` |
| Valid session, no `staff_profiles` row | `NotLinkedScreen` | `NotLinkedScreen` |

There is no `/coach/login` — both portals authenticate through the one existing Supabase Auth session via `/admin/login`.

## 5. Local test results

- `npm run test:db`: **184/184 checks passed**, including:
  - RPC-level correctness: `is_org_coach()`/`is_org_physician()` are strict single-role checks (an administrator gets `false` from both).
  - A "before" snapshot proving the exact pre-0008 gap (a coach has identical access to an administrator on all 5 tables).
  - Non-regression: administrator/physician/Super User access on all 5 tables is byte-identical before and after `0008`.
  - The actual tightening: a plain coach drops to zero rows on all 5 tables, for both reads (`SELECT`) and writes (`INSERT` rejected via `WITH CHECK`, `UPDATE` silently filtered to zero rows via `USING`).
  - Activity Routines / athlete-experience regression guard: `get_athlete_routines()` still returns a valid athlete's routine unchanged after `0008` (it's `SECURITY DEFINER` and never depended on these table policies).
  - The fresh-database chain (`0000 → 0001 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008`) still applies cleanly end-to-end with no `schema.sql` and no archived `0002`.
- `npm run build`: **succeeded** — clean compile, type-check, and static generation of all routes including the new `/coach` route.
- **No automated coverage exists for the route guards themselves** (`admin/layout.tsx`/`coach/layout.tsx`) — this project has no UI/component test framework (see CLAUDE.md). The guard-behavior table in §4 has been verified by code review against `getStaffContext()`'s resolved `role`/`isSuperUser` values, not by an automated browser test. Manually verifying each row of that table (log in as each role, visit both routes) is recommended before relying on this in a live environment.

## 6. Known, accepted limitations (not regressions)

- No staff accounts with `role = 'coach'` or `role = 'physician'` exist in production today (Milestone 1's backfill only onboarded one `administrator`), so this milestone's production impact, once applied, is currently zero until such accounts are created.
- `AppShell`'s role label and any other `role`-reading UI will now correctly show "Coach"/"Physician" instead of always falling back to "Staff" for non-administrators — a correctness fix, not new scope.

## 7. Production rollout status

**Not applied.** Per the approved Milestone 4 plan, `0007`/`0008` and the accompanying application code are deliberately developed and tested together, entirely locally, with production migration/deployment treated as a separate, explicitly authorized operation to be performed later — not part of this milestone's implementation. No `supabase db push`, migration repair, or remote SQL was run against production as part of this work.
