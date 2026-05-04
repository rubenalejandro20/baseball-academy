'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/admin/dashboard');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-[#0B1426]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_-20%,rgba(34,197,94,0.12),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_-10%_80%,rgba(99,102,241,0.08),transparent_50%)]" />

      {/* Diamond pattern dots */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Card */}
      <div className="relative w-full max-w-sm mx-4 animate-slide-up">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-500/15 border border-brand-500/30 mb-4">
            {/* Baseball icon */}
            <svg viewBox="0 0 32 32" className="w-8 h-8" fill="none">
              <circle cx="16" cy="16" r="13" stroke="#22c55e" strokeWidth="2"/>
              <path d="M9 8c2 2 3 5 3 8s-1 6-3 8" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M23 8c-2 2-3 5-3 8s1 6 3 8" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M3 16h26" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-white">
            BASEBALL ACADEMY
          </h1>
          <p className="text-sm text-slate-400 mt-1 font-body">
            Physician & Performance Portal
          </p>
        </div>

        {/* Form card */}
        <div className="card p-8 border-white/10">
          <h2 className="font-display text-xl font-semibold text-white mb-1 tracking-wide">
            ADMIN LOGIN
          </h2>
          <p className="text-xs text-slate-500 mb-6 font-body">
            Sign in with your physician account
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input-dark"
                placeholder="doctor@academy.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input-dark"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center mt-2 py-3 text-base tracking-wide font-display font-semibold"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Signing in…
                </span>
              ) : 'SIGN IN'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/8 text-center">
            <p className="text-xs text-slate-500">
              Athlete?{' '}
              <a href="/athlete" className="text-brand-400 hover:text-brand-300 underline underline-offset-2">
                Access your exercises here
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
