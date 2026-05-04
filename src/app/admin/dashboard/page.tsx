'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { Users, Dumbbell, CalendarDays, ChevronRight, TrendingUp, Clock } from 'lucide-react';
import { type Athlete, type Exercise, CATEGORY_LABELS, CATEGORY_COLORS, formatWeekRange, getMondayOfWeek } from '@/lib/types';

export default function DashboardPage() {
  const [athletes, setAthletes]   = useState<Athlete[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [planCount, setPlanCount] = useState(0);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [a, e, p] = await Promise.all([
        supabase.from('athletes').select('*').eq('is_active', true).order('full_name'),
        supabase.from('exercises').select('*').eq('is_active', true),
        supabase.from('weekly_plans').select('id').gte('week_start', getMondayOfWeek()),
      ]);
      setAthletes(a.data ?? []);
      setExercises(e.data ?? []);
      setPlanCount(p.data?.length ?? 0);
      setLoading(false);
    }
    load();
  }, []);

  const categoryCount = exercises.reduce<Record<string, number>>((acc, ex) => {
    acc[ex.category] = (acc[ex.category] ?? 0) + 1;
    return acc;
  }, {});

  const weekLabel = formatWeekRange(getMondayOfWeek());

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white">
          DASHBOARD
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Week of {weekLabel}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<Users className="w-5 h-5 text-brand-400" />}
          label="Active Athletes"
          value={loading ? '—' : athletes.length}
          sub="on the roster"
          href="/admin/athletes"
          color="brand"
        />
        <StatCard
          icon={<Dumbbell className="w-5 h-5 text-purple-400" />}
          label="Exercises"
          value={loading ? '—' : exercises.length}
          sub="in the library"
          href="/admin/exercises"
          color="purple"
        />
        <StatCard
          icon={<CalendarDays className="w-5 h-5 text-amber-400" />}
          label="Plans This Week"
          value={loading ? '—' : planCount}
          sub="active weekly plans"
          href="/admin/assignments"
          color="amber"
        />
      </div>

      {/* Two-column section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent athletes */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-lg font-semibold tracking-wide text-white">
              RECENT ATHLETES
            </h2>
            <Link
              href="/admin/athletes"
              className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1"
            >
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <LoadingSkeleton rows={4} />
          ) : athletes.length === 0 ? (
            <EmptyState
              label="No athletes yet"
              href="/admin/athletes/new"
              cta="Add first athlete"
            />
          ) : (
            <ul className="space-y-2">
              {athletes.slice(0, 6).map(a => (
                <li key={a.id}>
                  <Link
                    href={`/admin/athletes/${a.id}`}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors group"
                  >
                    <AthleteAvatar athlete={a} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {a.full_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {a.position ?? 'No position'} {a.age ? `· ${a.age} yrs` : ''}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Exercise breakdown */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-lg font-semibold tracking-wide text-white">
              LIBRARY BREAKDOWN
            </h2>
            <Link
              href="/admin/exercises"
              className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1"
            >
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <LoadingSkeleton rows={6} />
          ) : exercises.length === 0 ? (
            <EmptyState
              label="No exercises yet"
              href="/admin/exercises/new"
              cta="Add first exercise"
            />
          ) : (
            <ul className="space-y-2.5">
              {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map(cat => {
                const count = categoryCount[cat] ?? 0;
                const total = exercises.length;
                const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <li key={cat}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`badge ${CATEGORY_COLORS[cat]}`}>
                        {CATEGORY_LABELS[cat]}
                      </span>
                      <span className="text-xs text-slate-500">{count} exercises</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="card p-6">
        <h2 className="font-display text-lg font-semibold tracking-wide text-white mb-4">
          QUICK ACTIONS
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickAction
            href="/admin/athletes/new"
            icon={<Users className="w-5 h-5" />}
            label="Add Athlete"
            desc="Create a new athlete profile"
          />
          <QuickAction
            href="/admin/exercises/new"
            icon={<Dumbbell className="w-5 h-5" />}
            label="Add Exercise"
            desc="Expand the exercise library"
          />
          <QuickAction
            href="/admin/assignments"
            icon={<CalendarDays className="w-5 h-5" />}
            label="Assign Exercises"
            desc="Build this week's plans"
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────

function StatCard({
  icon, label, value, sub, href, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  href: string;
  color: 'brand' | 'purple' | 'amber';
}) {
  const rings = {
    brand:  'bg-brand-500/10 border-brand-500/20',
    purple: 'bg-purple-500/10 border-purple-500/20',
    amber:  'bg-amber-500/10 border-amber-500/20',
  };
  return (
    <Link href={href} className="card card-hover p-5 flex items-start gap-4 group">
      <div className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${rings[color]}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-display font-bold text-white">{value}</p>
        <p className="text-sm font-medium text-slate-300">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
      </div>
    </Link>
  );
}

function QuickAction({ href, icon, label, desc }: {
  href: string; icon: React.ReactNode; label: string; desc: string;
}) {
  return (
    <Link
      href={href}
      className="card card-hover p-4 flex items-center gap-3 group"
    >
      <div className="w-9 h-9 rounded-lg bg-brand-500/12 border border-brand-500/20 flex items-center justify-center text-brand-400 shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 ml-auto shrink-0" />
    </Link>
  );
}

function AthleteAvatar({
  athlete, size = 'md',
}: {
  athlete: Pick<Athlete, 'full_name' | 'photo_url'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-16 h-16 text-xl' };
  const initials = athlete.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  if (athlete.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={athlete.photo_url}
        alt={athlete.full_name}
        className={`${sizes[size]} rounded-full object-cover border border-white/10 shrink-0`}
      />
    );
  }
  return (
    <div className={`${sizes[size]} rounded-full bg-brand-500/15 border border-brand-500/25 flex items-center justify-center font-semibold text-brand-400 shrink-0 font-display`}>
      {initials}
    </div>
  );
}

function LoadingSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ label, href, cta }: { label: string; href: string; cta: string }) {
  return (
    <div className="text-center py-8">
      <p className="text-slate-500 text-sm mb-3">{label}</p>
      <Link href={href} className="btn-primary text-xs py-2 px-3">
        {cta}
      </Link>
    </div>
  );
}
