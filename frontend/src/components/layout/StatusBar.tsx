import React from 'react';
import { Wifi, WifiOff, Cpu, MemoryStick, HardDrive, Activity } from 'lucide-react';
import { useTabStore } from '@/store/tabStore';
import { useMetricsStore } from '@/store/metricsStore';
import { useConfigStore } from '@/store/configStore';

const StatusBar: React.FC = () => {
  const activeTab = useTabStore((s) => s.activeTab);
  const tabs = useTabStore((s) => s.tabs);
  const metrics = useMetricsStore((s) => s.metrics);
  const isVisible = useMetricsStore((s) => s.isVisible);
  const setVisible = useMetricsStore((s) => s.setVisible);
  const appName = useConfigStore((s) => s.appName);

  const current = tabs.find((t) => t.id === activeTab);
  const isSession = current && current.type !== 'home' && current.type !== 'editor';
  const isConnected = isSession && current.isConnected;

  return (
    <div className="flex items-center h-6 min-h-[24px] bg-[var(--bg-secondary)] border-t border-[var(--border)] px-3 text-[10px] select-none">
      {/* Left: connection status */}
      <div className="flex items-center gap-1.5 min-w-0">
        {isSession ? (
          <>
            {isConnected ? (
              <div className="flex items-center gap-1.5 animate-fade-in">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span
                    className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-connected-pulse"
                    style={{ backgroundColor: 'var(--success)' }}
                  />
                  <span
                    className="relative inline-flex h-2 w-2 rounded-full"
                    style={{ backgroundColor: 'var(--success)' }}
                  />
                </span>
                <Wifi size={11} className="shrink-0" style={{ color: 'var(--success)' }} />
                <span style={{ color: 'var(--success)' }}>Connected</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 animate-fade-in">
                <span
                  className="inline-flex h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: 'var(--danger)' }}
                />
                <WifiOff size={11} className="shrink-0" style={{ color: 'var(--danger)' }} />
                <span style={{ color: 'var(--danger)' }}>Disconnected</span>
              </div>
            )}
          </>
        ) : (
          <span className="text-[var(--text-muted)]">Ready</span>
        )}
      </div>

      {/* Center: session info */}
      <div className="flex-1 text-center text-[var(--text-muted)] truncate px-4">
        {isSession && current ? (
          <span className="transition-opacity duration-200">
            {(() => {
              const title = current.title || '';
              const host = current.meta?.host || '';
              const port = current.meta?.port;
              const hostPort = port ? `${host}:${port}` : host;
              // Check if title already contains the host (e.g. "root@213.165.47.165" or "213.165.47.165")
              const titleContainsHost = host && title.includes(host);
              const showAddress = host && !titleContainsHost;

              return (
                <>
                  {title}
                  {showAddress && (
                    <span className="ml-1">
                      — {hostPort}
                    </span>
                  )}
                  {!showAddress && host && port && !title.includes(`:${port}`) && (
                    <span>:{port}</span>
                  )}
                  {isVisible && metrics?.os_name && metrics.os_name !== 'Linux' && (
                    <span className="ml-1 text-[var(--text-muted)]" style={{ opacity: 0.7 }}>
                      — {metrics.os_name}
                    </span>
                  )}
                </>
              );
            })()}
          </span>
        ) : (
          <span>{appName}</span>
        )}
      </div>

      {/* Right: metrics toggle + badges */}
      <div className="flex items-center gap-3 shrink-0 text-[var(--text-muted)]">
        {isVisible && metrics && (
          <>
            <MetricBadge icon={<Cpu size={10} />} value={`${metrics.cpu_percent}%`} />
            <MetricBadge icon={<MemoryStick size={10} />} value={`${metrics.mem_percent}%`} />
            {metrics.disk_percent !== undefined && (
              <MetricBadge icon={<HardDrive size={10} />} value={`${metrics.disk_percent}%`} />
            )}
          </>
        )}
        {/* Toggle button - visible when connected to a session */}
        {isConnected && (
          <button
            onClick={() => setVisible(!isVisible)}
            className="flex items-center justify-center p-0.5 rounded transition-colors duration-150 hover:text-[var(--text-primary)]"
            style={{
              color: isVisible && metrics ? 'var(--accent)' : undefined,
            }}
            title={isVisible ? 'Hide system metrics' : 'Show system metrics'}
          >
            <Activity size={11} />
          </button>
        )}
      </div>
    </div>
  );
};

/** Small metric badge with transition on value changes */
const MetricBadge: React.FC<{ icon: React.ReactNode; value: string }> = ({ icon, value }) => (
  <span className="flex items-center gap-1 transition-colors duration-300">
    {icon}
    <span className="tabular-nums">{value}</span>
  </span>
);

export default StatusBar;
