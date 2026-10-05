'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { getStaffContext } from '@/lib/auth/getStaffContext';
import {
  type CoachAvailability, type CoachBlock, type DayOfWeek,
  DAYS_OF_WEEK, DAY_LABELS, formatTime12h,
} from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useToast } from '@/components/ui/Toast';
import { Plus, Pencil, Trash2, Pause, Play } from 'lucide-react';

type LoadState = 'loading' | 'error' | 'ready';

export default function CoachAvailabilityPage() {
  const { showToast } = useToast();
  const [state, setState]       = useState<LoadState>('loading');
  const [coachId, setCoachId]   = useState<string | null>(null);
  const [orgId, setOrgId]       = useState<string | null>(null);
  const [availability, setAvailability] = useState<CoachAvailability[]>([]);
  const [blocks, setBlocks]     = useState<CoachBlock[]>([]);

  const [windowSheet, setWindowSheet] = useState<{ day: DayOfWeek; editing: CoachAvailability | null } | null>(null);
  const [windowDeleteTarget, setWindowDeleteTarget] = useState<CoachAvailability | null>(null);
  const [windowSaving, setWindowSaving] = useState(false);

  const [blockSheet, setBlockSheet] = useState<{ editing: CoachBlock | null } | null>(null);
  const [blockDeleteTarget, setBlockDeleteTarget] = useState<CoachBlock | null>(null);
  const [blockSaving, setBlockSaving] = useState(false);

  async function load() {
    setState('loading');
    const staffContext = await getStaffContext();
    if (staffContext.status !== 'ok' || !staffContext.staffProfileId) {
      setState('error');
      return;
    }
    setCoachId(staffContext.staffProfileId);
    setOrgId(staffContext.organizationId);

    const supabase = createClient();
    // Explicitly scoped by coach_id, same reasoning as My Services — an
    // administrator/Super User visiting this page should see THEIR OWN
    // (typically empty) availability, not every coach's via their
    // broader org-wide RLS policy.
    const [availRes, blocksRes] = await Promise.all([
      supabase.from('coach_availability').select('*').eq('coach_id', staffContext.staffProfileId),
      supabase.from('coach_blocks').select('*').eq('coach_id', staffContext.staffProfileId).order('start_at'),
    ]);

    if (availRes.error || blocksRes.error) {
      setState('error');
      return;
    }
    setAvailability((availRes.data ?? []) as CoachAvailability[]);
    setBlocks((blocksRes.data ?? []) as CoachBlock[]);
    setState('ready');
  }

  useEffect(() => { load(); }, []);

  // ── Availability window mutations (direct RLS-protected CRUD) ──
  async function saveWindow(day: DayOfWeek, startTime: string, endTime: string, editing: CoachAvailability | null) {
    if (!coachId || !orgId) return;
    const supabase = createClient();
    if (editing) {
      const { error } = await supabase.from('coach_availability')
        .update({ start_time: startTime, end_time: endTime })
        .eq('id', editing.id);
      if (error) {
        showToast('Couldn\'t save this window. Try again.', 'error');
        return;
      }
      setAvailability(prev => prev.map(a => a.id === editing.id ? { ...a, start_time: startTime, end_time: endTime } : a));
      showToast('Availability updated.', 'success');
    } else {
      const { data, error } = await supabase.from('coach_availability')
        .insert({ organization_id: orgId, coach_id: coachId, day_of_week: day, start_time: startTime, end_time: endTime })
        .select('*')
        .single();
      if (error || !data) {
        showToast('Couldn\'t add this window. Try again.', 'error');
        return;
      }
      setAvailability(prev => [...prev, data as CoachAvailability]);
      showToast('Availability window added.', 'success');
    }
    setWindowSheet(null);
  }

  async function toggleWindow(w: CoachAvailability) {
    const supabase = createClient();
    const nextActive = !w.is_active;
    const { error } = await supabase.from('coach_availability').update({ is_active: nextActive }).eq('id', w.id);
    if (error) {
      showToast('Couldn\'t update this window. Try again.', 'error');
      return;
    }
    setAvailability(prev => prev.map(a => a.id === w.id ? { ...a, is_active: nextActive } : a));
  }

  async function deleteWindow(w: CoachAvailability) {
    const supabase = createClient();
    const { error } = await supabase.from('coach_availability').delete().eq('id', w.id);
    setWindowDeleteTarget(null);
    if (error) {
      showToast('Couldn\'t remove this window. Try again.', 'error');
      return;
    }
    setAvailability(prev => prev.filter(a => a.id !== w.id));
    showToast('Window removed.', 'success');
  }

  // ── Time-off block mutations (direct RLS-protected CRUD) ──
  async function saveBlock(startAt: string, endAt: string, reason: string, editing: CoachBlock | null) {
    if (!coachId || !orgId) return;
    const supabase = createClient();
    const reasonValue = reason.trim() || null;
    if (editing) {
      const { error } = await supabase.from('coach_blocks')
        .update({ start_at: startAt, end_at: endAt, reason: reasonValue })
        .eq('id', editing.id);
      if (error) {
        showToast('Couldn\'t save this time off. Try again.', 'error');
        return;
      }
      setBlocks(prev =>
        prev.map(b => b.id === editing.id ? { ...b, start_at: startAt, end_at: endAt, reason: reasonValue } : b)
          .sort((a, b) => a.start_at.localeCompare(b.start_at))
      );
      showToast('Time off updated.', 'success');
    } else {
      const { data, error } = await supabase.from('coach_blocks')
        .insert({ organization_id: orgId, coach_id: coachId, start_at: startAt, end_at: endAt, reason: reasonValue })
        .select('*')
        .single();
      if (error || !data) {
        showToast('Couldn\'t add this time off. Try again.', 'error');
        return;
      }
      setBlocks(prev => [...prev, data as CoachBlock].sort((a, b) => a.start_at.localeCompare(b.start_at)));
      showToast('Time off added.', 'success');
    }
    setBlockSheet(null);
  }

  async function deleteBlock(b: CoachBlock) {
    const supabase = createClient();
    const { error } = await supabase.from('coach_blocks').delete().eq('id', b.id);
    setBlockDeleteTarget(null);
    if (error) {
      showToast('Couldn\'t remove this time off. Try again.', 'error');
      return;
    }
    setBlocks(prev => prev.filter(x => x.id !== b.id));
    showToast('Time off removed.', 'success');
  }

  if (state === 'loading') {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Card className="p-6"><SkeletonRows rows={5} /></Card>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="max-w-3xl mx-auto">
        <Card className="p-6">
          <p className="text-sm text-red-400">Couldn&apos;t load your availability. Try refreshing the page.</p>
        </Card>
      </div>
    );
  }

  const byDay = new Map<DayOfWeek, CoachAvailability[]>();
  for (const day of DAYS_OF_WEEK) byDay.set(day, []);
  for (const w of availability) byDay.get(w.day_of_week)?.push(w);
  Array.from(byDay.values()).forEach(list => list.sort((a, b) => a.start_time.localeCompare(b.start_time)));

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white">AVAILABILITY</h1>
        <p className="text-slate-400 text-sm mt-0.5">Your recurring weekly hours and time off.</p>
      </div>

      {/* Weekly hours */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold tracking-wide text-white">WEEKLY HOURS</h2>
        <div className="space-y-2">
          {DAYS_OF_WEEK.map(day => (
            <DayCard
              key={day}
              day={day}
              windows={byDay.get(day) ?? []}
              onAdd={() => setWindowSheet({ day, editing: null })}
              onEdit={w => setWindowSheet({ day, editing: w })}
              onToggle={toggleWindow}
              onDelete={w => setWindowDeleteTarget(w)}
            />
          ))}
        </div>
      </section>

      {/* Time off */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold tracking-wide text-white">TIME OFF</h2>
          <Button variant="secondary" className="text-xs py-1.5 px-3" onClick={() => setBlockSheet({ editing: null })}>
            <Plus className="w-3.5 h-3.5" /> Add Time Off
          </Button>
        </div>
        {blocks.length === 0 ? (
          <Card className="p-2"><EmptyState label="No time off scheduled." /></Card>
        ) : (
          <div className="space-y-2">
            {blocks.map(b => (
              <BlockRow key={b.id} block={b} onEdit={() => setBlockSheet({ editing: b })} onDelete={() => setBlockDeleteTarget(b)} />
            ))}
          </div>
        )}
      </section>

      {windowSheet && (
        <WindowSheet
          day={windowSheet.day}
          editing={windowSheet.editing}
          saving={windowSaving}
          onSave={async (start, end) => {
            setWindowSaving(true);
            await saveWindow(windowSheet.day, start, end, windowSheet.editing);
            setWindowSaving(false);
          }}
          onClose={() => setWindowSheet(null)}
        />
      )}

      <ConfirmDialog
        open={!!windowDeleteTarget}
        title="Remove availability window?"
        message={windowDeleteTarget
          ? `Remove ${formatTime12h(windowDeleteTarget.start_time)} – ${formatTime12h(windowDeleteTarget.end_time)} on ${DAY_LABELS[windowDeleteTarget.day_of_week]}?`
          : ''}
        confirmLabel="Remove"
        danger
        onConfirm={() => windowDeleteTarget && deleteWindow(windowDeleteTarget)}
        onCancel={() => setWindowDeleteTarget(null)}
      />

      {blockSheet && (
        <BlockSheet
          editing={blockSheet.editing}
          saving={blockSaving}
          onSave={async (startAt, endAt, reason) => {
            setBlockSaving(true);
            await saveBlock(startAt, endAt, reason, blockSheet.editing);
            setBlockSaving(false);
          }}
          onClose={() => setBlockSheet(null)}
        />
      )}

      <ConfirmDialog
        open={!!blockDeleteTarget}
        title="Remove time off?"
        message={blockDeleteTarget ? `Remove this time off${blockDeleteTarget.reason ? ` (${blockDeleteTarget.reason})` : ''}?` : ''}
        confirmLabel="Remove"
        danger
        onConfirm={() => blockDeleteTarget && deleteBlock(blockDeleteTarget)}
        onCancel={() => setBlockDeleteTarget(null)}
      />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────

function DayCard({ day, windows, onAdd, onEdit, onToggle, onDelete }: {
  day: DayOfWeek;
  windows: CoachAvailability[];
  onAdd: () => void;
  onEdit: (w: CoachAvailability) => void;
  onToggle: (w: CoachAvailability) => void;
  onDelete: (w: CoachAvailability) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white text-sm">{DAY_LABELS[day]}</h3>
        <button
          onClick={onAdd}
          className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {windows.length === 0 ? (
        <p className="text-sm text-slate-500 mt-2">Unavailable</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {windows.map(w => (
            <div
              key={w.id}
              className={`flex items-center justify-between gap-2 p-2 rounded-lg ${w.is_active ? 'bg-white/4' : 'bg-white/2'}`}
            >
              <span className={`text-sm flex items-center gap-2 ${w.is_active ? 'text-slate-200' : 'text-slate-500'}`}>
                {formatTime12h(w.start_time)} – {formatTime12h(w.end_time)}
                {!w.is_active && <Badge tone="neutral">Paused</Badge>}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onToggle(w)}
                  aria-label={w.is_active ? 'Pause this window' : 'Resume this window'}
                  className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-white/10"
                >
                  {w.is_active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => onEdit(w)}
                  aria-label="Edit this window"
                  className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-white/10"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDelete(w)}
                  aria-label="Delete this window"
                  className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function BlockRow({ block, onEdit, onDelete }: {
  block: CoachBlock;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const start = new Date(block.start_at);
  const end   = new Date(block.end_at);
  const sameDay = start.toDateString() === end.toDateString();
  const dateLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const timeLabel = sameDay
    ? `${start.toLocaleTimeString('en-US', timeOpts)} – ${end.toLocaleTimeString('en-US', timeOpts)}`
    : `${start.toLocaleString('en-US', { month: 'short', day: 'numeric', ...timeOpts })} – ${end.toLocaleString('en-US', { month: 'short', day: 'numeric', ...timeOpts })}`;

  return (
    <Card className="p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{sameDay ? dateLabel : `${dateLabel} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}</p>
        <p className="text-xs text-slate-400 mt-0.5">{timeLabel}</p>
        {block.reason && <p className="text-xs text-slate-500 mt-1">{block.reason}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onEdit} aria-label="Edit this time off" className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-white/10">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} aria-label="Delete this time off" className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </Card>
  );
}

function WindowSheet({ day, editing, saving, onSave, onClose }: {
  day: DayOfWeek;
  editing: CoachAvailability | null;
  saving: boolean;
  onSave: (start: string, end: string) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(editing ? editing.start_time.slice(0, 5) : '09:00');
  const [end, setEnd]     = useState(editing ? editing.end_time.slice(0, 5) : '17:00');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (end <= start) {
      setError('End time must be after start time.');
      return;
    }
    setError('');
    onSave(start, end);
  }

  return (
    <BottomSheet open title={`${editing ? 'Edit' : 'Add'} Window – ${DAY_LABELS[day]}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start" type="time" value={start} onChange={e => setStart(e.target.value)} required />
          <Input label="End" type="time" value={end} onChange={e => setEnd(e.target.value)} required />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving}>{editing ? 'Save' : 'Add'}</Button>
        </div>
      </form>
    </BottomSheet>
  );
}

function BlockSheet({ editing, saving, onSave, onClose }: {
  editing: CoachBlock | null;
  saving: boolean;
  onSave: (startAt: string, endAt: string, reason: string) => void;
  onClose: () => void;
}) {
  const [start, setStart]   = useState(editing ? toDatetimeLocal(editing.start_at) : '');
  const [end, setEnd]       = useState(editing ? toDatetimeLocal(editing.end_at) : '');
  const [reason, setReason] = useState(editing?.reason ?? '');
  const [error, setError]   = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!start || !end) {
      setError('Start and end are required.');
      return;
    }
    if (new Date(end) <= new Date(start)) {
      setError('End must be after start.');
      return;
    }
    setError('');
    onSave(new Date(start).toISOString(), new Date(end).toISOString(), reason);
  }

  return (
    <BottomSheet open title={editing ? 'Edit Time Off' : 'Add Time Off'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-xs text-red-400">{error}</p>}
        <Input label="Starts" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} required />
        <Input label="Ends" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} required />
        <Input
          label="Reason (optional)"
          type="text"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Doctor appointment"
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving}>{editing ? 'Save' : 'Add'}</Button>
        </div>
      </form>
    </BottomSheet>
  );
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
