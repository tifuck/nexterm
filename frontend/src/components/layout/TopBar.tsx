import React, { useState, useRef, useEffect } from 'react';
import { Menu, LayoutGrid, Wrench, User, LogOut, Settings, FolderTree, HardDrive } from 'lucide-react';
import { useSidebarStore } from '@/store/sidebarStore';
import { useAuthStore } from '@/store/authStore';
import { useTabStore } from '@/store/tabStore';
import { useToolsStore } from '@/store/toolsStore';
import TabBar from '../tabs/TabBar';

type SidebarPanel = 'sessions' | 'sftp';

interface TopBarProps {
  sidebarWidth: number;
  sidebarOpen: boolean;
}

const TopBar: React.FC<TopBarProps> = ({ sidebarWidth }) => {
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const { user, logout } = useAuthStore();
  const addTab = useTabStore((s) => s.addTab);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Sidebar panel state
  const activePanel = useSidebarStore((s) => s.activePanel);
  const setActivePanel = useSidebarStore((s) => s.setActivePanel);

  // Track the active SSH tab's connection ID for SFTP indicator
  const activeTab = useTabStore((s) => s.activeTab);
  const tabs = useTabStore((s) => s.tabs);
  const currentTab = tabs.find((t) => t.id === activeTab);
  const isSSHTab = currentTab?.type === 'ssh' || currentTab?.type === 'telnet';
  const connectionId = isSSHTab ? currentTab?.connectionId : undefined;
  const isConnected = isSSHTab && currentTab?.isConnected && !!connectionId;

  // Tools panel state
  const isPanelOpen = useToolsStore((s) => s.isPanelOpen);
  const toggleTools = useToolsStore((s) => s.togglePanel);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
      <div className="flex items-stretch min-h-[38px] bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
        {/* Sidebar panel tabs — width matches the sidebar below */}
        <div
          className="shrink-0 overflow-hidden transition-[width] duration-200 ease-out flex"
          style={{ width: sidebarWidth }}
        >
          <div className="flex flex-1 min-w-0" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
            <button
              onClick={() => setActivePanel('sessions')}
              className={`relative flex items-center justify-center gap-1.5 flex-1 px-3 text-[11px] font-medium transition-colors ${
                activePanel === 'sessions'
                  ? 'text-[var(--accent)] bg-[var(--accent-muted)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <FolderTree size={13} />
              Sessions
              <span
                className={`absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)] transition-all duration-200 ${
                  activePanel === 'sessions' ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'
                }`}
              />
            </button>
            <button
              onClick={() => setActivePanel('sftp')}
              className={`relative flex items-center justify-center gap-1.5 flex-1 px-3 text-[11px] font-medium transition-colors ${
                activePanel === 'sftp'
                  ? 'text-[var(--accent)] bg-[var(--accent-muted)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <HardDrive size={13} />
              Files
              {connectionId && (
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: 'var(--success)' }}
                  title="SFTP connected"
                />
              )}
              <span
                className={`absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)] transition-all duration-200 ${
                  activePanel === 'sftp' ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'
                }`}
              />
            </button>

          </div>
        </div>

        {/* Right side: hamburger + tabs + actions */}
        <div className="flex items-end flex-1 min-w-0 px-1 sm:px-2 gap-1 sm:gap-2">
          {/* Hamburger */}
          <button
            onClick={toggleSidebar}
            className="p-1 mb-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors active:scale-95 shrink-0"
            title="Toggle sidebar"
          >
            <Menu size={16} />
          </button>

          {/* Tab bar */}
          <div className="flex-1 min-w-0">
            <TabBar />
          </div>

          {/* Right: grid + user (outside overflow-hidden so dropdown works) */}
          <div className="flex items-center shrink-0 gap-1 sm:gap-2 mb-1">
            <button
              className="hidden sm:flex p-1.5 rounded text-[var(--text-muted)] opacity-40 cursor-not-allowed"
              title="Tile view (coming soon)"
              disabled
            >
              <LayoutGrid size={16} />
            </button>

            <button
              onClick={toggleTools}
              disabled={!isConnected}
              className={`hidden sm:flex items-center justify-center p-1.5 rounded transition-colors ${
                !isConnected
                  ? 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
                  : isPanelOpen
                  ? 'text-[var(--accent)] bg-[var(--accent-muted)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              title={isConnected ? 'Server Tools' : 'Connect to SSH to use Server Tools'}
            >
              <Wrench size={16} />
              {isConnected && (
                <span
                  className="w-1.5 h-1.5 rounded-full absolute -top-0.5 -right-0.5"
                  style={{ backgroundColor: 'var(--success)' }}
                />
              )}
            </button>

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--accent-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title="User menu"
              >
                <User size={14} />
              </button>

              {showUserMenu && (
                <div className="absolute right-0 top-9 w-48 max-w-[calc(100vw-1rem)] bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md shadow-xl z-50 py-1 animate-slide-down">
                  {user && (
                    <div className="px-3 py-2 border-b border-[var(--border)]">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {user.username}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {user.email || 'No email'}
                      </p>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      addTab({ id: 'settings', type: 'settings', title: 'Settings', isConnected: false });
                      setShowUserMenu(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <Settings size={14} />
                    Settings
                  </button>
                  <button
                    onClick={() => {
                      logout();
                      setShowUserMenu(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
  );
};

export default TopBar;
