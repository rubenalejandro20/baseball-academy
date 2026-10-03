'use client';

/**
 * Shared full-screen states for staff-only route guards (admin, coach, ...).
 * Extracted in Milestone 4 so the new Coach Portal guard doesn't duplicate
 * the "checking"/"not linked" markup that previously lived only inline in
 * admin/layout.tsx — appearance and behavior for those two are unchanged.
 * `ForbiddenScreen` is new: the UX counterpart to the Milestone 4 RLS
 * cutover (0008) for a staff member whose role isn't permitted in the
 * portal they've navigated to (e.g. a plain coach at `/admin`, or a plain
 * physician at `/coach`). RLS remains the real security boundary; this is
 * only the corresponding explained-denial screen, same spirit as
 * `NotLinkedScreen` not being a silent bounce to login.
 */

export function CheckingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B1426]">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function NotLinkedScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B1426] px-4">
      <div className="card p-8 max-w-sm text-center">
        <h1 className="font-display text-xl font-bold text-white tracking-wide mb-2">
          ACCOUNT NOT LINKED
        </h1>
        <p className="text-sm text-slate-400">
          Your login was successful, but this account isn&apos;t linked to an academy yet.
          Contact your administrator or platform support.
        </p>
        <button onClick={onLogout} className="btn-secondary mt-6 mx-auto">
          Sign out
        </button>
      </div>
    </div>
  );
}

export function ForbiddenScreen({ onLogout, message }: { onLogout: () => void; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B1426] px-4">
      <div className="card p-8 max-w-sm text-center">
        <h1 className="font-display text-xl font-bold text-white tracking-wide mb-2">
          ACCESS NOT AVAILABLE
        </h1>
        <p className="text-sm text-slate-400">{message}</p>
        <button onClick={onLogout} className="btn-secondary mt-6 mx-auto">
          Sign out
        </button>
      </div>
    </div>
  );
}
