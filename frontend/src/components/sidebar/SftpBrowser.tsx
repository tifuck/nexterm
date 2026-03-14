import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Folder,
  File,
  FileText,
  Upload,
  Download,
  Trash2,
  FolderPlus,
  Pencil,
  HardDrive,
  Loader2,
  RefreshCw,
  ClipboardCopy,
  FilePlus,
  Home,
  Eye,
  EyeOff,
} from 'lucide-react';
import { apiGet, apiDelete, apiPost, apiUpload } from '@/api/client';
import { useTabStore } from '@/store/tabStore';
import { useToastStore } from '@/store/toastStore';

/** Raw entry shape from the backend /ls endpoint */
interface RawFileEntry {
  name: string;
  size: number;
  modified: string;
  permissions: string;
  is_dir: boolean;
  is_link: boolean;
}

/** Normalized entry with a computed type field */
interface FileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modified: string;
  permissions: string;
}

/** Backend response shape for /ls */
interface LsResponse {
  path: string;
  entries: RawFileEntry[];
}

/** Convert a raw backend entry to a normalized FileEntry with a type field */
function normalizeEntry(raw: RawFileEntry): FileEntry {
  let type: FileEntry['type'] = 'file';
  if (raw.is_link) type = 'symlink';
  if (raw.is_dir) type = 'directory';
  return {
    name: raw.name,
    type,
    size: raw.size,
    modified: raw.modified,
    permissions: raw.permissions,
  };
}

interface SftpBrowserProps {
  connectionId: string;
}

/** File extensions that can be opened in the editor */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.toml', '.xml', '.html',
  '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.sh', '.bash', '.zsh',
  '.conf', '.cfg', '.ini', '.log', '.env', '.csv', '.sql', '.rb',
  '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.java', '.kt', '.swift',
  '.php', '.pl', '.lua', '.vim', '.dockerfile', '.gitignore', '.editorconfig',
  '.prettierrc', '.eslintrc', '.babelrc', '.makefile', '.cmake',
]);

/** Names (no extension) treated as text */
const TEXT_NAMES = new Set([
  'makefile', 'dockerfile', 'vagrantfile', 'gemfile', 'rakefile',
  'procfile', 'readme', 'license', 'changelog', 'authors',
  '.gitignore', '.gitattributes', '.dockerignore', '.env',
  '.editorconfig', '.prettierrc', '.eslintrc', '.babelrc',
]);

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEXT_NAMES.has(lower)) return true;
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx >= 0) {
    return TEXT_EXTENSIONS.has(lower.slice(dotIdx));
  }
  return false;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function getFileIcon(entry: FileEntry): React.ReactNode {
  if (entry.type === 'directory') {
    return <Folder size={14} className="text-[var(--accent)] flex-shrink-0" />;
  }
  if (isTextFile(entry.name)) {
    return <FileText size={14} className="text-[var(--text-secondary)] flex-shrink-0" />;
  }
  return <File size={14} className="text-[var(--text-tertiary)] flex-shrink-0" />;
}

/** Map file extension to Monaco language id */
function getLanguageForFile(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    json: 'json',
    yaml: 'yaml', yml: 'yaml',
    xml: 'xml', svg: 'xml',
    html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less',
    md: 'markdown',
    sql: 'sql',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c', h: 'c',
    cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
    php: 'php',
    pl: 'perl',
    lua: 'lua',
    toml: 'toml',
    ini: 'ini',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
  };
  return map[ext] || 'plaintext';
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

function buildFullPath(basePath: string, name: string): string {
  return basePath === '/' ? `/${name}` : `${basePath}/${name}`;
}

/* ========================================================================== */
/* Context Menu                                                                */
/* ========================================================================== */

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry | null; // null = background context menu
  fullPath: string;
}

interface ContextMenuItem {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  danger?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  items: ContextMenuItem[];
}

