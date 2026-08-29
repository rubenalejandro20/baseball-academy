import Link from 'next/link';

type Tone = 'brand' | 'purple' | 'amber';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  href?: string;
  tone?: Tone;
}

const RING_CLASS: Record<Tone, string> = {
  brand: 'bg-brand-500/10 border-brand-500/20',
  purple: 'bg-purple-500/10 border-purple-500/20',
  amber: 'bg-amber-500/10 border-amber-500/20',
};

export function StatCard({ icon, label, value, sub, href, tone = 'brand' }: StatCardProps) {
  const content = (
    <>
      <div className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${RING_CLASS[tone]}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-display font-bold text-white">{value}</p>
        <p className="text-sm font-medium text-slate-300">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="card card-hover p-5 flex items-start gap-4 group">
        {content}
      </Link>
    );
  }

  return <div className="card p-5 flex items-start gap-4">{content}</div>;
}
