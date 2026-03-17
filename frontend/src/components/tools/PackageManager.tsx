import React, { useEffect, useState, useCallback } from 'react';
import {
  Package,
  RefreshCw,
  Loader2,
  X,
  Search,
  Download,
  Trash2,
  ArrowUpCircle,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Zap,
  Code,
  Globe,
  Database,
  Shield,
  Wrench,
  Server,
  Network,
  Bot,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';
import { useToastStore } from '@/store/toastStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PackageManagerInfo {
  manager: string;
  os_id: string;
  os_name: string;
  os_version: string;
}

interface PackageUpdateInfo {
  name: string;
  current_version: string;
  new_version: string;
  size: string;
}

interface PackageUpdatesResponse {
  manager: string;
  updates: PackageUpdateInfo[];
  total: number;
  security_updates: number;
}

interface PackageInfo {
  name: string;
  version: string;
  architecture: string;
  status: string;
  description: string;
  size: string;
}

interface PackageSearchResult {
  packages: PackageInfo[];
  total: number;
}

type TabId = 'updates' | 'search' | 'quick-install';

// ---------------------------------------------------------------------------
// Popular Packages Definition
// ---------------------------------------------------------------------------

type ManagerId = 'apt' | 'dnf' | 'yum' | 'pacman' | 'apk' | 'zypper';

interface PopularPackage {
  name: string;
  description: string;
  category: 'ai' | 'languages' | 'devtools' | 'servers' | 'databases' | 'security' | 'networking' | 'utilities' | 'editors';
  /** Package names per manager. If a manager key is missing, the package is hidden for that OS. */
  packages: Partial<Record<ManagerId, string>>;
  /** Shell command to run for installation instead of the package manager (e.g. curl-pipe-bash). */
  customInstallCmd?: string;
  /** Shell command to check if installed (exit 0 = installed). */
  customCheckCmd?: string;
}

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  ai: { label: 'AI Tools', icon: <Bot size={11} />, color: '#c084fc' },
  languages: { label: 'Languages', icon: <Code size={11} />, color: 'var(--accent)' },
  devtools: { label: 'Dev Tools', icon: <Wrench size={11} />, color: 'var(--warning)' },
  servers: { label: 'Web Servers', icon: <Globe size={11} />, color: 'var(--success)' },
  databases: { label: 'Databases', icon: <Database size={11} />, color: '#a78bfa' },
  security: { label: 'Security', icon: <Shield size={11} />, color: '#f87171' },
  networking: { label: 'Networking', icon: <Network size={11} />, color: '#38bdf8' },
  utilities: { label: 'Utilities', icon: <Server size={11} />, color: '#fb923c' },
  editors: { label: 'Editors', icon: <Code size={11} />, color: '#34d399' },
};