const ContextMenu: React.FC<ContextMenuProps> = ({ state, onClose, items }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(state.x, window.innerWidth - 190),
    top: Math.min(state.y, window.innerHeight - items.length * 32 - 40),
    zIndex: 9999,
  };

  return (
    <div ref={menuRef} style={style} className="w-48 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md shadow-xl py-1 animate-slide-down">
      {state.entry && (
        <div className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] truncate border-b border-[var(--border)] mb-0.5">
          {state.entry.name}
        </div>
      )}
      {items.map((item, idx) => (
        <React.Fragment key={item.label}>
          {item.separator && idx > 0 && (
            <div className="border-t border-[var(--border)] my-0.5" />
          )}
          <button
            onClick={() => { item.action(); onClose(); }}
            className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors ${
              item.danger
                ? 'text-[var(--danger)] hover:bg-[var(--bg-secondary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

/* ========================================================================== */
/* Delete Confirmation Dialog                                                   */
/* ========================================================================== */

interface DeleteConfirmProps {
  name: string;
  isDirectory: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirmDialog: React.FC<DeleteConfirmProps> = ({ name, isDirectory, onConfirm, onCancel }) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
      <div ref={dialogRef} className="bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg shadow-xl p-4 max-w-sm mx-4">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
          Delete {isDirectory ? 'Folder' : 'File'}
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Are you sure you want to delete <strong className="text-[var(--text-primary)]">{name}</strong>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs text-white bg-[var(--danger)] hover:opacity-90 rounded transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

/* ========================================================================== */
/* New Folder Dialog                                                           */
/* ========================================================================== */

interface NewFolderDialogProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

const NewFolderDialog: React.FC<NewFolderDialogProps> = ({ onConfirm, onCancel }) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg shadow-xl p-4 max-w-sm mx-4">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">New Folder</h3>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Folder name"
            className="w-full px-3 py-1.5 text-xs bg-[var(--bg-primary)] border border-[var(--border)] rounded text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] mb-3"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-3 py-1.5 text-xs text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded transition-colors disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ========================================================================== */
/* File / Directory Row                                                        */
/* ========================================================================== */

interface EntryRowProps {
  entry: FileEntry;
  basePath: string;
  connectionId: string;
  isRenaming: boolean;
  onNavigate: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onRenameSubmit: (oldPath: string, newName: string) => void;
  onRenameCancel: () => void;
}

const EntryRow: React.FC<EntryRowProps> = ({
  entry, basePath, connectionId, isRenaming,
  onNavigate, onContextMenu, onRenameSubmit, onRenameCancel,
}) => {
  const addTab = useTabStore((s) => s.addTab);
  const [renameValue, setRenameValue] = useState(entry.name);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fullPath = buildFullPath(basePath, entry.name);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(entry.name);
      // Small timeout to ensure the input is rendered before focusing
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [isRenaming, entry.name]);

  const handleDoubleClick = useCallback(() => {
    if (entry.type === 'directory') {
      onNavigate(fullPath);
      return;
    }
    if (isTextFile(entry.name)) {
      const tabId = `editor-${connectionId}-${fullPath}`;
      addTab({
        id: tabId,
        type: 'editor',
        title: entry.name,
        connectionId,
        isConnected: true,
        meta: {
          filePath: fullPath,
          language: getLanguageForFile(entry.name),
        },
      });
    }
  }, [entry, fullPath, connectionId, addTab, onNavigate]);

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = renameValue.trim();
      if (trimmed && trimmed !== entry.name) {
        onRenameSubmit(fullPath, trimmed);
      } else {
        onRenameCancel();
      }
    } else if (e.key === 'Escape') {
      onRenameCancel();
    }
  };

  const handleRenameBlur = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== entry.name) {
      onRenameSubmit(fullPath, trimmed);
    } else {
      onRenameCancel();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => onContextMenu(e, entry)}
      className={`flex items-center gap-1.5 w-full px-2 py-1 text-left rounded hover:bg-[var(--bg-hover)] transition-colors group select-none ${
        entry.type === 'directory' || isTextFile(entry.name) ? 'cursor-pointer' : 'cursor-default'
      }`}
      style={{ paddingLeft: '8px' }}
      title={
        entry.type === 'directory'
          ? 'Double-click to open'
          : isTextFile(entry.name)
            ? 'Double-click to edit'
            : entry.name
      }
    >
      {getFileIcon(entry)}
      {isRenaming ? (
        <input
          ref={renameInputRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={handleRenameBlur}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="text-xs bg-[var(--bg-primary)] border border-[var(--accent)] rounded px-1 py-0 text-[var(--text-primary)] focus:outline-none flex-1 min-w-0"
        />
      ) : (
        <>
          <span className="text-xs text-[var(--text-primary)] truncate flex-1">{entry.name}</span>
          <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {entry.type === 'directory' ? '' : formatFileSize(entry.size)}
          </span>
        </>
      )}
    </div>
  );
};

/* ========================================================================== */
/* Main SftpBrowser                                                            */
/* ========================================================================== */

export const SftpBrowser: React.FC<SftpBrowserProps> = ({ connectionId }) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const addToast = useToastStore((s) => s.addToast);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; path: string; isDirectory: boolean } | null>(null);

  // New folder dialog
  const [showNewFolder, setShowNewFolder] = useState(false);

  // Hidden files toggle (hidden by default)
  const [showHidden, setShowHidden] = useState(false);

  // Refs to avoid stale closures in callbacks/intervals
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const connectionIdRef = useRef(connectionId);
  connectionIdRef.current = connectionId;

  // Track whether initial load succeeded (to distinguish retry-able state)
  const [initialized, setInitialized] = useState(false);

  // Hidden file input for upload via context menu
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDirectory = useCallback(
    async (path: string, silent = false) => {
      const connId = connectionIdRef.current;
      if (!connId) return;

      if (!silent) setIsLoading(true);
      setError(null);

      try {
        const result = await apiGet<LsResponse>(`/api/sftp/${connId}/ls`, { path });
        setEntries(sortEntries(result.entries.map(normalizeEntry)));
        setCurrentPath(path);
        setInitialized(true);
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : 'Failed to list directory');
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [] // no deps — uses refs for connectionId
  );

  // Fetch home directory on mount, then load its contents.
  // Retries automatically if the connection isn't ready yet (e.g. after page refresh).
  useEffect(() => {
    if (!connectionId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const MAX_RETRIES = 8;
    const RETRY_DELAY = 1000;
    const INITIAL_DELAY = 500; // brief wait for SSH connection to establish

    const tryLoad = async () => {
      if (cancelled) return;
      attempt++;

      try {
        const homeResult = await apiGet<{ path: string }>(`/api/sftp/${connectionId}/home`);
        if (cancelled) return;

        const lsResult = await apiGet<LsResponse>(`/api/sftp/${connectionId}/ls`, { path: homeResult.path });
        if (cancelled) return;

        setEntries(sortEntries(lsResult.entries.map(normalizeEntry)));
        setCurrentPath(homeResult.path);
        setInitialized(true);
        setIsLoading(false);
        setError(null);
      } catch {
        if (cancelled) return;

        if (attempt < MAX_RETRIES) {
          timer = setTimeout(tryLoad, RETRY_DELAY);
        } else {
          setError('Connection not ready. Click retry or reconnect the SSH session.');
          setIsLoading(false);
        }
      }
    };

    setIsLoading(true);
    setError(null);
    setInitialized(false);
    timer = setTimeout(tryLoad, INITIAL_DELAY);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [connectionId]); // only re-run when connectionId itself changes

  // Auto-refresh every 30 seconds (only after successful initial load)
  useEffect(() => {
    if (!connectionId || !initialized) return;

    const interval = setInterval(() => {
      fetchDirectory(currentPathRef.current, true);
    }, 30000);

    return () => clearInterval(interval);
  }, [connectionId, initialized, fetchDirectory]);

  const breadcrumbParts = currentPath.split('/').filter(Boolean);

  const visibleEntries = showHidden
    ? entries
    : entries.filter((e) => !e.name.startsWith('.'));

  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      const path = '/' + breadcrumbParts.slice(0, index + 1).join('/');
      fetchDirectory(path);
    },
    [breadcrumbParts, fetchDirectory]
  );

  // ------ Navigation ------

  const handleNavigate = useCallback(
    (path: string) => {
      fetchDirectory(path);
    },
    [fetchDirectory]
  );

  // ------ Context Menu ------

  const handleEntryContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    const fullPath = buildFullPath(currentPathRef.current, entry.name);
    setContextMenu({ x: e.clientX, y: e.clientY, entry, fullPath });
  }, []);

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry: null, fullPath: currentPathRef.current });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ------ File Operations ------

  const handleRename = useCallback((fullPath: string) => {
    setRenamingPath(fullPath);
  }, []);

  const handleRenameSubmit = useCallback(
    async (oldPath: string, newName: string) => {
      const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
      const newPath = buildFullPath(parentDir, newName);
      try {
        await apiPost(`/api/sftp/${connectionId}/rename`, { old_path: oldPath, new_path: newPath });
        addToast('Renamed successfully', 'success');
        fetchDirectory(currentPathRef.current);
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Rename failed', 'error');
      } finally {
        setRenamingPath(null);
      }
    },
    [connectionId, fetchDirectory, addToast]
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
  }, []);

  const handleDelete = useCallback(async (path: string) => {
    try {
      await apiDelete(`/api/sftp/${connectionId}/rm?path=${encodeURIComponent(path)}`);
      addToast('Deleted successfully', 'success');
      fetchDirectory(currentPathRef.current);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteTarget(null);
    }
  }, [connectionId, fetchDirectory, addToast]);

  const handleDownload = useCallback((path: string, filename: string) => {
    const token = localStorage.getItem('token');
    const url = `/api/sftp/${connectionId}/download?path=${encodeURIComponent(path)}`;
    // Create a temporary link with auth
    const a = document.createElement('a');
    // We need to fetch with auth header, then trigger download
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Download failed');
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      })
      .catch((err) => {
        addToast(err instanceof Error ? err.message : 'Download failed', 'error');
      });
  }, [connectionId, addToast]);

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      addToast('Path copied to clipboard', 'success');
    }).catch(() => {
      addToast('Failed to copy path', 'error');
    });
  }, [addToast]);

  const handleNewFolder = useCallback(
    async (name: string) => {
      const newPath = buildFullPath(currentPathRef.current, name);
      try {
        await apiPost(`/api/sftp/${connectionId}/mkdir?path=${encodeURIComponent(newPath)}`);
        addToast('Folder created', 'success');
        fetchDirectory(currentPathRef.current);
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Failed to create folder', 'error');
      } finally {
        setShowNewFolder(false);
      }
    },
    [connectionId, fetchDirectory, addToast]
  );

  // ------ Upload (Drag & Drop + File Input) ------

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setIsUploading(true);

      let successCount = 0;
      let failCount = 0;

      for (const file of files) {
        try {
          await apiUpload(
            `/api/sftp/${connectionId}/upload`,
            file,
            { path: currentPathRef.current }
          );
          successCount++;
        } catch {
          failCount++;
        }
      }

      setIsUploading(false);

      if (successCount > 0) {
        addToast(`Uploaded ${successCount} file${successCount > 1 ? 's' : ''}`, 'success');
      }
      if (failCount > 0) {
        addToast(`Failed to upload ${failCount} file${failCount > 1 ? 's' : ''}`, 'error');
      }

      fetchDirectory(currentPathRef.current);
    },
    [connectionId, fetchDirectory, addToast]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if we're actually leaving the drop zone
    const relatedTarget = e.relatedTarget as Node | null;
    if (dropZoneRef.current && relatedTarget && dropZoneRef.current.contains(relatedTarget)) {
      return;
    }
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        uploadFiles(files);
      }
    },
    [uploadFiles]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length > 0) {
        uploadFiles(files);
      }
      // Reset input so the same file can be selected again
      e.target.value = '';
    },
    [uploadFiles]
  );

  // ------ Build context menu items ------

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (!contextMenu) return [];

    if (contextMenu.entry === null) {
      // Background context menu
      return [
        { label: 'New Folder', icon: <FolderPlus size={13} />, action: () => setShowNewFolder(true) },
        { label: 'Upload File', icon: <Upload size={13} />, action: () => fileInputRef.current?.click() },
        { label: 'Refresh', icon: <RefreshCw size={13} />, action: () => fetchDirectory(currentPathRef.current), separator: true },
        { label: 'Copy Path', icon: <ClipboardCopy size={13} />, action: () => handleCopyPath(currentPathRef.current), separator: true },
      ];
    }

    const entry = contextMenu.entry;
    const fullPath = contextMenu.fullPath;

    if (entry.type === 'directory') {
      return [
        { label: 'Open', icon: <Folder size={13} />, action: () => handleNavigate(fullPath) },
        { label: 'Rename', icon: <Pencil size={13} />, action: () => handleRename(fullPath), separator: true },
        { label: 'Copy Path', icon: <ClipboardCopy size={13} />, action: () => handleCopyPath(fullPath) },
        {
          label: 'Delete',
          icon: <Trash2 size={13} />,
          action: () => setDeleteTarget({ name: entry.name, path: fullPath, isDirectory: true }),
          danger: true,
          separator: true,
        },
      ];
    }

    // File context menu
    const items: ContextMenuItem[] = [];

    if (isTextFile(entry.name)) {
      items.push({
        label: 'Edit',
        icon: <FilePlus size={13} />,
        action: () => {
          const tabId = `editor-${connectionId}-${fullPath}`;
          useTabStore.getState().addTab({
            id: tabId,
            type: 'editor',
            title: entry.name,
            connectionId,
            isConnected: true,
            meta: { filePath: fullPath, language: getLanguageForFile(entry.name) },
          });
        },
      });
    }

    items.push({ label: 'Download', icon: <Download size={13} />, action: () => handleDownload(fullPath, entry.name) });
    items.push({ label: 'Rename', icon: <Pencil size={13} />, action: () => handleRename(fullPath), separator: true });
    items.push({ label: 'Copy Path', icon: <ClipboardCopy size={13} />, action: () => handleCopyPath(fullPath) });
    items.push({
      label: 'Delete',
      icon: <Trash2 size={13} />,
      action: () => setDeleteTarget({ name: entry.name, path: fullPath, isDirectory: false }),
      danger: true,
      separator: true,
    });

    return items;
  }, [contextMenu, connectionId, fetchDirectory, handleNavigate, handleRename, handleDownload, handleCopyPath]);

  // ------ Render ------

  if (!connectionId) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <HardDrive size={28} className="text-[var(--text-muted)] mb-2" />
        <p className="text-xs text-[var(--text-secondary)] mb-1">Connect to view files</p>
        <p className="text-[10px] text-[var(--text-muted)]">
          Open an SSH session to browse remote files
        </p>
      </div>
    );
  }

  return (
    <div
      ref={dropZoneRef}
      className={`flex flex-col h-full relative ${
        isDragOver ? 'ring-2 ring-[var(--accent)] ring-inset' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={handleBackgroundContextMenu}
    >
      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-[var(--accent-muted)] z-20 flex items-center justify-center rounded pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <Upload size={24} className="text-[var(--accent)]" />
            <span className="text-xs text-[var(--accent)] font-medium">Drop files to upload</span>
          </div>
        </div>
      )}

      {/* Upload progress overlay */}
      {isUploading && (
        <div className="absolute inset-0 bg-black/30 z-20 flex items-center justify-center rounded">
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={24} className="text-[var(--accent)] animate-spin" />
            <span className="text-xs text-[var(--text-primary)] font-medium">Uploading...</span>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-[var(--border-primary)] min-h-[28px]">
        <button
          onClick={() => {
            apiGet<{ path: string }>(`/api/sftp/${connectionId}/home`)
              .then((res) => fetchDirectory(res.path))
              .catch(() => {});
          }}
          className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors flex-shrink-0 p-1 rounded hover:bg-[var(--bg-hover)]"
          title="Go to home directory"
        >
          <Home size={13} />
        </button>
        <button
          onClick={() => setShowHidden((prev) => !prev)}
          className={`transition-colors flex-shrink-0 p-1 rounded hover:bg-[var(--bg-hover)] ${
            showHidden ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--accent)]'
          }`}
          title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
        >
          {showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowNewFolder(true)}
          className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors flex-shrink-0 p-1 rounded hover:bg-[var(--bg-hover)]"
          title="New folder"
        >
          <FolderPlus size={13} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors flex-shrink-0 p-1 rounded hover:bg-[var(--bg-hover)]"
          title="Upload file"
        >
          <Upload size={13} />
        </button>
      </div>

      {/* Breadcrumb path bar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-[var(--border-primary)] overflow-x-auto min-h-[24px]">
        <button
          onClick={() => fetchDirectory('/')}
          className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors flex-shrink-0 p-0.5 rounded hover:bg-[var(--bg-hover)]"
          title="Go to root"
        >
          <HardDrive size={11} />
        </button>
        {breadcrumbParts.map((part, idx) => (
          <React.Fragment key={idx}>
            <span className="text-[10px] text-[var(--text-muted)]">/</span>
            <button
              onClick={() => handleBreadcrumbClick(idx)}
              className={`text-[10px] flex-shrink-0 transition-colors ${
                idx === breadcrumbParts.length - 1
                  ? 'text-[var(--text-primary)] font-medium'
                  : 'text-[var(--text-secondary)] hover:text-[var(--accent)]'
              }`}
            >
              {part}
            </button>
          </React.Fragment>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => fetchDirectory(currentPath)}
          className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors flex-shrink-0 p-0.5"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* File listing */}
      <div className="flex-1 overflow-y-auto" onContextMenu={handleBackgroundContextMenu}>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="text-[var(--text-muted)] animate-spin" />
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-[var(--danger)]">{error}</p>
            <button
              onClick={() => fetchDirectory(currentPath)}
              className="text-[10px] text-[var(--accent)] hover:underline mt-1"
            >
              Retry
            </button>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-[var(--text-muted)]">
              {entries.length > 0 ? 'Only hidden files in this directory' : 'Empty directory'}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              {entries.length > 0
                ? 'Toggle hidden files to view them'
                : 'Right-click for options or drag files to upload'}
            </p>
          </div>
        ) : (
          <div className="py-1">
            {visibleEntries.map((entry) => {
              const fullPath = buildFullPath(currentPath, entry.name);
              return (
                <EntryRow
                  key={entry.name}
                  entry={entry}
                  basePath={currentPath}
                  connectionId={connectionId}
                  isRenaming={renamingPath === fullPath}
                  onNavigate={handleNavigate}
                  onContextMenu={handleEntryContextMenu}
                  onRenameSubmit={handleRenameSubmit}
                  onRenameCancel={handleRenameCancel}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={closeContextMenu}
          items={getContextMenuItems()}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <DeleteConfirmDialog
          name={deleteTarget.name}
          isDirectory={deleteTarget.isDirectory}
          onConfirm={() => handleDelete(deleteTarget.path)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* New Folder Dialog */}
      {showNewFolder && (
        <NewFolderDialog
          onConfirm={handleNewFolder}
          onCancel={() => setShowNewFolder(false)}
        />
      )}
    </div>
  );
};

export default SftpBrowser;
