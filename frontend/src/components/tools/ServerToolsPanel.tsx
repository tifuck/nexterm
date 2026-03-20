import React, { useEffect, useCallback, useRef, useState } from 'react';
import {
  X,
  Activity,
  ListTree,
  Server,
  FileText,
  Code2,
  ShieldCheck,
  Flame,
  Package,
  Container,
  Network,
  Clock,
  History,
  ClipboardCheck,
} from 'lucide-react';
import { useToolsStore, TOOLS, type ToolId } from '@/store/toolsStore';
import { apiGet } from '@/api/client';

const CATEGORY_LABELS: Record<string, string> = {
  monitoring: 'Monitoring',
  system: 'System',
  security: 'Security',
  networking: 'Networking',
  automation: 'Automation',
};

const TOOL_ICONS: Record<ToolId, React.ReactNode> = {
  'system-dashboard': <Activity size={16} />,
  'process-manager': <ListTree size={16} />,
  'service-manager': <Server size={16} />,
  'log-viewer': <FileText size={16} />,
  'script-vault': <Code2 size={16} />,
  'security-center': <ShieldCheck size={16} />,
  'firewall-manager': <Flame size={16} />,
  'package-manager': <Package size={16} />,
  'docker-manager': <Container size={16} />,
  'wireguard-manager': <Network size={16} />,
  'cron-manager': <Clock size={16} />,
  'job-center': <History size={16} />,
  'audit-log': <ClipboardCheck size={16} />,
};

const TOOL_CAPABILITY_KEYS: Record<ToolId, string> = {
  'system-dashboard': 'system',
  'process-manager': 'processes',
  'service-manager': 'services',
  'log-viewer': 'logs',
  'script-vault': 'scripts',
  'security-center': 'security',
  'firewall-manager': 'firewall',
  'package-manager': 'packages',
  'docker-manager': 'docker',
  'wireguard-manager': 'wireguard',
  'cron-manager': 'cron',
  'job-center': 'jobs',
  'audit-log': 'audit',
};

interface Props {
  connectionId: string;
}

export const ServerToolsPanel: React.FC<Props> = ({ connectionId }) => {
  // Reserved for future connection-scoped capability checks.
  void connectionId;

  const isPanelOpen = useToolsStore((s) => s.isPanelOpen);
  const closePanel = useToolsStore((s) => s.closePanel);
  const openTool = useToolsStore((s) => s.openTool);
  const panelRef = useRef<HTMLDivElement>(null);
  const [capabilities, setCapabilities] = useState<Record<string, { read: boolean; execute: boolean; high_risk: boolean }>>({});

  useEffect(() => {
    if (!isPanelOpen) return;
    apiGet('/api/tools/capabilities')
      .then((data) => {
        setCapabilities(data?.tools || {});
      })
      .catch(() => {
        setCapabilities({});
      });
  }, [isPanelOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPanelOpen) closePanel();
    },
    [isPanelOpen, closePanel]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Click outside to close
  useEffect(() => {
    if (!isPanelOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };
    // Delay to avoid catching the opening click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [isPanelOpen, closePanel]);

  // Group tools by category
  const categories = ['monitoring', 'system', 'security', 'networking', 'automation'] as const;

  return (
    <>
      {/* Backdrop */}
      {isPanelOpen && (
        <div className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-200" />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 h-full w-72 bg-[var(--bg-secondary)] border-l border-[var(--border)] shadow-2xl z-50 flex flex-col transition-transform duration-200 ease-out ${
          isPanelOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 h-[40px] shrink-0 border-b border-[var(--border)]">
          <Server size={16} className="text-[var(--accent)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex-1">
            Server Tools
          </h2>
          <button
            onClick={closePanel}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tools list */}
        <div className="flex-1 overflow-y-auto py-2">
          {categories.map((category) => {
            const categoryTools = TOOLS.filter((t) => t.category === category);
            if (categoryTools.length === 0) return null;

            return (
              <div key={category} className="mb-3">
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {CATEGORY_LABELS[category]}
                </div>
                {categoryTools.map((tool) => {
                  const capKey = TOOL_CAPABILITY_KEYS[tool.id];
                  const canRead = capabilities[capKey]?.read ?? true;
                  return (
                  <button
                    key={tool.id}
                    onClick={() => canRead && openTool(tool.id)}
                    className={`flex items-start gap-3 w-full px-4 py-2.5 text-left transition-colors group ${
                      canRead ? 'hover:bg-[var(--bg-hover)]' : 'opacity-45 cursor-not-allowed'
                    }`}
                    title={canRead ? tool.description : 'Disabled by server policy'}
                    disabled={!canRead}
                  >
                    <span className="mt-0.5 text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors shrink-0">
                      {TOOL_ICONS[tool.id]}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                        {tool.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
                        {tool.description}
                      </div>
                    </div>
                  </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};
