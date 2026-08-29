'use client';

import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Replaces window.confirm() for destructive/important actions. Not wired
 * into any existing page in Milestone 1 — introduced now so Phase 2+
 * features (staff deactivation, role changes, etc.) have it available
 * from day one instead of each reinventing window.confirm.
 */
export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, loading = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm card p-5 shadow-2xl animate-slide-up">
        <h3 className="font-display text-lg font-bold text-white tracking-wide">{title}</h3>
        <p className="text-sm text-slate-400 mt-2">{message}</p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
