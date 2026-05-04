'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { type Athlete, BASEBALL_POSITIONS } from '@/lib/types';
import { ArrowLeft, Save } from 'lucide-react';

export default function EditAthletePage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const [loading, setSaving] = useState(false);
  const [error, setError]    = useState('');
  const [form, setForm]      = useState<Partial<Athlete>>({});
  const [ready, setReady]    = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('athletes').select('*').eq('id', id).single();
      if (data) { setForm(data); setReady(true); }
    }
    load();
  }, [id]);

  function set(key: string, value: string | number | null) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const supabase = createClient();
    const { error: err } = await supabase.from('athletes').update({
      full_name:   form.full_name,
      age:         form.age         ?? null,
      weight_lbs:  form.weight_lbs  ?? null,
      position:    form.position    ?? null,
      access_code: (form.access_code ?? '').toUpperCase(),
      notes:       form.notes       ?? null,
    }).eq('id', id);

    if (err) { setError(err.message); setSaving(false); }
    else router.push(`/admin/athletes/${id}`);
  }

  if (!ready) return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="card h-96 animate-pulse" />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/admin/athletes/${id}`} className="btn-secondary py-2 px-3 text-xs">
          <ArrowLeft className="w-3.5 h-3.5" />
        </Link>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-white">EDIT ATHLETE</h1>
          <p className="text-slate-400 text-sm">{form.full_name}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-sm">{error}</div>
        )}

        <Field label="Full Name *">
          <input type="text" className="input-dark" value={form.full_name ?? ''} onChange={e => set('full_name', e.target.value)} required />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Age">
            <input type="number" className="input-dark" value={form.age ?? ''} onChange={e => set('age', e.target.value ? parseInt(e.target.value) : null)} min={1} max={99} />
          </Field>
          <Field label="Weight (lbs)">
            <input type="number" className="input-dark" value={form.weight_lbs ?? ''} onChange={e => set('weight_lbs', e.target.value ? parseFloat(e.target.value) : null)} step="0.1" />
          </Field>
        </div>

        <Field label="Position">
          <select className="input-dark" value={form.position ?? ''} onChange={e => set('position', e.target.value)}>
            <option value="">Select position…</option>
            {BASEBALL_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>

        <Field label="Access Code" hint="Athletes use this to access their plan.">
          <input
            type="text"
            className="input-dark font-mono tracking-widest uppercase"
            value={form.access_code ?? ''}
            onChange={e => set('access_code', e.target.value.toUpperCase())}
            maxLength={12}
            required
          />
        </Field>

        <Field label="Notes">
          <textarea className="input-dark resize-none" rows={4} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <Link href={`/admin/athletes/${id}`} className="btn-secondary">Cancel</Link>
          <button type="submit" disabled={loading} className="btn-primary">
            <Save className="w-4 h-4" />
            {loading ? 'Saving…' : 'Save Changes'}
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
