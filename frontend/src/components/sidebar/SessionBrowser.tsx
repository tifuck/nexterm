import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Terminal,
  Monitor,
  Eye,
  Radio,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderClosed,
  Pencil,
  Trash2,
  Copy,
  Play,
  Plus,
  FolderPlus,
  Palette,
  GripVertical,
} from 'lucide-react';
import { useSessionStore } from '@/store/sessionStore';
import type { Session, Folder as SessionFolder } from '@/types/session';
import { useTabStore } from '@/store/tabStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useToastStore } from '@/store/toastStore';
import { PROTOCOL_COLORS } from '@/utils/protocolColors';
import { NewSessionDialog } from '@/components/sessions/NewSessionDialog';

const PROTOCOL_ICONS: Record<string, React.ReactNode> = {
  ssh: <Terminal size={14} style={{ color: PROTOCOL_COLORS.ssh }} />,
  rdp: <Monitor size={14} style={{ color: PROTOCOL_COLORS.rdp }} />,
  vnc: <Eye size={14} style={{ color: PROTOCOL_COLORS.vnc }} />,
  telnet: <Radio size={14} style={{ color: PROTOCOL_COLORS.telnet }} />,
  ftp: <FolderOpen size={14} style={{ color: PROTOCOL_COLORS.ftp }} />,
};

function getProtocolIcon(protocol: string): React.ReactNode {
  return PROTOCOL_ICONS[protocol.toLowerCase()] ?? <Terminal size={14} className="text-[var(--text-tertiary)]" />;
}

const FOLDER_COLORS = [
  null,
  '#00e5ff',
  '#3fb950',
  '#f0b429',
  '#f85149',
  '#d2a8ff',
  '#ff7b72',
  '#79c0ff',
  '#ffa657',
];

/* ---------- Session Context Menu ---------- */

interface ContextMenuState {
  x: number;
  y: number;
  session: Session;
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onConnect: (session: Session) => void;
  onEdit: (session: Session) => void;
  onDuplicate: (session: Session) => void;
  onDelete: (session: Session) => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ state, onClose, onConnect, onEdit, onDuplicate, onDelete }) => {
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

  // Clamp position to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(state.x, window.innerWidth - 180),
    top: Math.min(state.y, window.innerHeight - 200),
    zIndex: 9999,
  };

  const items = [
    { label: 'Connect', icon: <Play size={13} />, action: () => onConnect(state.session) },
    { label: 'Edit', icon: <Pencil size={13} />, action: () => onEdit(state.session) },
    { label: 'Duplicate', icon: <Copy size={13} />, action: () => onDuplicate(state.session) },
    { label: 'Delete', icon: <Trash2 size={13} />, action: () => onDelete(state.session), danger: true },
  ];

  return (
    <div ref={menuRef} style={style} className="w-44 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md shadow-xl py-1 animate-slide-down">
      <div className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] truncate border-b border-[var(--border)] mb-0.5">
        {state.session.name}
      </div>
      {items.map((item) => (
        <button
          key={item.label}
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
      ))}
    </div>
  );
};

/* ---------- Folder Context Menu ---------- */

interface FolderContextMenuState {
  x: number;
  y: number;
  folder: SessionFolder;
}

interface FolderContextMenuProps {
  state: FolderContextMenuState;
  onClose: () => void;
  onRename: (folder: SessionFolder) => void;
  onChangeColor: (folder: SessionFolder) => void;
  onDelete: (folder: SessionFolder) => void;
}

const FolderContextMenu: React.FC<FolderContextMenuProps> = ({ state, onClose, onRename, onChangeColor, onDelete }) => {
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
    left: Math.min(state.x, window.innerWidth - 180),
    top: Math.min(state.y, window.innerHeight - 200),
    zIndex: 9999,
  };

  const items = [
    { label: 'Rename', icon: <Pencil size={13} />, action: () => onRename(state.folder) },
    { label: 'Change Color', icon: <Palette size={13} />, action: () => onChangeColor(state.folder) },
    { label: 'Delete', icon: <Trash2 size={13} />, action: () => onDelete(state.folder), danger: true },
  ];

  return (
    <div ref={menuRef} style={style} className="w-44 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md shadow-xl py-1 animate-slide-down">
      <div className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] truncate border-b border-[var(--border)] mb-0.5">
        {state.folder.name}
      </div>
      {items.map((item) => (
        <button
          key={item.label}
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
      ))}
    </div>
  );
};

