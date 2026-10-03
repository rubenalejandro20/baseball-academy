/**
 * Minimal Coach Portal placeholder (Milestone 4). Proves the role-gated
 * shell works end to end; no coach-domain data or features exist yet —
 * those are explicitly out of scope until a later milestone (booking,
 * services, availability).
 */
export default function CoachDashboardPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white">COACH PORTAL</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Scheduling, availability, and bookings are coming in a future milestone.
        </p>
      </div>
      <div className="card p-6">
        <p className="text-sm text-slate-400">
          This is a minimal placeholder confirming role-based routing works end to end.
          Coach, administrator, and Super User accounts can reach this page; physician/trainer
          accounts cannot.
        </p>
      </div>
    </div>
  );
}
