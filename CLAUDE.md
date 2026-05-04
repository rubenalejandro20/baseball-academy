# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Next.js development server
npm run build    # Build for production
npm start        # Start production server
npm run lint     # Run ESLint
```

No test framework is configured.

## Environment Setup

Copy `.env.example` to `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`

The database schema (tables, enums, RLS policies, seed data) is in [supabase/schema.sql](supabase/schema.sql).

## Architecture

This is a Next.js 14 App Router app using Supabase (PostgreSQL + Auth + Storage) as the backend. There are no API routes — all data access is direct Supabase queries from page components, with Row Level Security enforcing access control.

### Two distinct user flows

**Admin/Physician side** (`/admin/`) — Protected by Supabase Auth, dark navy + emerald theme:
- `layout.tsx` is the auth guard — it runs a client-side `useEffect` + `getSession()` check and redirects unauthenticated users to `/admin/login`
- Covers: dashboard stats, athlete CRUD, exercise library CRUD, weekly plan builder per athlete, QR code generation

**Athlete side** (`/athlete/`) — No authentication, light mobile-first theme:
- Athletes identify themselves via a PIN/access code (not user accounts)
- `/athlete` — PIN entry form
- `/athlete/[code]` — Read-only weekly exercise plan view (athletes can also upload a selfie photo)

The root `/` redirects to `/admin/login`.

### Key shared modules

- [src/lib/types.ts](src/lib/types.ts) — Single source of truth for all TypeScript interfaces, enums (`ExerciseCategory`, `DayOfWeek`), and UI helper constants (`CATEGORY_LABELS`, `CATEGORY_COLORS`, `BASEBALL_POSITIONS`, `DAY_LABELS`) plus utility functions (`getMondayOfWeek`, `formatWeekRange`, `formatDuration`)
- [src/lib/supabase.ts](src/lib/supabase.ts) — Supabase client factory using `@supabase/auth-helpers-nextjs`

### Database schema (4 tables)

| Table | Purpose |
|-------|---------|
| `athletes` | Athlete profiles; `access_code` is the PIN athletes use; `is_active` for soft deletes |
| `exercises` | Exercise library; `category` is `exercise_category` enum |
| `weekly_plans` | One plan per athlete per `week_start` date (unique constraint) |
| `assigned_exercises` | Line items in a plan; can override default sets/reps/duration from the exercise library; `sort_order` controls sequencing |

RLS: authenticated users (physicians) have full access; anonymous users have read-only access to active records plus the ability to upload athlete photos.

### Styling

- Admin: dark theme (`#0B1426` background, `#22c55e` emerald accents), defined via CSS variables in [src/app/globals.css](src/app/globals.css)
- Athlete: light theme applied via the `.athlete-page` class added by the athlete layout
- Tailwind custom theme (brand/navy palette, `fade-in`/`slide-up`/`slide-in-right` animations) in [tailwind.config.ts](tailwind.config.ts)
- Fonts: Barlow Condensed (display) + DM Sans (body) via Google Fonts

### Component structure

Most UI is inline within page files rather than extracted into components. The only shared components are:
- [src/components/admin/AthleteAvatar.tsx](src/components/admin/AthleteAvatar.tsx) — Shows athlete photo or initials fallback

`src/components/athlete/`, `src/components/ui/`, and `src/hooks/` are currently empty.
