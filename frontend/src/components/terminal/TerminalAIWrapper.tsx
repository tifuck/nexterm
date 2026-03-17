import React, { useState, useCallback, useEffect } from 'react';
import { TerminalToolbar } from './TerminalToolbar';
import { AIPanel } from './AIPanel';
import { AICommandPopup } from './AICommandPopup';
import { getTerminalInstance } from './TerminalContainer';
import { useAIStore } from '@/store/aiStore';
import { useTabStore } from '@/store/tabStore';
import { apiPost } from '@/api/client';

interface TerminalAIWrapperProps {
  tabId: string;
}

type AIMode = null | 'command' | 'diagnose' | 'explain';

/**
 * Wraps the terminal toolbar and all AI panels for a single terminal tab.
 * Manages AI interaction state (which panel is open, loading, results).
 */
export const TerminalAIWrapper: React.FC<TerminalAIWrapperProps> = ({ tabId }) => {
  const isFeatureEnabled = useAIStore((s) => s.isFeatureEnabled);

  const [aiMode, setAIMode] = useState<AIMode>(null);
  const [aiContent, setAIContent] = useState<string | null>(null);
  const [aiLoading, setAILoading] = useState(false);
  const [aiError, setAIError] = useState<string | null>(null);

  const closeAI = useCallback(() => {
    setAIMode(null);
    setAIContent(null);
    setAILoading(false);
    setAIError(null);
  }, []);

  /**
   * Extract text from the terminal scrollback buffer.
   * If text is selected, uses selection. Otherwise grabs last N lines.
   */
  const getTerminalContext = useCallback((lines = 50): string => {
    const terminal = getTerminalInstance(tabId);
    if (!terminal) return '';

    // Prefer selection if available
    const selection = terminal.getSelection();
    if (selection && selection.trim().length > 0) return selection.trim();

    // Fall back to scrollback buffer
    const buffer = terminal.buffer.active;
    const totalRows = buffer.length;
    const startRow = Math.max(0, totalRows - lines);
    const result: string[] = [];
    for (let i = startRow; i < totalRows; i++) {
      const line = buffer.getLine(i);
      if (line) {
        const text = line.translateToString(true);
        if (text.trim()) result.push(text);
      }
    }
    return result.join('\n');
  }, [tabId]);

  /**
   * Get the last non-empty command from terminal buffer.
   * Looks for lines starting with common prompt suffixes.
   */
  const getLastCommand = useCallback((): string => {
    const terminal = getTerminalInstance(tabId);
    if (!terminal) return '';

    const buffer = terminal.buffer.active;
    const totalRows = buffer.length;
    for (let i = totalRows - 1; i >= Math.max(0, totalRows - 30); i--) {
      const line = buffer.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true).trim();
      // Match common prompt patterns: user@host:~$ cmd, [user]$ cmd, $ cmd, # cmd
      const match = text.match(/(?:\$|#|>|%)\s+(.+)/);
      if (match && match[1].trim()) return match[1].trim();
    }
    return '';
  }, [tabId]);

  // ---- AI Command ----
  const handleAICommand = useCallback(() => {
    if (aiMode === 'command') {
      closeAI();
    } else {
      closeAI();
      setAIMode('command');
    }
  }, [aiMode, closeAI]);

  const handleInsertCommand = useCallback((command: string) => {
    const terminal = getTerminalInstance(tabId);
    if (terminal) {
      // Clear current line (Ctrl+U), then type command (don't auto-execute)
      terminal.input('\x15' + command, true);
      terminal.focus();
    }
    closeAI();
  }, [tabId, closeAI]);

  // ---- AI Diagnose ----
  const handleAIDiagnose = useCallback(async () => {
    if (aiMode === 'diagnose') {
      closeAI();
      return;
    }
    closeAI();
    setAIMode('diagnose');
    setAILoading(true);

    const context = getTerminalContext(50);
    if (!context) {
      setAIError('No terminal output to diagnose');
      setAILoading(false);
      return;
    }

    try {
      const lastCmd = getLastCommand();
      const data = await apiPost<{ diagnosis: string }>('/api/ai/diagnose', {
        error_output: context,
        command: lastCmd || undefined,
      });
      setAIContent(data.diagnosis);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Diagnosis failed';
      setAIError(message);
    } finally {
      setAILoading(false);
    }
  }, [aiMode, closeAI, getTerminalContext, getLastCommand]);

  // ---- AI Explain ----
  const handleAIExplain = useCallback(async () => {
    if (aiMode === 'explain') {
      closeAI();
      return;
    }
    closeAI();
    setAIMode('explain');
    setAILoading(true);

    const terminal = getTerminalInstance(tabId);
    const selection = terminal?.getSelection()?.trim();
    const command = selection || getLastCommand();

    if (!command) {
      setAIError('No command to explain. Select text or run a command first.');
      setAILoading(false);
      return;
    }

    try {
      const data = await apiPost<{ explanation: string }>('/api/ai/explain', { command });
      setAIContent(data.explanation);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Explanation failed';
      setAIError(message);
    } finally {
      setAILoading(false);
    }
  }, [aiMode, tabId, closeAI, getLastCommand]);

  // Feature availability
  const cmdEnabled = isFeatureEnabled('command_generation');
  const diagEnabled = isFeatureEnabled('error_diagnosis');
  const explEnabled = isFeatureEnabled('command_explanation');

  // Keyboard shortcuts (only active when this tab is focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle shortcuts when this tab is active
      const activeTab = useTabStore.getState().activeTab;
      if (activeTab !== tabId) return;

      // Ctrl+K → AI Command
      if (e.ctrlKey && !e.shiftKey && e.key === 'k' && cmdEnabled) {
        e.preventDefault();
        e.stopPropagation();
        handleAICommand();
        return;
      }

      // Ctrl+Shift+D → Diagnose
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd') && diagEnabled) {
        e.preventDefault();
        e.stopPropagation();
        handleAIDiagnose();
        return;
      }

      // Ctrl+Shift+E → Explain
      if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e') && explEnabled) {
        e.preventDefault();
        e.stopPropagation();
        handleAIExplain();
        return;
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [tabId, cmdEnabled, diagEnabled, explEnabled, handleAICommand, handleAIDiagnose, handleAIExplain]);

  return (
    <>
      <TerminalToolbar
        tabId={tabId}
        aiCommandEnabled={cmdEnabled}
        aiDiagnoseEnabled={diagEnabled}
        aiExplainEnabled={explEnabled}
        onAICommand={handleAICommand}
        onAIDiagnose={handleAIDiagnose}
        onAIExplain={handleAIExplain}
      />

      {aiMode === 'command' && (
        <AICommandPopup
          onInsert={handleInsertCommand}
          onClose={closeAI}
        />
      )}

      {aiMode === 'diagnose' && (
        <AIPanel
          title="Error Diagnosis"
          content={aiContent}
          loading={aiLoading}
          error={aiError}
          onClose={closeAI}
        />
      )}

      {aiMode === 'explain' && (
        <AIPanel
          title="Command Explanation"
          content={aiContent}
          loading={aiLoading}
          error={aiError}
          onClose={closeAI}
        />
      )}
    </>
  );
};
