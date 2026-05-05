'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import {
  type ActivityType, type ExerciseCategory,
  ACTIVITIES, ACTIVITY_LABELS, CATEGORY_LABELS, CATEGORY_COLORS, SESSION_TYPES,
} from '@/lib/types';
import { ChevronRight } from 'lucide-react';

type SlotCounts = Record<string, number>;

export default function RoutinesPage() {
  const [counts, setCounts]   = useState<SlotCounts>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('activity_routines')
        .select('activity, session_type');

      const c: SlotCounts = {};
      for (const row of data ?? []) {
        const key = `${row.activity}__${row.session_type}`;
        c[key] = (c[key] ?? 0) + 1;
      }
      setCounts(c);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white">ROUTINES</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Manage exercise routines for each activity and session type
        </p>
      </div>

      {ACTIVITIES.map(activity => (
        <section key={activity}>
          <h2 className="font-display text-lg font-bold tracking-widest text-slate-300 uppercase mb-3">
            {ACTIVITY_LABELS[activity]}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {SESSION_TYPES.map(sessionType => {
              const count = counts[`${activity}__${sessionType}`] ?? 0;
              return (
                <Link
                  key={sessionType}
                  href={`/admin/routines/${activity}/${sessionType}`}
                  className="card card-hover p-4 flex flex-col gap-3"
                >
                  <span className={`badge text-[10px] self-start ${CATEGORY_COLORS[sessionType]}`}>
                    {CATEGORY_LABELS[sessionType]}
                  </span>
                  <div className="flex items-end justify-between mt-auto">
                    {loading ? (
                      <div className="h-7 w-6 bg-white/5 rounded animate-pulse" />
                    ) : (
                      <p className="font-display text-2xl font-bold text-white leading-none">
                        {count}
                      </p>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                  </div>
                  <p className="text-[11px] text-slate-500 -mt-2">exercises</p>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
