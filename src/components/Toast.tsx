"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { Check, AlertCircle, Info, X } from 'lucide-react';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
}

interface ShowToastOptions {
  variant?: ToastVariant;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextType {
  showToast: (message: string, options?: ShowToastOptions | ToastVariant) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(item => item.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, options?: ShowToastOptions | ToastVariant) => {
      const opts: ShowToastOptions =
        typeof options === 'string' ? { variant: options } : options || {};
      const variant = opts.variant || 'info';
      const durationMs = opts.durationMs ?? 3600;
      const id = crypto.randomUUID();

      setToasts(prev => [
        ...prev.slice(-2),
        {
          id,
          message,
          variant,
          actionLabel: opts.actionLabel,
          onAction: opts.onAction,
        },
      ]);

      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setToasts(prev => prev.filter(item => item.id !== id));
      }, durationMs);
      timersRef.current.set(id, timer);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div
          data-interactive-protected="true"
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 100000,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxWidth: '380px',
            pointerEvents: 'none',
          }}
        >
          {toasts.map(item => {
            const accentColor =
              item.variant === 'success'
                ? 'var(--accent-emerald)'
                : item.variant === 'error'
                ? 'var(--accent-rose)'
                : item.variant === 'warning'
                ? 'var(--primary)'
                : 'var(--text-secondary)';

            return (
              <div
                key={item.id}
                role="status"
                style={{
                  pointerEvents: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  background: 'var(--surface-1)',
                  color: 'var(--foreground)',
                  border: '1px solid var(--border-strong)',
                  borderLeft: `3px solid ${accentColor}`,
                  borderRadius: '10px',
                  boxShadow: 'var(--shadow-md)',
                  fontSize: '12.5px',
                  lineHeight: 1.45,
                }}
              >
                <span style={{ color: accentColor, display: 'flex', flexShrink: 0 }}>
                  {item.variant === 'success' ? (
                    <Check size={15} />
                  ) : item.variant === 'error' || item.variant === 'warning' ? (
                    <AlertCircle size={15} />
                  ) : (
                    <Info size={15} />
                  )}
                </span>
                <span style={{ flex: 1 }}>{item.message}</span>
                {item.actionLabel && item.onAction && (
                  <button
                    type="button"
                    onClick={() => {
                      item.onAction?.();
                      dismiss(item.id);
                    }}
                    style={{
                      background: 'var(--primary-surface)',
                      color: 'var(--primary)',
                      border: '1px solid var(--primary-border)',
                      borderRadius: '6px',
                      padding: '3px 8px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.actionLabel}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label="关闭通知"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    padding: '2px',
                    cursor: 'pointer',
                    display: 'flex',
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
