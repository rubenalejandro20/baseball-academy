'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { type Athlete } from '@/lib/types';
import { Plus, Search, ChevronRight, CalendarDays } from 'lucide-react';
import { AthleteAvatar } from '@/components/admin/AthleteAvatar';

type Filter = 'active' | 'inactive' | 'all';

export default function AthletesPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [query, setQuery]       = useState('');
  const [filter, setFilter]     = useState<Filter>('active');
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('athletes')
        .select('*')
        .order('full_name');
      setAthletes(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const activeCount   = athletes.filter(a => a.is_active).length;
  const inactiveCount = athletes.filter(a => !a.is_active).length;

  const filtered = athletes.filter(a => {
    const matchesFilter =
      filter === 'all' ? true :
      filter === 'active' ? a.is_active :
      !a.is_active;
    const matchesQuery =
      a.full_name.toLowerCase().includes(query.toLowerCase()) ||
      (a.position ?? '').toLowerCase().includes(query.toLowerCase());
    return matchesFilter && matchesQuery;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-wide text-white">ATHLETES</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {activeCount} active · {inactiveCount} inactive
          </p>
        </div>
        <Link href="/admin/athletes/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add Athlete</span>
        </Link>
      </div>

      {/* Filters + Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          {(['active', 'inactive', 'all'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${
                filter === f
                  ? 'bg-brand-500 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or position…"
            className="input-dark pl-9"
          />
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-5 h-32 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-slate-500 mb-4">
            {query ? 'No athletes match your search.' : `No ${filter === 'all' ? '' : filter} athletes yet.`}
          </p>
          {!query && filter !== 'inactive' && (
            <Link href="/admin/athletes/new" className="btn-primary">
              <Plus className="w-4 h-4" /> Add First Athlete
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(athlete => (
            <AthleteCard key={athlete.id} athlete={athlete} />
          ))}
        </div>
      )}
    </div>
  );
}

function AthleteCard({ athlete }: { athlete: Athlete }) {
  return (
    <div className={`card card-hover p-5 group flex flex-col gap-4 ${!athlete.is_active ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <AthleteAvatar athlete={athlete} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white truncate">{athlete.full_name}</h3>
            {!athlete.is_active && (
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                Inactive
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400">
            {athlete.position ?? 'No position'}
            {athlete.age ? ` · ${athlete.age} yrs` : ''}
          </p>
          {athlete.weight_lbs && (
            <p className="text-xs text-slate-500">{athlete.weight_lbs} lbs</p>
          )}
        </div>
      </div>

      {athlete.notes && (
        <p className="text-xs text-slate-500 line-clamp-2 border-t border-[var(--border)] pt-3">
          {athlete.notes}
        </p>
      )}

      <div className="flex items-center gap-2 mt-auto">
        <Link
          href={`/admin/athletes/${athlete.id}`}
          className="flex-1 btn-secondary justify-center text-xs py-2"
        >
          <ChevronRight className="w-3.5 h-3.5" /> Profile
        </Link>
        <Link
          href={`/admin/assignments/${athlete.id}`}
          className="flex-1 btn-primary justify-center text-xs py-2"
        >
          <CalendarDays className="w-3.5 h-3.5" /> Plan
        </Link>
      </div>
    </div>
  );
}
