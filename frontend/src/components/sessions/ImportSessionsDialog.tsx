import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  X,
  Upload,
  FileText,
  Check,
  AlertTriangle,
  Terminal,
  Monitor,
  Eye,
  Radio,
  FolderOpen,
  Folder,
} from 'lucide-react';
import { useSessionStore, type ImportedSession, type ImportResult } from '@/store/sessionStore';
import { useToastStore } from '@/store/toastStore';

interface ImportSessionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'upload' | 'preview' | 'result';

const FORMAT_LABELS: Record<string, string> = {
  mobaxterm: 'MobaXterm',
  ssh_config: 'SSH Config',
  mremoteng: 'mRemoteNG',
  putty: 'PuTTY',
};

const PROTOCOL_ICONS: Record<string, React.ReactNode> = {
  ssh: <Terminal size={12} />,
  rdp: <Monitor size={12} />,
  vnc: <Eye size={12} />,
  telnet: <Radio size={12} />,
  ftp: <FolderOpen size={12} />,
  sftp: <FolderOpen size={12} />,
};

const ACCEPTED_EXTENSIONS = '.mxtsessions,.xml,.reg,.txt,';

export const ImportSessionsDialog: React.FC<ImportSessionsDialogProps> = ({ isOpen, onClose }) => {
  const { previewImport, importSessions } = useSessionStore();
  const addToast = useToastStore((s) => s.addToast);
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [sessions, setSessions] = useState<ImportedSession[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [formatDetected, setFormatDetected] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('upload');
      setFile(null);
      setSessions([]);
      setSelected(new Set());
      setWarnings([]);
      setFormatDetected('');
      setResult(null);
      setIsLoading(false);
      setIsDragOver(false);
      setIsClosing(false);
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    const timeout = setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 150);
    return () => clearTimeout(timeout);
  }, [onClose]);

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setIsLoading(true);

    try {
      const preview = await previewImport(selectedFile);
      setSessions(preview.sessions);
      setWarnings(preview.warnings);
      setFormatDetected(preview.format_detected);
      // Select all by default
      setSelected(new Set(preview.sessions.map((_, i) => i)));
      setStep('preview');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse file';
      addToast(message, 'error');
      setFile(null);
    } finally {
      setIsLoading(false);
    }
  }, [previewImport, addToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  }, [handleFileSelect]);

  const toggleSession = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === sessions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sessions.map((_, i) => i)));
    }
  }, [selected.size, sessions.length]);

  const handleImport = useCallback(async () => {
    if (!file || selected.size === 0) return;
    setIsLoading(true);

    try {
      const importResult = await importSessions(file);
      setResult(importResult);
      setStep('result');
      addToast(`Imported ${importResult.sessions_created} session(s)`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      addToast(message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [file, selected.size, importSessions, addToast]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    },
    [handleClose]
  );

  if (!isOpen && !isClosing) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-150"
        style={{ opacity: isClosing ? 0 : 1 }}
        onClick={handleClose}
      />

      {/* Dialog */}
      <div
        className="relative w-full max-w-xl mx-4 bg-[var(--bg-modal)] border border-[var(--border-primary)] rounded-xl shadow-2xl overflow-hidden transition-all duration-150"
        style={{
          opacity: isClosing ? 0 : 1,
          transform: isClosing ? 'scale(0.95)' : 'scale(1)',
          animation: !isClosing ? 'scaleIn 200ms ease-out forwards' : undefined,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Import Sessions
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors active:scale-90"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {step === 'upload' && (
            <UploadStep
              isDragOver={isDragOver}
              isLoading={isLoading}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onFileInputClick={() => fileInputRef.current?.click()}
              fileInputRef={fileInputRef}
              onFileInputChange={handleFileInputChange}
            />
          )}

          {step === 'preview' && (
            <PreviewStep
              sessions={sessions}
              selected={selected}
              warnings={warnings}
              formatDetected={formatDetected}
              fileName={file?.name ?? ''}
              onToggle={toggleSession}
              onToggleAll={toggleAll}
            />
          )}

          {step === 'result' && result && (
            <ResultStep result={result} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-primary)]">
          <div className="text-[10px] text-[var(--text-muted)]">
            {step === 'preview' && `${selected.size} of ${sessions.length} selected`}
            {step === 'result' && result && `${result.sessions_created} imported, ${result.skipped} skipped`}
          </div>
          <div className="flex gap-2">
            {step === 'preview' && (
              <button
                onClick={() => { setStep('upload'); setFile(null); }}
                className="px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-hover)] transition-colors active:scale-95"
              >
                Back
              </button>
            )}
            <button
              onClick={step === 'result' ? handleClose : step === 'preview' ? handleImport : handleClose}
              disabled={step === 'preview' && (selected.size === 0 || isLoading)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md transition-all active:scale-95 ${
                step === 'result' || (step === 'preview' && selected.size > 0 && !isLoading)
                  ? 'bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]'
                  : step === 'upload'
                    ? 'bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    : 'bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-not-allowed'
              }`}
            >
              {step === 'result' ? 'Done' : step === 'preview' ? (
                <>{isLoading ? 'Importing...' : <>
                  <Upload size={13} />
                  Import {selected.size} Session{selected.size !== 1 ? 's' : ''}
                </>}</>
              ) : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------- Upload Step ---------- */

interface UploadStepProps {
  isDragOver: boolean;
  isLoading: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onFileInputClick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const UploadStep: React.FC<UploadStepProps> = ({
  isDragOver,
  isLoading,
  onDrop,
  onDragOver,
  onDragLeave,
  onFileInputClick,
  fileInputRef,
  onFileInputChange,
}) => (
  <div className="space-y-4">
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onFileInputClick}
      className={`flex flex-col items-center justify-center gap-3 px-6 py-10 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
        isDragOver
          ? 'border-[var(--accent)] bg-[var(--accent-muted)]'
          : 'border-[var(--border-secondary)] hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      {isLoading ? (
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      ) : (
        <Upload size={28} className="text-[var(--text-muted)]" />
      )}
      <div className="text-center">
        <p className="text-xs text-[var(--text-secondary)]">
          {isLoading ? 'Parsing file...' : 'Drop a file here or click to browse'}
        </p>
        <p className="text-[10px] text-[var(--text-muted)] mt-1">
          Supported: MobaXterm (.mxtsessions), SSH Config, mRemoteNG (.xml), PuTTY (.reg)
        </p>
      </div>
    </div>
    <input
      ref={fileInputRef as React.RefObject<HTMLInputElement>}
      type="file"
      accept={ACCEPTED_EXTENSIONS}
      onChange={onFileInputChange}
      className="hidden"
    />
  </div>
);

/* ---------- Preview Step ---------- */

interface PreviewStepProps {
  sessions: ImportedSession[];
  selected: Set<number>;
  warnings: string[];
  formatDetected: string;
  fileName: string;
  onToggle: (index: number) => void;
  onToggleAll: () => void;
}

const PreviewStep: React.FC<PreviewStepProps> = ({
  sessions,
  selected,
  warnings,
  formatDetected,
  fileName,
  onToggle,
  onToggleAll,
}) => (
  <div className="space-y-3">
    {/* File info */}
    <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] rounded-md">
      <FileText size={14} className="text-[var(--accent)] flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--text-primary)] truncate">{fileName}</p>
        <p className="text-[10px] text-[var(--text-muted)]">
          {FORMAT_LABELS[formatDetected] ?? formatDetected} - {sessions.length} session{sessions.length !== 1 ? 's' : ''} found
        </p>
      </div>
    </div>

    {/* Warnings */}
    {warnings.length > 0 && (
      <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
        <div className="flex items-center gap-1.5 mb-1">
          <AlertTriangle size={12} className="text-yellow-500" />
          <span className="text-[10px] font-medium text-yellow-500">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="space-y-0.5 max-h-20 overflow-y-auto">
          {warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-[var(--text-muted)]">{w}</p>
          ))}
        </div>
      </div>
    )}

    {/* Session list */}
    <div className="border border-[var(--border-primary)] rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
        <button
          onClick={onToggleAll}
          className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
            selected.size === sessions.length
              ? 'bg-[var(--accent)] border-[var(--accent)]'
              : selected.size > 0
                ? 'bg-[var(--accent)]/50 border-[var(--accent)]'
                : 'border-[var(--border-secondary)] hover:border-[var(--accent)]'
          }`}
        >
          {selected.size > 0 && <Check size={10} className="text-white" />}
        </button>
        <span className="text-[10px] font-medium text-[var(--text-secondary)] flex-1">Session</span>
        <span className="text-[10px] font-medium text-[var(--text-secondary)] w-28">Host</span>
        <span className="text-[10px] font-medium text-[var(--text-secondary)] w-12 text-right">Port</span>
        <span className="text-[10px] font-medium text-[var(--text-secondary)] w-10 text-center">Type</span>
      </div>

      {/* Rows */}
      <div className="max-h-52 overflow-y-auto">
        {sessions.map((s, i) => (
          <button
            key={i}
            onClick={() => onToggle(i)}
            className={`flex items-center gap-2 px-3 py-1.5 w-full text-left transition-colors ${
              selected.has(i) ? 'bg-[var(--accent-muted)]' : 'hover:bg-[var(--bg-hover)]'
            }`}
          >
            <span
              className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                selected.has(i) ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border-secondary)]'
              }`}
            >
              {selected.has(i) && <Check size={10} className="text-white" />}
            </span>
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {s.folder_path && (
                <Folder size={10} className="text-[var(--text-muted)] flex-shrink-0" />
              )}
              <span className="text-xs text-[var(--text-primary)] truncate">{s.name}</span>
              {s.folder_path && (
                <span className="text-[9px] text-[var(--text-muted)] truncate hidden sm:block">
                  {s.folder_path}
                </span>
              )}
            </div>
            <span className="text-[10px] text-[var(--text-secondary)] w-28 truncate">{s.host}</span>
            <span className="text-[10px] text-[var(--text-muted)] w-12 text-right">{s.port}</span>
            <span className="w-10 flex justify-center">
              {PROTOCOL_ICONS[s.session_type] ?? <Terminal size={12} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  </div>
);

