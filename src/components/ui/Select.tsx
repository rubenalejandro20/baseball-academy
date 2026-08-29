'use client';

import { forwardRef, useId } from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, hint, error, className = '', id, children, ...rest }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    return (
      <div>
        {label && (
          <label htmlFor={selectId} className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            {label}
          </label>
        )}
        {hint && !error && <p className="text-xs text-slate-500 mb-1.5">{hint}</p>}
        <select ref={ref} id={selectId} className={`input-dark ${className}`.trim()} {...rest}>
          {children}
        </select>
        {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';
