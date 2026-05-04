'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import {
  type Athlete, type WeeklyPlan, type AssignedExercise, type DayOfWeek,
  DAYS_OF_WEEK, DAY_LABELS, CATEGORY_LABELS, CATEGORY_COLORS_LIGHT,
  formatDuration, getMondayOfWeek, formatWeekRange,
} from '@/lib/types';
import { ChevronLeft, ChevronRight, Play, Timer, RotateCcw, Upload, Camera, ArrowLeft } from 'lucide-react';

export default function AthleteExerciseViewPage() {
  const { code } = useParams<{ code: string }>();

  const [athlete, setAthlete]   = useState<Athlete | null>(null);
  const [plan, setPlan]         = useState<WeeklyPlan | null>(null);
  const [assigned, setAssigned] = useState<AssignedExercise[]>([]);
  const [weekStart, setWeekStart] = useState(getMondayOfWeek());
  const [activeDay, setActiveDay] = useState<DayOfWeek>(() => {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    return (days[new Date().getDay()] ?? 'monday') as DayOfWeek;
  });
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load athlete by access code
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: a } = await supabase
        .from('athletes')
        .select('*')
        .eq('access_code', code.toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (!a) { setNotFound(true); setLoading(false); return; }
      setAthlete(a);
    }
    load();
  }, [code]);

  // Load plan for week
  useEffect(() => {
    if (!athlete) return;
    async function loadPlan() {
      setLoading(true);
      const supabase = createClient();
      const { data: p } = await supabase
        .from('weekly_plans')
        .select('*')
        .eq('athlete_id', athlete!.id)
        .eq('week_start', weekStart)
        .maybeSingle();

      if (p) {
        const { data: ae } = await supabase
          .from('assigned_exercises')
          .select('*, exercise:exercises(*)')
          .eq('weekly_plan_id', p.id)
          .order('sort_order');
        setPlan(p);
        setAssigned(ae ?? []);
      } else {
        setPlan(null);
        setAssigned([]);
      }
      setLoading(false);
    }
    loadPlan();
  }, [athlete, weekStart]);

  function shiftWeek(delta: number) {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d.toISOString().split('T')[0]);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !athlete) return;
    setUploading(true);
    try {
      const supabase = createClient();
      const ext  = file.name.split('.').pop();
      const path = `athletes/${athlete.id}.${ext}`;
      const { error: upErr } = await supabase.storage.from('athlete-photos').upload(path, file, { upsert: true });
      if (!upErr) {
        const { data: { publicUrl } } = supabase.storage.from('athlete-photos').getPublicUrl(path);
        await supabase.from('athletes').update({ photo_url: publicUrl }).eq('id', athlete.id);
        setAthlete(a => a ? { ...a, photo_url: publicUrl } : a);
      }
    } finally {
      setUploading(false);
    }
  }

  const todayExercises  = assigned.filter(a => a.day === activeDay);
  const daysWithContent = new Set(assigned.map(a => a.day));

  // ── Not found ──
  if (notFound) {
    return (
      <div className="athlete-page min-h-screen flex flex-col items-center justify-center px-4 text-center">
        <div className="text-6xl mb-4">⚾</div>
        <h1 className="text-2xl font-black text-gray-900 mb-2" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          CODE NOT FOUND
        </h1>
        <p className="text-gray-500 text-sm mb-6">That access code doesn't match any athlete. Check with your physician.</p>
        <Link href="/athlete" className="px-6 py-3 rounded-2xl bg-green-600 text-white font-bold text-sm">
          Try Again
        </Link>
      </div>
    );
  }

  if (loading && !athlete) {
    return (
      <div className="athlete-page min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="athlete-page min-h-screen" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Top nav */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        <Link href="/athlete" className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <AthletePhoto athlete={athlete!} onUpload={() => fileRef.current?.click()} uploading={uploading} />
          <div className="min-w-0">
            <p className="font-black text-gray-900 text-sm leading-tight truncate" style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em' }}>
              {athlete?.full_name.toUpperCase()}
            </p>
            <p className="text-xs text-gray-400">{athlete?.position ?? 'Athlete'}</p>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handlePhotoUpload} />
      </header>

      {/* Week selector */}
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <button onClick={() => shiftWeek(-1)} className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-white">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-gray-800">{formatWeekRange(weekStart)}</p>
          {weekStart === getMondayOfWeek() && (
            <p className="text-xs text-green-600 font-semibold">This Week</p>
          )}
        </div>
        <button onClick={() => shiftWeek(1)} className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-white">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day pills */}
      <div className="bg-white border-b border-gray-100 px-3 py-3 flex gap-1.5 overflow-x-auto no-scrollbar">
        {DAYS_OF_WEEK.map(day => {
          const hasContent = daysWithContent.has(day);
          const isActive   = activeDay === day;
          return (
            <button
              key={day}
              onClick={() => setActiveDay(day)}
              className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all relative ${
                isActive
                  ? 'bg-green-600 text-white shadow-md shadow-green-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em' }}
            >
              {DAY_LABELS[day].slice(0, 3).toUpperCase()}
              {hasContent && !isActive && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Exercise content */}
      <main className="px-4 py-5 max-w-lg mx-auto space-y-4 pb-20">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />)}
          </div>
        ) : todayExercises.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">🏖️</div>
            <p className="font-bold text-gray-700 text-lg" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>REST DAY</p>
            <p className="text-gray-400 text-sm mt-1">No exercises scheduled for {DAY_LABELS[activeDay]}.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="font-black text-gray-900 text-xl" style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em' }}>
                {DAY_LABELS[activeDay].toUpperCase()}
              </h2>
              <span className="text-sm text-gray-400 font-medium">{todayExercises.length} exercises</span>
            </div>
            {plan?.notes && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1">Physician Note</p>
                <p className="text-sm text-amber-800">{plan.notes}</p>
              </div>
            )}
            {todayExercises.map((ae, idx) => (
              <ExerciseCard key={ae.id} ae={ae} index={idx + 1} />
            ))}
          </>
        )}
      </main>
    </div>
  );
}

