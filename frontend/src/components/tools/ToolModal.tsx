import React, { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useToolsStore } from '@/store/toolsStore';

interface Props {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

export const ToolModal: React.FC<Props> = ({ title, icon, children }) => {
  const closeTool = useToolsStore((s) => s.closeTool);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTool();
    },
    [closeTool]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeTool}
      />

      {/* Modal */}
      <div
        className="relative flex flex-col bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-2xl animate-slide-down"
        style={{ width: '85vw', height: '80vh', maxWidth: '1400px', maxHeight: '900px' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] rounded-t-lg shrink-0">
          <span className="text-[var(--accent)]">{icon}</span>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex-1">{title}</h2>
          <button
            onClick={closeTool}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
};
