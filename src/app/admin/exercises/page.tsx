'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import {
  type Exercise, type ExerciseCategory,
  CATEGORY_LABELS, CATEGORY_COLORS, formatDuration,
} from '@/lib/types';
import { Plus, Search, Pencil, Trash2, Play, Timer, RotateCcw } from 'lucide-react';

const ALL = 'all' as const;

export default function ExercisesPage() {
  const [exercises, setExercises]   = useState<Exercise[]>([]);
  const [query, setQuery]           = useState('');
  const [filter, setFilter]         = useState<ExerciseCategory | typeof ALL>(ALL);
  const [loading, setLoading]       = useState(true);
  const [deleting, setDeleting]     = useState<string | null>(null);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase.from('exercises').select('*').eq('is_active', true).order('name');
    setExercises(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(ex: Exercise) {
    if (!confirm(`Remove "${ex.name}" from the library?`)) return;
    setDeleting(ex.id);
    const supabase = createClient();
    await supabase.from('exercises').update({ is_active: false }).eq('id', ex.id);
    setExercises(prev => prev.filter(e => e.id !== ex.id));
    setDeleting(null);
  }

  const filtered = exercises.filter(ex => {
    const matchQ = ex.name.toLowerCase().includes(query.toLowerCase()) ||
                   (ex.description ?? '').toLowerCase().includes(query.toLowerCase());
    const matchF = filter === ALL || ex.category === filter;
    return matchQ && matchF;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-wide text-white">EXERCISE LIBRARY</h1>
          <p className="text-slate-400 text-sm mt-0.5">{exercises.length} exercises</p>
        </div>
        <Link href="/admin/exercises/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Exercise</span>
        </Link>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search exercises…"
            className="input-dark pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip active={filter === ALL} onClick={() => setFilter(ALL)}>All</FilterChip>
          {(Object.keys(CATEGORY_LABELS) as ExerciseCategory[]).map(cat => (
            <FilterChip
              key={cat}
              active={filter === cat}
              onClick={() => setFilter(cat)}
            >
              {CATEGORY_LABELS[cat]}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card h-20 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-slate-500 mb-4">
            {query || filter !== ALL ? 'No exercises match your filters.' : 'No exercises yet.'}
          </p>
          {!query && filter === ALL && (
            <Link href="/admin/exercises/new" className="btn-primary">
              <Plus className="w-4 h-4" /> Add First Exercise
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(ex => (
            <ExerciseRow key={ex.id} exercise={ex} onDelete={handleDelete} deleting={deleting === ex.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExerciseRow({
  exercise: ex, onDelete, deleting,
}: {
  exercise: Exercise;
  onDelete: (ex: Exercise) => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button
        className="w-full flex items-start gap-4 p-4 text-left hover:bg-white/3 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <span className="font-semibold text-white">{ex.name}</span>
            <span className={`badge ${CATEGORY_COLORS[ex.category]}`}>
              {CATEGORY_LABELS[ex.category]}
            </span>
          </div>
          {ex.description && !expanded && (
            <p className="text-xs text-slate-500 line-clamp-1">{ex.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs text-slate-500">
          {ex.sets && <span className="flex items-center gap-1"><RotateCcw className="w-3 h-3" />{ex.sets}×{ex.reps ?? '?'}</span>}
          {ex.duration_sec && <span className="flex items-center gap-1"><Timer className="w-3 h-3" />{formatDuration(ex.duration_sec)}</span>}
          {ex.video_url && <Play className="w-3.5 h-3.5 text-brand-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--border)] pt-3 space-y-3">
          {ex.description && (
            <p className="text-sm text-slate-300 whitespace-pre-line">{ex.description}</p>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            {ex.sets    && <span>Sets: <b className="text-white">{ex.sets}</b></span>}
            {ex.reps    && <span>Reps: <b className="text-white">{ex.reps}</b></span>}
            {ex.duration_sec && <span>Duration: <b className="text-white">{formatDuration(ex.duration_sec)}</b></span>}
          </div>
          {ex.video_url && (
            <a
              href={ex.video_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300"
              onClick={e => e.stopPropagation()}
            >
              <Play className="w-3.5 h-3.5" /> Watch Demo
            </a>
          )}
          <div className="flex gap-2 pt-1">
            <Link
              href={`/admin/exercises/${ex.id}/edit`}
              className="btn-secondary py-1.5 px-3 text-xs"
              onClick={e => e.stopPropagation()}
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Link>
            <button
              onClick={e => { e.stopPropagation(); onDelete(ex); }}
              disabled={deleting}
              className="btn-danger py-1.5 px-3 text-xs"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
        active
          ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
          : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
