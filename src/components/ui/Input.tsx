'use client';

import { forwardRef, useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, className = '', id, ...rest }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <div>
        {label && (
          <label htmlFor={inputId} className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            {label}
          </label>
        )}
        {hint && !error && <p className="text-xs text-slate-500 mb-1.5">{hint}</p>}
        <input ref={ref} id={inputId} className={`input-dark ${className}`.trim()} {...rest} />
        {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';
