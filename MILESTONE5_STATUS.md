# Milestone 5 (Booking/Scheduling Domain Foundation) — Status

**Read this alongside [MILESTONE1_STATUS.md](MILESTONE1_STATUS.md), [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md), [MILESTONE3_STATUS.md](MILESTONE3_STATUS.md), and [MILESTONE4_STATUS.md](MILESTONE4_STATUS.md) before touching any file in `supabase/migrations/`.**

Like Milestone 4, this file does **not** record a production rollout. Milestone 5's database changes (`0009`–`0012`) have been developed and verified entirely locally against the PGlite test suite, and have **not** been applied to the real production Supabase project. Production application is a separate, later, explicitly authorized step. This file will be updated once (and only once) that happens.

Last updated: 2026-10-05 (local implementation only — see "Production rollout status" below). Revised after a post-implementation read-only audit found several gaps; all were corrected before this update (see §3a and §7).

---

## 1. What this milestone adds

The smallest coherent database foundation for the eventual Coach → Service → Date/Time booking flow, deliberately stopping well short of actual bookings:

- `coach_profiles` — booking-facing coach configuration, separate from `staff_profiles` (identity).
- `services` — the academy's service catalog.
- `coach_services` — which coach offers which service, with per-pairing price/duration overrides and a bookable flag.
- `coach_availability` — recurring weekly availability.
- `coach_blocks` — one-off blocked time / time off.
- Two new RPCs: `current_staff_profile_id()` (identity resolution) and `set_coach_service_bookable()` (the coach's one narrow, gated write path into `coach_services`).

**Explicitly out of scope** (per the approved plan): actual booking records, contacts/guardians, guest booking, slot generation, email/SMS, payments, booking-management links, cancellation/rescheduling, double-booking protection, and any new UI (`/coach/services`, `/coach/availability`, `/academy`, or a public booking surface).

## 2. Local database changes

| File | Status | Purpose |
|---|---|---|
| `supabase/migrations/0009_coach_identity_rpc.sql` | **Written, tested locally, NOT applied to production** | `current_staff_profile_id()` — the first RPC resolving *which* `staff_profiles` row the caller is, not just *what's true about* them. Purely additive. |
| `supabase/migrations/0010_coach_profiles.sql` | **Written, tested locally, NOT applied to production** | `coach_profiles` table, its composite org-integrity constraint, identity-immutability trigger, and all RLS (schema + policies introduced together, atomically — not split into a separate "RLS cutover" file, per this project's current standardization on formal atomic migrations). |
| `supabase/migrations/0011_services_and_coach_services.sql` | **Written, tested locally, NOT applied to production** | `services` (with the case-insensitive per-org unique name index) and `coach_services` (with its composite FKs, identity-immutability trigger, and `set_coach_service_bookable()`), schema + RLS together. |
| `supabase/migrations/0012_coach_scheduling.sql` | **Written, tested locally, NOT applied to production** | `coach_availability` and `coach_blocks`, schema + RLS together. |

All four are wrapped in `BEGIN;`/`COMMIT;`, safely re-runnable (`CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS`/`CREATE POLICY`, `CREATE TABLE IF NOT EXISTS`, guarded `DO` blocks for constraints), and formally tracked as part of the standard migration chain — no manual, section-by-section production-execution instructions, consistent with this project's current standardization away from that older posture.

## 3. Key design decisions and why

- **`coach_profiles` is a separate entity from `staff_profiles`.** `staff_profiles` is identity (who can log in as what role); `coach_profiles` is booking-facing configuration (display name, bio, online-booking toggle). Mixing the two would widen `staff_profiles`' write surface for a concern unrelated to authentication.
- **Not auto-created.** No trigger creates a `coach_profiles` row when a `staff_profiles` row with `role = 'coach'` is created. Only an administrator or Super User may `INSERT`/`DELETE` one. A coach may `SELECT`/`UPDATE` their own existing row (`display_name`/`bio`/`is_bookable_online`) but has no `INSERT`/`DELETE` policy at all.
- **The coach-pause/resume mechanism for `coach_services` is a `SECURITY DEFINER` RPC, not RLS column tricks or Postgres column-level `GRANT`s.** Ordinary RLS can restrict which *rows* are reachable, not which *columns* within an allowed row may change. Column-level `GRANT UPDATE (is_active)` was considered and rejected: it's a property of the database *role*, and in this project administrator/coach/physician are all the same shared `authenticated` role — a column grant restricting that role would restrict administrators too. Instead, a coach has **no write policy at all** on `coach_services`; the only mutation path is `set_coach_service_bookable(id, bool)`, whose signature makes it structurally incapable of touching `price_cents`, `duration_minutes`, or any identity column. See `0011`'s own header comment for the full reasoning.
- **Composite foreign keys, not triggers, enforce organization integrity** for `coach_profiles`/`coach_services`/`coach_availability`/`coach_blocks` (e.g. `(organization_id, coach_id) REFERENCES staff_profiles(organization_id, id)`). This is possible — unlike Milestone 2's `activity_routines`, which needed a trigger — because none of these FK columns are nullable; a plain composite FK can fully express "same org" with no trigger.
- **`ON DELETE RESTRICT`, not `CASCADE`, on every new `coach_id`/`service_id` foreign key.** These are booking-domain records a future `bookings` table will likely reference for historical integrity (e.g. snapshotting which price/duration pairing a booking was made against) — nothing here may be silently cascaded away if a coach or service is ever hard-deleted. This matches this project's existing, dominant convention (`is_active` deactivation, never hard-delete) rather than the `CASCADE` pattern used for `activity_routines.exercise_id` (chosen there because a routine-slot row is genuinely meaningless without its exercise, which doesn't apply here).
- **Identity columns (`coach_id`, `service_id`, `organization_id`) are immutable after insert, for every actor including administrators** — enforced by a trigger, not RLS, following `0001`'s `protect_staff_profile_identity_fields()` pattern. If a different pairing is wanted, create a new row; never repoint an existing one.
- **Case-insensitive per-organization service-name uniqueness** uses a functional unique index (`UNIQUE INDEX ... ON services (organization_id, lower(name))`), not the `citext` extension — Postgres `UNIQUE` table constraints can't reference expressions, but a unique index enforces the identical guarantee with no new extension.
- **Peer-coach isolation is new.** Every prior RLS policy in this project was org-scoped only; `coach_availability`/`coach_blocks`/`coach_profiles`/`coach_services` are the first tables where a coach is isolated from *other coaches in the same org*, via `coach_id = current_staff_profile_id()`.
- **`is_org_physician()` appears in none of this milestone's policies**, and none of the five tables has any `anon`-role policy — both deliberate, mirroring Milestone 4's privacy boundary in the other direction.
- **Explicit table privileges, not reliance on Supabase's default grant.** All five tables carry their own `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` plus `REVOKE ALL ... FROM anon` (added during audit — see §3a). This project's earlier migrations all rely on Supabase's platform-level default privilege grant to `anon`/`authenticated`, with RLS as the only boundary; that default is appropriate where some `anon` access is intended (`exercises`, `activity_routines`, routed through RPCs), but Milestone 5 has a hard "zero anonymous access" requirement, so these five tables assert that as a property of the migration file itself — a second, independent layer under RLS, not a replacement for it.
- **`coach_blocks` has `updated_at`** (added during audit — see §3a): the table supports full `UPDATE` via RLS just like the other four, so it gets the same last-modified tracking; the original "one-off record, not edited in place" justification didn't actually match the capability the table was given.

### 3a. Post-implementation audit and corrections

A read-only audit of the as-written `0009`–`0012` and their tests found nine items, all corrected before this status update:

1. Added explicit `GRANT`/`REVOKE` table privileges (above) to all five tables.
2. Added a `created_at` guard to all four identity-protection trigger functions, matching `0001`'s `protect_staff_profile_identity_fields()` precedent (the first draft omitted it).
3. Added `REVOKE EXECUTE ... FROM PUBLIC` on all four trigger functions, matching `0001`'s blanket audit convention (not independently exploitable — Postgres refuses to invoke a trigger-returning function via plain `SELECT` regardless of grants — but inconsistent with established practice until fixed).
4. Added `coach_blocks.updated_at` (above).
5. Rewrote three RLS-denial tests (coach inserting their own `coach_profiles`; physician inserting a `coach_profiles` row; coach inserting a `coach_services` row) that had each targeted a row which *also* independently violated a `UNIQUE` or composite-FK constraint — meaning the original tests couldn't prove RLS specifically was what blocked the attempt. Rewritten to target an otherwise fully valid, non-conflicting row (a third coach fixture, `coachB3`, reserved for exactly this) so RLS is the only possible reason for rejection.
6. Added cross-organization composite-FK rejection tests for `coach_profiles` and `coach_blocks` (previously only `coach_services` and `coach_availability` exercised this, even though the constraint is structurally identical on all four).
7. Added a genuine physician write-denial test (not just read-denial) for `services`, `coach_services`, `coach_availability`, and `coach_blocks`, each using an otherwise-valid, non-conflicting row.
8. Removed the test harness's blanket `GRANT ... TO anon, authenticated` for these five tables (now redundant/actively wrong given item 1 — it would have silently undone the migrations' own `REVOKE`) and converted the five anonymous-access-denial assertions from "expect zero rows" to "expect a thrown permission-denied error," so they prove the explicit `REVOKE` rather than merely re-proving RLS.
9. Removed one unused, dead test-setup line.

