'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { getStaffContext } from '@/lib/auth/getStaffContext';
import { type CoachService, formatCents } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { Clock } from 'lucide-react';

type LoadState = 'loading' | 'error' | 'ready';

export default function CoachServicesPage() {
  const { showToast } = useToast();
  const [state, setState]       = useState<LoadState>('loading');
  const [services, setServices] = useState<CoachService[]>([]);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function load() {
    setState('loading');
    const staffContext = await getStaffContext();
    if (staffContext.status !== 'ok' || !staffContext.staffProfileId) {
      setState('error');
      return;
    }

    const supabase = createClient();
    // Explicitly scoped by coach_id — not relying solely on RLS — so an
    // administrator or Super User visiting this page (both allowed in by
    // the Coach Portal guard) see THEIR OWN scope, not every coach's
    // offerings via their broader org-wide policy.
    const { data, error } = await supabase
      .from('coach_services')
      .select('*, service:services(*)')
      .eq('coach_id', staffContext.staffProfileId)
      .order('created_at');

    if (error) {
      setState('error');
      return;
    }
    setServices((data ?? []) as CoachService[]);
    setState('ready');
  }

  useEffect(() => { load(); }, []);

  async function handleToggle(cs: CoachService) {
    setTogglingId(cs.id);
    const supabase = createClient();
    const nextActive = !cs.is_active;
    const { data, error } = await supabase.rpc('set_coach_service_bookable', {
      p_coach_service_id: cs.id,
      p_is_active: nextActive,
    });

    if (error || data !== true) {
      showToast('Couldn’t update this service. Try again.', 'error');
    } else {
      setServices(prev => prev.map(s => s.id === cs.id ? { ...s, is_active: nextActive } : s));
      showToast(nextActive ? 'Service resumed.' : 'Service paused.', 'success');
    }
    setTogglingId(null);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white">MY SERVICES</h1>
        <p className="text-slate-400 text-sm mt-0.5">Services your academy has assigned to you.</p>
      </div>

      {state === 'loading' && (
        <Card className="p-6"><SkeletonRows rows={3} /></Card>
      )}

      {state === 'error' && (
        <Card className="p-6">
          <p className="text-sm text-red-400">Couldn&apos;t load your services. Try refreshing the page.</p>
        </Card>
      )}

      {state === 'ready' && services.length === 0 && (
        <Card className="p-2">
          <EmptyState label="No services assigned yet. Contact your academy administrator." />
        </Card>
      )}

      {state === 'ready' && services.length > 0 && (
        <div className="space-y-3">
          {services.map(cs => (
            <ServiceRow
              key={cs.id}
              coachService={cs}
              onToggle={() => handleToggle(cs)}
              toggling={togglingId === cs.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceRow({ coachService, onToggle, toggling }: {
  coachService: CoachService;
  onToggle: () => void;
  toggling: boolean;
}) {
  const svc = coachService.service;
  if (!svc) return null;

  const effectiveDuration = coachService.duration_minutes ?? svc.default_duration_minutes;
  const effectivePriceCents = coachService.price_cents ?? svc.default_price_cents;
  const durationIsCustom = coachService.duration_minutes !== null;
  const priceIsCustom = coachService.price_cents !== null;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white">{svc.name}</h3>
            <Badge tone={coachService.is_active ? 'success' : 'neutral'}>
              {coachService.is_active ? 'Active' : 'Paused'}
            </Badge>
          </div>
          {svc.description && (
            <p className="text-sm text-slate-400 mt-1">{svc.description}</p>
          )}
          <div className="flex items-center gap-4 flex-wrap mt-3 text-sm text-slate-300">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              {effectiveDuration} min
              {durationIsCustom && <span className="text-[10px] text-brand-400 font-semibold ml-1">CUSTOM</span>}
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-white">
              {effectivePriceCents !== null ? formatCents(effectivePriceCents) : (
                <span className="text-slate-500 font-normal">Price not set</span>
              )}
              {priceIsCustom && effectivePriceCents !== null && (
                <span className="text-[10px] text-brand-400 font-semibold ml-1">CUSTOM</span>
              )}
            </span>
          </div>
        </div>
        <Button
          variant="secondary"
          onClick={onToggle}
          loading={toggling}
          className="shrink-0 text-xs py-2 px-3"
          aria-label={coachService.is_active ? `Pause ${svc.name}` : `Resume ${svc.name}`}
        >
          {coachService.is_active ? 'Pause' : 'Resume'}
        </Button>
      </div>
    </Card>
  );
}
