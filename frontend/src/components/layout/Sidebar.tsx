import React, { useEffect, useState, useCallback } from 'react';
import {
  Search,
  X,
  HardDrive,
  Plus,
  FolderPlus,
  Upload,
} from 'lucide-react';
import { useSidebarStore } from '@/store/sidebarStore';
import { useSessionStore } from '@/store/sessionStore';
import { useTabStore } from '@/store/tabStore';
import { SessionBrowser } from '@/components/sidebar/SessionBrowser';
import { SftpBrowser } from '@/components/sidebar/SftpBrowser';
import { NewSessionDialog } from '@/components/sessions/NewSessionDialog';
import { ImportSessionsDialog } from '@/components/sessions/ImportSessionsDialog';

/* ---------- Skeleton Loader ---------- */
const SessionSkeleton: React.FC = () => (
  <div className="px-2 py-1 space-y-2">
    {[1, 2, 3, 4, 5].map((i) => (
      <div key={i} className="flex items-center gap-2">
        <div className="skeleton w-3 h-3 rounded" />
        <div className="skeleton h-3 flex-1 rounded" style={{ maxWidth: `${60 + i * 10}%` }} />
      </div>
    ))}
  </div>
);

/* ---------- Main Sidebar ---------- */

const Sidebar: React.FC = () => {
  const width = useSidebarStore((s) => s.width);
  const searchQuery = useSidebarStore((s) => s.searchQuery);
  const setSearchQuery = useSidebarStore((s) => s.setSearchQuery);
  const activePanel = useSidebarStore((s) => s.activePanel);
  const { isLoading, fetchSessions, fetchFolders, createFolder } = useSessionStore();
  const [showNewSession, setShowNewSession] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const handleSessionCreated = useCallback(() => {
    setShowNewSession(false);
    fetchSessions().catch(() => {});
    fetchFolders().catch(() => {});
  }, [fetchSessions, fetchFolders]);

  const handleImportClose = useCallback(() => {
    setShowImport(false);
    fetchSessions().catch(() => {});
    fetchFolders().catch(() => {});
  }, [fetchSessions, fetchFolders]);

  const handleNewFolder = useCallback(async () => {
    try {
      await createFolder({ name: 'New Folder' });
    } catch {
      // handled by store
    }
  }, [createFolder]);

  // Track the active SSH tab's connection ID for SFTP
  const activeTab = useTabStore((s) => s.activeTab);
  const tabs = useTabStore((s) => s.tabs);
  const currentTab = tabs.find((t) => t.id === activeTab);
  const isSSHTab = currentTab?.type === 'ssh' || currentTab?.type === 'telnet';
  const connectionId = isSSHTab && currentTab?.isConnected ? currentTab?.connectionId : undefined;

  // Fetch sessions and folders on mount
  useEffect(() => {
    fetchSessions().catch(() => {});
    fetchFolders().catch(() => {});
  }, [fetchSessions, fetchFolders]);

  return (
    <div
      className="flex flex-col h-full bg-[var(--bg-secondary)] shrink-0 overflow-hidden"
      style={{ width }}
    >
      {/* Sessions panel — always mounted, hidden via display */}
      <div className="flex flex-col flex-1 min-h-0" style={{ display: activePanel === 'sessions' ? 'flex' : 'none' }}>
        {/* Search + New Session */}
        <div className="flex items-center gap-1 p-2 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center flex-1 gap-1.5 px-2 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] focus-within:border-[var(--accent)] transition-colors">
            <Search size={13} className="text-[var(--text-muted)] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <button
            onClick={handleNewFolder}
            className="flex items-center justify-center w-7 h-7 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors shrink-0 active:scale-90"
            title="New folder"
          >
            <FolderPlus size={14} />
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center justify-center w-7 h-7 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors shrink-0 active:scale-90"
            title="Import sessions"
          >
            <Upload size={14} />
          </button>
          <button
            onClick={() => setShowNewSession(true)}
            className="flex items-center justify-center w-7 h-7 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors shrink-0 active:scale-90"
            title="New session"
          >
            <Plus size={15} />
          </button>
        </div>

        {/* Session browser */}
        <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
          {isLoading ? <SessionSkeleton /> : <SessionBrowser />}
        </div>
      </div>

      {/* SFTP panel — always mounted once connectionId exists, hidden via display */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden" style={{ display: activePanel === 'sftp' ? 'flex' : 'none' }}>
        {connectionId ? (
          <SftpBrowser connectionId={connectionId} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <HardDrive size={28} className="text-[var(--text-muted)] mb-2" />
            <p className="text-xs text-[var(--text-secondary)] mb-1">No active connection</p>
            <p className="text-[10px] text-[var(--text-muted)]">
              Connect to an SSH session to browse remote files
            </p>
          </div>
        )}
      </div>

      {/* New Session Dialog */}
      <NewSessionDialog
        isOpen={showNewSession}
        onClose={handleSessionCreated}
      />

      {/* Import Sessions Dialog */}
      <ImportSessionsDialog
        isOpen={showImport}
        onClose={handleImportClose}
      />
    </div>
  );
};

export default Sidebar;
