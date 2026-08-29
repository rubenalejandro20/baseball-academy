'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { getStaffContext } from '@/lib/auth/getStaffContext';
import { type ExerciseCategory, CATEGORY_LABELS } from '@/lib/types';
import { ArrowLeft, Save } from 'lucide-react';

export default function NewExercisePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [form, setForm] = useState({
    name:         '',
    category:     'mobility' as ExerciseCategory,
    description:  '',
    sets:         '',
    reps:         '',
    duration_min: '',
    duration_sec: '',
    video_url:    '',
  });

  function set(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setError('');
    setLoading(true);

    const durSec = (form.duration_min ? parseInt(form.duration_min) * 60 : 0)
                 + (form.duration_sec ? parseInt(form.duration_sec) : 0);

    const staffContext = await getStaffContext();
    if (staffContext.status !== 'ok') {
      setError('Your account is not linked to an academy. Contact your administrator.');
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: err } = await supabase.from('exercises').insert({
      name:            form.name.trim(),
      category:        form.category,
      description:     form.description || null,
      sets:            form.sets ? parseInt(form.sets) : null,
      reps:            form.reps ? parseInt(form.reps) : null,
      duration_sec:    durSec || null,
      video_url:       form.video_url || null,
      organization_id: staffContext.organizationId,
    });

    if (err) { setError(err.message); setLoading(false); }
    else router.push('/admin/exercises');
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/exercises" className="btn-secondary py-2 px-3 text-xs">
          <ArrowLeft className="w-3.5 h-3.5" />
        </Link>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-white">NEW EXERCISE</h1>
          <p className="text-slate-400 text-sm">Add to the library</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-sm">{error}</div>
        )}

        <Field label="Exercise Name *">
          <input type="text" className="input-dark" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Hip Flexor Stretch" required />
        </Field>

        <Field label="Category *">
          <select className="input-dark" value={form.category} onChange={e => set('category', e.target.value)}>
            {(Object.entries(CATEGORY_LABELS) as [ExerciseCategory, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>

        <Field label="Description / Instructions">
          <textarea
            className="input-dark resize-none"
            rows={5}
            value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Step-by-step instructions for performing the exercise correctly…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Sets">
            <input type="number" className="input-dark" value={form.sets} onChange={e => set('sets', e.target.value)} placeholder="3" min={1} />
          </Field>
          <Field label="Reps">
            <input type="number" className="input-dark" value={form.reps} onChange={e => set('reps', e.target.value)} placeholder="12" min={1} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Duration – Minutes">
            <input type="number" className="input-dark" value={form.duration_min} onChange={e => set('duration_min', e.target.value)} placeholder="1" min={0} />
          </Field>
          <Field label="Duration – Seconds">
            <input type="number" className="input-dark" value={form.duration_sec} onChange={e => set('duration_sec', e.target.value)} placeholder="30" min={0} max={59} />
          </Field>
        </div>

        <Field label="Video / Demo URL" hint="YouTube or any public video link">
          <input type="url" className="input-dark" value={form.video_url} onChange={e => set('video_url', e.target.value)} placeholder="https://youtube.com/…" />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <Link href="/admin/exercises" className="btn-secondary">Cancel</Link>
          <button type="submit" disabled={loading} className="btn-primary">
            <Save className="w-4 h-4" />
            {loading ? 'Saving…' : 'Add Exercise'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}
