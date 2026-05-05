'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import {
  type Exercise, type ActivityType, type ExerciseCategory, type ActivityRoutine,
  ACTIVITY_LABELS, CATEGORY_LABELS, CATEGORY_COLORS, SESSION_TYPES, ACTIVITIES,
  formatDuration,
} from '@/lib/types';
import { ArrowLeft, Plus, X, Search, Timer, RotateCcw } from 'lucide-react';

export default function RoutineSlotPage() {
  const { activity, sessionType } = useParams<{ activity: string; sessionType: string }>();

  const act  = activity as ActivityType;
  const sess = sessionType as ExerciseCategory;

  const isValid = ACTIVITIES.includes(act) && SESSION_TYPES.includes(sess);

  const [routines, setRoutines]   = useState<ActivityRoutine[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving]       = useState(false);

  const loadRoutines = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('activity_routines')
      .select('*, exercise:exercises(*)')
      .eq('activity', act)
      .eq('session_type', sess)
      .order('sort_order');
    setRoutines(data ?? []);
    setLoading(false);
  }, [act, sess]);

  useEffect(() => {
    if (!isValid) return;
    loadRoutines();
    createClient()
      .from('exercises')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setExercises(data ?? []));
  }, [loadRoutines, isValid]);

  async function addExercise(exercise: Exercise) {
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('activity_routines')
      .insert({
        activity:     act,
        session_type: sess,
        exercise_id:  exercise.id,
        sort_order:   routines.length,
      })
      .select('*, exercise:exercises(*)')
      .single();
    if (data) setRoutines(prev => [...prev, data]);
    setSaving(false);
    setShowModal(false);
  }

  async function removeRoutine(id: string) {
    const supabase = createClient();
    await supabase.from('activity_routines').delete().eq('id', id);
    setRoutines(prev => prev.filter(r => r.id !== id));
  }

  if (!isValid) {
    return (
      <div className="max-w-3xl mx-auto">
        <p className="text-slate-500">Invalid routine slot.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/admin/routines" className="btn-secondary py-2 px-3 text-xs mt-1">
          <ArrowLeft className="w-3.5 h-3.5" />
        </Link>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-white uppercase">
            {ACTIVITY_LABELS[act]}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`badge text-xs ${CATEGORY_COLORS[sess]}`}>
              {CATEGORY_LABELS[sess]}
            </span>
            <span className="text-slate-500 text-sm">{routines.length} exercises</span>
          </div>
        </div>
      </div>

      {/* Exercise list */}
      <div className="card p-4 space-y-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : routines.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-500 text-sm">No exercises in this routine yet.</p>
            <p className="text-slate-600 text-xs mt-1">Click "Add Exercise" to build this routine.</p>
          </div>
        ) : (
          routines.map((r, idx) => (
            <RoutineRow key={r.id} routine={r} index={idx + 1} onRemove={removeRoutine} />
          ))
        )}

        <button
          onClick={() => setShowModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold text-brand-400 border border-brand-500/25 border-dashed hover:bg-brand-500/8 transition-colors mt-1"
        >
          <Plus className="w-4 h-4" /> Add Exercise
        </button>
      </div>

      {showModal && (
        <AddExerciseModal
          exercises={exercises}
          existingIds={new Set(routines.map(r => r.exercise_id))}
          onAdd={addExercise}
          onClose={() => setShowModal(false)}
          saving={saving}
        />
      )}
    </div>
  );
}

function RoutineRow({ routine, index, onRemove }: {
  routine: ActivityRoutine;
  index: number;
  onRemove: (id: string) => void;
}) {
  const ex   = routine.exercise!;
  const sets = routine.sets_override ?? ex.sets;
  const reps = routine.reps_override ?? ex.reps;
  const dur  = routine.duration_sec_override ?? ex.duration_sec;

  return (
    <div className="group flex items-center gap-3 p-3 rounded-lg bg-white/4 hover:bg-white/7 transition-colors">
      <span className="w-5 text-center text-xs font-bold text-slate-600 shrink-0">{index}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">{ex.name}</p>
        <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
          {sets && reps && (
            <span className="flex items-center gap-1">
              <RotateCcw className="w-2.5 h-2.5" /> {sets} × {reps}
            </span>
          )}
          {dur && (
            <span className="flex items-center gap-1">
              <Timer className="w-2.5 h-2.5" /> {formatDuration(dur)}
            </span>
          )}
        </p>
      </div>
      <button
        onClick={() => onRemove(routine.id)}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-slate-500 hover:text-red-400 transition-all shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function AddExerciseModal({ exercises, existingIds, onAdd, onClose, saving }: {
  exercises: Exercise[];
  existingIds: Set<string>;
  onAdd: (ex: Exercise) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [query, setQuery]         = useState('');
  const [catFilter, setCatFilter] = useState<ExerciseCategory | 'all'>('all');

  const filtered = exercises.filter(ex => {
    const matchQ = ex.name.toLowerCase().includes(query.toLowerCase());
    const matchC = catFilter === 'all' || ex.category === catFilter;
    return matchQ && matchC;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg card p-5 max-h-[90vh] flex flex-col shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl font-bold text-white tracking-wide">ADD EXERCISE</h3>
          <button onClick={onClose} className="btn-secondary py-1.5 px-2">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search exercises…"
            className="input-dark pl-9"
          />
        </div>

        <div className="flex gap-1.5 flex-wrap mb-3">
          <button
            onClick={() => setCatFilter('all')}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
              catFilter === 'all'
                ? 'bg-white/15 text-white border-white/25'
                : 'bg-white/5 text-slate-500 border-white/8 hover:bg-white/10'
            }`}
          >
            All
          </button>
          {SESSION_TYPES.map(k => (
            <button
              key={k}
              onClick={() => setCatFilter(k)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                catFilter === k
                  ? CATEGORY_COLORS[k]
                  : 'bg-white/5 text-slate-500 border-white/8 hover:bg-white/10'
              }`}
            >
              {CATEGORY_LABELS[k]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filtered.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">No exercises match.</p>
          ) : (
            filtered.map(ex => {
              const already = existingIds.has(ex.id);
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
                      <span className={`badge text-[10px] ${CATEGORY_COLORS[ex.category]}`}>
                        {CATEGORY_LABELS[ex.category]}
                      </span>
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
                  {already
                    ? <span className="text-[10px] text-slate-500 shrink-0">Added</span>
                    : <Plus className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
                  }
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