/* ---------- Color Picker Popover ---------- */

interface ColorPickerProps {
  folder: SessionFolder;
  onClose: () => void;
  onSelect: (folderId: string, color: string | null) => void;
}

const ColorPicker: React.FC<ColorPickerProps> = ({ folder, onClose, onSelect }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
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

  return (
    <div
      ref={ref}
      className="absolute left-6 top-0 z-50 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md shadow-xl p-2 animate-slide-down"
    >
      <div className="text-[10px] text-[var(--text-muted)] mb-1.5">Folder color</div>
      <div className="flex items-center gap-1">
        {FOLDER_COLORS.map((color, i) => (
          <button
            key={i}
            onClick={() => { onSelect(folder.id, color); onClose(); }}
            className={`w-5 h-5 rounded-full border-2 transition-transform active:scale-90 ${
              (folder.color ?? null) === color
                ? 'border-white scale-110'
                : 'border-transparent hover:scale-110'
            }`}
            style={{
              backgroundColor: color ?? 'transparent',
              ...(color === null ? { border: '2px dashed var(--border-secondary)' } : {}),
            }}
            title={color ?? 'None'}
          />
        ))}
      </div>
    </div>
  );
};

/* ---------- Delete Confirmation ---------- */

interface DeleteConfirmProps {
  session: Session;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirm: React.FC<DeleteConfirmProps> = ({ session, onConfirm, onCancel }) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg shadow-2xl p-5 max-w-sm mx-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Delete Session</h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Are you sure you want to delete <strong className="text-[var(--text-primary)]">{session.name}</strong>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs font-medium text-white bg-[var(--danger)] rounded hover:brightness-110 transition-all active:scale-95"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------- Delete Folder Confirmation ---------- */

interface DeleteFolderConfirmProps {
  folder: SessionFolder;
  sessionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteFolderConfirm: React.FC<DeleteFolderConfirmProps> = ({ folder, sessionCount, onConfirm, onCancel }) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg shadow-2xl p-5 max-w-sm mx-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Delete Folder</h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Are you sure you want to delete <strong className="text-[var(--text-primary)]">{folder.name}</strong>?
          {sessionCount > 0 && (
            <> The {sessionCount} session{sessionCount > 1 ? 's' : ''} inside will be moved to the root level.</>
          )}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs font-medium text-white bg-[var(--danger)] rounded hover:brightness-110 transition-all active:scale-95"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------- Folder Node ---------- */

interface FolderNodeProps {
  folder: SessionFolder;
  sessions: Session[];
  allFolders: SessionFolder[];
  expandedFolders: Set<string>;
  renamingFolderId: string | null;
  depth: number;
  onToggleFolder: (folderId: string) => void;
  onConnectSession: (session: Session) => void;
  onContextMenu: (e: React.MouseEvent, session: Session) => void;
  onFolderContextMenu: (e: React.MouseEvent, folder: SessionFolder) => void;
  onRenameSubmit: (folderId: string, newName: string) => void;
  onRenameCancel: () => void;
  onDragOver: (e: React.DragEvent, folderId: string) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, folderId: string) => void;
  onFolderDragStart: (e: React.DragEvent, folderId: string) => void;
  onFolderDragEnd: () => void;
  dragOverFolderId: string | null;
}

const FolderNode: React.FC<FolderNodeProps> = ({
  folder,
  sessions,
  allFolders,
  expandedFolders,
  renamingFolderId,
  depth,
  onToggleFolder,
  onConnectSession,
  onContextMenu,
  onFolderContextMenu,
  onRenameSubmit,
  onRenameCancel,
  onDragOver,
  onDragLeave,
  onDrop,
  onFolderDragStart,
  onFolderDragEnd,
  dragOverFolderId,
}) => {
  const isExpanded = expandedFolders.has(folder.id);
  const folderSessions = sessions.filter((s) => s.folder_id === folder.id);
  const isRenaming = renamingFolderId === folder.id;
  const isDragOver = dragOverFolderId === folder.id;
  const [renameValue, setRenameValue] = useState(folder.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(folder.name);
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [isRenaming, folder.name]);

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const trimmed = renameValue.trim();
      if (trimmed) onRenameSubmit(folder.id, trimmed);
      else onRenameCancel();
    }
    if (e.key === 'Escape') onRenameCancel();
  };

  const folderColor = folder.color || undefined;
  const childFolders = allFolders.filter((f) => f.parent_id === folder.id);

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          // Don't start drag if we're renaming
          if (isRenaming) { e.preventDefault(); return; }
          onFolderDragStart(e, folder.id);
        }}
        onDragEnd={onFolderDragEnd}
        onDragOver={(e) => onDragOver(e, folder.id)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, folder.id)}
        className={`rounded-md transition-all ${isDragOver ? 'bg-[var(--accent-muted)] ring-1 ring-[var(--accent)]' : ''}`}
      >
        <button
          onClick={() => onToggleFolder(folder.id)}
          onContextMenu={(e) => { e.preventDefault(); onFolderContextMenu(e, folder); }}
          className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left rounded-md hover:bg-[var(--bg-hover)] transition-colors group cursor-grab active:cursor-grabbing"
        >
          {isExpanded ? (
            <ChevronDown size={12} className="text-[var(--text-tertiary)] flex-shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-[var(--text-tertiary)] flex-shrink-0" />
          )}
          {isExpanded ? (
            <Folder size={14} className="flex-shrink-0" style={{ color: folderColor ?? 'var(--accent)' }} />
          ) : (
            <FolderClosed size={14} className="flex-shrink-0" style={{ color: folderColor ?? 'var(--text-secondary)' }} />
          )}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={() => {
                const trimmed = renameValue.trim();
                if (trimmed) onRenameSubmit(folder.id, trimmed);
                else onRenameCancel();
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--accent)] rounded px-1.5 py-0.5 outline-none min-w-0"
              autoFocus
            />
          ) : (
            <span className="text-xs font-medium text-[var(--text-primary)] truncate">
              {folder.name}
            </span>
          )}
          <span className="text-[10px] text-[var(--text-muted)] ml-auto flex-shrink-0">
            {folderSessions.length}
          </span>
        </button>
      </div>

      {isExpanded && (
        <div className="ml-4 border-l border-[var(--border-primary)] pl-1">
          {/* Child folders (only at depth 0) */}
          {depth === 0 && childFolders.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              sessions={sessions}
              allFolders={allFolders}
              expandedFolders={expandedFolders}
              renamingFolderId={renamingFolderId}
              depth={1}
              onToggleFolder={onToggleFolder}
              onConnectSession={onConnectSession}
              onContextMenu={onContextMenu}
              onFolderContextMenu={onFolderContextMenu}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onFolderDragStart={onFolderDragStart}
              onFolderDragEnd={onFolderDragEnd}
              dragOverFolderId={dragOverFolderId}
            />
          ))}
          {folderSessions.length === 0 && childFolders.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-[var(--text-muted)] italic">
              Empty
            </div>
          ) : (
            folderSessions.map((session) => (
              <SessionNode
                key={session.id}
                session={session}
                onConnect={onConnectSession}
                onContextMenu={onContextMenu}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

/* ---------- Session Node ---------- */

interface SessionNodeProps {
  session: Session;
  onConnect: (session: Session) => void;
  onContextMenu: (e: React.MouseEvent, session: Session) => void;
}

const SessionNode: React.FC<SessionNodeProps> = ({ session, onConnect, onContextMenu }) => {
  const handleDoubleClick = useCallback(() => {
    onConnect(session);
  }, [session, onConnect]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(e, session);
  }, [session, onContextMenu]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/session-id', session.id);
    e.dataTransfer.effectAllowed = 'move';
  }, [session.id]);

  return (
    <button
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      className="flex items-center gap-2 w-full px-2 py-1.5 text-left rounded-md hover:bg-[var(--bg-hover)] transition-colors group cursor-grab active:cursor-grabbing"
    >
      <span className="flex-shrink-0">{getProtocolIcon(session.session_type)}</span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-xs text-[var(--text-primary)] truncate leading-tight">
          {session.name}
        </span>
        <span className="text-[10px] text-[var(--text-muted)] truncate leading-tight">
          {session.host}
          {session.port ? `:${session.port}` : ''} &middot;{' '}
          {session.session_type.toUpperCase()}
        </span>
      </div>
      {session.color && (
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: session.color }}
        />
      )}
    </button>
  );
};

