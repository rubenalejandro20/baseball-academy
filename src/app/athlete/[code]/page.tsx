'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import {
  type AthleteLookupResult, type ActivityType, type ExerciseCategory, type ActivityRoutine,
  ACTIVITIES, ACTIVITY_LABELS, CATEGORY_LABELS, CATEGORY_COLORS_LIGHT, SESSION_TYPES,
  formatDuration,
} from '@/lib/types';
import { ArrowLeft, Play, Timer, RotateCcw, ChevronRight } from 'lucide-react';

type Step = 'activities' | 'session' | 'primary' | 'routine';

// Flat row shape returned by the get_athlete_routines() RPC — a plpgsql
// function returns tabular rows, so the joined exercise comes back
// ex_-prefixed rather than nested; reshaped into ActivityRoutine below.
interface RoutineRpcRow {
  id: string;
  activity: ActivityType;
  session_type: ExerciseCategory;
  exercise_id: string;
  sets_override: number | null;
  reps_override: number | null;
  duration_sec_override: number | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  ex_id: string;
  ex_name: string;
  ex_category: ExerciseCategory;
  ex_description: string | null;
  ex_sets: number | null;
  ex_reps: number | null;
  ex_duration_sec: number | null;
  ex_video_url: string | null;
  ex_is_active: boolean;
  ex_created_at: string;
  ex_updated_at: string;
}

const ACTIVITY_STYLES: Record<ActivityType, { idle: string; active: string; emoji: string }> = {
  pitching: { idle: 'bg-blue-50 border-blue-200 text-blue-800',   active: 'bg-blue-700 border-blue-700 text-white',   emoji: '⚾' },
  catching: { idle: 'bg-amber-50 border-amber-200 text-amber-800', active: 'bg-amber-600 border-amber-600 text-white', emoji: '🧤' },
  hitting:  { idle: 'bg-red-50 border-red-200 text-red-900',       active: 'bg-[#CC0000] border-[#CC0000] text-white', emoji: '🏏' },
  fielding: { idle: 'bg-teal-50 border-teal-200 text-teal-800',   active: 'bg-teal-700 border-teal-700 text-white',   emoji: '🌿' },
};

const SESSION_STYLES: Record<ExerciseCategory, { idle: string; active: string }> = {
  pre_training:      { idle: 'bg-blue-50 border-blue-200 text-blue-800',     active: 'bg-blue-600 border-blue-600 text-white' },
  post_training:     { idle: 'bg-purple-50 border-purple-200 text-purple-800', active: 'bg-purple-600 border-purple-600 text-white' },
  recovery:          { idle: 'bg-teal-50 border-teal-200 text-teal-800',      active: 'bg-teal-600 border-teal-600 text-white' },
  mobility:          { idle: 'bg-amber-50 border-amber-200 text-amber-800',   active: 'bg-amber-500 border-amber-500 text-white' },
  strength:          { idle: 'bg-red-50 border-red-200 text-red-800',         active: 'bg-red-600 border-red-600 text-white' },
  injury_prevention: { idle: 'bg-emerald-50 border-emerald-200 text-emerald-800', active: 'bg-emerald-600 border-emerald-600 text-white' },
};

