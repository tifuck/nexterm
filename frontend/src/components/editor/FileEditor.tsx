import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import {
  Save,
  Loader2,
  AlertCircle,
  FileText,
  X,
  RotateCcw,
} from 'lucide-react';
import { apiGet, apiPost } from '@/api/client';
import { useTabStore } from '@/store/tabStore';
import type { Tab } from '@/types/session';

interface FileReadResponse {
  path: string;
  content: string;
  size: number;
}

interface FileEditorProps {
  tab: Tab;
}

const FileEditor: React.FC<FileEditorProps> = ({ tab }) => {
  const updateTab = useTabStore((s) => s.updateTab);
  const connectionId = tab.connectionId!;
  const filePath = tab.meta?.filePath as string;
  const language = (tab.meta?.language as string) || 'plaintext';

  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const editorRef = useRef<any>(null);

  // Load file content
  useEffect(() => {
    let cancelled = false;

    const loadFile = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await apiGet<FileReadResponse>(
          `/api/sftp/${connectionId}/read`,
          { path: filePath }
        );
        if (!cancelled) {
          setContent(result.content);
          setOriginalContent(result.content);
          setIsDirty(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load file');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadFile();
    return () => { cancelled = true; };
  }, [connectionId, filePath]);

  // Update tab title with dirty indicator
  useEffect(() => {
    const fileName = filePath.split('/').pop() || filePath;
    const newTitle = isDirty ? `* ${fileName}` : fileName;
    if (tab.title !== newTitle) {
      updateTab(tab.id, { title: newTitle });
    }
  }, [isDirty, filePath, tab.id, tab.title, updateTab]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setContent(value);
      setIsDirty(value !== originalContent);
      setSaveError(null);
    }
  }, [originalContent]);

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;

    // Add Ctrl+S keybinding
    editor.addCommand(
      // Monaco KeyMod.CtrlCmd | Monaco KeyCode.KeyS
      2048 | 49, // CtrlCmd = 2048, KeyS = 49
      () => {
        handleSave();
      }
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      await apiPost(`/api/sftp/${connectionId}/save?path=${encodeURIComponent(filePath)}`, {
        content,
      });
      setOriginalContent(content);
      setIsDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setIsSaving(false);
    }
  }, [connectionId, filePath, content, isSaving]);

  const handleRevert = useCallback(() => {
    setContent(originalContent);
    setIsDirty(false);
    setSaveError(null);
    if (editorRef.current) {
      editorRef.current.setValue(originalContent);
    }
  }, [originalContent]);

  const handleRetry = useCallback(() => {
    setError(null);
    setIsLoading(true);

    apiGet<FileReadResponse>(`/api/sftp/${connectionId}/read`, { path: filePath })
      .then((result) => {
        setContent(result.content);
        setOriginalContent(result.content);
        setIsDirty(false);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load file');
        setIsLoading(false);
      });
  }, [connectionId, filePath]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 bg-[var(--bg-primary)]">
        <Loader2 size={24} className="text-[var(--accent)] animate-spin" />
        <span className="text-sm text-[var(--text-secondary)]">Loading {filePath}...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 bg-[var(--bg-primary)]">
        <AlertCircle size={32} className="text-[var(--danger)]" />
        <span className="text-sm text-[var(--danger)]">{error}</span>
        <button
          onClick={handleRetry}
          className="px-3 py-1.5 text-xs bg-[var(--accent)] text-[var(--accent-contrast)] rounded hover:opacity-90 transition-opacity"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={14} className="text-[var(--text-muted)] flex-shrink-0" />
          <span className="text-xs text-[var(--text-secondary)] truncate" title={filePath}>
            {filePath}
          </span>
          {isDirty && (
            <span className="text-[10px] text-[var(--warning)] font-medium flex-shrink-0">
              Modified
            </span>
          )}
          <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 uppercase">
            {language}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {saveError && (
            <span className="text-[10px] text-[var(--danger)] mr-1 truncate max-w-[200px]" title={saveError}>
              {saveError}
            </span>
          )}

          {isDirty && (
            <button
              onClick={handleRevert}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
              title="Revert changes"
            >
              <RotateCcw size={12} />
              Revert
            </button>
          )}

          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] rounded transition-colors ${
              isDirty
                ? 'bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed'
            }`}
            title="Save (Ctrl+S)"
          >
            {isSaving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            Save
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={language}
          value={content}
          theme="vs-dark"
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          loading={
            <div className="flex items-center justify-center h-full">
              <Loader2 size={20} className="text-[var(--accent)] animate-spin" />
            </div>
          }
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures: true,
            minimap: { enabled: true, maxColumn: 80 },
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 2,
            insertSpaces: true,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            padding: { top: 8 },
            readOnly: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
};

export default FileEditor;
