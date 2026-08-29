'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { getStaffContext } from '@/lib/auth/getStaffContext';
import {
  type Athlete, type Exercise, type WeeklyPlan, type AssignedExercise,
  type DayOfWeek, type ExerciseCategory,
  DAYS_OF_WEEK, DAY_LABELS, CATEGORY_LABELS, CATEGORY_COLORS, formatDuration,
  getMondayOfWeek, formatWeekRange,
} from '@/lib/types';
import { AthleteAvatar } from '@/components/admin/AthleteAvatar';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Plus, Trash2, X, Search,
  Timer, RotateCcw, Play, Save,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────

interface AddExerciseModal {
  day: DayOfWeek;
  session: ExerciseCategory;
}

// ── Page ──────────────────────────────────────────────────────

export default function AthleteAssignmentPage() {
  const { athleteId } = useParams<{ athleteId: string }>();
  const searchParams   = useSearchParams();

  const [athlete, setAthlete]         = useState<Athlete | null>(null);
  const [exercises, setExercises]     = useState<Exercise[]>([]);
  const [weekStart, setWeekStart]     = useState<string>(
    searchParams.get('week') ?? getMondayOfWeek()
  );
  const [plan, setPlan]               = useState<WeeklyPlan | null>(null);
  const [assigned, setAssigned]       = useState<AssignedExercise[]>([]);
  const [loading, setLoading]         = useState(true);
  const [modal, setModal]             = useState<AddExerciseModal | null>(null);
  const [saving, setSaving]           = useState(false);

  // Load athlete + exercise library once
  useEffect(() => {
    async function loadBase() {
      const supabase = createClient();
      const [{ data: a }, { data: e }] = await Promise.all([
        supabase.from('athletes').select('*').eq('id', athleteId).single(),
        supabase.from('exercises').select('*').eq('is_active', true).order('name'),
      ]);
      setAthlete(a);
      setExercises(e ?? []);
    }
    loadBase();
  }, [athleteId]);

  // Load plan for current week
  const loadPlan = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: p } = await supabase
      .from('weekly_plans')
      .select('*')
      .eq('athlete_id', athleteId)
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
  }, [athleteId, weekStart]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  function shiftWeek(delta: number) {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d.toISOString().split('T')[0]);
  }

  // Ensure plan exists before adding exercises
  async function ensurePlan(): Promise<string> {
    if (plan) return plan.id;
    setSaving(true);
    const staffContext = await getStaffContext();
    const supabase = createClient();
    const { data } = await supabase
      .from('weekly_plans')
      .insert({
        athlete_id: athleteId,
        week_start: weekStart,
        organization_id: staffContext.status === 'ok' ? staffContext.organizationId : null,
      })
      .select()
      .single();
    setPlan(data);
    setSaving(false);
    return data.id;
  }

  async function addExercise(exercise: Exercise) {
    if (!modal) return;
    setSaving(true);
    const planId = await ensurePlan();
    const supabase = createClient();
    const { data } = await supabase.from('assigned_exercises').insert({
      weekly_plan_id: planId,
      exercise_id:    exercise.id,
      day:            modal.day,
      session_type:   modal.session,
      sort_order:     assigned.filter(a => a.day === modal.day).length,
    }).select('*, exercise:exercises(*)').single();
    if (data) setAssigned(prev => [...prev, data]);
    setSaving(false);
    setModal(null);
  }

  async function removeAssigned(id: string) {
    const supabase = createClient();
    await supabase.from('assigned_exercises').delete().eq('id', id);
    setAssigned(prev => prev.filter(a => a.id !== id));
  }

  if (!athlete) return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="card h-40 animate-pulse" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/admin/assignments" className="btn-secondary py-2 px-3 text-xs mt-1">
          <ArrowLeft className="w-3.5 h-3.5" />
        </Link>
        <div className="flex items-center gap-3 flex-1">
          <AthleteAvatar athlete={athlete} size="md" />
          <div>
            <h1 className="font-display text-3xl font-bold tracking-wide text-white">
              {athlete.full_name.toUpperCase()}
            </h1>
            <p className="text-slate-400 text-sm">
              {athlete.position ?? 'No position'} · Weekly Exercise Plan
            </p>
          </div>
        </div>
      </div>

      {/* Week selector */}
      <div className="card p-4 flex items-center justify-between">
        <button onClick={() => shiftWeek(-1)} className="btn-secondary py-2 px-3 text-xs">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-center">
          <p className="font-display text-lg font-semibold text-white tracking-wide">
            {formatWeekRange(weekStart)}
          </p>
          {weekStart === getMondayOfWeek() && (
            <span className="text-xs text-brand-400 font-medium">Current Week</span>
          )}
        </div>
        <button onClick={() => shiftWeek(1)} className="btn-secondary py-2 px-3 text-xs">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day columns */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="card h-48 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {DAYS_OF_WEEK.map(day => {
            const dayExercises = assigned.filter(a => a.day === day);
            return (
              <DayColumn
                key={day}
                day={day}
                exercises={dayExercises}
                onAdd={(session) => setModal({ day, session })}
                onRemove={removeAssigned}
              />
            );
          })}
        </div>
      )}

      {/* Plan notes */}
      {plan && (
        <PlanNotes plan={plan} onUpdate={note => setPlan(p => p ? { ...p, notes: note } : p)} />
      )}

      {/* Add Exercise Modal */}
      {modal && (
        <AddExerciseModal
          day={modal.day}
          session={modal.session}
          exercises={exercises}
          assigned={assigned}
          onAdd={addExercise}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}
    </div>
  );
}

