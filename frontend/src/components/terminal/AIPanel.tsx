import React from 'react';
import { X, Loader2, Sparkles, AlertTriangle } from 'lucide-react';

interface AIPanelProps {
  title: string;
  content: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

/**
 * Shared floating panel for AI results (diagnose, explain).
 * Positioned absolute in the terminal container's top-right area.
 */
export const AIPanel: React.FC<AIPanelProps> = ({ title, content, loading, error, onClose }) => {
  return (
    <div className="absolute top-10 right-2 z-40 w-80 max-h-[60vh] overflow-y-auto rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] shadow-xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <Sparkles size={14} className="text-[var(--accent)]" />
        <span className="text-xs font-semibold text-[var(--text-primary)] flex-1">{title}</span>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-4 justify-center">
            <Loader2 size={14} className="animate-spin" />
            Analyzing...
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs text-[var(--danger)] py-1">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {content && !loading && (
          <div className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
            {formatAIContent(content)}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Simple formatting for AI responses.
 * Handles **bold** markers used in diagnose prompts.
 */
function formatAIContent(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="text-[var(--text-primary)] font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
