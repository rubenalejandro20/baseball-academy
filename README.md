# ⚾ Baseball Academy – Athlete & Exercise Management Platform

A full-stack web application built for baseball academy physicians to manage athletes, build an exercise library, and assign weekly exercise plans. Athletes access their personalized plans via QR code and PIN.

---

## ✨ Features

### Admin / Physician Side
- 🔐 **Secure login** via Supabase Auth
- 📋 **Athlete management** – create, view, edit, and deactivate profiles (name, age, weight, position, notes)
- 🏋️ **Exercise library** – add exercises with category, description, sets, reps, duration, and optional video demo link
- 📅 **Weekly assignment builder** – drag-and-drop per day × session type; override sets/reps per athlete
- 📊 **Dashboard** – overview of athletes, library, and this week's active plans
- 🔡 **QR code generator** – printable QR codes + PIN for each athlete

### Athlete Side
- 📱 **QR / PIN access** – no login required; athlete scans QR code or visits `/athlete`, enters PIN
- 🗓️ **Weekly view** – exercises organized by day with session type badges
- 📖 **Exercise detail** – sets, reps, duration, instructions, and video demo link
- 🤳 **Selfie upload** – athlete can add their photo from the same page

---

## 🛠 Tech Stack

| Layer         | Technology                        |
|---------------|-----------------------------------|
| Framework     | Next.js 14 (App Router)           |
| Language      | TypeScript                        |
| Styling       | Tailwind CSS + custom CSS vars    |
| Backend       | Supabase (Auth + PostgreSQL + Storage) |
| Icons         | Lucide React                      |
| Fonts         | Barlow Condensed · DM Sans (Google Fonts) |

---

## 🚀 Getting Started

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/baseball-academy.git
cd baseball-academy
npm install
```

### 2. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. In your project, go to **SQL Editor** and run the entire contents of `supabase/schema.sql`
3. In **Storage → Buckets**, create a public bucket named `athlete-photos`
4. Copy your project URL and anon key from **Settings → API**

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Create the admin account

In Supabase → **Authentication → Users → Add user**, create your physician account with email + password.

### 5. Run locally

```bash
npm run dev
```

Visit `http://localhost:3000` — you'll be redirected to `/admin/login`.

---

## 📁 Project Structure

```
src/
├── app/
│   ├── admin/
│   │   ├── login/          # Physician login
│   │   ├── dashboard/      # Stats overview
│   │   ├── athletes/       # List, create, view, edit
│   │   ├── exercises/      # Library + create + edit
│   │   ├── assignments/    # Weekly plan builder
│   │   └── qrcodes/        # Printable QR codes
│   └── athlete/
│       ├── page.tsx        # QR landing / PIN entry
│       └── [code]/         # Athlete exercise view
├── lib/
│   ├── supabase.ts         # Client setup
│   └── types.ts            # All TypeScript types + helpers
supabase/
└── schema.sql              # Complete DB schema + RLS policies
```

---

## 🗄 Database Schema

```
athletes            ← Athlete profiles + access codes
exercises           ← Exercise library
weekly_plans        ← One plan per athlete per week
assigned_exercises  ← Individual exercises in a plan (day + session type)
```

See `supabase/schema.sql` for the full schema with Row Level Security policies.

---

## 🎨 Design

- **Admin dashboard**: Dark navy theme (`#0B1426`) with emerald green accent — clean, utilitarian, professional
- **Athlete view**: Light, mobile-first, easy to read on a phone — large text, clear hierarchy
- **Fonts**: Barlow Condensed (display/headers) + DM Sans (body)
- **Responsive**: Works on desktop for physicians, optimized for phone for athletes

---

## 🔒 Security

- Admin routes protected by Supabase session (server + client guard)
- Row Level Security on all tables — authenticated users have full access, anon users can only read public data
- Athletes can upload their own photo but cannot modify exercises or plans
- Access codes are not passwords — suitable for low-friction athlete access in a supervised setting

---

## 📦 Deployment (Vercel)

```bash
# Push to GitHub, then in Vercel:
# 1. Import repo
# 2. Add environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_APP_URL)
# 3. Deploy
```

---

## 🛣 Roadmap (future versions)

- [ ] Athlete accounts with full login
- [ ] Exercise completion tracking / check-offs
- [ ] Push notifications for daily reminders
- [ ] Progress charts and history
- [ ] PDF export of weekly plan
- [ ] Multi-physician support with roles

---

## 📄 License

MIT
