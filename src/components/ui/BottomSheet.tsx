'use client';

import { X } from 'lucide-react';

interface BottomSheetProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Mobile-first contextual action sheet — intended to replace tiny inline
 * dropdown menus on small screens (e.g. staff row actions in Phase 2).
 * Not wired into any existing page in Milestone 1.
 */
export function BottomSheet({ open, title, onClose, children }: BottomSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full sm:max-w-md card rounded-b-none sm:rounded-b-xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl animate-slide-up"
        role="dialog"
      >
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="font-display text-base font-bold text-white tracking-wide">{title}</h3>}
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-slate-400 hover:bg-white/10" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
