'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AthleteAccessPage() {
  const router = useRouter();
  const [code, setCode]     = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setError('');
    setLoading(true);
    router.push(`/athlete/${code.trim().toUpperCase()}`);
  }

  return (
    <div className="min-h-screen athlete-page flex flex-col items-center justify-center px-4">
      {/* Background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-emerald-100 rounded-full blur-3xl opacity-50" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-blue-100 rounded-full blur-3xl opacity-40" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white shadow-xl border border-gray-100 mb-5">
            <svg viewBox="0 0 32 32" className="w-10 h-10" fill="none">
              <circle cx="16" cy="16" r="13" stroke="#15803d" strokeWidth="2"/>
              <path d="M9 8c2 2 3 5 3 8s-1 6-3 8" stroke="#15803d" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M23 8c-2 2-3 5-3 8s1 6 3 8" stroke="#15803d" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M3 16h26" stroke="#15803d" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h1
            className="text-3xl font-black tracking-tight text-gray-900"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em' }}
          >
            7AR BASEBALL ACADEMY
          </h1>
          <p className="text-gray-500 text-sm mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Your Performance Program
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl shadow-gray-200/80 p-8 border border-gray-100">
          <h2
            className="text-xl font-black text-gray-900 mb-1"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em' }}
          >
            ENTER YOUR CODE
          </h2>
          <p className="text-sm text-gray-500 mb-6" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Use the access code or PIN provided by your physician.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABC123"
              className="w-full px-4 py-4 text-center text-2xl font-mono font-bold tracking-[0.3em] rounded-2xl border-2 border-gray-200 bg-gray-50 text-gray-900 placeholder-gray-300 focus:outline-none focus:border-green-500 focus:bg-white focus:ring-4 focus:ring-green-500/10 transition-all uppercase"
              maxLength={12}
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full py-4 rounded-2xl text-white font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                letterSpacing: '0.1em',
                background: loading || !code.trim()
                  ? '#9ca3af'
                  : 'linear-gradient(135deg, #16a34a, #15803d)',
              }}
            >
              {loading ? 'LOADING…' : 'VIEW MY EXERCISES'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Need your code?{' '}
          <span className="text-gray-600">Ask your physician or athletic trainer.</span>
        </p>
      </div>
    </div>
  );
}