/* ---------- Background Context Menu ---------- */

interface BgContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
  onNewSession: () => void;
  onNewFolder: () => void;
}

const BgContextMenu: React.FC<BgContextMenuProps> = ({ position, onClose, onNewSession, onNewFolder }) => {
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
    left: Math.min(position.x, window.innerWidth - 180),
    top: Math.min(position.y, window.innerHeight - 100),
    zIndex: 9999,
  };

  return (
    <div ref={menuRef} style={style} className="w-44 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md shadow-xl py-1 animate-slide-down">
      <button
        onClick={() => { onNewSession(); onClose(); }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Plus size={13} />
        New Session
      </button>
      <button
        onClick={() => { onNewFolder(); onClose(); }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <FolderPlus size={13} />
        New Folder
      </button>
    </div>
  );
};

/* ---------- New Folder Inline ---------- */

interface NewFolderInlineProps {
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

const NewFolderInline: React.FC<NewFolderInlineProps> = ({ onSubmit, onCancel }) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const trimmed = name.trim();
      if (trimmed) onSubmit(trimmed);
      else onCancel();
    }
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5">
      <FolderPlus size={14} className="text-[var(--accent)] flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          const trimmed = name.trim();
          if (trimmed) onSubmit(trimmed);
          else onCancel();
        }}
        placeholder="Folder name..."
        className="flex-1 bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--accent)] rounded px-1.5 py-0.5 outline-none placeholder:text-[var(--text-muted)] min-w-0"
      />
    </div>
  );
};

