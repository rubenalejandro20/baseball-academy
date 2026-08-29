type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-white/10 text-slate-300 border-white/15',
  brand: 'bg-brand-500/15 text-brand-400 border-brand-500/25',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  danger: 'bg-red-500/15 text-red-400 border-red-500/25',
};

export function Badge({ tone = 'neutral', className = '', children, ...rest }: BadgeProps) {
  return (
    <span className={`badge ${TONE_CLASS[tone]} ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}