/* ---------- Result Step ---------- */

interface ResultStepProps {
  result: ImportResult;
}

const ResultStep: React.FC<ResultStepProps> = ({ result }) => (
  <div className="space-y-4">
    <div className="flex flex-col items-center justify-center py-6">
      <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
        <Check size={24} className="text-green-500" />
      </div>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Import Complete</h3>
      <p className="text-xs text-[var(--text-secondary)]">
        Successfully imported your sessions.
      </p>
    </div>

    <div className="grid grid-cols-3 gap-3">
      <div className="text-center px-3 py-2 bg-[var(--bg-secondary)] rounded-md">
        <p className="text-lg font-bold text-[var(--accent)]">{result.sessions_created}</p>
        <p className="text-[10px] text-[var(--text-muted)]">Sessions</p>
      </div>
      <div className="text-center px-3 py-2 bg-[var(--bg-secondary)] rounded-md">
        <p className="text-lg font-bold text-[var(--text-primary)]">{result.folders_created}</p>
        <p className="text-[10px] text-[var(--text-muted)]">Folders</p>
      </div>
      <div className="text-center px-3 py-2 bg-[var(--bg-secondary)] rounded-md">
        <p className="text-lg font-bold text-[var(--text-secondary)]">{result.skipped}</p>
        <p className="text-[10px] text-[var(--text-muted)]">Skipped</p>
      </div>
    </div>

    {result.warnings.length > 0 && (
      <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
        <div className="flex items-center gap-1.5 mb-1">
          <AlertTriangle size={12} className="text-yellow-500" />
          <span className="text-[10px] font-medium text-yellow-500">
            {result.warnings.length} warning{result.warnings.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="space-y-0.5 max-h-24 overflow-y-auto">
          {result.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-[var(--text-muted)]">{w}</p>
          ))}
        </div>
      </div>
    )}
  </div>
);

export default ImportSessionsDialog;
