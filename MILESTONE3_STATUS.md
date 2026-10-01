# Milestone 3 (Exercise Organization Isolation) — Verified Production Status

**Read this alongside [MILESTONE1_STATUS.md](MILESTONE1_STATUS.md) and [MILESTONE2_STATUS.md](MILESTONE2_STATUS.md) before touching any file in `supabase/migrations/`.**

This document records the CURRENT, manually verified state of the production Supabase project with respect to the exercise anonymous-access hardening work. As with Milestones 1 and 2, there is no automated migration-history table backing this — "applied" means manually run against production and manually verified, as recorded here, not tracked by tooling.

Last verified: 2026-10-01.

---

## 1. What this milestone fixed

`public.exercises` carried a temporary, org-unscoped anonymous SELECT policy (`"Public read exercises"`, `FOR SELECT TO anon USING (is_active = true)`) left over from before the Milestone 1/2 hardening work. It let **any caller holding the public anon key** — not just the app, anyone, via a raw PostgREST request — read every active exercise across **every organization**, with no PIN, no app involvement, and no rate limiting. `0003_milestone1_rls.sql`'s own header comment had already flagged this as a required (not optional) fix once a second organization existed; it had not yet been acted on.

The fix was possible with **zero application code changes** because Milestone 2's `get_athlete_routines()` RPC (`SECURITY DEFINER`) already serves every exercise field the athlete UI needs, bypassing RLS/table policies entirely — the original justification for keeping the anon policy open (the pre-Milestone-2 athlete wizard's direct `exercise:exercises(*)` embed) no longer existed in the deployed code.

## 2. Database rollout status

| File | Status |
|---|---|
| `0006_exercise_anon_policy_removal.sql` | **Applied to production** |

Net effect: `"Public read exercises"` has been dropped. `public.exercises` RLS now carries exactly one policy.

## 3. Production verification results

**Post-deployment policy check** on `public.exercises` returned exactly **one** policy:

```
"Staff org access - exercises"
- role: authenticated
- command: ALL
- qual: ((organization_id = current_org_id()) OR (organization_id IS NULL) OR is_super_user())
```

`"Public read exercises"` is confirmed **no longer present**. Supabase reported the `DROP POLICY` as "Success. No rows returned," consistent with a pure access-control change (no table/column/row touched).

## 4. Manual production regression test

- Athlete PIN login works
- Athlete can select Pitching → Pre-Training
- The expected routine exercise still appears successfully

**Therefore `get_athlete_routines()` continues to provide full athlete exercise data after direct anonymous SELECT access to `public.exercises` was removed** — the decisive proof this change was safe.

(A stale-Next.js-static-chunk 404/white-page issue was hit during manual testing and resolved by restarting the local dev server — a local dev-server artifact, not a database or RLS failure, and not evidence of any regression.)

## 5. Pre-deployment testing (completed before production application)

- `npm run test:db`: **143/143 checks passed** locally, including dedicated coverage proving: the staff policy is untouched, org A staff still sees exactly the same exercises as before, anonymous direct `SELECT`/`INSERT` on `exercises` are now denied, `anon` can still `EXECUTE get_athlete_routines()`, and a valid athlete code still retrieves its routine with full exercise fields (name, sets, reps, duration, video_url, description) after the policy removal.
- `npm run build`: **succeeded**
- **No application source-code changes were required** — confirmed by the investigation and unchanged by implementation.

## 6. Security properties now active in production

- **No anonymous SELECT policy exists on `exercises`.** All athlete access to exercise data goes exclusively through `get_athlete_routines()`, which derives the caller's organization server-side from a validated, active athlete access code — never from anything the browser supplies.
- **Staff access is completely unaffected.** `"Staff org access - exercises"` (own organization + global/`organization_id IS NULL` exercises + Super User override) was never touched by this change.
- **An anonymous caller with only the public anon key can no longer enumerate any organization's exercise library** via a direct PostgREST request — the exact risk `0003_milestone1_rls.sql` had flagged as a required future fix is now closed.

## 7. Rollback

| File | Scope |
|---|---|
| `supabase/migrations/rollback/0006_emergency_rollback.sql` | Recreates `"Public read exercises"` verbatim. Pure access-control toggle — no data loss either direction. |

No dependency ordering concerns with other rollback files — this change is independent of the Milestone 2 (`0004`/`0005`) and Milestone 1 (`0001`–`0003`) objects, none of which it touches.

## 8. Important warnings (same posture as Milestones 1 and 2)

- **Do NOT rerun `0006` against production.** It is written to be safely re-runnable (`DROP POLICY IF EXISTS`), but there is no reason to re-apply an already-live, already-verified change.
- **Do not assume `0006` is unapplied just because there is no automated migration-history table.** This file is the record of what has actually been run.
- **Any further production database change requires explicit review before execution**, same as Milestones 1 and 2.
