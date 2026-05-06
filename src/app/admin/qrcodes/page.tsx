'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { type Athlete } from '@/lib/types';
import { AthleteAvatar } from '@/components/admin/AthleteAvatar';
import { QrCode } from 'lucide-react';

export default function QRCodesPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading]   = useState(true);
  const [appUrl, setAppUrl]     = useState('');

  useEffect(() => {
    setAppUrl(window.location.origin);
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('athletes').select('*').eq('is_active', true).order('full_name');
      setAthletes(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white">QR CODES</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Print or display these so athletes can scan and access their exercise plan.
        </p>
      </div>

      <div className="card p-5 border-brand-500/20 bg-brand-500/5">
        <div className="flex items-start gap-3">
          <QrCode className="w-5 h-5 text-brand-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-white">How it works</p>
            <p className="text-xs text-slate-400 mt-1">
              Athletes scan the QR code → land on the access page → enter their PIN code → see their weekly exercises.
              The QR code points to: <code className="text-brand-400 bg-brand-500/10 px-1 rounded">{appUrl}/athlete</code>
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="card h-48 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {athletes.map(a => (
            <AthleteQRCard key={a.id} athlete={a} appUrl={appUrl} />
          ))}
        </div>
      )}
    </div>
  );
}

function AthleteQRCard({ athlete, appUrl }: { athlete: Athlete; appUrl: string }) {
  const qrUrl = `${appUrl}/athlete`;
  // Encode for QR API
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}&bgcolor=ffffff&color=CC0000&margin=12`;

  return (
    <div className="card p-5 text-center flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        <AthleteAvatar athlete={athlete} size="sm" />
        <div className="text-left">
          <p className="text-sm font-semibold text-white leading-tight">{athlete.full_name}</p>
          <p className="text-xs text-slate-500">{athlete.position ?? 'No position'}</p>
        </div>
      </div>

      {/* QR Code */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrApiUrl}
        alt={`QR code for ${athlete.full_name}`}
        className="w-40 h-40 rounded-xl border border-white/10"
      />

      <div>
        <p className="text-xs text-slate-500 mb-1">PIN Code</p>
        <span className="font-mono text-xl font-bold tracking-[0.2em] text-brand-400 bg-brand-500/10 border border-brand-500/20 rounded-lg px-3 py-1.5 inline-block">
          {athlete.access_code}
        </span>
      </div>

      <button
        onClick={() => window.print()}
        className="btn-secondary text-xs py-1.5 px-3 w-full justify-center"
      >
        Print
      </button>
    </div>
  );
}
