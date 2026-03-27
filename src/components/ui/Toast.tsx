'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Undo2 } from 'lucide-react';

export interface ToastData {
  message: string;
  undoAction?: () => void;
  duration?: number; // ms, default 3000
}

interface ToastProps {
  toast: ToastData | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  // Set up auto-dismiss timer via setTimeout (no direct setState in effect)
  useEffect(() => {
    if (!toast) {
      clearTimers();
      return;
    }

    const duration = toast.duration ?? 3000;
    dismissTimerRef.current = setTimeout(onDismiss, duration);

    return clearTimers;
  }, [toast, onDismiss, clearTimers]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-card border border-white/[0.08] shadow-lg">
        <span className="text-sm">{toast.message}</span>
        {toast.undoAction && (
          <button
            onClick={() => {
              toast.undoAction?.();
              clearTimers();
              onDismiss();
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Undo2 className="h-3 w-3" />
            Undo
          </button>
        )}
      </div>
    </div>
  );
}
