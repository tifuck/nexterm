import React, { useState, useRef, useEffect } from 'react';
import { X, Loader2, Sparkles, Copy, ArrowRightToLine } from 'lucide-react';
import { apiPost } from '@/api/client';

interface AICommandPopupProps {
  onInsert: (command: string) => void;
  onClose: () => void;
  history?: string[];
  context?: string;
}

/**
 * Floating popup for AI command generation.
 * Phase 1: user types natural language prompt.
 * Phase 2: shows editable result with Insert/Copy/Dismiss.
 */
function normalizeCommand(result: string): string {
  const trimmed = result.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  if (lines.length < 2) return trimmed.replace(/`/g, '').trim();
  const body = lines.slice(1, lines[lines.length - 1].startsWith('```') ? -1 : undefined).join('\n');
  return body.trim();
}

export const AICommandPopup: React.FC<AICommandPopupProps> = ({ onInsert, onClose, history, context }) => {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [editedResult, setEditedResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (result !== null) {
      setEditedResult(result);
      // Focus the editable result field after a tick
      setTimeout(() => resultRef.current?.focus(), 50);
    }
  }, [result]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost<{ command: string }>('/api/ai/command', {
        prompt: prompt.trim(),
        history: history?.slice(-5),
        context,
      });
      setResult(normalizeCommand(data.command));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate command';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleInsert = () => {
    if (editedResult.trim()) {
      onInsert(editedResult.trim());
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editedResult);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access may fail
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && !e.shiftKey && result === null) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="absolute top-10 right-2 z-40 w-80 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] shadow-xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <Sparkles size={14} className="text-[var(--accent)]" />
        <span className="text-xs font-semibold text-[var(--text-primary)] flex-1">AI Command</span>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">
        {/* Prompt input (phase 1) */}
        {result === null && (
          <>
            <input
              ref={inputRef}
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want to do..."
              disabled={loading}
              className="w-full px-2.5 py-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
            />
            <div className="flex justify-end">
              <button
                onClick={handleGenerate}
                disabled={loading || !prompt.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-[11px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Generate
              </button>
            </div>
          </>
        )}

        {/* Result (phase 2) */}
        {result !== null && (
          <>
            <textarea
              ref={resultRef}
              value={editedResult}
              onChange={(e) => setEditedResult(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleInsert();
                }
              }}
              rows={Math.min(editedResult.split('\n').length + 1, 6)}
              className="w-full px-2.5 py-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-mono resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setResult(null); setError(null); }}
                className="px-2.5 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Back
              </button>
              <div className="flex-1" />
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Copy size={11} />
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={handleInsert}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-[11px] font-medium hover:opacity-90 transition-opacity"
              >
                <ArrowRightToLine size={11} />
                Insert
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-muted)]">
              Ctrl+Enter to insert. Command won't auto-execute.
            </p>
          </>
        )}

        {error && (
          <p className="text-xs text-[var(--danger)]">{error}</p>
        )}
      </div>
    </div>
  );
};