// ── Day Column ────────────────────────────────────────────────

function DayColumn({
  day, exercises, onAdd, onRemove,
}: {
  day: DayOfWeek;
  exercises: AssignedExercise[];
  onAdd: (session: ExerciseCategory) => void;
  onRemove: (id: string) => void;
}) {
  const [showSessionPicker, setShowSessionPicker] = useState(false);

  const grouped = exercises.reduce<Partial<Record<ExerciseCategory, AssignedExercise[]>>>(
    (acc, ex) => {
      (acc[ex.session_type] ??= []).push(ex);
      return acc;
    }, {}
  );

  return (
    <div className="card p-3 flex flex-col gap-3 min-h-[160px]">
      {/* Day header */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold tracking-wider text-white uppercase">
          {DAY_LABELS[day].slice(0, 3)}
          <span className="hidden sm:inline">{DAY_LABELS[day].slice(3)}</span>
        </h3>
        <span className="text-xs text-slate-600">{exercises.length} ex.</span>
      </div>

      {/* Exercises grouped by session */}
      {Object.entries(grouped).map(([session, exs]) => (
        <div key={session}>
          <div className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mb-1 inline-block border ${CATEGORY_COLORS[session as ExerciseCategory]}`}>
            {CATEGORY_LABELS[session as ExerciseCategory]}
          </div>
          <div className="space-y-1">
            {exs!.map(ae => (
              <AssignedExerciseCard key={ae.id} ae={ae} onRemove={onRemove} />
            ))}
          </div>
        </div>
      ))}

      {exercises.length === 0 && (
        <p className="text-xs text-slate-600 flex-1 flex items-center justify-center">No exercises</p>
      )}

      {/* Add button */}
      <div className="relative mt-auto">
        <button
          onClick={() => setShowSessionPicker(v => !v)}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-brand-400 border border-brand-500/25 border-dashed hover:bg-brand-500/8 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
        {showSessionPicker && (
          <SessionPicker
            onSelect={s => { onAdd(s); setShowSessionPicker(false); }}
            onClose={() => setShowSessionPicker(false)}
          />
        )}
      </div>
    </div>
  );
}

function AssignedExerciseCard({ ae, onRemove }: { ae: AssignedExercise; onRemove: (id: string) => void }) {
  const ex = ae.exercise!;
  const sets = ae.sets_override ?? ex.sets;
  const reps = ae.reps_override ?? ex.reps;
  const dur  = ae.duration_sec_override ?? ex.duration_sec;

  return (
    <div className="group flex items-start gap-1.5 p-2 rounded-lg bg-white/4 hover:bg-white/7 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white leading-snug line-clamp-2">{ex.name}</p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          {sets && reps ? `${sets}×${reps}` : sets ? `${sets} sets` : reps ? `${reps} reps` : ''}
          {dur ? ` · ${formatDuration(dur)}` : ''}
        </p>
      </div>
      <button
        onClick={() => onRemove(ae.id)}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-600 hover:text-red-400 transition-all shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function SessionPicker({ onSelect, onClose }: {
  onSelect: (s: ExerciseCategory) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full left-0 right-0 mb-1 z-20 card p-1.5 shadow-xl space-y-0.5">
        {(Object.entries(CATEGORY_LABELS) as [ExerciseCategory, string][]).map(([k, v]) => (
          <button
            key={k}
            onClick={() => onSelect(k)}
            className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-semibold transition-colors ${CATEGORY_COLORS[k]} hover:opacity-80`}
          >
            {v}
          </button>
        ))}
      </div>
    </>
  );
}

