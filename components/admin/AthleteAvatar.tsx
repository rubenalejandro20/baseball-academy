import { type Athlete } from '@/lib/types';

export function AthleteAvatar({
  athlete, size = 'md',
}: {
  athlete: Pick<Athlete, 'full_name' | 'photo_url'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-16 h-16 text-xl' };
  const initials = athlete.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  if (athlete.photo_url) {
    return (
      <img
        src={athlete.photo_url}
        alt={athlete.full_name}
        className={`${sizes[size]} rounded-full object-cover border border-white/10 shrink-0`}
      />
    );
  }
  return (
    <div className={`${sizes[size]} rounded-full bg-brand-500/15 border border-brand-500/25 flex items-center justify-center font-semibold text-brand-400 shrink-0 font-display`}>
      {initials}
    </div>
  );
}
