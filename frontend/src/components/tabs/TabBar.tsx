import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Home, X, Plus, Terminal, Monitor, Eye, FileEdit, Globe, Settings } from 'lucide-react';
import { useTabStore } from '@/store/tabStore';
import { useSidebarStore } from '@/store/sidebarStore';
import type { Tab } from '@/types/session';
import { PROTOCOL_COLORS } from '@/utils/protocolColors';

const typeIcon: Record<string, React.ReactNode> = {
  home: <Home size={12} />,
  ssh: <Terminal size={12} />,
  telnet: <Globe size={12} />,
  rdp: <Monitor size={12} />,
  vnc: <Eye size={12} />,
  editor: <FileEdit size={12} />,
  ftp: <FileEdit size={12} />,
  settings: <Settings size={12} />,
};

const typeDotColor: Record<string, string> = {
  home: 'var(--text-muted)',
  ssh: PROTOCOL_COLORS.ssh,
  telnet: PROTOCOL_COLORS.telnet,
  rdp: PROTOCOL_COLORS.rdp,
  vnc: PROTOCOL_COLORS.vnc,
  editor: PROTOCOL_COLORS.ftp,
  ftp: PROTOCOL_COLORS.ftp,
  settings: 'var(--text-secondary)',
};

const MAX_TABS = 20;

const TabBar: React.FC = () => {
  const tabs = useTabStore((s) => s.tabs);
  const activeTab = useTabStore((s) => s.activeTab);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const addTab = useTabStore((s) => s.addTab);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const tabAreaRef = useRef<HTMLDivElement>(null);

  // Detect overflow (multi-row)
  const checkOverflow = useCallback(() => {
    if (tabAreaRef.current) {
      const el = tabAreaRef.current;
      // If scrollHeight > a single row height (~28px + some padding), we're wrapping
      setIsOverflowing(el.scrollHeight > 32);
    }
  }, []);

  useEffect(() => {
    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    if (tabAreaRef.current) observer.observe(tabAreaRef.current);
    return () => observer.disconnect();
  }, [checkOverflow, tabs.length]);

  const handleMouseDown = (e: React.MouseEvent, tab: Tab) => {
    // Middle-click to close
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tab.id);
    }
  };

  const isHomeActive = activeTab === 'home';
  const atMaxTabs = tabs.length >= MAX_TABS;

  return (
    <div className={`flex items-end gap-0.5 min-w-0 ${isOverflowing ? 'pb-1' : ''}`}>
      {/* Home icon button */}
      <div className="flex items-end shrink-0">
        <button
          onClick={() => {
            setActiveTab('home');
            useSidebarStore.getState().setActivePanel('sessions');
          }}
          className={`
            flex items-center justify-center transition-all duration-150 relative shrink-0
            ${isOverflowing ? 'w-6 h-6 rounded' : 'w-8 h-8 rounded-t'}
            ${
              isHomeActive
                ? 'bg-[var(--bg-primary)] text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
            }
          `}
          title="Home"
        >
          <Home size={14} />
          {!isOverflowing && (
            <span
              className={`absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)] transition-all duration-200 ${
                isHomeActive ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'
              }`}
            />
          )}
        </button>

        {/* Separator */}
        {tabs.length > 0 && (
          <div className="w-px h-4 bg-[var(--border)] mx-1 shrink-0 mb-1.5" />
        )}
      </div>

      {/* Tab area */}
      <div
        ref={tabAreaRef}
        className={`flex-1 min-w-0 flex flex-wrap gap-0.5 ${
          isOverflowing ? 'max-h-[72px] overflow-hidden' : ''
        }`}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const dotColor = typeDotColor[tab.type] || '#888';

          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                // Auto-switch sidebar: SFTP for connected SSH/telnet, Sessions otherwise
                if ((tab.type === 'ssh' || tab.type === 'telnet') && tab.isConnected && tab.connectionId) {
                  useSidebarStore.getState().setActivePanel('sftp');
                } else {
                  useSidebarStore.getState().setActivePanel('sessions');
                }
              }}
              onMouseDown={(e) => handleMouseDown(e, tab)}
              className={`
                group flex items-center gap-1.5 px-2.5 text-[11px] whitespace-nowrap
                transition-all duration-150 shrink-0 relative max-w-[160px]
                ${isOverflowing ? 'h-6' : 'h-8'}
                ${isOverflowing
                  ? `rounded-md ${
                      isActive
                        ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] ring-1 ring-[var(--border)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                    }`
                  : `rounded-t ${
                      isActive
                        ? 'bg-[var(--bg-primary)] text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                    }`
                }
              `}
            >
              {/* Colored dot */}
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 transition-transform duration-150 ${
                  isActive ? 'scale-110' : ''
                }`}
                style={{ backgroundColor: dotColor }}
              />

              {/* Icon */}
              <span className="shrink-0 text-[var(--text-muted)]">{typeIcon[tab.type]}</span>

              {/* Title */}
              <span className="max-w-[90px] truncate">{tab.title}</span>

              {/* Close button */}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-150"
              >
                <X size={10} />
              </span>

              {/* Active indicator — only in single-row mode */}
              {!isOverflowing && (
                <span
                  className={`absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)] transition-all duration-200 rounded-full ${
                    isActive ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'
                  }`}
                />
              )}
            </button>
          );
        })}

        {/* Add tab button */}
        {!atMaxTabs && (
          <button
            onClick={() => {
              addTab({ id: `home-${Date.now()}`, title: 'New Tab', type: 'home', isConnected: false });
              useSidebarStore.getState().setActivePanel('sessions');
            }}
            className={`flex items-center justify-center rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors active:scale-90 shrink-0 ${isOverflowing ? 'w-6 h-6' : 'w-8 h-8'}`}
            title="New tab"
          >
            <Plus size={12} />
          </button>
        )}
      </div>

    </div>
  );
};

export default TabBar;