## 4. Local test results

- `npm run test:db`: **277/277 checks passed** (up from 271 pre-audit — item 5's rewrites net the same count, items 6/7 add new assertions), including:
  - Migration apply + re-run/idempotency for all four new files.
  - `current_staff_profile_id()` resolving correctly for a linked vs. unlinked account.
  - `coach_profiles`: administrator create/delete; coach self-`SELECT`/`UPDATE` only (no `INSERT`/`DELETE`, confound-free); peer-coach isolation; identity-column immutability (for coach *and* administrator); `UNIQUE(coach_id)` enforcement; cross-org composite-FK rejection; physician read *and* write denial (confound-free); cross-org/anonymous denial (anonymous now proven via permission error, not just empty RLS result); Super User cross-org.
  - `services`: administrator CRUD; coach read-only; **case-insensitive duplicate name rejected within an org, the same name permitted across two different orgs**; duration/price `CHECK` constraints; physician read *and* write denial; cross-org/anonymous denial.
  - `coach_services`: composite-FK rejection for a coach/service pairing spanning organizations (both directions); `UNIQUE(coach_id, service_id)`; identity-column immutability; a coach's raw `UPDATE`/`DELETE`/`INSERT` all affecting zero rows or being rejected outright (confound-free); `set_coach_service_bookable()` succeeding for the owning coach and no-op'ing (not erroring, not leaking row existence) for another coach's row, with price/duration/identity columns provably unchanged afterward; physician read *and* write denial.
  - `coach_availability`/`coach_blocks`: coach full CRUD on own rows; peer isolation; identity-column immutability; `CHECK (end > start)` constraints; cross-org composite-FK rejection (both tables now); physician read *and* write denial (both tables now).
  - Deletion semantics: deleting a `services` or `staff_profiles` row that still has dependent Milestone 5 rows is rejected (`RESTRICT`), not cascaded.
  - Administrator full read access across all five tables within their own org; Super User cross-organization behavior on all five.
  - Anonymous access to all five tables now fails with a Postgres permission error (no table grant at all), not merely an RLS-filtered empty result.
  - The fresh-database chain (`0000 → ... → 0012`) applies cleanly end-to-end, with updated expected table (15)/function (13)/RLS-enabled-table (10) counts.
- `npm run build`: **succeeded** — no application code or routes were touched by this milestone, so the route list is unchanged from Milestone 4.
- **No UI exists for any of this** — by design. There is nothing to manually verify in a browser for this milestone.

## 5. Known, accepted limitations (not regressions)

- No `coach_profiles`/`coach_services`/`coach_availability`/`coach_blocks` rows exist in production (the tables don't exist there yet), so this milestone's production impact, once applied, is currently zero.
- No application code reads or writes any of these tables yet — they are reachable only via direct SQL/RPC calls today, exactly as intended for a database-only milestone.

## 6. Production rollout status

**Not applied.** `0009`–`0012` and this status file were developed and tested entirely locally, with production migration/deployment treated as a separate, explicitly authorized operation to be performed later — not part of this milestone's implementation. No `supabase db push`, migration repair, or remote SQL was run against production as part of this work.
