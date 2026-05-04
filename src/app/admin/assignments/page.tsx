'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { type Athlete } from '@/lib/types';
import { AthleteAvatar } from '@/components/admin/AthleteAvatar';
import { CalendarDays, Search, ChevronRight } from 'lucide-react';

export default function AssignmentsIndexPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [query, setQuery]       = useState('');
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('athletes').select('*').eq('is_active', true).order('full_name');
      setAthletes(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = athletes.filter(a =>
    a.full_name.toLowerCase().includes(query.toLowerCase()) ||
    (a.position ?? '').toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white">WEEKLY PLANS</h1>
        <p className="text-slate-400 text-sm mt-0.5">Select an athlete to manage their exercises</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search athletes…"
          className="input-dark pl-9"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card h-16 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-500">
            {query ? 'No athletes match your search.' : 'No athletes found.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(a => (
            <Link
              key={a.id}
              href={`/admin/assignments/${a.id}`}
              className="card card-hover flex items-center gap-4 p-4 group"
            >
              <AthleteAvatar athlete={a} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white">{a.full_name}</p>
                <p className="text-xs text-slate-500">{a.position ?? 'No position'}</p>
              </div>
              <div className="flex items-center gap-2 text-slate-500 group-hover:text-brand-400 transition-colors">
                <CalendarDays className="w-4 h-4" />
                <span className="text-xs hidden sm:inline">Manage Plan</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