const POPULAR_PACKAGES: PopularPackage[] = [
  {
    name: 'Claude Code',
    description: 'Anthropic\'s AI coding agent for the terminal',
    category: 'ai',
    packages: {},
    customInstallCmd: 'curl -fsSL https://claude.ai/install.sh | bash',
    customCheckCmd: 'which claude',
  },
  {
    name: 'OpenCode',
    description: 'Open source AI coding agent by Anomaly',
    category: 'ai',
    packages: {},
    customInstallCmd: 'curl -fsSL https://opencode.ai/install | bash',
    customCheckCmd: 'which opencode',
  },
  {
    name: 'Python 3 + venv + pip',
    description: 'Python runtime, virtual environments & package manager',
    category: 'languages',
    packages: { apt: 'python3 python3-venv python3-pip', dnf: 'python3 python3-pip', yum: 'python3 python3-pip', pacman: 'python python-pip', apk: 'python3 py3-pip', zypper: 'python3 python3-pip' },
  },
  {
    name: 'Node.js + npm',
    description: 'JavaScript runtime & package manager',
    category: 'languages',
    packages: { apt: 'nodejs npm', dnf: 'nodejs npm', yum: 'nodejs npm', pacman: 'nodejs npm', apk: 'nodejs npm', zypper: 'nodejs npm' },
  },
  {
    name: 'Git',
    description: 'Distributed version control system',
    category: 'devtools',
    packages: { apt: 'git', dnf: 'git', yum: 'git', pacman: 'git', apk: 'git', zypper: 'git' },
  },
  {
    name: 'build-essential',
    description: 'C/C++ compilers, make & core build tools',
    category: 'devtools',
    packages: { apt: 'build-essential', dnf: 'gcc gcc-c++ make', yum: 'gcc gcc-c++ make', pacman: 'base-devel', apk: 'build-base', zypper: 'gcc gcc-c++ make' },
  },
  {
    name: 'curl',
    description: 'Command-line tool for transferring data via URLs',
    category: 'devtools',
    packages: { apt: 'curl', dnf: 'curl', yum: 'curl', pacman: 'curl', apk: 'curl', zypper: 'curl' },
  },
  {
    name: 'wget',
    description: 'Network file downloader',
    category: 'devtools',
    packages: { apt: 'wget', dnf: 'wget', yum: 'wget', pacman: 'wget', apk: 'wget', zypper: 'wget' },
  },
  {
    name: 'Nginx',
    description: 'High-performance web server & reverse proxy',
    category: 'servers',
    packages: { apt: 'nginx', dnf: 'nginx', yum: 'nginx', pacman: 'nginx', apk: 'nginx', zypper: 'nginx' },
  },
  {
    name: 'PostgreSQL',
    description: 'Advanced open-source relational database',
    category: 'databases',
    packages: { apt: 'postgresql', dnf: 'postgresql-server', yum: 'postgresql-server', pacman: 'postgresql', apk: 'postgresql', zypper: 'postgresql-server' },
  },
  {
    name: 'Redis',
    description: 'In-memory data store & cache',
    category: 'databases',
    packages: { apt: 'redis-server', dnf: 'redis', yum: 'redis', pacman: 'redis', apk: 'redis', zypper: 'redis' },
  },
  {
    name: 'Docker',
    description: 'Container runtime for application deployment',
    category: 'servers',
    packages: { apt: 'docker.io', dnf: 'docker-ce', yum: 'docker', pacman: 'docker', apk: 'docker', zypper: 'docker' },
  },
  {
    name: 'WireGuard',
    description: 'Modern, fast VPN tunnel',
    category: 'networking',
    packages: { apt: 'wireguard', dnf: 'wireguard-tools', yum: 'wireguard-tools', pacman: 'wireguard-tools', apk: 'wireguard-tools', zypper: 'wireguard-tools' },
  },
  {
    name: 'net-tools',
    description: 'Classic networking utilities (ifconfig, netstat)',
    category: 'networking',
    packages: { apt: 'net-tools', dnf: 'net-tools', yum: 'net-tools', pacman: 'net-tools', apk: 'net-tools', zypper: 'net-tools' },
  },
  {
    name: 'UFW Firewall',
    description: 'Uncomplicated firewall for iptables',
    category: 'security',
    packages: { apt: 'ufw', dnf: 'ufw', pacman: 'ufw' },
  },
  {
    name: 'fail2ban',
    description: 'Intrusion prevention & brute-force protection',
    category: 'security',
    packages: { apt: 'fail2ban', dnf: 'fail2ban', yum: 'fail2ban', pacman: 'fail2ban', zypper: 'fail2ban' },
  },
  {
    name: 'htop',
    description: 'Interactive process viewer & system monitor',
    category: 'utilities',
    packages: { apt: 'htop', dnf: 'htop', yum: 'htop', pacman: 'htop', apk: 'htop', zypper: 'htop' },
  },
  {
    name: 'tmux',
    description: 'Terminal multiplexer for persistent sessions',
    category: 'utilities',
    packages: { apt: 'tmux', dnf: 'tmux', yum: 'tmux', pacman: 'tmux', apk: 'tmux', zypper: 'tmux' },
  },
  {
    name: 'vim',
    description: 'Powerful terminal-based text editor',
    category: 'editors',
    packages: { apt: 'vim', dnf: 'vim-enhanced', yum: 'vim-enhanced', pacman: 'vim', apk: 'vim', zypper: 'vim' },
  },
  {
    name: 'nano',
    description: 'Simple, beginner-friendly text editor',
    category: 'editors',
    packages: { apt: 'nano', dnf: 'nano', yum: 'nano', pacman: 'nano', apk: 'nano', zypper: 'nano' },
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  connectionId: string;
}

export const PackageManager: React.FC<Props> = ({ connectionId }) => {
  const addToast = useToastStore((s) => s.addToast);
  const [pkgInfo, setPkgInfo] = useState<PackageManagerInfo | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('updates');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Updates state
  const [updates, setUpdates] = useState<PackageUpdatesResponse | null>(null);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeOutput, setUpgradeOutput] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PackageSearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Action state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  // Quick install state
  const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({});
  const [quickCheckLoading, setQuickCheckLoading] = useState(false);
  const [quickCheckDone, setQuickCheckDone] = useState(false);
  const [quickInstallLoading, setQuickInstallLoading] = useState<string | null>(null);

  const detectManager = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/packages/detect`);
      setPkgInfo(data);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to detect package manager';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    detectManager();
  }, [detectManager]);

  const checkUpdates = useCallback(async () => {
    setUpdatesLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/packages/updates`);
      setUpdates(data);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to check updates';
      setError(message);
    } finally {
      setUpdatesLoading(false);
    }
  }, [connectionId]);

  const upgradeAll = async () => {
    if (!confirm('Upgrade all packages? This may take several minutes.')) return;
    setUpgradeLoading(true);
    setUpgradeOutput(null);
    try {
      const data = await apiPost(`/api/tools/${connectionId}/packages/upgrade-all`, {});
      setUpgradeOutput(data.output || data.message);
      if (data.success) {
        setActionMessage('All packages upgraded successfully');
        // Refresh updates after upgrade
        setTimeout(checkUpdates, 2000);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upgrade failed';
      setError(message);
    } finally {
      setUpgradeLoading(false);
    }
  };

  const searchPackages = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/packages/search`, {
        query: searchQuery.trim(),
      });
      setSearchResults(data);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Search failed';
      setError(message);
    } finally {
      setSearchLoading(false);
    }
  };

  const packageAction = async (pkgName: string, action: 'install' | 'remove' | 'purge') => {
    const verb = action === 'install' ? 'Install' : action === 'remove' ? 'Remove' : 'Purge';
    if (!confirm(`${verb} package "${pkgName}"?`)) return;
    setActionLoading(`${pkgName}:${action}`);
    setActionMessage('');
    try {
      const data = await apiPost(`/api/tools/${connectionId}/packages/action`, {
        action,
        package_name: pkgName,
      });
      setActionMessage(data.message || `${verb} successful`);
      // Refresh search results
      if (searchResults && searchQuery) {
        setTimeout(searchPackages, 1000);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `${verb} failed`;
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchPackages();
    }
  };

  // -------------------------------------------------------------------
  // Quick Install helpers
  // -------------------------------------------------------------------

  const getVisiblePackages = useCallback(() => {
    if (!pkgInfo) return [];
    const mgr = pkgInfo.manager as ManagerId;
    return POPULAR_PACKAGES.filter((p) => p.customInstallCmd || p.packages[mgr]);
  }, [pkgInfo]);

  const checkInstalledPackages = useCallback(async () => {
    if (!pkgInfo || pkgInfo.manager === 'unknown') return;
    const mgr = pkgInfo.manager as ManagerId;
    const visible = POPULAR_PACKAGES.filter((p) => p.customInstallCmd || p.packages[mgr]);
    // Flatten all individual package names (system packages)
    const allPkgs = new Set<string>();
    // Collect custom check commands
    const customChecks: { name: string; check_cmd: string }[] = [];
    visible.forEach((p) => {
      if (p.customCheckCmd) {
        customChecks.push({ name: p.name, check_cmd: p.customCheckCmd });
      } else {
        const names = p.packages[mgr];
        if (names) {
          names.split(' ').forEach((n) => allPkgs.add(n));
        }
      }
    });

    setQuickCheckLoading(true);
    try {
      const results: Record<string, boolean> = {};

      // Check system packages
      if (allPkgs.size > 0) {
        const data = await apiPost(`/api/tools/${connectionId}/packages/check-installed`, {
          packages: Array.from(allPkgs),
        });
        Object.assign(results, data.installed || {});
      }

      // Check custom-install packages
      if (customChecks.length > 0) {
        const data = await apiPost(`/api/tools/${connectionId}/packages/check-custom`, {
          checks: customChecks,
        });
        Object.assign(results, data.installed || {});
      }

      setInstalledMap(results);
      setQuickCheckDone(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to check installed packages';
      addToast(message, 'error');
    } finally {
      setQuickCheckLoading(false);
    }
  }, [connectionId, pkgInfo, addToast]);

  /** Check whether ALL sub-packages of a bundle are installed */
  const isBundleInstalled = useCallback((pkg: PopularPackage): boolean => {
    // Custom-install packages are keyed by display name
    if (pkg.customCheckCmd) {
      return installedMap[pkg.name] === true;
    }
    if (!pkgInfo) return false;
    const mgr = pkgInfo.manager as ManagerId;
    const names = pkg.packages[mgr];
    if (!names) return false;
    return names.split(' ').every((n) => installedMap[n] === true);
  }, [pkgInfo, installedMap]);

  const quickInstall = async (pkg: PopularPackage) => {
    if (!pkgInfo) return;

    // Custom-install packages use a shell command instead of the package manager
    if (pkg.customInstallCmd) {
      if (!confirm(`Install ${pkg.name}?\n\nCommand: ${pkg.customInstallCmd}`)) return;

      setQuickInstallLoading(pkg.name);
      try {
        await apiPost(`/api/tools/${connectionId}/packages/action`, {
          action: 'install',
          package_name: pkg.name,
          custom_command: pkg.customInstallCmd,
        });
        addToast(`${pkg.name} installed successfully`, 'success');
        setInstalledMap((prev) => ({ ...prev, [pkg.name]: true }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : `Failed to install ${pkg.name}`;
        addToast(message, 'error');
      } finally {
        setQuickInstallLoading(null);
      }
      return;
    }

    const mgr = pkgInfo.manager as ManagerId;
    const pkgNames = pkg.packages[mgr];
    if (!pkgNames) return;
    if (!confirm(`Install ${pkg.name}?\n\nPackages: ${pkgNames}`)) return;

    setQuickInstallLoading(pkg.name);
    try {
      await apiPost(`/api/tools/${connectionId}/packages/action`, {
        action: 'install',
        package_name: pkgNames,
      });
      addToast(`${pkg.name} installed successfully`, 'success');
      // Mark sub-packages as installed locally
      const updated = { ...installedMap };
      pkgNames.split(' ').forEach((n) => { updated[n] = true; });
      setInstalledMap(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to install ${pkg.name}`;
      addToast(message, 'error');
    } finally {
      setQuickInstallLoading(null);
    }
  };

  return (
    <ToolModal title="Updates & Packages" icon={<Package size={18} />}>
      {/* OS Info bar */}
      {pkgInfo && (
        <div className="flex items-center gap-3 mb-3 text-[10px] text-[var(--text-muted)]">
          <span>OS: <span className="text-[var(--text-secondary)] font-medium">{pkgInfo.os_name || pkgInfo.os_id || 'Unknown'}</span></span>
          {pkgInfo.os_version && <span>Version: <span className="text-[var(--text-secondary)] font-medium">{pkgInfo.os_version}</span></span>}
          <span>Package Manager: <span className="text-[var(--accent)] font-medium uppercase">{pkgInfo.manager}</span></span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
          <button
            onClick={() => setActiveTab('updates')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
              activeTab === 'updates'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <ArrowUpCircle size={13} />
            Updates
            {updates && updates.total > 0 && (
              <span className="ml-0.5 px-1 py-0.5 rounded-full text-[9px] bg-[var(--warning)]/20 text-[var(--warning)]">
                {updates.total}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
              activeTab === 'search'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Search size={13} />
            Search & Install
          </button>
          <button
            onClick={() => setActiveTab('quick-install')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
              activeTab === 'quick-install'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Zap size={13} />
            Quick Install
          </button>
        </div>
        <div className="flex-1" />
      </div>

      {error && (
        <div className="mb-3 p-2 rounded bg-[var(--danger)]/10 text-[var(--danger)] text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-2">
            <X size={12} />
          </button>
        </div>
      )}

      {actionMessage && (
        <div className="mb-3 p-2 rounded bg-[var(--success)]/10 text-[var(--success)] text-xs flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <CheckCircle size={12} />
            {actionMessage}
          </span>
          <button onClick={() => setActionMessage('')} className="ml-2">
            <X size={12} />
          </button>
        </div>
      )}

      {loading && !pkgInfo && (
        <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Detecting package manager...
        </div>
      )}

      {pkgInfo && pkgInfo.manager === 'unknown' && (
        <div className="py-8 text-center">
          <AlertTriangle size={24} className="mx-auto mb-2 text-[var(--warning)]" />
          <div className="text-xs text-[var(--text-primary)] font-medium mb-1">
            No Package Manager Detected
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">
            Supported: apt, dnf, yum, pacman, apk, zypper
          </div>
        </div>
      )}

      {/* Updates tab */}
      {pkgInfo && pkgInfo.manager !== 'unknown' && activeTab === 'updates' && (
        <UpdatesTab
          updates={updates}
          loading={updatesLoading}
          upgradeLoading={upgradeLoading}
          upgradeOutput={upgradeOutput}
          onCheck={checkUpdates}
          onUpgradeAll={upgradeAll}
        />
      )}

      {/* Search tab */}
      {pkgInfo && pkgInfo.manager !== 'unknown' && activeTab === 'search' && (
        <SearchTab
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onSearch={searchPackages}
          onKeyDown={handleSearchKeyDown}
          results={searchResults}
          loading={searchLoading}
          actionLoading={actionLoading}
          onAction={packageAction}
        />
      )}

      {/* Quick Install tab */}
      {pkgInfo && pkgInfo.manager !== 'unknown' && activeTab === 'quick-install' && (
        <QuickInstallTab
          packages={getVisiblePackages()}
          installedMap={installedMap}
          isBundleInstalled={isBundleInstalled}
          checkLoading={quickCheckLoading}
          checkDone={quickCheckDone}
          installLoading={quickInstallLoading}
          onCheck={checkInstalledPackages}
          onInstall={quickInstall}
        />
      )}
    </ToolModal>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const UpdatesTab: React.FC<{
  updates: PackageUpdatesResponse | null;
  loading: boolean;
  upgradeLoading: boolean;
  upgradeOutput: string | null;
  onCheck: () => void;
  onUpgradeAll: () => void;
}> = ({ updates, loading, upgradeLoading, upgradeOutput, onCheck, onUpgradeAll }) => {
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div className="space-y-3">
      {/* Action bar */}
      <div className="flex items-center gap-2">
        <button
          onClick={onCheck}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {loading ? 'Checking...' : 'Check for Updates'}
        </button>

        {updates && updates.total > 0 && (
          <button
            onClick={onUpgradeAll}
            disabled={upgradeLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--success)]/15 text-[var(--success)] text-xs font-medium hover:bg-[var(--success)]/25 transition-colors disabled:opacity-50"
          >
            {upgradeLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <ArrowUpCircle size={12} />
            )}
            {upgradeLoading ? 'Upgrading...' : `Upgrade All (${updates.total})`}
          </button>
        )}
      </div>

      {/* Summary cards */}
      {updates && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="p-2.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
            <div className="text-[10px] text-[var(--text-muted)] mb-0.5">Total Updates</div>
            <div className="text-sm font-semibold font-mono" style={{ color: updates.total > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {updates.total}
            </div>
          </div>
          {updates.security_updates > 0 && (
            <div className="p-2.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
              <div className="text-[10px] text-[var(--text-muted)] mb-0.5">Security Updates</div>
              <div className="text-sm font-semibold font-mono text-[var(--danger)]">
                {updates.security_updates}
              </div>
            </div>
          )}
          <div className="p-2.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
            <div className="text-[10px] text-[var(--text-muted)] mb-0.5">Manager</div>
            <div className="text-sm font-semibold font-mono text-[var(--accent)] uppercase">
              {updates.manager}
            </div>
          </div>
        </div>
      )}

      {/* Upgrade output */}
      {upgradeOutput && (
        <div>
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            {showOutput ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showOutput ? 'Hide' : 'Show'} upgrade output
          </button>
          {showOutput && (
            <pre className="mt-1 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px] font-mono text-[var(--text-secondary)] overflow-auto max-h-[200px] whitespace-pre-wrap">
              {upgradeOutput}
            </pre>
          )}
        </div>
      )}

      {/* Updates table */}
      {updates && updates.updates.length > 0 && (
        <div className="overflow-auto max-h-[calc(80vh-350px)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="py-2 px-2 font-medium">Package</th>
                <th className="py-2 px-2 font-medium">Current</th>
                <th className="py-2 px-2 font-medium">Available</th>
              </tr>
            </thead>
            <tbody>
              {updates.updates.map((pkg, i) => (
                <tr
                  key={i}
                  className="border-b border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <td className="py-1.5 px-2 font-medium text-[var(--text-primary)] font-mono">
                    {pkg.name}
                  </td>
                  <td className="py-1.5 px-2 text-[var(--text-muted)] font-mono text-[10px]">
                    {pkg.current_version || '—'}
                  </td>
                  <td className="py-1.5 px-2 text-[var(--success)] font-mono text-[10px]">
                    {pkg.new_version || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {updates && updates.updates.length === 0 && (
        <div className="py-6 text-center">
          <CheckCircle size={20} className="mx-auto mb-2 text-[var(--success)]" />
          <div className="text-xs text-[var(--text-primary)] font-medium">All packages are up to date</div>
        </div>
      )}
    </div>
  );
};

const SearchTab: React.FC<{
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  results: PackageSearchResult | null;
  loading: boolean;
  actionLoading: string | null;
  onAction: (pkg: string, action: 'install' | 'remove' | 'purge') => void;
}> = ({ query, onQueryChange, onSearch, onKeyDown, results, loading, actionLoading, onAction }) => {
  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search packages (e.g. nginx, python3, htop)..."
            className="w-full pl-8 pr-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
        <button
          onClick={onSearch}
          disabled={loading || !query.trim()}
          className="flex items-center gap-1.5 px-3 py-2 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Search
        </button>
      </div>

      {/* Results */}
      {results && (
        <div className="overflow-auto max-h-[calc(80vh-260px)]">
          {results.packages.length === 0 ? (
            <div className="py-8 text-center text-[var(--text-muted)] text-xs">
              No packages found matching &quot;{query}&quot;
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-[10px] text-[var(--text-muted)] mb-1">
                {results.total} package{results.total !== 1 ? 's' : ''} found
              </div>
              {results.packages.map((pkg, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-hover)] transition-colors group"
                >
                  <Package size={14} className="text-[var(--text-muted)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--text-primary)] font-mono">
                        {pkg.name}
                      </span>
                      {pkg.version && (
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">
                          {pkg.version}
                        </span>
                      )}
                    </div>
                    {pkg.description && (
                      <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                        {pkg.description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onAction(pkg.name, 'install')}
                      disabled={actionLoading === `${pkg.name}:install`}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[var(--success)]/15 text-[var(--success)] hover:bg-[var(--success)]/25 transition-colors disabled:opacity-50"
                      title="Install"
                    >
                      {actionLoading === `${pkg.name}:install` ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <Download size={10} />
                      )}
                      Install
                    </button>
                    <button
                      onClick={() => onAction(pkg.name, 'remove')}
                      disabled={actionLoading === `${pkg.name}:remove`}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[var(--danger)]/15 text-[var(--danger)] hover:bg-[var(--danger)]/25 transition-colors disabled:opacity-50"
                      title="Remove"
                    >
                      {actionLoading === `${pkg.name}:remove` ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <Trash2 size={10} />
                      )}
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!results && !loading && (
        <div className="py-8 text-center text-[var(--text-muted)] text-xs">
          Enter a package name and press Enter or click Search
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Quick Install Tab
// ---------------------------------------------------------------------------

const QuickInstallTab: React.FC<{
  packages: PopularPackage[];
  installedMap: Record<string, boolean>;
  isBundleInstalled: (pkg: PopularPackage) => boolean;
  checkLoading: boolean;
  checkDone: boolean;
  installLoading: string | null;
  onCheck: () => void;
  onInstall: (pkg: PopularPackage) => void;
}> = ({ packages, isBundleInstalled, checkLoading, checkDone, installLoading, onCheck, onInstall }) => {
  // Auto-check on first render
  useEffect(() => {
    if (!checkDone && !checkLoading) {
      onCheck();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (checkLoading && !checkDone) {
    return (
      <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
        <Loader2 size={14} className="animate-spin" />
        Checking installed packages...
      </div>
    );
  }

  // Group by category
  const grouped: Record<string, PopularPackage[]> = {};
  packages.forEach((pkg) => {
    if (!grouped[pkg.category]) grouped[pkg.category] = [];
    grouped[pkg.category].push(pkg);
  });

  const categoryOrder = ['ai', 'languages', 'devtools', 'servers', 'databases', 'security', 'networking', 'utilities', 'editors'];
  const sortedCategories = categoryOrder.filter((c) => grouped[c]);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-[var(--text-muted)]">
          One-click install popular packages. Already installed packages are marked.
        </div>
        <button
          onClick={onCheck}
          disabled={checkLoading}
          className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={10} className={checkLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Package grid by category */}
      <div className="overflow-auto max-h-[calc(80vh-260px)] space-y-4">
        {sortedCategories.map((catKey) => {
          const meta = CATEGORY_META[catKey];
          const catPackages = grouped[catKey];
          return (
            <div key={catKey}>
              {/* Category header */}
              <div className="flex items-center gap-1.5 mb-2">
                <span style={{ color: meta.color }}>{meta.icon}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
                  {meta.label}
                </span>
              </div>

              {/* Cards grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {catPackages.map((pkg) => {
                  const installed = isBundleInstalled(pkg);
                  const isInstalling = installLoading === pkg.name;

                  return (
                    <div
                      key={pkg.name}
                      className={`relative rounded-lg border p-3 transition-all ${
                        installed
                          ? 'bg-[var(--bg-secondary)] border-[var(--border)] opacity-60'
                          : 'bg-[var(--bg-secondary)] border-[var(--border)] hover:border-[var(--accent)] hover:shadow-md cursor-pointer'
                      }`}
                      onClick={() => !installed && !isInstalling && onInstall(pkg)}
                    >
                      {/* Installed badge */}
                      {installed && (
                        <div className="absolute top-2 right-2">
                          <CheckCircle size={14} className="text-[var(--success)]" />
                        </div>
                      )}

                      {/* Package name */}
                      <div className="text-[11px] font-semibold text-[var(--text-primary)] mb-0.5 pr-5">
                        {pkg.name}
                      </div>

                      {/* Description */}
                      <div className="text-[9px] text-[var(--text-muted)] leading-tight mb-2.5 line-clamp-2">
                        {pkg.description}
                      </div>

                      {/* Status / action */}
                      {installed ? (
                        <div className="flex items-center gap-1 text-[9px] text-[var(--success)] font-medium">
                          <CheckCircle size={9} />
                          Installed
                        </div>
                      ) : isInstalling ? (
                        <div className="flex items-center gap-1 text-[9px] text-[var(--accent)] font-medium">
                          <Loader2 size={9} className="animate-spin" />
                          Installing...
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[9px] text-[var(--accent)] font-medium">
                          <Download size={9} />
                          Click to install
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {packages.length === 0 && (
        <div className="py-8 text-center">
          <AlertTriangle size={20} className="mx-auto mb-2 text-[var(--warning)]" />
          <div className="text-xs text-[var(--text-primary)] font-medium mb-1">No packages available</div>
          <div className="text-[10px] text-[var(--text-muted)]">
            No popular packages are configured for this package manager.
          </div>
        </div>
      )}
    </div>
  );
};
