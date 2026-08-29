interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  rows?: number;
}

export function Skeleton({ className = '', ...rest }: SkeletonProps) {
  return <div className={`bg-white/5 rounded-lg animate-pulse ${className}`.trim()} {...rest} />;
}

export function SkeletonRows({ rows = 3, className = '' }: SkeletonProps) {
  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}
