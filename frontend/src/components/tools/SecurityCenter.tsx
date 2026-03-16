import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck,
  RefreshCw,
  Loader2,
  X,
  AlertTriangle,
  Check,
  XCircle,
  Globe,
  Users,
  Key,
  Bug,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenPort {
  protocol: string;
  local_address: string;
  port: number;
  pid: string;
  process: string;
  state: string;
}

interface FailedLogin {
  date: string;
  user: string;
  source: string;
  service: string;
}

interface UserPrivilege {
  username: string;
  uid: number;
  gid: number;
  groups: string[];
  shell: string;
  has_sudo: boolean;
  home: string;
}

interface SecurityScan {
  open_ports: OpenPort[];
  failed_logins: FailedLogin[];
  users: UserPrivilege[];
  ssh_config: Record<string, string>;
  malware_scan_available: boolean;
}

interface MalwareScanResult {
  tool: string;
  status: string;
  output: string;
  threats_found: number;
}

type TabId = 'ports' | 'logins' | 'users' | 'ssh' | 'malware';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  connectionId: string;
}

export const SecurityCenter: React.FC<Props> = ({ connectionId }) => {
  const [scan, setScan] = useState<SecurityScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('ports');
  const [malwareResult, setMalwareResult] = useState<MalwareScanResult | null>(null);
  const [malwareLoading, setMalwareLoading] = useState(false);

  const fetchScan = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/security-scan`);
      setScan(data);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Security scan failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    fetchScan();
  }, [fetchScan]);

  const runMalwareScan = async () => {
    setMalwareLoading(true);
    try {
      const data = await apiPost(`/api/tools/${connectionId}/malware-scan`, {});
      setMalwareResult(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Malware scan failed';
      setError(message);
    } finally {
      setMalwareLoading(false);
    }
  };

  const tabs: { id: TabId; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'ports', label: 'Open Ports', icon: <Globe size={13} />, count: scan?.open_ports.length },
    { id: 'logins', label: 'Failed Logins', icon: <AlertTriangle size={13} />, count: scan?.failed_logins.length },
    { id: 'users', label: 'Users', icon: <Users size={13} />, count: scan?.users.length },
    { id: 'ssh', label: 'SSH Config', icon: <Key size={13} /> },
    { id: 'malware', label: 'Malware Scan', icon: <Bug size={13} /> },
  ];

  return (
    <ToolModal title="Security Center" icon={<ShieldCheck size={18} />}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* Tabs */}
        <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5 flex-1 min-w-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-0.5 opacity-70">({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={fetchScan}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
          title="Re-scan"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 rounded bg-[var(--danger)]/10 text-[var(--danger)] text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-2">
            <X size={12} />
          </button>
        </div>
      )}

      {loading && !scan && (
        <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Running security scan...
        </div>
      )}

      {/* Tab content */}
      {scan && (
        <div className="overflow-auto max-h-[calc(80vh-160px)]">
          {activeTab === 'ports' && <PortsTab ports={scan.open_ports} />}
          {activeTab === 'logins' && <LoginsTab logins={scan.failed_logins} />}
          {activeTab === 'users' && <UsersTab users={scan.users} />}
          {activeTab === 'ssh' && <SSHConfigTab config={scan.ssh_config} />}
          {activeTab === 'malware' && (
            <MalwareTab
              available={scan.malware_scan_available}
              result={malwareResult}
              loading={malwareLoading}
              onScan={runMalwareScan}
            />
          )}
        </div>
      )}
    </ToolModal>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const PortsTab: React.FC<{ ports: OpenPort[] }> = ({ ports }) => {
  if (ports.length === 0) {
    return (
      <div className="py-8 text-center text-[var(--text-muted)] text-xs">
        No open ports detected (or insufficient permissions)
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
          <th className="py-2 px-2 font-medium">Port</th>
          <th className="py-2 px-2 font-medium">Protocol</th>
          <th className="py-2 px-2 font-medium">Address</th>
          <th className="py-2 px-2 font-medium">Process</th>
          <th className="py-2 px-2 font-medium">State</th>
        </tr>
      </thead>
      <tbody>
        {ports.map((p, i) => (
          <tr
            key={i}
            className="border-b border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
          >
            <td className="py-1.5 px-2 font-mono font-medium text-[var(--text-primary)]">
              {p.port}
            </td>
            <td className="py-1.5 px-2 text-[var(--text-secondary)]">{p.protocol}</td>
            <td className="py-1.5 px-2 text-[var(--text-secondary)] font-mono">{p.local_address}</td>
            <td className="py-1.5 px-2 text-[var(--text-secondary)] truncate max-w-[200px]">{p.process}</td>
            <td className="py-1.5 px-2">
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--success)]/20 text-[var(--success)]">
                {p.state}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const LoginsTab: React.FC<{ logins: FailedLogin[] }> = ({ logins }) => {
  if (logins.length === 0) {
    return (
      <div className="py-8 text-center text-[var(--text-muted)] text-xs">
        No failed login attempts found
      </div>
    );
  }

  // Group by source IP for summary
  const bySource: Record<string, number> = {};
  for (const l of logins) {
    bySource[l.source] = (bySource[l.source] || 0) + 1;
  }
  const topSources = Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryCard label="Total Failed" value={String(logins.length)} color="var(--danger)" />
        <SummaryCard label="Unique Sources" value={String(Object.keys(bySource).length)} color="var(--warning)" />
        <SummaryCard
          label="Top Attacker"
          value={topSources[0]?.[0] || 'N/A'}
          color="var(--danger)"
        />
        <SummaryCard
          label="Top Attempts"
          value={topSources[0] ? String(topSources[0][1]) : '0'}
          color="var(--danger)"
        />
      </div>

      {/* Top attackers */}
      {topSources.length > 1 && (
        <div>
          <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
            Top Source IPs
          </div>
          <div className="flex flex-wrap gap-1.5">
            {topSources.map(([ip, count]) => (
              <span
                key={ip}
                className="px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[11px] font-mono text-[var(--text-secondary)]"
              >
                {ip} <span className="text-[var(--danger)] font-medium">({count})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
            <th className="py-2 px-2 font-medium">Date</th>
            <th className="py-2 px-2 font-medium">User</th>
            <th className="py-2 px-2 font-medium">Source</th>
            <th className="py-2 px-2 font-medium">Service</th>
          </tr>
        </thead>
        <tbody>
          {logins.map((l, i) => (
            <tr
              key={i}
              className="border-b border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <td className="py-1.5 px-2 text-[var(--text-secondary)] font-mono text-[10px]">{l.date}</td>
              <td className="py-1.5 px-2 font-medium text-[var(--text-primary)]">{l.user}</td>
              <td className="py-1.5 px-2 text-[var(--text-secondary)] font-mono">{l.source}</td>
              <td className="py-1.5 px-2 text-[var(--text-muted)]">{l.service}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const UsersTab: React.FC<{ users: UserPrivilege[] }> = ({ users }) => {
  if (users.length === 0) {
    return (
      <div className="py-8 text-center text-[var(--text-muted)] text-xs">
        No users found
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
          <th className="py-2 px-2 font-medium">User</th>
          <th className="py-2 px-2 font-medium">UID</th>
          <th className="py-2 px-2 font-medium">Shell</th>
          <th className="py-2 px-2 font-medium">Home</th>
          <th className="py-2 px-2 font-medium">Groups</th>
          <th className="py-2 px-2 font-medium">Sudo</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr
            key={u.username}
            className="border-b border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
          >
            <td className="py-1.5 px-2 font-medium text-[var(--text-primary)] font-mono">
              {u.username}
              {u.uid === 0 && (
                <span className="ml-1.5 px-1 py-0.5 rounded text-[8px] font-bold bg-[var(--danger)]/20 text-[var(--danger)]">
                  ROOT
                </span>
              )}
            </td>
            <td className="py-1.5 px-2 text-[var(--text-muted)] font-mono">{u.uid}</td>
            <td className="py-1.5 px-2 text-[var(--text-secondary)] font-mono text-[10px]">{u.shell}</td>
            <td className="py-1.5 px-2 text-[var(--text-secondary)] font-mono text-[10px] truncate max-w-[150px]">{u.home}</td>
            <td className="py-1.5 px-2">
              <div className="flex flex-wrap gap-0.5">
                {u.groups.slice(0, 5).map((g) => (
                  <span
                    key={g}
                    className="px-1 py-0.5 rounded text-[9px] bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                  >
                    {g}
                  </span>
                ))}
                {u.groups.length > 5 && (
                  <span className="text-[9px] text-[var(--text-muted)]">
                    +{u.groups.length - 5}
                  </span>
                )}
              </div>
            </td>
            <td className="py-1.5 px-2">
              {u.has_sudo ? (
                <Check size={13} style={{ color: 'var(--warning)' }} />
              ) : (
                <XCircle size={13} className="text-[var(--text-muted)] opacity-30" />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const SSHConfigTab: React.FC<{ config: Record<string, string> }> = ({ config }) => {
  if (Object.keys(config).length === 0) {
    return (
      <div className="py-8 text-center text-[var(--text-muted)] text-xs">
        Could not read SSH configuration
      </div>
    );
  }

  // Map config keys to display labels and audit status
  const auditItems: { key: string; label: string; value: string; status: 'good' | 'warn' | 'info' }[] = [
    {
      key: 'permit_root_login',
      label: 'Root Login',
      value: config.permit_root_login || 'not set',
      status: config.permit_root_login === 'no' ? 'good' : config.permit_root_login === 'prohibit-password' ? 'info' : 'warn',
    },
    {
      key: 'password_auth',
      label: 'Password Authentication',
      value: config.password_auth || 'not set',
      status: config.password_auth === 'no' ? 'good' : 'warn',
    },
    {
      key: 'pubkey_auth',
      label: 'Public Key Authentication',
      value: config.pubkey_auth || 'not set',
      status: config.pubkey_auth === 'yes' || config.pubkey_auth === 'not set' ? 'good' : 'warn',
    },
    {
      key: 'port',
      label: 'SSH Port',
      value: config.port || '22',
      status: config.port && config.port !== '22' ? 'good' : 'info',
    },
    {
      key: 'max_auth_tries',
      label: 'Max Auth Tries',
      value: config.max_auth_tries || 'not set',
      status: 'info',
    },
  ];

  const goodCount = auditItems.filter((i) => i.status === 'good').length;
  const warnCount = auditItems.filter((i) => i.status === 'warn').length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-3 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
        <ShieldCheck size={20} className={warnCount > 0 ? 'text-[var(--warning)]' : 'text-[var(--success)]'} />
        <div>
          <div className="text-xs font-medium text-[var(--text-primary)]">
            SSH Configuration Audit
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">
            {goodCount} secure, {warnCount} warning{warnCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Config items */}
      <div className="space-y-1.5">
        {auditItems.map((item) => (
          <div
            key={item.key}
            className="flex items-center gap-3 px-3 py-2.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]"
          >
            <div className="shrink-0">
              {item.status === 'good' ? (
                <Check size={14} style={{ color: 'var(--success)' }} />
              ) : item.status === 'warn' ? (
                <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />
              ) : (
                <div className="w-3.5 h-3.5 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border)]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[var(--text-primary)]">{item.label}</div>
            </div>
            <div className="text-xs font-mono text-[var(--text-secondary)]">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const MalwareTab: React.FC<{
  available: boolean;
  result: MalwareScanResult | null;
  loading: boolean;
  onScan: () => void;
}> = ({ available, result, loading, onScan }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="p-4 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-center">
        <Bug size={24} className="mx-auto mb-2 text-[var(--text-muted)]" />
        <div className="text-xs text-[var(--text-primary)] font-medium mb-1">
          {available ? 'Malware Scanner Available' : 'No Malware Scanner Installed'}
        </div>
        <div className="text-[10px] text-[var(--text-muted)] mb-3">
          {available
            ? 'Run a scan of /tmp, /var/tmp, and /home directories'
            : 'Install ClamAV or rkhunter to enable malware scanning'}
        </div>
        <button
          onClick={onScan}
          disabled={!available || loading}
          className="px-4 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Scanning... (this may take a while)
            </span>
          ) : (
            'Run Malware Scan'
          )}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-2">
          <div className={`flex items-center gap-2 p-3 rounded border ${
            result.threats_found > 0
              ? 'bg-[var(--danger)]/10 border-[var(--danger)]/30'
              : 'bg-[var(--success)]/10 border-[var(--success)]/30'
          }`}>
            {result.threats_found > 0 ? (
              <AlertTriangle size={16} style={{ color: 'var(--danger)' }} />
            ) : (
              <Check size={16} style={{ color: 'var(--success)' }} />
            )}
            <div className="flex-1">
              <div className="text-xs font-medium text-[var(--text-primary)]">
                {result.threats_found > 0
                  ? `${result.threats_found} threat(s) found!`
                  : 'No threats detected'}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                Scanned with {result.tool} — Status: {result.status}
              </div>
            </div>
          </div>

          {/* Expandable output */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {expanded ? 'Hide' : 'Show'} scan output
          </button>
          {expanded && (
            <pre className="p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px] font-mono text-[var(--text-secondary)] overflow-auto max-h-[300px] whitespace-pre-wrap">
              {result.output || 'No output'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div className="p-2.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
    <div className="text-[10px] text-[var(--text-muted)] mb-0.5">{label}</div>
    <div className="text-sm font-semibold font-mono truncate" style={{ color }}>
      {value}
    </div>
  </div>
);
