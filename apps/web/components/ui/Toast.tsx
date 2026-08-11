// apps/web/components/ui/Toast.tsx
// Lightweight toast notification system
// Used to notify analysts when another analyst acts on an alert
'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import clsx from 'clsx';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

interface ToastContextValue {
  addToast: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { ...toast, id }]);

    // Auto-remove after duration
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, toast.duration || 4000);
  }, []);

  function removeToast(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}

      {/* Toast container — fixed bottom-right */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={clsx(
              'flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl',
              'pointer-events-auto max-w-sm animate-slideIn',
              toast.type === 'success' && 'bg-emerald-950 border-emerald-800 text-emerald-300',
              toast.type === 'error'   && 'bg-red-950 border-red-800 text-red-300',
              toast.type === 'warning' && 'bg-amber-950 border-amber-800 text-amber-300',
              toast.type === 'info'    && 'bg-blue-950 border-blue-800 text-blue-300',
            )}
          >
            {toast.type === 'success' && <CheckCircle size={16} className="shrink-0 mt-0.5" />}
            {toast.type === 'error'   && <AlertCircle size={16} className="shrink-0 mt-0.5" />}
            {toast.type === 'info'    && <Info size={16} className="shrink-0 mt-0.5" />}
            {toast.type === 'warning' && <AlertCircle size={16} className="shrink-0 mt-0.5" />}

            <p className="text-sm flex-1">{toast.message}</p>

            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}