// ── Exercise Card (athlete view) ───────────────────────────────

function ExerciseCard({ ae, index }: { ae: AssignedExercise; index: number }) {
  const ex       = ae.exercise!;
  const sets     = ae.sets_override ?? ex.sets;
  const reps     = ae.reps_override ?? ex.reps;
  const dur      = ae.duration_sec_override ?? ex.duration_sec;
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-start gap-4 p-4 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <div className="w-8 h-8 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center shrink-0">
          <span className="text-xs font-black text-green-700">{index}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 leading-snug">{ex.name}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`badge text-[10px] ${CATEGORY_COLORS_LIGHT[ae.session_type]}`}>
              {CATEGORY_LABELS[ae.session_type]}
            </span>
            {sets && reps && (
              <span className="flex items-center gap-1 text-xs text-gray-500 font-semibold">
                <RotateCcw className="w-3 h-3" /> {sets} × {reps}
              </span>
            )}
            {dur && (
              <span className="flex items-center gap-1 text-xs text-gray-500 font-semibold">
                <Timer className="w-3 h-3" /> {formatDuration(dur)}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className={`w-4 h-4 text-gray-300 shrink-0 mt-1 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-3">
          {/* Stats row */}
          <div className="flex gap-3 flex-wrap">
            {sets  && <Stat label="Sets"     value={sets.toString()} />}
            {reps  && <Stat label="Reps"     value={reps.toString()} />}
            {dur   && <Stat label="Duration" value={formatDuration(dur)} />}
          </div>

          {/* Description */}
          {ex.description && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Instructions</p>
              <p className="text-sm text-gray-700 leading-relaxed">{ex.description}</p>
            </div>
          )}

          {/* Notes override */}
          {ae.notes && (
            <div className="bg-green-50 rounded-xl p-3 border border-green-100">
              <p className="text-[11px] font-bold text-green-600 uppercase tracking-wider mb-1">Coach Note</p>
              <p className="text-sm text-green-800">{ae.notes}</p>
            </div>
          )}

          {/* Video */}
          {ex.video_url && (
            <a
              href={ex.video_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gray-900 text-white text-sm font-bold"
              style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em' }}
            >
              <Play className="w-4 h-4 fill-current" />
              WATCH DEMO VIDEO
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2 text-center min-w-[60px]">
      <p className="text-lg font-black text-gray-900" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{value}</p>
      <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{label}</p>
    </div>
  );
}

function AthletePhoto({ athlete, onUpload, uploading }: {
  athlete: Athlete; onUpload: () => void; uploading: boolean;
}) {
  const initials = athlete.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  return (
    <button
      onClick={onUpload}
      className="relative w-10 h-10 rounded-xl overflow-hidden shrink-0 border-2 border-gray-200 hover:border-green-400 transition-colors group"
      title="Tap to update photo"
    >
      {athlete.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={athlete.photo_url} alt={athlete.full_name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-green-50 flex items-center justify-center">
          <span className="text-xs font-black text-green-700" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            {initials}
          </span>
        </div>
      )}
      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
        <Camera className="w-3 h-3 text-white" />
      </div>
      {uploading && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </button>
  );
}