// ── Add Exercise Modal ─────────────────────────────────────────

function AddExerciseModal({
  day, session, exercises, assigned, onAdd, onClose, saving,
}: {
  day: DayOfWeek;
  session: ExerciseCategory;
  exercises: Exercise[];
  assigned: AssignedExercise[];
  onAdd: (ex: Exercise) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<ExerciseCategory | 'all'>(session);

  const assignedIds = new Set(assigned.filter(a => a.day === day && a.session_type === session).map(a => a.exercise_id));

  const filtered = exercises.filter(ex => {
    const matchQ = ex.name.toLowerCase().includes(query.toLowerCase());
    const matchC = catFilter === 'all' || ex.category === catFilter;
    return matchQ && matchC;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg card p-5 max-h-[90vh] flex flex-col shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-xl font-bold text-white tracking-wide">ADD EXERCISE</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {DAY_LABELS[day]} · <span className={`badge ${CATEGORY_COLORS[session]}`}>{CATEGORY_LABELS[session]}</span>
            </p>
          </div>
          <button onClick={onClose} className="btn-secondary py-1.5 px-2">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search exercises…"
            className="input-dark pl-9"
            autoFocus
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-1.5 flex-wrap mb-3">
          <button
            onClick={() => setCatFilter('all')}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${catFilter === 'all' ? 'bg-white/15 text-white border-white/25' : 'bg-white/5 text-slate-500 border-white/8 hover:bg-white/10'}`}
          >
            All
          </button>
          {(Object.entries(CATEGORY_LABELS) as [ExerciseCategory, string][]).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setCatFilter(k)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${catFilter === k ? `${CATEGORY_COLORS[k]}` : 'bg-white/5 text-slate-500 border-white/8 hover:bg-white/10'}`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Exercise list */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filtered.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">No exercises match.</p>
          ) : (
            filtered.map(ex => {
              const already = assignedIds.has(ex.id);
              return (
                <button
                  key={ex.id}
                  disabled={already || saving}
                  onClick={() => onAdd(ex)}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg text-left border transition-all ${
                    already
                      ? 'opacity-40 cursor-not-allowed bg-white/4 border-white/8'
                      : 'bg-white/4 border-white/8 hover:bg-brand-500/10 hover:border-brand-500/25'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{ex.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`badge text-[10px] ${CATEGORY_COLORS[ex.category]}`}>{CATEGORY_LABELS[ex.category]}</span>
                      {ex.sets && ex.reps && (
                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                          <RotateCcw className="w-2.5 h-2.5" /> {ex.sets}×{ex.reps}
                        </span>
                      )}
                      {ex.duration_sec && (
                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Timer className="w-2.5 h-2.5" /> {formatDuration(ex.duration_sec)}
                        </span>
                      )}
                    </div>
                  </div>
                  {already ? (
                    <span className="text-[10px] text-slate-500 shrink-0">Added</span>
                  ) : (
                    <Plus className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Plan Notes ─────────────────────────────────────────────────

function PlanNotes({ plan, onUpdate }: { plan: WeeklyPlan; onUpdate: (note: string) => void }) {
  const [note, setNote]     = useState(plan.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  async function save() {
    setSaving(true);
    const supabase = createClient();
    await supabase.from('weekly_plans').update({ notes: note }).eq('id', plan.id);
    onUpdate(note);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="card p-5">
      <h3 className="font-display text-sm font-semibold tracking-wide text-white mb-2">
        PLAN NOTES
      </h3>
      <textarea
        className="input-dark resize-none w-full"
        rows={3}
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Notes for this week's plan…"
      />
      <div className="flex justify-end mt-2">
        <button onClick={save} disabled={saving} className="btn-secondary text-xs py-1.5 px-3">
          <Save className="w-3.5 h-3.5" />
          {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Notes'}
        </button>
      </div>
    </div>
  );
}
