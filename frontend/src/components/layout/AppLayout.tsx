import React, { useRef, useEffect, useCallback } from 'react';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTabStore } from '@/store/tabStore';
import { useToolsStore } from '@/store/toolsStore';
import { useMetricsWs } from '@/hooks/useMetricsWs';
import Sidebar from './Sidebar';
import SidebarResizer from './SidebarResizer';
import TopBar from './TopBar';
import MainContent from './MainContent';
import StatusBar from './StatusBar';
import { ServerToolsPanel } from '../tools/ServerToolsPanel';
import { SystemDashboard } from '../tools/SystemDashboard';
import { ProcessManager } from '../tools/ProcessManager';
import { ServiceManager } from '../tools/ServiceManager';
import { LogViewer } from '../tools/LogViewer';
import { ScriptVault } from '../tools/ScriptVault';
import { SecurityCenter } from '../tools/SecurityCenter';
import { FirewallManager } from '../tools/FirewallManager';
import { PackageManager } from '../tools/PackageManager';
import { DockerManager } from '../tools/DockerManager';
import { WireGuardManager } from '../tools/WireGuardManager';
import { CronManager } from '../tools/CronManager';

const MOBILE_BREAKPOINT = 640; // matches Tailwind's 'sm'

const AppLayout: React.FC = () => {
  const isOpen = useSidebarStore((s) => s.isOpen);
  const width = useSidebarStore((s) => s.width);
  const toggle = useSidebarStore((s) => s.toggle);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Manage the metrics WebSocket (follows the active SSH tab)
  useMetricsWs();

  // Server Tools state
  const activeTab = useTabStore((s) => s.activeTab);
  const tabs = useTabStore((s) => s.tabs);
  const activeToolId = useToolsStore((s) => s.activeToolId);

  // Derive connectionId for tools
  const currentTab = tabs.find((t) => t.id === activeTab);
  const isSSHTab = currentTab?.type === 'ssh' || currentTab?.type === 'telnet';
  const toolsConnectionId = isSSHTab && currentTab?.isConnected ? currentTab?.connectionId : undefined;

  // Close sidebar when viewport shrinks below mobile breakpoint.
  // Uses a ref so the resize handler can read the latest isOpen without
  // re-registering the listener (which was causing an immediate re-close
  // every time the user tried to open the sidebar on mobile).
  const isOpenRef = useRef(isOpen);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  const closeSidebarIfMobile = useCallback(() => {
    if (window.innerWidth < MOBILE_BREAKPOINT && isOpenRef.current) {
      toggle();
    }
  }, [toggle]);

  useEffect(() => {
    // Close on mount if already on a small screen
    closeSidebarIfMobile();

    const handleResize = () => closeSidebarIfMobile();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [closeSidebarIfMobile]);

  // Clamp sidebar width to viewport on small screens
  const effectiveWidth = Math.min(width, typeof window !== 'undefined' ? window.innerWidth * 0.8 : width);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Shared top bar spanning full width */}
      <TopBar sidebarWidth={isOpen ? effectiveWidth : 0} sidebarOpen={isOpen} />

      {/* Below top bar: sidebar + content */}
      <div className="flex flex-1 min-h-0 bg-[var(--bg-secondary)]">
        {/* Sidebar container with slide animation */}
        <div
          ref={sidebarRef}
          className="shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out h-full"
          style={{
            width: isOpen ? effectiveWidth : 0,
            opacity: isOpen ? 1 : 0,
          }}
        >
          <div className="h-full" style={{ width: effectiveWidth, minWidth: effectiveWidth }}>
            <Sidebar />
          </div>
        </div>

        {/* Resizer - zero layout width, wide hit area via padding */}
        {isOpen && <SidebarResizer />}

        {/* Main content */}
        <MainContent />
      </div>

      {/* StatusBar spans full width */}
      <StatusBar />

      {/* Server Tools slide-out panel */}
      {toolsConnectionId && (
        <ServerToolsPanel connectionId={toolsConnectionId} />
      )}

      {/* Server Tools modal for the active tool */}
      {toolsConnectionId && activeToolId === 'system-dashboard' && (
        <SystemDashboard connectionId={toolsConnectionId} />
      )}
      {toolsConnectionId && activeToolId === 'process-manager' && (
        <ProcessManager connectionId={toolsConnectionId} />
      )}
      {toolsConnectionId && activeToolId === 'service-manager' && (
        <ServiceManager connectionId={toolsConnectionId} />
      )}
      {toolsConnectionId && activeToolId === 'log-viewer' && (
        <LogViewer connectionId={toolsConnectionId} />
      )}
      {toolsConnectionId && activeToolId === 'script-vault' && (
        <ScriptVault connectionId={toolsConnectionId} />
      )}
      {toolsConnectionId && activeToolId === 'security-center' && (
        <SecurityCenter connectionId={toolsConnectionId} />
      )}
      {toolsConnectionId && activeToolId === 'firewall-manager' && (
        <FirewallManager connectionId={toolsConnectionId} />
      )}
      {toolsConnectionId && activeToolId === 'package-manager' && (
        <PackageManager connectionId={toolsConnectionId} />
      )}
      {toolsConnectionId && activeToolId === 'docker-manager' && (
        <DockerManager connectionId={toolsConnectionId} />
      )}
      {toolsConnectionId && activeToolId === 'wireguard-manager' && (
        <WireGuardManager connectionId={toolsConnectionId} />
      )}
      {toolsConnectionId && activeToolId === 'cron-manager' && (
        <CronManager connectionId={toolsConnectionId} />
      )}
    </div>
  );
};

export default AppLayout;
