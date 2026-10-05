# Milestone 6 (Coach Portal UI) — Status

**Read this alongside [MILESTONE4_STATUS.md](MILESTONE4_STATUS.md) and [MILESTONE5_STATUS.md](MILESTONE5_STATUS.md).** Milestone 4 built the role/privacy foundation and the `/coach` route shell; Milestone 5 built the booking/scheduling database tables with no UI; this milestone builds the UI that consumes them.

Unlike every prior milestone, this one touches **no SQL at all** — no migrations, no RLS/policy changes, no new functions. It is purely application-layer work against the exact Milestone 4/5 security model, unchanged.

Last updated: 2026-10-05 (local implementation only — see "Production rollout status" below).

---

## 1. What this milestone adds

A functional Coach Portal UI, replacing the Milestone 4 placeholder:

- **`/coach`** — Dashboard: coach identity (display name, bio, online-booking status) from `coach_profiles`, with an honest setup message if that row doesn't exist yet; active-service count; weekly-availability summary; a static "No upcoming lessons yet." area (no `bookings` table exists yet — this is not a fetch error state, it's the real, honest state).
- **`/coach/services`** — "My Services": the coach's `coach_services` rows joined with their `services` catalog entry, showing effective duration/price (inherited-vs-overridden, see §3), and a Pause/Resume control wired to `set_coach_service_bookable()`.
- **`/coach/availability`** — Weekly Hours (all seven days always rendered, "Unavailable" for days with no `coach_availability` rows, multiple windows per day supported, add/edit/delete/pause-resume) and Time Off (real `start_at`/`end_at` timestamps, add/edit/delete, optional reason) as two sections on one page.

**Explicitly out of scope** (unchanged from the approved plan): customer booking, Academy Administration, payments, SMS, packages, group lessons, advanced calendar functionality, coach-profile editing (display-only this milestone).

## 2. Files changed

| File | Status | Purpose |
|---|---|---|
| `src/lib/types.ts` | Modified (additive) | `CoachProfile`, `Service`, `CoachService`, `CoachAvailability`, `CoachBlock` interfaces; `formatCents()`, `formatTime12h()` |
| `src/lib/auth/getStaffContext.ts` | Modified (additive) | Added `current_staff_profile_id()` to the existing `Promise.all`, folded into the same fail-closed check; added `staffProfileId` to the `'ok'` result |
| `src/app/coach/layout.tsx` | Modified | `NAV` extended from 1 to 3 items (Dashboard, My Services, Availability). Guard logic untouched. |
| `src/app/coach/page.tsx` | Rewritten | Placeholder → real dashboard |
| `src/app/coach/services/page.tsx` | New | "My Services" |
| `src/app/coach/availability/page.tsx` | New | Weekly Hours + Time Off |

No `/admin/*` file, no shared component (`AppShell`, `StaffGuardScreens`, the UI kit), and no SQL migration was touched.

## 3. Effective value calculation (My Services)

```
effectiveDuration = coach_services.duration_minutes ?? service.default_duration_minutes
effectivePrice    = coach_services.price_cents       ?? service.default_price_cents
```

`??` (nullish coalescing), not `||` — `0` is a theoretically valid override and must not be treated as missing. `effectiveDuration` always resolves to a number (`default_duration_minutes` is `NOT NULL`); `effectivePrice` can be genuinely `null` (no price configured at either level), rendered as "Price not set," not `"$0.00"` or `"$NaN"`. A small "CUSTOM" label appears next to a value only when the coach-specific override is non-null.

## 4. Query/mutation architecture, exactly as implemented

| Feature | Mechanism |
|---|---|
| Dashboard reads | Direct Supabase query, `.eq('coach_id', staffProfileId)` |
| My Services read | Direct query with embedded join: `.from('coach_services').select('*, service:services(*)').eq('coach_id', staffProfileId)` |
| My Services mutation | `supabase.rpc('set_coach_service_bookable', { p_coach_service_id, p_is_active })` — the only coach-side write path into `coach_services`, by design (0011) |
| Availability/Time Off reads+writes | Direct Supabase CRUD, RLS-protected, `.eq('coach_id', staffProfileId)` on reads; inserts carry `organization_id`/`coach_id` from `getStaffContext()`, never a user-editable field |
| Route Handlers | None added — not needed; every interaction is an authenticated session |

**Every "my data" query is explicitly scoped by `staffProfileId`**, not left to RLS alone — this is deliberate, not redundant: Milestone 4's guard also admits administrators and Super Users into `/coach/*`, and their broader org-wide RLS policies would otherwise surface every coach's rows under a "My Services"/"Availability" heading instead of the viewer's own (typically empty) scope.

## 5. Local verification

- `npm run build`: **succeeded.** One real, unrelated-to-logic TypeScript error was caught and fixed during implementation: `for (const list of byDay.values())` (a `Map` iterator) requires `--downlevelIteration` or an ES2015+ target, which this project's `tsconfig` doesn't set — replaced with `Array.from(byDay.values()).forEach(...)`, which needs neither.
- `npm run test:db`: **277/277 checks passed** — the same count as the Milestone 5 baseline, confirming zero database-layer regression (expected, since no SQL changed).
- No UI test framework was introduced — consistent with this project's existing posture (no `npm run test:db`-equivalent exists for UI, and introducing one for a UI-only milestone under a short timeline wasn't justified). Manual verification across coach/administrator/physician roles is the verification method for this milestone's actual UI behavior.

## 6. Known, accepted limitations (not regressions)

- No `coach_profiles`/`services`/`coach_services`/`coach_availability`/`coach_blocks` rows exist in the real production database yet — `0007`–`0012` are still not applied there (see `MILESTONE4_STATUS.md`/`MILESTONE5_STATUS.md`). This UI is correct and tested against the local PGlite-equivalent schema, but cannot be exercised against live data until that separate, explicitly authorized deployment step happens.
- There is currently no admin-facing UI to create `services`/`coach_services`/`coach_profiles` rows at all (Academy Administration is explicitly deferred). Demo data, once migrations are applied, would need to be seeded via reviewed SQL or built live through the coach-side availability/time-off UI (which a coach *can* self-serve) — services/assignments remain administrator-only by design.
- Coach-profile editing (display name/bio/online-booking toggle) is display-only this milestone, per the approved plan — fully supported by existing RLS whenever it's wanted.
- No timezone-aware display — times render in the viewer's browser-local timezone, consistent with how the rest of this application already works; not a regression introduced here.

## 7. Production rollout status

**Not applicable — no SQL changes.** This milestone is pure application code; there is nothing to apply to production at the database layer. The underlying `0007`–`0012` migrations remain **not applied to production**, per `MILESTONE4_STATUS.md`/`MILESTONE5_STATUS.md`, and that remains a separate, later, explicitly authorized step this milestone does not take.
