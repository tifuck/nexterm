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
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';

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

type TabId = 'updates' | 'search';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  connectionId: string;
}

export const PackageManager: React.FC<Props> = ({ connectionId }) => {
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
                  className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-secondary)] transition-colors"
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
              No packages found matching "{query}"
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
