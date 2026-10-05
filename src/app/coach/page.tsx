'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { getStaffContext } from '@/lib/auth/getStaffContext';
import { type CoachProfile, type CoachAvailability } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { Dumbbell, CalendarClock, CalendarX2, User } from 'lucide-react';

type LoadState = 'loading' | 'error' | 'ready';

export default function CoachDashboardPage() {
  const [state, setState]               = useState<LoadState>('loading');
  const [profile, setProfile]            = useState<CoachProfile | null>(null);
  const [activeServiceCount, setActiveServiceCount] = useState(0);
  const [availability, setAvailability]  = useState<CoachAvailability[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const staffContext = await getStaffContext();
      if (staffContext.status !== 'ok' || !staffContext.staffProfileId) {
        if (!cancelled) setState('error');
        return;
      }
      const coachId = staffContext.staffProfileId;
      const supabase = createClient();

      const [profileRes, servicesRes, availabilityRes] = await Promise.all([
        supabase.from('coach_profiles').select('*').eq('coach_id', coachId).maybeSingle(),
        supabase.from('coach_services').select('id', { count: 'exact', head: true }).eq('coach_id', coachId).eq('is_active', true),
        supabase.from('coach_availability').select('*').eq('coach_id', coachId).eq('is_active', true),
      ]);

      if (cancelled) return;

      // profileRes.error is expected to be null even when no row exists
      // (maybeSingle() returns { data: null, error: null } for zero rows —
      // that's the "profile not set up yet" case, not a fetch failure).
      if (profileRes.error || servicesRes.error || availabilityRes.error) {
        setState('error');
        return;
      }

      setProfile(profileRes.data as CoachProfile | null);
      setActiveServiceCount(servicesRes.count ?? 0);
      setAvailability((availabilityRes.data ?? []) as CoachAvailability[]);
      setState('ready');
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const daysWithAvailability = new Set(availability.map(a => a.day_of_week)).size;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white">COACH PORTAL</h1>
        <p className="text-slate-400 text-sm mt-0.5">Your schedule, services, and availability at a glance.</p>
      </div>

      {state === 'loading' && (
        <div className="space-y-6">
          <div className="card p-6"><SkeletonRows rows={2} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-5 h-24 bg-white/5 rounded-xl animate-pulse" />
            <div className="card p-5 h-24 bg-white/5 rounded-xl animate-pulse" />
          </div>
        </div>
      )}

      {state === 'error' && (
        <Card className="p-6">
          <p className="text-sm text-red-400">Couldn&apos;t load your dashboard. Try refreshing the page.</p>
        </Card>
      )}

      {state === 'ready' && (
        <>
          {/* Coach identity / profile */}
          {profile ? (
            <Card className="p-6 flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-brand-500/15 border border-brand-500/25 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-brand-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-display text-xl font-bold text-white tracking-wide">{profile.display_name}</h2>
                  <Badge tone={profile.is_bookable_online ? 'success' : 'neutral'}>
                    {profile.is_bookable_online ? 'Online booking enabled' : 'Online booking paused'}
                  </Badge>
                </div>
                {profile.bio && <p className="text-sm text-slate-400 mt-1.5">{profile.bio}</p>}
              </div>
            </Card>
          ) : (
            <Card className="p-6">
              <h2 className="font-display text-lg font-bold text-white tracking-wide">COACH PROFILE NOT SET UP YET</h2>
              <p className="text-sm text-slate-400 mt-1.5">
                Your academy administrator hasn&apos;t created your coach profile yet. Once they do, your name,
                bio, and booking status will appear here.
              </p>
            </Card>
          )}

          {/* Stat summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard
              icon={<Dumbbell className="w-5 h-5 text-brand-400" />}
              label="Active Services"
              value={activeServiceCount}
              sub="currently bookable"
              href="/coach/services"
              tone="brand"
            />
            <StatCard
              icon={<CalendarClock className="w-5 h-5 text-purple-400" />}
              label="Weekly Availability"
              value={`${daysWithAvailability} / 7`}
              sub="days with hours set"
              href="/coach/availability"
              tone="purple"
            />
          </div>

          {/* Upcoming lessons — no bookings table exists yet; honest, static empty state */}
          <Card className="p-6">
            <h2 className="font-display text-lg font-semibold tracking-wide text-white mb-4">UPCOMING LESSONS</h2>
            <div className="text-center py-10">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
                <CalendarX2 className="w-5 h-5 text-slate-500" />
              </div>
              <p className="text-slate-300 text-sm font-medium">No upcoming lessons yet.</p>
              <p className="text-slate-500 text-xs mt-1">Your scheduled lessons will appear here.</p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
