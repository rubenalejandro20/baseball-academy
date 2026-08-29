interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  as?: 'div';
}

export function Card({ hover = false, className = '', children, ...rest }: CardProps) {
  return (
    <div className={`card ${hover ? 'card-hover' : ''} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
