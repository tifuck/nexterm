import React from 'react';
import { Monitor, Eye } from 'lucide-react';
import { useTabStore } from '@/store/tabStore';
import HomeTab from '../tabs/HomeTab';
import SettingsTab from '../tabs/SettingsTab';
import FileEditor from '../editor/FileEditor';
import TerminalContainer from '../terminal/TerminalContainer';
import { TerminalToolbar } from '../terminal/TerminalToolbar';
import type { ConnectionConfig } from '../terminal/TerminalContainer';

/** Placeholder for content types not yet implemented */
const Placeholder: React.FC<{ label: string; icon: React.ReactNode }> = ({ label, icon }) => (
  <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
    {icon}
    <span className="text-sm font-medium">{label}</span>
  </div>
);

/**
 * Renders content for every open tab.
 * Uses opacity transition for smooth tab switches while keeping all tabs alive.
 */
const MainContent: React.FC = () => {
  const tabs = useTabStore((s) => s.tabs);
  const activeTab = useTabStore((s) => s.activeTab);

  // Show home when activeTab is 'home' (dedicated home view, not a tab)
  const showHome = activeTab === 'home';

  return (
    <div className="flex-1 relative overflow-hidden bg-[var(--bg-primary)]">
      {/* Dedicated home view (not in tabs list) */}
      <div
        className="absolute inset-0 transition-opacity duration-150 ease-in-out"
        style={{
          opacity: showHome ? 1 : 0,
          pointerEvents: showHome ? 'auto' : 'none',
          zIndex: showHome ? 1 : 0,
        }}
      >
        <HomeTab />
      </div>

      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const isTerminal = tab.type === 'ssh' || tab.type === 'telnet';

        return (
          <div
            key={tab.id}
            className="absolute inset-0 transition-opacity duration-150 ease-in-out"
            style={{
              opacity: isActive ? 1 : 0,
              pointerEvents: isActive ? 'auto' : 'none',
              zIndex: isActive ? 1 : 0,
            }}
          >
            {tab.type === 'home' && <HomeTab />}

            {isTerminal && (
              <div className="relative w-full h-full">
                <TerminalContainer
                  tabId={tab.id}
                  sessionId={tab.sessionId}
                  connectionConfig={
                    tab.meta
                      ? ({
                          host: tab.meta.host,
                          port: tab.meta.port,
                          username: tab.meta.username,
                          password: tab.meta.password,
                          sshKey: tab.meta.sshKey,
                        } as ConnectionConfig)
                      : undefined
                  }
                />
                <TerminalToolbar tabId={tab.id} />
              </div>
            )}

            {tab.type === 'rdp' && (
              <Placeholder label="RDP Coming Soon" icon={<Monitor size={40} />} />
            )}

            {tab.type === 'vnc' && (
              <Placeholder label="VNC Coming Soon" icon={<Eye size={40} />} />
            )}

            {tab.type === 'editor' && <FileEditor tab={tab} />}

            {tab.type === 'settings' && <SettingsTab />}
          </div>
        );
      })}
    </div>
  );
};

export default MainContent;
