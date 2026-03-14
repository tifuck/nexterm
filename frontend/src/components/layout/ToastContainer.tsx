import React from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { useToastStore } from '@/store/toastStore';
import type { ToastType } from '@/store/toastStore';

const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={14} />,
  error: <AlertCircle size={14} />,
  info: <Info size={14} />,
};

const colorMap: Record<ToastType, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  info: 'text-blue-400',
};

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] shadow-lg animate-slide-up min-w-[220px] max-w-[360px]"
        >
          <span className={`shrink-0 ${colorMap[toast.type]}`}>
            {iconMap[toast.type]}
          </span>
          <span className="text-xs text-[var(--text-primary)] flex-1">
            {toast.message}
          </span>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
