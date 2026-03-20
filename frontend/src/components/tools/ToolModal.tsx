import React, { useEffect, useCallback, useRef } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { useToolsStore } from '@/store/toolsStore';

interface Props {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

export const ToolModal: React.FC<Props> = ({ title, icon, children }) => {
  const closeTool = useToolsStore((s) => s.closeTool);
  const modalRef = useRef<HTMLDivElement>(null);

  const focusSearchInput = useCallback(() => {
    if (!modalRef.current) return;
    const preferred = modalRef.current.querySelector('[data-tool-search]') as HTMLElement | null;
    const fallback = modalRef.current.querySelector('input[type="text"], input[type="search"]') as HTMLElement | null;
    const target = preferred || fallback;
    if (target && 'focus' in target) {
      target.focus();
      if ('select' in target && typeof (target as HTMLInputElement).select === 'function') {
        (target as HTMLInputElement).select();
      }
    }
  }, []);

  const triggerRefresh = useCallback(() => {
    if (!modalRef.current) return;
    const explicit = modalRef.current.querySelector('[data-tool-refresh]') as HTMLButtonElement | null;
    if (explicit) {
      explicit.click();
      return;
    }

    const buttons = Array.from(modalRef.current.querySelectorAll('button')) as HTMLButtonElement[];
    const match = buttons.find((btn) => {
      const titleText = (btn.getAttribute('title') || '').toLowerCase();
      const content = (btn.textContent || '').toLowerCase();
      return titleText.includes('refresh') || content.includes('refresh');
    });
    if (match) match.click();
  }, []);

  const triggerExport = useCallback(() => {
    if (!modalRef.current) return;

    const explicit = modalRef.current.querySelector('[data-tool-export]') as HTMLButtonElement | null;
    if (explicit) {
      explicit.click();
      return;
    }

    const table = modalRef.current.querySelector('table');
    if (!table) return;

    const rows = Array.from(table.querySelectorAll('tr'));
    const csvRows = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('th,td')).map((cell) => {
        const text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
        return `"${text.replace(/"/g, '""')}"`;
      });
      return cells.join(',');
    });

    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, '-')}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [title]);

  const isTypingTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return target.isContentEditable;
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTool();
      if (isTypingTarget(e.target)) return;

      if (e.key === '/') {
        e.preventDefault();
        focusSearchInput();
        return;
      }

      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        triggerRefresh();
        return;
      }

      if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        triggerExport();
      }
    },
    [closeTool, focusSearchInput, triggerRefresh, triggerExport]
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
        ref={modalRef}
        className="relative flex flex-col bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-2xl animate-slide-down"
        style={{ width: '85vw', height: '80vh', maxWidth: '1400px', maxHeight: '900px' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] rounded-t-lg shrink-0">
          <span className="text-[var(--accent)]">{icon}</span>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex-1">{title}</h2>
          <button
            onClick={triggerRefresh}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Refresh (R)"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={triggerExport}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Export (E)"
          >
            <Download size={14} />
          </button>
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
