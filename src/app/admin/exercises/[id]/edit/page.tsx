'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { type Exercise, type ExerciseCategory, CATEGORY_LABELS } from '@/lib/types';
import { ArrowLeft, Save } from 'lucide-react';

export default function EditExercisePage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const [loading, setSaving] = useState(false);
  const [error, setError]    = useState('');
  const [form, setForm]      = useState<Partial<Exercise> & { duration_min?: string; duration_sec_part?: string }>({});
  const [ready, setReady]    = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('exercises').select('*').eq('id', id).single();
      if (data) {
        const min = data.duration_sec ? Math.floor(data.duration_sec / 60).toString() : '';
        const sec = data.duration_sec ? (data.duration_sec % 60).toString() : '';
        setForm({ ...data, duration_min: min, duration_sec_part: sec });
        setReady(true);
      }
    }
    load();
  }, [id]);

  function set(key: string, value: unknown) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);

    const durSec =
      ((form.duration_min ? parseInt(form.duration_min as string) : 0) * 60) +
      (form.duration_sec_part ? parseInt(form.duration_sec_part as string) : 0);

    const supabase = createClient();
    const { error: err } = await supabase.from('exercises').update({
      name:         form.name,
      category:     form.category,
      description:  form.description ?? null,
      sets:         form.sets ?? null,
      reps:         form.reps ?? null,
      duration_sec: durSec || null,
      video_url:    form.video_url ?? null,
    }).eq('id', id);

    if (err) { setError(err.message); setSaving(false); }
    else router.push('/admin/exercises');
  }

  if (!ready) return <div className="max-w-2xl mx-auto card h-96 animate-pulse" />;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/exercises" className="btn-secondary py-2 px-3 text-xs">
          <ArrowLeft className="w-3.5 h-3.5" />
        </Link>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-white">EDIT EXERCISE</h1>
          <p className="text-slate-400 text-sm">{form.name}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-sm">{error}</div>
        )}

        <Field label="Exercise Name *">
          <input type="text" className="input-dark" value={form.name ?? ''} onChange={e => set('name', e.target.value)} required />
        </Field>

        <Field label="Category *">
          <select className="input-dark" value={form.category ?? ''} onChange={e => set('category', e.target.value as ExerciseCategory)}>
            {(Object.entries(CATEGORY_LABELS) as [ExerciseCategory, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>

        <Field label="Description / Instructions">
          <textarea className="input-dark resize-none" rows={5} value={form.description ?? ''} onChange={e => set('description', e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Sets">
            <input type="number" className="input-dark" value={form.sets ?? ''} onChange={e => set('sets', e.target.value ? parseInt(e.target.value) : null)} min={1} />
          </Field>
          <Field label="Reps">
            <input type="number" className="input-dark" value={form.reps ?? ''} onChange={e => set('reps', e.target.value ? parseInt(e.target.value) : null)} min={1} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Duration – Minutes">
            <input type="number" className="input-dark" value={(form as any).duration_min ?? ''} onChange={e => set('duration_min', e.target.value)} min={0} />
          </Field>
          <Field label="Duration – Seconds">
            <input type="number" className="input-dark" value={(form as any).duration_sec_part ?? ''} onChange={e => set('duration_sec_part', e.target.value)} min={0} max={59} />
          </Field>
        </div>

        <Field label="Video / Demo URL">
          <input type="url" className="input-dark" value={form.video_url ?? ''} onChange={e => set('video_url', e.target.value)} placeholder="https://youtube.com/…" />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <Link href="/admin/exercises" className="btn-secondary">Cancel</Link>
          <button type="submit" disabled={loading} className="btn-primary">
            <Save className="w-4 h-4" /> {loading ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}