/* ---------- Session Browser ---------- */

export const SessionBrowser: React.FC = () => {
  const {
    sessions, folders,
    deleteSession, duplicateSession,
    fetchSessions, fetchFolders,
    createFolder, updateFolder, deleteFolder,
    moveSessions,
  } = useSessionStore();
  const { addTab } = useTabStore();
  const { searchQuery } = useSidebarStore();
  const addToast = useToastStore((s) => s.addToast);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);
  const [bgContextMenu, setBgContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [deletingSession, setDeletingSession] = useState<Session | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<SessionFolder | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [colorPickerFolder, setColorPickerFolder] = useState<SessionFolder | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);

  const handleToggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleConnectSession = useCallback(
    (session: Session) => {
      addTab({
        id: `tab-${session.id}-${Date.now()}`,
        title: session.name,
        type: session.session_type,
        sessionId: session.id,
        isConnected: false,
        meta: {
          host: session.host,
          port: session.port,
          username: session.username ?? '',
        },
      });

      // Auto-close sidebar on mobile so the terminal is immediately visible
      if (window.innerWidth < 640) {
        const { isOpen, toggle } = useSidebarStore.getState();
        if (isOpen) toggle();
      }
    },
    [addTab]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, session: Session) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  }, []);

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folder: SessionFolder) => {
    e.preventDefault();
    setFolderContextMenu({ x: e.clientX, y: e.clientY, folder });
  }, []);

  const handleEdit = useCallback((session: Session) => {
    setEditingSession(session);
  }, []);

  const handleDuplicate = useCallback(async (session: Session) => {
    try {
      await duplicateSession(session.id);
      addToast('Session duplicated', 'success');
    } catch {
      addToast('Failed to duplicate session', 'error');
    }
  }, [duplicateSession, addToast]);

  const handleDeleteRequest = useCallback((session: Session) => {
    setDeletingSession(session);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingSession) return;
    try {
      await deleteSession(deletingSession.id);
      addToast('Session deleted', 'success');
    } catch {
      addToast('Failed to delete session', 'error');
    }
    setDeletingSession(null);
  }, [deletingSession, deleteSession, addToast]);

  // Folder actions
  const handleFolderRename = useCallback((folder: SessionFolder) => {
    setRenamingFolderId(folder.id);
  }, []);

  const handleFolderRenameSubmit = useCallback(async (folderId: string, newName: string) => {
    try {
      await updateFolder(folderId, { name: newName });
      addToast('Folder renamed', 'success');
    } catch {
      addToast('Failed to rename folder', 'error');
    }
    setRenamingFolderId(null);
  }, [updateFolder, addToast]);

  const handleFolderRenameCancel = useCallback(() => {
    setRenamingFolderId(null);
  }, []);

  const handleFolderChangeColor = useCallback((folder: SessionFolder) => {
    setColorPickerFolder(folder);
  }, []);

  const handleFolderColorSelect = useCallback(async (folderId: string, color: string | null) => {
    try {
      await updateFolder(folderId, { color: color });
    } catch {
      addToast('Failed to update folder color', 'error');
    }
    setColorPickerFolder(null);
  }, [updateFolder, addToast]);

  const handleFolderDeleteRequest = useCallback((folder: SessionFolder) => {
    setDeletingFolder(folder);
  }, []);

  const handleFolderDeleteConfirm = useCallback(async () => {
    if (!deletingFolder) return;
    try {
      await deleteFolder(deletingFolder.id);
      addToast('Folder deleted', 'success');
    } catch {
      addToast('Failed to delete folder', 'error');
    }
    setDeletingFolder(null);
  }, [deletingFolder, deleteFolder, addToast]);

  const handleNewFolder = useCallback(async (name: string) => {
    try {
      await createFolder({ name });
      addToast('Folder created', 'success');
    } catch {
      addToast('Failed to create folder', 'error');
    }
    setShowNewFolder(false);
  }, [createFolder, addToast]);

  // Drag and drop
  const handleDragOverFolder = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    const hasFolderDrag = e.dataTransfer.types.includes('application/folder-id');
    if (hasFolderDrag) {
      // Only accept folder drops on root-level folders that aren't the folder itself
      const targetFolder = folders.find((f) => f.id === folderId);
      if (
        !targetFolder ||
        targetFolder.parent_id ||
        draggingFolderId === folderId
      ) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      // Don't accept if the dragged folder has children
      const draggedHasChildren = folders.some((f) => f.parent_id === draggingFolderId);
      if (draggedHasChildren) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
    }
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolderId(folderId);
  }, [folders, draggingFolderId]);

  const handleDragLeaveFolder = useCallback((e: React.DragEvent) => {
    // Only clear if we're truly leaving (not entering a child element)
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setDragOverFolderId(null);
    }
  }, []);

  const handleDropOnFolder = useCallback(async (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    setDragOverFolderId(null);

    // Handle folder drop
    const droppedFolderId = e.dataTransfer.getData('application/folder-id');
    if (droppedFolderId) {
      if (droppedFolderId === folderId) return;
      try {
        await updateFolder(droppedFolderId, { parent_id: folderId });
        setExpandedFolders((prev) => new Set(prev).add(folderId));
        addToast('Folder moved', 'success');
      } catch {
        addToast('Failed to move folder', 'error');
      }
      return;
    }

    // Handle session drop
    const sessionId = e.dataTransfer.getData('application/session-id');
    if (!sessionId) return;
    try {
      await moveSessions([sessionId], folderId);
      // Auto-expand the target folder
      setExpandedFolders((prev) => new Set(prev).add(folderId));
      addToast('Session moved', 'success');
    } catch {
      addToast('Failed to move session', 'error');
    }
  }, [moveSessions, updateFolder, addToast]);

  const handleFolderDragStart = useCallback((e: React.DragEvent, folderId: string) => {
    e.dataTransfer.setData('application/folder-id', folderId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingFolderId(folderId);
  }, []);

  const handleFolderDragEnd = useCallback(() => {
    setDraggingFolderId(null);
    setDragOverFolderId(null);
  }, []);

  const handleDragOverRoot = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverRoot(true);
  }, []);

  const handleDragLeaveRoot = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setDragOverRoot(false);
    }
  }, []);

  const handleDropOnRoot = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverRoot(false);

    // Handle folder drop (un-nest to root)
    const droppedFolderId = e.dataTransfer.getData('application/folder-id');
    if (droppedFolderId) {
      const folder = folders.find((f) => f.id === droppedFolderId);
      if (folder && !folder.parent_id) return; // Already root
      try {
        await updateFolder(droppedFolderId, { parent_id: null });
        addToast('Folder moved to root', 'success');
      } catch {
        addToast('Failed to move folder', 'error');
      }
      return;
    }

    // Handle session drop
    const sessionId = e.dataTransfer.getData('application/session-id');
    if (!sessionId) return;
    // Check if the session is already at root
    const session = sessions.find((s) => s.id === sessionId);
    if (session && !session.folder_id) return; // Already root
    try {
      await moveSessions([sessionId], null);
      addToast('Session moved to root', 'success');
    } catch {
      addToast('Failed to move session', 'error');
    }
  }, [moveSessions, updateFolder, addToast, sessions, folders]);

  const handleEditClose = useCallback(() => {
    setEditingSession(null);
    fetchSessions().catch(() => {});
    fetchFolders().catch(() => {});
  }, [fetchSessions, fetchFolders]);

  const handleNewSessionClose = useCallback(() => {
    setShowNewSession(false);
    fetchSessions().catch(() => {});
    fetchFolders().catch(() => {});
  }, [fetchSessions, fetchFolders]);

  const handleBgContextMenu = useCallback((e: React.MouseEvent) => {
    // Only show if the click target is the background container itself (not a child session/folder)
    if (e.target === e.currentTarget) {
      e.preventDefault();
      setBgContextMenu({ x: e.clientX, y: e.clientY });
    }
  }, []);

  const filteredSessions = useMemo(() => {
    if (!searchQuery) return sessions;
    const query = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.host.toLowerCase().includes(query) ||
        s.session_type.toLowerCase().includes(query)
    );
  }, [sessions, searchQuery]);

  const rootSessions = useMemo(
    () => filteredSessions.filter((s) => !s.folder_id),
    [filteredSessions]
  );

  const hasMatchesInFolder = useCallback(
    (folderId: string) => {
      // Check direct sessions and sessions in child folders
      if (filteredSessions.some((s) => s.folder_id === folderId)) return true;
      const childFolderIds = folders.filter((f) => f.parent_id === folderId).map((f) => f.id);
      return childFolderIds.some((childId) => filteredSessions.some((s) => s.folder_id === childId));
    },
    [filteredSessions, folders]
  );

  const visibleFolders = useMemo(() => {
    // Only show root-level folders; child folders render inside their parent
    const rootFolders = folders.filter((f) => !f.parent_id);
    if (!searchQuery) return rootFolders;
    return rootFolders.filter((f) => hasMatchesInFolder(f.id));
  }, [folders, searchQuery, hasMatchesInFolder]);

  const deletingFolderSessionCount = useMemo(() => {
    if (!deletingFolder) return 0;
    const childFolderIds = folders.filter((f) => f.parent_id === deletingFolder.id).map((f) => f.id);
    const allFolderIds = [deletingFolder.id, ...childFolderIds];
    return sessions.filter((s) => s.folder_id && allFolderIds.includes(s.folder_id)).length;
  }, [deletingFolder, sessions, folders]);

  if (sessions.length === 0 && folders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <Terminal size={28} className="text-[var(--text-muted)] mb-2" />
        <p className="text-xs text-[var(--text-secondary)] mb-1">No sessions yet</p>
        <p className="text-[10px] text-[var(--text-muted)]">
          Create a new session to get started
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        className="flex flex-col gap-0.5 py-1 flex-1 min-h-0"
        onContextMenu={handleBgContextMenu}
      >
        {/* New Folder inline input */}
        {showNewFolder && (
          <NewFolderInline
            onSubmit={handleNewFolder}
            onCancel={() => setShowNewFolder(false)}
          />
        )}

        {/* Folders */}
        {visibleFolders.map((folder) => (
          <div key={folder.id} className="relative">
            <FolderNode
              folder={folder}
              sessions={filteredSessions}
              allFolders={folders}
              expandedFolders={expandedFolders}
              renamingFolderId={renamingFolderId}
              depth={0}
              onToggleFolder={handleToggleFolder}
              onConnectSession={handleConnectSession}
              onContextMenu={handleContextMenu}
              onFolderContextMenu={handleFolderContextMenu}
              onRenameSubmit={handleFolderRenameSubmit}
              onRenameCancel={handleFolderRenameCancel}
              onDragOver={handleDragOverFolder}
              onDragLeave={handleDragLeaveFolder}
              onDrop={handleDropOnFolder}
              onFolderDragStart={handleFolderDragStart}
              onFolderDragEnd={handleFolderDragEnd}
              dragOverFolderId={dragOverFolderId}
            />
            {colorPickerFolder?.id === folder.id && (
              <ColorPicker
                folder={folder}
                onClose={() => setColorPickerFolder(null)}
                onSelect={handleFolderColorSelect}
              />
            )}
          </div>
        ))}

        {/* Root-level drop zone for sessions */}
        <div
          onDragOver={handleDragOverRoot}
          onDragLeave={handleDragLeaveRoot}
          onDrop={handleDropOnRoot}
          className={`flex-1 min-h-[24px] rounded-md transition-all ${
            dragOverRoot ? 'bg-[var(--accent-muted)] ring-1 ring-[var(--accent)] ring-dashed' : ''
          }`}
        >
          {/* Root-level sessions (no folder) */}
          {rootSessions.length > 0 && visibleFolders.length > 0 && (
            <div className="h-px bg-[var(--border-primary)] mx-2 my-1" />
          )}
          {rootSessions.map((session) => (
            <SessionNode
              key={session.id}
              session={session}
              onConnect={handleConnectSession}
              onContextMenu={handleContextMenu}
            />
          ))}
        </div>

        {/* No results for search */}
        {searchQuery && filteredSessions.length === 0 && (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-[var(--text-muted)]">No sessions match "{searchQuery}"</p>
          </div>
        )}
      </div>

      {/* Session Context Menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onConnect={handleConnectSession}
          onEdit={handleEdit}
          onDuplicate={handleDuplicate}
          onDelete={handleDeleteRequest}
        />
      )}

      {/* Folder Context Menu */}
      {folderContextMenu && (
        <FolderContextMenu
          state={folderContextMenu}
          onClose={() => setFolderContextMenu(null)}
          onRename={handleFolderRename}
          onChangeColor={handleFolderChangeColor}
          onDelete={handleFolderDeleteRequest}
        />
      )}

      {/* Edit Session Dialog */}
      <NewSessionDialog
        isOpen={!!editingSession}
        onClose={handleEditClose}
        editSession={editingSession ?? undefined}
      />

      {/* Delete Session Confirmation */}
      {deletingSession && (
        <DeleteConfirm
          session={deletingSession}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingSession(null)}
        />
      )}

      {/* Delete Folder Confirmation */}
      {deletingFolder && (
        <DeleteFolderConfirm
          folder={deletingFolder}
          sessionCount={deletingFolderSessionCount}
          onConfirm={handleFolderDeleteConfirm}
          onCancel={() => setDeletingFolder(null)}
        />
      )}

      {/* Background Context Menu */}
      {bgContextMenu && (
        <BgContextMenu
          position={bgContextMenu}
          onClose={() => setBgContextMenu(null)}
          onNewSession={() => setShowNewSession(true)}
          onNewFolder={() => setShowNewFolder(true)}
        />
      )}

      {/* New Session Dialog (from context menu) */}
      <NewSessionDialog
        isOpen={showNewSession}
        onClose={handleNewSessionClose}
      />
    </>
  );
};

export default SessionBrowser;
