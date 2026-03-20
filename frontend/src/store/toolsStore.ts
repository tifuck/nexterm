import { create } from 'zustand';

export type ToolId =
  | 'system-dashboard'
  | 'process-manager'
  | 'service-manager'
  | 'log-viewer'
  | 'script-vault'
  | 'security-center'
  | 'firewall-manager'
  | 'package-manager'
  | 'docker-manager'
  | 'wireguard-manager'
  | 'cron-manager'
  | 'job-center'
  | 'audit-log';

export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  category: 'monitoring' | 'system' | 'security' | 'networking' | 'automation';
}

export const TOOLS: ToolDefinition[] = [
  {
    id: 'system-dashboard',
    name: 'System Dashboard',
    description: 'Real-time CPU, memory, disk, and network monitoring',
    category: 'monitoring',
  },
  {
    id: 'process-manager',
    name: 'Process Manager',
    description: 'View and manage running processes',
    category: 'monitoring',
  },
  {
    id: 'service-manager',
    name: 'Service Manager',
    description: 'Control systemd services',
    category: 'system',
  },
  {
    id: 'log-viewer',
    name: 'Log Viewer',
    description: 'Live log tailing with filters and AI analysis',
    category: 'system',
  },
  {
    id: 'script-vault',
    name: 'Script Vault',
    description: 'Run saved or custom scripts',
    category: 'automation',
  },
  {
    id: 'security-center',
    name: 'Security Center',
    description: 'Audit ports, logins, users, and SSH config',
    category: 'security',
  },
  {
    id: 'firewall-manager',
    name: 'Firewall Manager',
    description: 'Manage firewall rules and status',
    category: 'security',
  },
  {
    id: 'package-manager',
    name: 'Updates & Packages',
    description: 'Check updates, search, and install packages',
    category: 'system',
  },
  {
    id: 'docker-manager',
    name: 'Docker Manager',
    description: 'Manage containers, images, and logs',
    category: 'system',
  },
  {
    id: 'wireguard-manager',
    name: 'WireGuard Manager',
    description: 'VPN interfaces, peers, and tunnels',
    category: 'networking',
  },
  {
    id: 'cron-manager',
    name: 'Cron Manager',
    description: 'View and manage scheduled tasks',
    category: 'automation',
  },
  {
    id: 'job-center',
    name: 'Job Center',
    description: 'Track progress, retries, and run history',
    category: 'monitoring',
  },
  {
    id: 'audit-log',
    name: 'Audit Log',
    description: 'Immutable per-action security and tools audit trail',
    category: 'security',
  },
];

interface ToolsState {
  isPanelOpen: boolean;
  activeToolId: ToolId | null;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  openTool: (id: ToolId) => void;
  closeTool: () => void;
}

export const useToolsStore = create<ToolsState>((set) => ({
  isPanelOpen: false,
  activeToolId: null,
  togglePanel: () => set((s) => ({ isPanelOpen: !s.isPanelOpen })),
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),
  openTool: (id) => set({ activeToolId: id, isPanelOpen: false }),
  closeTool: () => set({ activeToolId: null }),
}));
