import Link from 'next/link';

interface EmptyStateProps {
  label: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export function EmptyState({ label, ctaLabel, ctaHref }: EmptyStateProps) {
  return (
    <div className="text-center py-8">
      <p className="text-slate-500 text-sm mb-3">{label}</p>
      {ctaLabel && ctaHref && (
        <Link href={ctaHref} className="btn-primary text-xs py-2 px-3 inline-flex">
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
