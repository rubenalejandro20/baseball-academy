'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { getStaffContext } from '@/lib/auth/getStaffContext';
import { BASEBALL_POSITIONS } from '@/lib/types';
import { ArrowLeft, Save } from 'lucide-react';

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default function NewAthletePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const [form, setForm] = useState({
    full_name:   '',
    age:         '',
    weight_lbs:  '',
    position:    '',
    access_code: generateCode(),
    notes:       '',
  });

  function set(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) { setError('Full name is required.'); return; }
    setError('');
    setLoading(true);

    const staffContext = await getStaffContext();
    if (staffContext.status !== 'ok') {
      setError('Your account is not linked to an academy. Contact your administrator.');
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { data, error: err } = await supabase.from('athletes').insert({
      full_name:       form.full_name.trim(),
      age:             form.age         ? parseInt(form.age)          : null,
      weight_lbs:      form.weight_lbs  ? parseFloat(form.weight_lbs) : null,
      position:        form.position    || null,
      access_code:     form.access_code.trim().toUpperCase(),
      notes:           form.notes       || null,
      organization_id: staffContext.organizationId,
    }).select().single();

    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      router.push(`/admin/athletes/${data.id}`);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/athletes" className="btn-secondary py-2 px-3 text-xs">
          <ArrowLeft className="w-3.5 h-3.5" />
        </Link>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-white">NEW ATHLETE</h1>
          <p className="text-slate-400 text-sm">Create a new athlete profile</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Full name */}
        <Field label="Full Name *">
          <input
            type="text"
            className="input-dark"
            value={form.full_name}
            onChange={e => set('full_name', e.target.value)}
            placeholder="Carlos Rivera"
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          {/* Age */}
          <Field label="Age">
            <input
              type="number"
              className="input-dark"
              value={form.age}
              onChange={e => set('age', e.target.value)}
              placeholder="22"
              min={1}
              max={99}
            />
          </Field>

          {/* Weight */}
          <Field label="Weight (lbs)">
            <input
              type="number"
              className="input-dark"
              value={form.weight_lbs}
              onChange={e => set('weight_lbs', e.target.value)}
              placeholder="185"
              step="0.1"
              min={0}
            />
          </Field>
        </div>

        {/* Position */}
        <Field label="Position">
          <select
            className="input-dark"
            value={form.position}
            onChange={e => set('position', e.target.value)}
          >
            <option value="">Select position…</option>
            {BASEBALL_POSITIONS.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>

        {/* Access code */}
        <Field
          label="Athlete Access Code"
          hint="Athletes use this PIN to access their exercise plan."
        >
          <div className="flex gap-2">
            <input
              type="text"
              className="input-dark font-mono tracking-widest uppercase"
              value={form.access_code}
              onChange={e => set('access_code', e.target.value.toUpperCase())}
              maxLength={12}
              placeholder="ABC123"
              required
            />
            <button
              type="button"
              className="btn-secondary px-3 text-xs whitespace-nowrap"
              onClick={() => set('access_code', generateCode())}
            >
              Regenerate
            </button>
          </div>
        </Field>

        {/* Notes */}
        <Field label="Notes">
          <textarea
            className="input-dark resize-none"
            rows={4}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Injury history, special considerations, goals…"
          />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <Link href="/admin/athletes" className="btn-secondary">Cancel</Link>
          <button type="submit" disabled={loading} className="btn-primary">
            <Save className="w-4 h-4" />
            {loading ? 'Saving…' : 'Create Athlete'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {hint && <p className="text-xs text-slate-500 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}
