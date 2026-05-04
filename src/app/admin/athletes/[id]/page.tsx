'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { type Athlete, type WeeklyPlan, CATEGORY_LABELS, CATEGORY_COLORS, formatWeekRange, DAY_LABELS } from '@/lib/types';
import { AthleteAvatar } from '@/components/admin/AthleteAvatar';
import { ArrowLeft, Pencil, CalendarDays, Trash2, QrCode, Copy, Check } from 'lucide-react';

export default function AthleteProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const [athlete, setAthlete]   = useState<Athlete | null>(null);
  const [plans, setPlans]       = useState<WeeklyPlan[]>([]);
  const [loading, setLoading]   = useState(true);
  const [copied, setCopied]     = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data: a }, { data: p }] = await Promise.all([
        supabase.from('athletes').select('*').eq('id', id).single(),
        supabase.from('weekly_plans').select('*, assigned_exercises(*, exercise:exercises(*))').eq('athlete_id', id).order('week_start', { ascending: false }).limit(4),
      ]);
      setAthlete(a);
      setPlans(p ?? []);
      setLoading(false);
    }
    load();
  }, [id]);

  async function handleDelete() {
    if (!confirm('Delete this athlete? This will also remove all their weekly plans.')) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from('athletes').update({ is_active: false }).eq('id', id);
    router.push('/admin/athletes');
  }

  function copyCode() {
    if (!athlete) return;
    navigator.clipboard.writeText(athlete.access_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-white/5 rounded animate-pulse" />
        <div className="card h-48 animate-pulse" />
      </div>
    );
  }

  if (!athlete) return <div className="text-slate-500">Athlete not found.</div>;

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/athletes" className="btn-secondary py-2 px-3 text-xs">
          <ArrowLeft className="w-3.5 h-3.5" />
        </Link>
        <h1 className="font-display text-3xl font-bold tracking-wide text-white flex-1">
          ATHLETE PROFILE
        </h1>
        <div className="flex items-center gap-2">
          <Link href={`/admin/athletes/${id}/edit`} className="btn-secondary text-xs py-2">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Link>
          <Link href={`/admin/assignments/${id}`} className="btn-primary text-xs py-2">
            <CalendarDays className="w-3.5 h-3.5" /> Weekly Plan
          </Link>
        </div>
      </div>

      {/* Profile card */}
      <div className="card p-6">
        <div className="flex items-start gap-5 flex-wrap">
          <AthleteAvatar athlete={athlete} size="lg" />
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-2xl font-bold text-white tracking-wide">
              {athlete.full_name}
            </h2>
            <p className="text-slate-400 mt-0.5">{athlete.position ?? 'No position assigned'}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
              <InfoItem label="Age"    value={athlete.age ? `${athlete.age} yrs`   : '—'} />
              <InfoItem label="Weight" value={athlete.weight_lbs ? `${athlete.weight_lbs} lbs` : '—'} />
              <InfoItem label="Status" value={athlete.is_active ? 'Active' : 'Inactive'} />
              <InfoItem label="Since"  value={new Date(athlete.created_at).toLocaleDateString()} />
            </div>
          </div>
        </div>

        {athlete.notes && (
          <div className="mt-5 pt-5 border-t border-[var(--border)]">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Notes</p>
            <p className="text-sm text-slate-300 whitespace-pre-line">{athlete.notes}</p>
          </div>
        )}
      </div>

      {/* Access code / QR */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-brand-400" />
            <h3 className="font-display text-base font-semibold tracking-wide text-white">
              ATHLETE ACCESS
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <p className="text-xs text-slate-500 mb-1">Access Code / PIN</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xl font-bold tracking-[0.25em] text-brand-400 bg-brand-500/10 border border-brand-500/20 rounded-lg px-4 py-2">
                {athlete.access_code}
              </span>
              <button onClick={copyCode} className="btn-secondary py-2 px-3 text-xs">
                {copied ? <Check className="w-3.5 h-3.5 text-brand-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <p className="text-xs text-slate-500 mb-1">Athlete Access URL</p>
            <div className="flex items-center gap-2">
              <code className="text-xs text-slate-400 bg-white/5 rounded px-2 py-1 flex-1 truncate">
                {appUrl}/athlete
              </code>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Athlete scans QR → enters this code to see their plan.
            </p>
          </div>
        </div>
      </div>

      {/* Recent plans */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-base font-semibold tracking-wide text-white">
            RECENT WEEKLY PLANS
          </h3>
          <Link href={`/admin/assignments/${id}`} className="text-xs text-brand-400 hover:text-brand-300">
            Manage plans →
          </Link>
        </div>

        {plans.length === 0 ? (
          <p className="text-sm text-slate-500">No plans assigned yet.</p>
        ) : (
          <div className="space-y-3">
            {plans.map(plan => (
              <Link
                key={plan.id}
                href={`/admin/assignments/${id}?week=${plan.week_start}`}
                className="block card card-hover p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">{formatWeekRange(plan.week_start)}</p>
                  <span className="text-xs text-slate-500">
                    {plan.assigned_exercises?.length ?? 0} exercises
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="card p-6 border-red-500/15">
        <h3 className="font-display text-base font-semibold tracking-wide text-red-400 mb-3">
          DANGER ZONE
        </h3>
        <p className="text-sm text-slate-500 mb-4">
          Deactivating this athlete will hide them from the roster. Their data is preserved.
        </p>
        <button onClick={handleDelete} disabled={deleting} className="btn-danger text-sm">
          <Trash2 className="w-4 h-4" />
          {deleting ? 'Deactivating…' : 'Deactivate Athlete'}
        </button>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-white mt-0.5">{value}</p>
    </div>
  );
}