export default function AthleteRoutinePage() {
  const { code }  = useParams<{ code: string }>();

  const [athlete, setAthlete]       = useState<AthleteLookupResult | null>(null);
  const [notFound, setNotFound]     = useState(false);
  const [loadingAthlete, setLoadingAthlete] = useState(true);

  const [step, setStep]                     = useState<Step>('activities');
  const [selectedActivities, setSelectedActivities] = useState<ActivityType[]>([]);
  const [selectedSession, setSelectedSession]       = useState<ExerciseCategory | null>(null);
  const [routines, setRoutines]             = useState<ActivityRoutine[]>([]);
  const [routineLoading, setRoutineLoading] = useState(false);
  const [routineError, setRoutineError]     = useState(false);

  // Looked up via the rate-limited get_athlete_by_code RPC (through a server
  // route so the rate limiter can key off a real client IP), not a direct
  // table read — this is the temporary PIN-bridge path, replaced by email
  // OTP in a later milestone. Only the minimum fields the UI needs are
  // returned (no access_code, age, weight, or notes).
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/athlete/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const body = await res.json();
        if (!res.ok || !body.athlete) {
          setNotFound(true);
        } else {
          setAthlete(body.athlete);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoadingAthlete(false);
      }
    }
    load();
  }, [code]);

  function toggleActivity(activity: ActivityType) {
    setSelectedActivities(prev =>
      prev.includes(activity) ? prev.filter(a => a !== activity) : [...prev, activity]
    );
  }

  // Routed through the get_athlete_routines() RPC rather than a direct
  // `.from('activity_routines')` read — that table has no anonymous SELECT
  // policy at all (see 0005_milestone2_activity_routines_rls_rpc.sql). The
  // RPC re-derives this athlete's organization_id server-side from `code`
  // and can never be asked for (or leak) another organization's routines.
  async function loadRoutines(activities: ActivityType[], session: ExerciseCategory) {
    setRoutineLoading(true);
    setRoutineError(false);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('get_athlete_routines', {
      p_code: code,
      p_activities: activities,
      p_session_type: session,
    });
    if (error) {
      setRoutineError(true);
      setRoutines([]);
    } else {
      setRoutines(
        ((data ?? []) as RoutineRpcRow[]).map(row => ({
          id: row.id,
          activity: row.activity,
          session_type: row.session_type,
          exercise_id: row.exercise_id,
          sets_override: row.sets_override,
          reps_override: row.reps_override,
          duration_sec_override: row.duration_sec_override,
          notes: row.notes,
          sort_order: row.sort_order,
          created_at: row.created_at,
          exercise: {
            id: row.ex_id,
            name: row.ex_name,
            category: row.ex_category,
            description: row.ex_description,
            sets: row.ex_sets,
            reps: row.ex_reps,
            duration_sec: row.ex_duration_sec,
            video_url: row.ex_video_url,
            is_active: row.ex_is_active,
            created_at: row.ex_created_at,
            updated_at: row.ex_updated_at,
          },
        }))
      );
    }
    setRoutineLoading(false);
  }

  function handleSessionSelect(session: ExerciseCategory) {
    setSelectedSession(session);
    const multiAndFocused = selectedActivities.length > 1 &&
      (session === 'pre_training' || session === 'post_training');
    if (multiAndFocused) {
      setStep('primary');
    } else {
      loadRoutines(selectedActivities, session);
      setStep('routine');
    }
  }

  function handlePrimarySelect(activity: ActivityType) {
    loadRoutines([activity], selectedSession!);
    setStep('routine');
  }

  function goBack() {
    if (step === 'routine') {
      const wasPrimary = selectedActivities.length > 1 &&
        (selectedSession === 'pre_training' || selectedSession === 'post_training');
      setStep(wasPrimary ? 'primary' : 'session');
    } else if (step === 'primary') {
      setStep('session');
    } else if (step === 'session') {
      setStep('activities');
    }
  }

  // ── Not found ─────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="athlete-page min-h-screen flex flex-col items-center justify-center px-4 text-center">
        <div className="text-6xl mb-4">⚾</div>
        <h1 className="text-2xl font-black text-gray-900 mb-2" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          CODE NOT FOUND
        </h1>
        <p className="text-gray-500 text-sm mb-6">That access code doesn't match any athlete. Check with your physician.</p>
        <Link href="/athlete" className="px-6 py-3 rounded-2xl bg-[#CC0000] text-white font-bold text-sm">
          Try Again
        </Link>
      </div>
    );
  }

  if (loadingAthlete) {
    return (
      <div className="athlete-page min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[#CC0000] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const showBack = step !== 'activities';

  return (
    <div className="athlete-page min-h-screen flex flex-col" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        {showBack ? (
          <button
            onClick={goBack}
            className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        ) : (
          <Link href="/athlete" className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        )}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <AthletePhoto athlete={athlete!} />
          <div className="min-w-0">
            <p className="font-black text-gray-900 text-sm leading-tight truncate"
               style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em' }}>
              {athlete?.full_name.toUpperCase()}
            </p>
            <p className="text-xs text-gray-400">{athlete?.position ?? 'Athlete'}</p>
          </div>
        </div>
      </header>

      {/* Step content */}
      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        {step === 'activities' && (
          <ActivitiesStep
            selected={selectedActivities}
            onToggle={toggleActivity}
            onContinue={() => setStep('session')}
          />
        )}
        {step === 'session' && (
          <SessionStep onSelect={handleSessionSelect} />
        )}
        {step === 'primary' && selectedSession && (
          <PrimaryStep
            activities={selectedActivities}
            session={selectedSession}
            onSelect={handlePrimarySelect}
          />
        )}
        {step === 'routine' && selectedSession && (
          <RoutineView
            activities={selectedActivities}
            session={selectedSession}
            routines={routines}
            loading={routineLoading}
            error={routineError}
          />
        )}
      </main>
    </div>
  );
}

// ── Step 1: Activity selection ─────────────────────────────────

function ActivitiesStep({ selected, onToggle, onContinue }: {
  selected: ActivityType[];
  onToggle: (a: ActivityType) => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-black text-gray-900 text-2xl leading-tight"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.04em' }}>
          WHAT ARE YOU DOING TODAY?
        </h2>
        <p className="text-gray-400 text-sm mt-1">Select all that apply</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {ACTIVITIES.map(activity => {
          const style   = ACTIVITY_STYLES[activity];
          const isSelected = selected.includes(activity);
          return (
            <button
              key={activity}
              onClick={() => onToggle(activity)}
              className={`flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 font-bold text-sm transition-all ${
                isSelected ? style.active : style.idle
              }`}
              style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em' }}
            >
              <span className="text-3xl">{style.emoji}</span>
              {ACTIVITY_LABELS[activity].toUpperCase()}
            </button>
          );
        })}
      </div>

      <button
        onClick={onContinue}
        disabled={selected.length === 0}
        className="w-full py-4 rounded-2xl bg-[#CC0000] hover:bg-[#aa0000] text-white font-black text-base disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em' }}
      >
        CONTINUE →
      </button>
    </div>
  );
}

// ── Step 2: Session type selection ────────────────────────────

function SessionStep({ onSelect }: { onSelect: (s: ExerciseCategory) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-black text-gray-900 text-2xl leading-tight"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.04em' }}>
          WHAT TYPE OF SESSION?
        </h2>
        <p className="text-gray-400 text-sm mt-1">Tap to continue</p>
      </div>

      <div className="space-y-3">
        {SESSION_TYPES.map(session => {
          const style = SESSION_STYLES[session];
          return (
            <button
              key={session}
              onClick={() => onSelect(session)}
              className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl border-2 font-bold text-base transition-all ${style.idle} hover:scale-[1.01] active:scale-[0.99]`}
              style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em' }}
            >
              {CATEGORY_LABELS[session].toUpperCase()}
              <ChevronRight className="w-5 h-5 opacity-50" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 3: Primary activity (pre/post + multi-select) ─────────

function PrimaryStep({ activities, session, onSelect }: {
  activities: ActivityType[];
  session: ExerciseCategory;
  onSelect: (a: ActivityType) => void;
}) {
  const question = session === 'pre_training'
    ? 'WHAT ARE YOU DOING FIRST?'
    : 'WHAT DID YOU DO LAST?';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-black text-gray-900 text-2xl leading-tight"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.04em' }}>
          {question}
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          {session === 'pre_training' ? 'Select the activity you\'re about to start' : 'Select the activity you just finished'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {activities.map(activity => {
          const style = ACTIVITY_STYLES[activity];
          return (
            <button
              key={activity}
              onClick={() => onSelect(activity)}
              className={`flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 font-bold text-sm transition-all ${style.idle} hover:scale-[1.02] active:scale-[0.98]`}
              style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em' }}
            >
              <span className="text-3xl">{style.emoji}</span>
              {ACTIVITY_LABELS[activity].toUpperCase()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Routine view ───────────────────────────────────────────────

function RoutineView({ activities, session, routines, loading, error }: {
  activities: ActivityType[];
  session: ExerciseCategory;
  routines: ActivityRoutine[];
  loading: boolean;
  error: boolean;
}) {
  const multiActivity = activities.length > 1 &&
    session !== 'pre_training' && session !== 'post_training';

  const grouped = routines.reduce<Partial<Record<ActivityType, ActivityRoutine[]>>>(
    (acc, r) => { (acc[r.activity] ??= []).push(r); return acc; },
    {}
  );

  const contextLabel = multiActivity
    ? `${activities.map(a => ACTIVITY_LABELS[a]).join(' + ')} · ${CATEGORY_LABELS[session]}`
    : `${ACTIVITY_LABELS[activities[0]]} · ${CATEGORY_LABELS[session]}`;

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h2 className="font-black text-gray-900 text-xl"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.04em' }}>
          YOUR ROUTINE
        </h2>
        <p className="text-sm text-gray-400 mt-0.5">{contextLabel}</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-3">⚠️</div>
          <p className="font-bold text-gray-700 text-lg"
             style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            COULDN'T LOAD YOUR ROUTINE
          </p>
          <p className="text-gray-400 text-sm mt-1">
            Please check your connection and try again.
          </p>
        </div>
      ) : routines.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-3">📋</div>
          <p className="font-bold text-gray-700 text-lg"
             style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            NO EXERCISES YET
          </p>
          <p className="text-gray-400 text-sm mt-1">
            Your physician hasn't added exercises to this routine yet.
          </p>
        </div>
      ) : multiActivity ? (
        Object.entries(grouped).map(([activity, exs]) => (
          <div key={activity}>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1"
               style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              {ACTIVITY_LABELS[activity as ActivityType]}
            </p>
            <div className="space-y-3">
              {exs!.map((r, idx) => (
                <ExerciseCard key={r.id} routine={r} index={idx + 1} session={session} />
              ))}
            </div>
          </div>
        ))
      ) : (
        routines.map((r, idx) => (
          <ExerciseCard key={r.id} routine={r} index={idx + 1} session={session} />
        ))
      )}
    </div>
  );
}

// ── Exercise card ──────────────────────────────────────────────

function ExerciseCard({ routine, index, session }: {
  routine: ActivityRoutine;
  index: number;
  session: ExerciseCategory;
}) {
  const ex   = routine.exercise!;
  const sets = routine.sets_override ?? ex.sets;
  const reps = routine.reps_override ?? ex.reps;
  const dur  = routine.duration_sec_override ?? ex.duration_sec;
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-start gap-4 p-4 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <div className="w-8 h-8 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
          <span className="text-xs font-black text-[#CC0000]">{index}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 leading-snug">{ex.name}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`badge text-[10px] ${CATEGORY_COLORS_LIGHT[session]}`}>
              {CATEGORY_LABELS[session]}
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
          <div className="flex gap-3 flex-wrap">
            {sets  && <Stat label="Sets"     value={sets.toString()} />}
            {reps  && <Stat label="Reps"     value={reps.toString()} />}
            {dur   && <Stat label="Duration" value={formatDuration(dur)} />}
          </div>

          {ex.description && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Instructions</p>
              <p className="text-sm text-gray-700 leading-relaxed">{ex.description}</p>
            </div>
          )}

          {routine.notes && (
            <div className="bg-red-50 rounded-xl p-3 border border-red-100">
              <p className="text-[11px] font-bold text-[#CC0000] uppercase tracking-wider mb-1">Coach Note</p>
              <p className="text-sm text-red-900">{routine.notes}</p>
            </div>
          )}

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

// Athlete self-photo upload is intentionally disabled here (poster/V1):
// Supabase Storage has no RLS policies permitting anon uploads to
// `athlete-photos` today, so the upload flow could never succeed anyway.
// This is display-only until the secure, server-mediated upload flow
// (signed upload URL issued after re-validating the access code, per the
// athlete photo upload investigation) replaces it post-launch. The
// existing athletes.photo_url / update_athlete_photo_by_code / /api/athlete/photo
// pieces are untouched and ready for that follow-up.
function AthletePhoto({ athlete }: {
  athlete: AthleteLookupResult;
}) {
  const initials = athlete.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="relative w-10 h-10 rounded-xl overflow-hidden shrink-0 border-2 border-gray-200">
      {athlete.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={athlete.photo_url} alt={athlete.full_name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-red-50 flex items-center justify-center">
          <span className="text-xs font-black text-[#CC0000]" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            {initials}
          </span>
        </div>
      )}
    </div>
  );
}
