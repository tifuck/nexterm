import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import DOMPurify from 'dompurify';
import {
  Network,
  RefreshCw,
  Loader2,
  X,
  AlertTriangle,
  Check,
  Power,
  PowerOff,
  Users,
  Globe,
  ArrowDownUp,
  Clock,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Terminal,
  Key,
  Download,
  Copy,
  Shield,
  ShieldOff,
  ShieldCheck,
  Eye,
  Skull,
  ServerCrash,
  Wifi,
  WifiOff,
  Activity,
  QrCode,
  Ban,
  CheckCircle,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost, getWsUrl, ensureFreshToken, sendWsAuth } from '@/api/client';
import { useToastStore } from '@/store/toastStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WireGuardClient {
  name: string;
  public_key: string;
  allowed_ips: string;
  endpoint: string;
  latest_handshake: string;
  transfer_rx: string;
  transfer_tx: string;
  persistent_keepalive: string;
  enabled: boolean;
  has_recent_handshake: boolean;
}

interface WireGuardStatus {
  installed: boolean;
  version: string;
  active: boolean;
  warning: string;
  server_public_key: string;
  listen_port: string;
  address: string;
  endpoint: string;
  public_ip: string;
  total_transfer_rx: string;
  total_transfer_tx: string;
  config_path: string;
  clients: WireGuardClient[];
  active_clients: number;
  total_clients: number;
}

interface WireGuardInstallCheck {
  supported: boolean;
  os: string;
  os_version: string;
  already_installed: boolean;
  public_ip: string;
  local_ips: string[];
  has_ipv6: boolean;
  ipv6_addr: string;
  is_container: boolean;
  needs_boringtun: boolean;
  reason: string;
}

interface WireGuardClientConfig {
  name: string;
  config_content: string;
  qr_svg: string;
}

interface InstallConfig {
  endpoint: string;
  port: number;
  dns: string;
  mtu: number | null;
  first_client_name: string;
  local_ip: string;
  ipv6_addr: string;
}

type ViewState = 'loading' | 'check' | 'not_supported' | 'not_installed' | 'installing' | 'dashboard';

const DNS_PRESETS: Record<string, string> = {
  'System Default': '',
  'Cloudflare': '1.1.1.1, 1.0.0.1',
  'Google': '8.8.8.8, 8.8.4.4',
  'OpenDNS': '208.67.222.222, 208.67.220.220',
  'Quad9': '9.9.9.9, 149.112.112.112',
  'Gcore': '95.85.95.85, 2.56.220.2',
  'AdGuard': '94.140.14.14, 94.140.15.15',
  'Custom': 'custom',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  connectionId: string;
}

export const WireGuardManager: React.FC<Props> = ({ connectionId }) => {
  const addToast = useToastStore((s) => s.addToast);

  const parseMtu = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(1280, Math.min(1420, Math.round(parsed)));
  };

  // View state
  const [view, setView] = useState<ViewState>('loading');
  const [status, setStatus] = useState<WireGuardStatus | null>(null);
  const [installCheck, setInstallCheck] = useState<WireGuardInstallCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Install flow
  const [installConfig, setInstallConfig] = useState<InstallConfig>({
    endpoint: '', port: 51820, dns: '1.1.1.1, 1.0.0.1', mtu: null,
    first_client_name: 'client', local_ip: '', ipv6_addr: '',
  });
  const [installOutput, setInstallOutput] = useState<string[]>([]);
  const [installStatus, setInstallStatus] = useState<'idle' | 'running' | 'completed' | 'failed' | 'killed'>('idle');
  const [dnsPreset, setDnsPreset] = useState('Cloudflare');
  const [customDns, setCustomDns] = useState('');
  const installOutputRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const checkRequestIdRef = useRef(0);
  const statusRequestIdRef = useRef(0);

  // Add client dialog
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientDns, setNewClientDns] = useState('1.1.1.1, 1.0.0.1');
  const [newClientMtu, setNewClientMtu] = useState<number | null>(null);
  const [addingClient, setAddingClient] = useState(false);

  // Client config viewer
  const [viewingConfig, setViewingConfig] = useState<WireGuardClientConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState<string | null>(null);

  // Uninstall confirm
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [uninstallLoading, setUninstallLoading] = useState(false);

  // Kill confirm for install
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  // -------------------------------------------------------------------
  // Initial check
  // -------------------------------------------------------------------

  const runCheck = useCallback(async () => {
    const requestId = checkRequestIdRef.current + 1;
    checkRequestIdRef.current = requestId;
    statusRequestIdRef.current += 1;
    setView('loading');
    setLoading(false);
    setStatus(null);
    setStatusError(null);
    try {
      const check: WireGuardInstallCheck = await apiGet(`/api/tools/${connectionId}/wireguard/check`);
      if (requestId !== checkRequestIdRef.current) return;
      setInstallCheck(check);

      if (check.already_installed) {
        setLoading(true);
        setView('dashboard');
        return;
      }

      if (!check.supported) {
        setView('not_supported');
        return;
      }

      // Pre-fill install config with detected values
      setInstallConfig((prev) => ({
        ...prev,
        endpoint: check.public_ip || (check.local_ips.length > 0 ? check.local_ips[0] : ''),
        local_ip: check.local_ips.length > 0 ? check.local_ips[0] : '',
        ipv6_addr: check.ipv6_addr || '',
      }));
      setView('not_installed');
    } catch {
      if (requestId !== checkRequestIdRef.current) return;
      addToast('Failed to check WireGuard status', 'error');
      setView('not_supported');
    }
  }, [connectionId, addToast]);

  // -------------------------------------------------------------------
  // Dashboard data
  // -------------------------------------------------------------------

  const fetchStatus = useCallback(async (options?: { resetStatus?: boolean }) => {
    const requestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = requestId;
    if (options?.resetStatus) {
      setStatus(null);
    }
    setStatusError(null);
    setLoading(true);
    try {
      const data: WireGuardStatus = await apiGet(`/api/tools/${connectionId}/wireguard/status`);
      if (requestId !== statusRequestIdRef.current) return;
      setStatus(data);
      if (!data.installed) {
        setStatus(null);
        setView('not_installed');
        return;
      }
      setView('dashboard');
    } catch (err: unknown) {
      if (requestId !== statusRequestIdRef.current) return;
      const message = err instanceof Error ? err.message : 'Failed to fetch WireGuard status';
      setStatusError(message);
      addToast(message, 'error');
    } finally {
      if (requestId === statusRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [connectionId, addToast]);

  useEffect(() => {
    if (view === 'dashboard') {
      void fetchStatus();
    }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  // -------------------------------------------------------------------
  // Install via WebSocket
  // -------------------------------------------------------------------

  const startInstall = useCallback(async () => {
    if (!installConfig.endpoint) {
      addToast('Please specify a server endpoint/IP', 'error');
      return;
    }

    setView('installing');
    setInstallOutput([]);
    setInstallStatus('running');

    await ensureFreshToken();
    const ws = new WebSocket(getWsUrl('/ws/tools'));
    wsRef.current = ws;

    ws.onopen = () => {
      sendWsAuth(ws);
      ws.send(JSON.stringify({
        type: 'wireguard_install',
        connection_id: connectionId,
        config: installConfig,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'wireguard_install_output') {
          if (msg.data) {
            setInstallOutput((prev) => [...prev, msg.data]);
          }
          if (msg.status === 'completed') {
            setInstallStatus('completed');
            addToast('WireGuard installed successfully!', 'success');
            ws.close();
            // Transition to dashboard after a brief delay
            setTimeout(() => {
              setStatus(null);
              setStatusError(null);
              setLoading(true);
              setView('dashboard');
            }, 2000);
          } else if (msg.status === 'failed') {
            setInstallStatus('failed');
            addToast('WireGuard installation failed', 'error');
            ws.close();
          } else if (msg.status === 'killed') {
            setInstallStatus('killed');
            addToast('Installation process killed', 'info');
            ws.close();
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      setInstallStatus('failed');
      addToast('WebSocket connection error during install', 'error');
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, [connectionId, installConfig, addToast]);

  const killInstall = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'wireguard_install_kill' }));
    }
    setShowKillConfirm(false);
  }, []);

  // Auto-scroll install output
  useEffect(() => {
    if (installOutputRef.current) {
      installOutputRef.current.scrollTop = installOutputRef.current.scrollHeight;
    }
  }, [installOutput]);

  // Cleanup WS on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // -------------------------------------------------------------------
  // Server actions
  // -------------------------------------------------------------------

  const toggleServer = async () => {
    setActionLoading('toggle-server');
    try {
      const result = await apiPost(`/api/tools/${connectionId}/wireguard/toggle`, {});
      addToast(result.message || 'Interface toggled', 'success');
      setTimeout(() => {
        void fetchStatus();
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to toggle server';
      addToast(message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const uninstallWireGuard = async () => {
    setUninstallLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/wireguard/uninstall`, {});
      addToast('WireGuard removed successfully', 'success');
      setShowUninstallConfirm(false);
      setStatus(null);
      runCheck();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to uninstall WireGuard';
      addToast(message, 'error');
    } finally {
      setUninstallLoading(false);
    }
  };

  // -------------------------------------------------------------------
  // Client management
  // -------------------------------------------------------------------

  const addClient = async () => {
    if (!newClientName.trim()) return;
    setAddingClient(true);
    try {
      const result: WireGuardClientConfig = await apiPost(`/api/tools/${connectionId}/wireguard/clients/add`, {
        name: newClientName.trim(),
        dns: newClientDns,
        mtu: newClientMtu,
      });
      addToast(`Client "${newClientName}" created successfully`, 'success');
      setShowAddClient(false);
      setNewClientName('');
      setNewClientMtu(null);
      setViewingConfig(result);
      void fetchStatus();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add client';
      addToast(message, 'error');
    } finally {
      setAddingClient(false);
    }
  };

  const removeClient = async (name: string) => {
    setActionLoading(`remove:${name}`);
    try {
      await apiPost(`/api/tools/${connectionId}/wireguard/clients/remove`, { name });
      addToast(`Client "${name}" removed`, 'success');
      void fetchStatus();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove client';
      addToast(message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleClient = async (name: string, action: 'enable' | 'disable') => {
    setActionLoading(`toggle:${name}`);
    try {
      await apiPost(`/api/tools/${connectionId}/wireguard/clients/toggle`, { name, action });
      addToast(`Client "${name}" ${action}d`, 'success');
      void fetchStatus();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to ${action} client`;
      addToast(message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const viewClientConfig = async (name: string) => {
    setLoadingConfig(name);
    try {
      const config: WireGuardClientConfig = await apiGet(`/api/tools/${connectionId}/wireguard/clients/${name}/config`);
      setViewingConfig(config);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to get client config';
      addToast(message, 'error');
    } finally {
      setLoadingConfig(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast('Copied to clipboard', 'success');
    } catch {
      addToast('Failed to copy', 'error');
    }
  };

  const downloadConfig = (name: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // -------------------------------------------------------------------
  // RENDER: Loading
  // -------------------------------------------------------------------

  if (view === 'loading') {
    return (
      <ToolModal title="WireGuard Manager" icon={<Network size={18} />}>
        <div className="py-16 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          Checking WireGuard status...
        </div>
      </ToolModal>
    );
  }

  // -------------------------------------------------------------------
  // RENDER: Not Supported
  // -------------------------------------------------------------------

  if (view === 'not_supported') {
    return (
      <ToolModal title="WireGuard Manager" icon={<Network size={18} />}>
        <div className="py-8 text-center max-w-md mx-auto">
          <ServerCrash size={32} className="mx-auto mb-3 text-[var(--danger)]" />
          <div className="text-sm text-[var(--text-primary)] font-medium mb-2">Unsupported System</div>
          <div className="text-xs text-[var(--text-muted)] mb-4">
            {installCheck?.reason || 'This system is not supported for WireGuard installation.'}
          </div>
          {installCheck && (
            <div className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-secondary)] rounded p-3 border border-[var(--border)]">
              <div>Detected OS: <span className="text-[var(--text-secondary)]">{installCheck.os || 'Unknown'}</span></div>
              <div className="mt-1">Supported: Ubuntu 22.04+, Debian 11+, CentOS/Alma/Rocky 9+, Fedora</div>
            </div>
          )}
        </div>
      </ToolModal>
    );
  }

  // -------------------------------------------------------------------
  // RENDER: Not Installed (install form)
  // -------------------------------------------------------------------

  if (view === 'not_installed') {
    return (
      <ToolModal title="WireGuard Manager" icon={<Network size={18} />}>
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-6">
            <Shield size={32} className="mx-auto mb-3 text-[var(--accent)]" />
            <div className="text-sm text-[var(--text-primary)] font-semibold mb-1">Install WireGuard VPN Server</div>
            <div className="text-xs text-[var(--text-muted)]">
              One-click setup based on the Nyr WireGuard installer.
              {installCheck?.os && <span> Detected: <span className="text-[var(--text-secondary)]">{installCheck.os}</span></span>}
              {installCheck?.is_container && <span className="text-[var(--warning)]"> (Container — BoringTun will be used)</span>}
            </div>
          </div>

          <div className="space-y-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-4">
            {/* Endpoint */}
            <div>
              <label className="text-[10px] font-medium text-[var(--text-secondary)] block mb-1">
                Public Endpoint / IP
              </label>
              <input
                type="text"
                value={installConfig.endpoint}
                onChange={(e) => setInstallConfig((p) => ({ ...p, endpoint: e.target.value }))}
                placeholder="Public IP or hostname"
                className="w-full px-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
              {installCheck?.public_ip && installConfig.endpoint !== installCheck.public_ip && (
                <button
                  onClick={() => setInstallConfig((p) => ({ ...p, endpoint: installCheck.public_ip }))}
                  className="text-[9px] text-[var(--accent)] mt-0.5 hover:underline"
                >
                  Use detected: {installCheck.public_ip}
                </button>
              )}
            </div>

            {/* Port */}
            <div>
              <label className="text-[10px] font-medium text-[var(--text-secondary)] block mb-1">
                Listen Port
              </label>
              <input
                type="number"
                value={installConfig.port}
                onChange={(e) => setInstallConfig((p) => ({ ...p, port: Math.max(1, Math.min(65535, Number(e.target.value))) }))}
                className="w-32 px-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* DNS */}
            <div>
              <label className="text-[10px] font-medium text-[var(--text-secondary)] block mb-1">
                DNS Server
              </label>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {Object.keys(DNS_PRESETS).map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      setDnsPreset(name);
                      if (name !== 'Custom' && name !== 'System Default') {
                        setInstallConfig((p) => ({ ...p, dns: DNS_PRESETS[name] }));
                      } else if (name === 'Custom') {
                        setInstallConfig((p) => ({ ...p, dns: customDns }));
                      }
                    }}
                    className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                      dnsPreset === name
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)]'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {dnsPreset === 'Custom' && (
                <input
                  type="text"
                  value={customDns}
                  onChange={(e) => {
                    setCustomDns(e.target.value);
                    setInstallConfig((p) => ({ ...p, dns: e.target.value }));
                  }}
                  placeholder="e.g. 8.8.8.8, 1.1.1.1"
                  className="w-full px-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
              )}
              {dnsPreset !== 'Custom' && dnsPreset !== 'System Default' && (
                <div className="text-[9px] text-[var(--text-muted)] font-mono">{DNS_PRESETS[dnsPreset]}</div>
              )}
            </div>

            {/* First Client Name */}
            <div>
              <label className="text-[10px] font-medium text-[var(--text-secondary)] block mb-1">
                First Client Name
              </label>
              <input
                type="text"
                value={installConfig.first_client_name}
                onChange={(e) => setInstallConfig((p) => ({ ...p, first_client_name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 15) }))}
                placeholder="client"
                className="w-48 px-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* Client MTU */}
            <div>
              <label className="text-[10px] font-medium text-[var(--text-secondary)] block mb-1">
                Client MTU (optional)
              </label>
              <input
                type="number"
                min={1280}
                max={1420}
                step={1}
                value={installConfig.mtu ?? ''}
                onChange={(e) => setInstallConfig((p) => ({ ...p, mtu: parseMtu(e.target.value) }))}
                placeholder="1380"
                className="w-32 px-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
              <div className="text-[9px] text-[var(--text-muted)] mt-0.5">
                Leave blank for auto-detect. Use this mainly for Linux clients. MTU controls the largest packet size sent through the tunnel; lowering it to 1280-1380 can avoid fragmentation when SSH or other larger transfers stall.
              </div>
            </div>

            {/* Local IP (if multiple) */}
            {installCheck && installCheck.local_ips.length > 1 && (
              <div>
                <label className="text-[10px] font-medium text-[var(--text-secondary)] block mb-1">
                  Local IP (server has multiple)
                </label>
                <select
                  value={installConfig.local_ip}
                  onChange={(e) => setInstallConfig((p) => ({ ...p, local_ip: e.target.value }))}
                  className="px-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {installCheck.local_ips.map((ip) => (
                    <option key={ip} value={ip}>{ip}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Install Button */}
          <div className="mt-4 flex justify-center">
            <button
              onClick={startInstall}
              disabled={!installConfig.endpoint}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Shield size={16} />
              Install WireGuard
            </button>
          </div>
        </div>
      </ToolModal>
    );
  }

  // -------------------------------------------------------------------
  // RENDER: Installing (live output stream)
  // -------------------------------------------------------------------

  if (view === 'installing') {
    return (
      <ToolModal title="WireGuard Manager" icon={<Network size={18} />}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {installStatus === 'running' && <Loader2 size={14} className="animate-spin text-[var(--accent)]" />}
              {installStatus === 'completed' && <CheckCircle size={14} className="text-[var(--success)]" />}
              {installStatus === 'failed' && <AlertTriangle size={14} className="text-[var(--danger)]" />}
              {installStatus === 'killed' && <Ban size={14} className="text-[var(--warning)]" />}
              <span className="text-xs font-medium text-[var(--text-primary)]">
                {installStatus === 'running' && 'Installing WireGuard...'}
                {installStatus === 'completed' && 'Installation Complete'}
                {installStatus === 'failed' && 'Installation Failed'}
                {installStatus === 'killed' && 'Installation Killed'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {installStatus === 'running' && (
                <button
                  onClick={() => setShowKillConfirm(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--danger)]/15 text-[var(--danger)] text-[10px] font-medium hover:bg-[var(--danger)]/25 transition-colors"
                >
                  <Skull size={11} />
                  Kill Process
                </button>
              )}
              {(installStatus === 'failed' || installStatus === 'killed') && (
                <button
                  onClick={() => { setView('not_installed'); setInstallStatus('idle'); }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-medium hover:bg-[var(--accent)]/25 transition-colors"
                >
                  <RefreshCw size={11} />
                  Retry
                </button>
              )}
            </div>
          </div>

          {/* Kill confirmation */}
          {showKillConfirm && (
            <div className="mb-3 p-3 rounded border border-[var(--danger)] bg-[var(--danger)]/5">
              <div className="text-xs font-medium text-[var(--danger)] mb-2 flex items-center gap-1.5">
                <AlertTriangle size={12} />
                Warning: Killing the install process may leave the system in a partially configured state.
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={killInstall}
                  className="px-3 py-1 rounded bg-[var(--danger)] text-white text-[10px] font-medium hover:bg-[var(--danger)]/80 transition-colors"
                >
                  Kill Anyway
                </button>
                <button
                  onClick={() => setShowKillConfirm(false)}
                  className="px-3 py-1 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Output feed */}
          <div
            ref={installOutputRef}
            className="flex-1 min-h-[300px] max-h-[calc(80vh-220px)] overflow-auto rounded bg-[#0d1117] border border-[var(--border)] p-3 font-mono text-[11px] leading-relaxed"
          >
            {installOutput.map((line, i) => (
              <div
                key={i}
                className={`${
                  line.startsWith('>>>') ? 'text-[#58a6ff] font-semibold' :
                  line.includes('ERROR') || line.includes('error') || line.includes('failed') ? 'text-[#f85149]' :
                  line.includes('SUCCESS') || line.includes('successfully') ? 'text-[#3fb950]' :
                  'text-[#c9d1d9]'
                }`}
              >
                {line}
              </div>
            ))}
            {installStatus === 'running' && (
              <div className="text-[#8b949e] animate-pulse mt-1">_</div>
            )}
          </div>
        </div>
      </ToolModal>
    );
  }

  // -------------------------------------------------------------------
  // RENDER: Dashboard
  // -------------------------------------------------------------------

  return (
    <ToolModal title="WireGuard Manager" icon={<Network size={18} />}>
      {/* Client Config Viewer Modal */}
      {viewingConfig && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setViewingConfig(null)} />
          <div className="relative bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col animate-slide-down">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] rounded-t-lg shrink-0">
              <QrCode size={14} className="text-[var(--accent)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)] flex-1">
                Client: {viewingConfig.name}
              </span>
              <button onClick={() => setViewingConfig(null)} className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* QR Code */}
              {viewingConfig.qr_svg && (
                <div className="flex justify-center">
                  <div
                    className="w-[240px] max-w-full bg-white p-3 rounded-lg overflow-hidden [&_svg]:block [&_svg]:w-full [&_svg]:h-auto"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(viewingConfig.qr_svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['svg', 'path', 'rect', 'circle', 'g', 'defs', 'use'], FORBID_ATTR: ['xlink:href', 'href'] }) }}
                  />
                </div>
              )}
              {/* Config text */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-medium text-[var(--text-secondary)]">Configuration File</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => copyToClipboard(viewingConfig.config_content)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      <Copy size={9} /> Copy
                    </button>
                    <button
                      onClick={() => downloadConfig(viewingConfig.name, viewingConfig.config_content)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
                    >
                      <Download size={9} /> Download .conf
                    </button>
                  </div>
                </div>
                <pre className="p-3 rounded bg-[#0d1117] border border-[var(--border)] text-[10px] font-mono text-[#c9d1d9] overflow-auto max-h-48 whitespace-pre-wrap">
                  {viewingConfig.config_content}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Uninstall Confirmation */}
      {showUninstallConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowUninstallConfirm(false)} />
          <div className="relative bg-[var(--bg-primary)] border border-[var(--danger)]/50 rounded-lg shadow-2xl max-w-sm w-full mx-4 p-5 animate-slide-down">
            <div className="text-center mb-4">
              <AlertTriangle size={28} className="mx-auto mb-2 text-[var(--danger)]" />
              <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">Uninstall WireGuard?</div>
              <div className="text-xs text-[var(--text-muted)]">
                This will remove WireGuard, all client configurations, and firewall rules.
                This action cannot be undone.
              </div>
            </div>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={uninstallWireGuard}
                disabled={uninstallLoading}
                className="flex items-center gap-1.5 px-4 py-2 rounded bg-[var(--danger)] text-white text-xs font-medium hover:bg-[var(--danger)]/80 transition-colors disabled:opacity-50"
              >
                {uninstallLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Uninstall
              </button>
              <button
                onClick={() => setShowUninstallConfirm(false)}
                className="px-4 py-2 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--text-muted)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Client Dialog */}
      {showAddClient && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAddClient(false)} />
          <div className="relative bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-2xl max-w-sm w-full mx-4 animate-slide-down">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] rounded-t-lg">
              <Plus size={14} className="text-[var(--accent)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)] flex-1">Add Client</span>
              <button onClick={() => setShowAddClient(false)} className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-medium text-[var(--text-secondary)] block mb-1">Client Name</label>
                <input
                  type="text"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 15))}
                  placeholder="e.g. laptop, phone"
                  className="w-full px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && newClientName.trim()) addClient(); }}
                />
                <div className="text-[9px] text-[var(--text-muted)] mt-0.5">
                  Alphanumeric, dashes, underscores only. Max 15 characters.
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-[var(--text-secondary)] block mb-1">DNS Server</label>
                <select
                  value={newClientDns}
                  onChange={(e) => setNewClientDns(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="1.1.1.1, 1.0.0.1">Cloudflare (1.1.1.1)</option>
                  <option value="8.8.8.8, 8.8.4.4">Google (8.8.8.8)</option>
                  <option value="208.67.222.222, 208.67.220.220">OpenDNS</option>
                  <option value="9.9.9.9, 149.112.112.112">Quad9</option>
                  <option value="94.140.14.14, 94.140.15.15">AdGuard</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-[var(--text-secondary)] block mb-1">Client MTU (optional)</label>
                <input
                  type="number"
                  min={1280}
                  max={1420}
                  step={1}
                  value={newClientMtu ?? ''}
                  onChange={(e) => setNewClientMtu(parseMtu(e.target.value))}
                  placeholder="1380"
                  className="w-full px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                <div className="text-[9px] text-[var(--text-muted)] mt-0.5">
                  Use this mainly for Linux clients. MTU controls the largest packet size sent through the tunnel; lowering it can help if the tunnel connects but SSH or larger transfers stall.
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={addClient}
                  disabled={addingClient || !newClientName.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
                >
                  {addingClient ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Create Client
                </button>
                <button
                  onClick={() => setShowAddClient(false)}
                  className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Client Confirmation - handled inline */}

      {/* Main dashboard content */}
      <div className="space-y-4">
        {statusError && (
          <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[var(--danger)] mb-1">Unable to load WireGuard status</div>
              <div className="text-[11px] text-[var(--text-secondary)] break-words">{statusError}</div>
            </div>
            <button
              onClick={() => void fetchStatus({ resetStatus: !status })}
              className="shrink-0 px-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[10px] font-medium text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {status?.warning && (
          <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3">
            <div className="text-xs font-semibold text-[var(--warning)] mb-1">Partial WireGuard data</div>
            <div className="text-[11px] text-[var(--text-secondary)] break-words">{status.warning}</div>
          </div>
        )}

        {/* Server Info Panel */}
        {status && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-3 border-b border-[var(--border)]">
              <div className={`w-3 h-3 rounded-full shrink-0 ${status.active ? 'bg-[var(--success)] shadow-[0_0_6px_var(--success)]' : 'bg-[var(--text-muted)]'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">WireGuard Server</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                    status.active
                      ? 'bg-[var(--success)]/15 text-[var(--success)]'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                  }`}>
                    {status.active ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">{status.version ? `v${status.version}` : 'version unknown'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleServer}
                  disabled={actionLoading === 'toggle-server'}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-medium transition-colors disabled:opacity-50 ${
                    status.active
                      ? 'bg-[var(--danger)]/15 text-[var(--danger)] hover:bg-[var(--danger)]/25'
                      : 'bg-[var(--success)]/15 text-[var(--success)] hover:bg-[var(--success)]/25'
                  }`}
                >
                  {actionLoading === 'toggle-server' ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : status.active ? (
                    <PowerOff size={11} />
                  ) : (
                    <Power size={11} />
                  )}
                  {status.active ? 'Stop' : 'Start'}
                </button>
                <button
                  onClick={() => void fetchStatus()}
                  disabled={loading}
                  data-tool-refresh
                  title="Refresh status"
                  className="p-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={() => setShowUninstallConfirm(true)}
                  className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                  title="Uninstall WireGuard"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Server details grid */}
            <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[10px]">
              <div>
                <div className="text-[var(--text-muted)] mb-0.5 flex items-center gap-1"><Globe size={10} /> Endpoint</div>
                <div className="font-mono text-[var(--text-primary)] break-all">{status.endpoint || status.public_ip || '—'}</div>
              </div>
              <div>
                <div className="text-[var(--text-muted)] mb-0.5 flex items-center gap-1"><Network size={10} /> Listen Port</div>
                <div className="font-mono text-[var(--text-primary)]">{status.listen_port || '—'}</div>
              </div>
              <div>
                <div className="text-[var(--text-muted)] mb-0.5 flex items-center gap-1"><Wifi size={10} /> Address</div>
                <div className="font-mono text-[var(--text-primary)]">{status.address || '—'}</div>
              </div>
              <div>
                <div className="text-[var(--text-muted)] mb-0.5 flex items-center gap-1"><Users size={10} /> Clients</div>
                <div className="text-[var(--text-primary)]">
                  <span className="text-[var(--success)] font-medium">{status.active_clients}</span>
                  <span className="text-[var(--text-muted)]"> / {status.total_clients}</span>
                  <span className="text-[var(--text-muted)]"> active</span>
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[var(--text-muted)] mb-0.5 flex items-center gap-1"><Key size={10} /> Public Key</div>
                <div className="font-mono text-[var(--text-primary)] break-all flex items-center gap-1">
                  <span className="truncate">{status.server_public_key || '—'}</span>
                  {status.server_public_key && (
                    <button
                      onClick={() => copyToClipboard(status.server_public_key)}
                      className="shrink-0 p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      <Copy size={9} />
                    </button>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)] mb-0.5 flex items-center gap-1"><ArrowDownUp size={10} /> Transfer</div>
                <div className="font-mono text-[var(--text-primary)]">
                  <span className="text-[var(--success)]">{status.total_transfer_rx || '0'}</span>
                  <span className="text-[var(--text-muted)]"> / </span>
                  <span className="text-[var(--accent)]">{status.total_transfer_tx || '0'}</span>
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)] mb-0.5 flex items-center gap-1"><Terminal size={10} /> Config</div>
                <div className="font-mono text-[var(--text-primary)]">{status.config_path}</div>
              </div>
            </div>
          </div>
        )}

        {/* Clients Section */}
        {status && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Users size={13} />
                Clients ({status.total_clients})
              </div>
              <button
                onClick={() => setShowAddClient(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-[10px] font-medium hover:bg-[var(--accent-hover)] transition-colors"
              >
                <Plus size={11} />
                Add Client
              </button>
            </div>

            {status.clients.length === 0 ? (
              <div className="py-6 text-center rounded border border-[var(--border)] bg-[var(--bg-secondary)]">
                <WifiOff size={20} className="mx-auto mb-2 text-[var(--text-muted)]" />
                <div className="text-xs text-[var(--text-primary)] font-medium mb-1">No Clients</div>
                <div className="text-[10px] text-[var(--text-muted)]">Add a client to get started with VPN connections.</div>
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-secondary)]">
                {/* Header */}
                <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr_auto] gap-2 px-3 py-2 bg-[var(--bg-primary)]/50 border-b border-[var(--border)] text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  <div className="w-4"></div>
                  <div>Client</div>
                  <div>Allowed IPs</div>
                  <div>Endpoint</div>
                  <div>Handshake</div>
                  <div>Transfer</div>
                  <div className="w-24 text-right">Actions</div>
                </div>

                {/* Client rows */}
                <div className="divide-y divide-[var(--border)]">
                  {status.clients.map((client) => (
                    <ClientRow
                      key={client.name}
                      client={client}
                      onViewConfig={() => viewClientConfig(client.name)}
                      onToggle={() => toggleClient(client.name, client.enabled ? 'disable' : 'enable')}
                      onRemove={() => removeClient(client.name)}
                      actionLoading={actionLoading}
                      loadingConfig={loadingConfig}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading state for dashboard */}
        {loading && !status && (
          <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading WireGuard status...
          </div>
        )}

        {!loading && !status && !statusError && (
          <div className="py-12 text-center rounded border border-[var(--border)] bg-[var(--bg-secondary)]">
            <div className="text-xs font-medium text-[var(--text-primary)] mb-1">WireGuard status is unavailable</div>
            <div className="text-[10px] text-[var(--text-muted)] mb-3">Retry the status check or reopen the tool.</div>
            <button
              onClick={() => void fetchStatus({ resetStatus: true })}
              className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-[10px] font-medium hover:bg-[var(--accent-hover)] transition-colors"
            >
              Retry Status Load
            </button>
          </div>
        )}
      </div>
    </ToolModal>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const ClientRow: React.FC<{
  client: WireGuardClient;
  onViewConfig: () => void;
  onToggle: () => void;
  onRemove: () => void;
  actionLoading: string | null;
  loadingConfig: string | null;
}> = ({ client, onViewConfig, onToggle, onRemove, actionLoading, loadingConfig }) => {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const statusColor = !client.enabled
    ? 'bg-[var(--text-muted)]'  // disabled = gray
    : client.has_recent_handshake
      ? 'bg-[var(--success)] shadow-[0_0_4px_var(--success)]'  // active = green glow
      : 'bg-[var(--warning)]';  // enabled but no recent handshake = yellow

  const isToggling = actionLoading === `toggle:${client.name}`;
  const isRemoving = actionLoading === `remove:${client.name}`;
  const isLoadingConfig = loadingConfig === client.name;

  return (
    <div className={`grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr_auto] gap-2 px-3 py-2.5 items-center hover:bg-[var(--bg-tertiary)]/50 transition-colors ${!client.enabled ? 'opacity-60' : ''}`}>
      {/* Status dot */}
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColor}`} />

      {/* Name */}
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-[var(--text-primary)] font-mono truncate">{client.name}</div>
        {!client.enabled && (
          <div className="text-[9px] text-[var(--text-muted)] italic">disabled</div>
        )}
      </div>

      {/* Allowed IPs */}
      <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate" title={client.allowed_ips}>
        {client.allowed_ips || '—'}
      </div>

      {/* Endpoint */}
      <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate" title={client.endpoint}>
        {client.endpoint || '(none)'}
      </div>

      {/* Handshake */}
      <div className="text-[10px] text-[var(--text-secondary)] truncate flex items-center gap-1">
        {client.has_recent_handshake && <Activity size={9} className="text-[var(--success)] shrink-0" />}
        <span className="font-mono truncate">{client.latest_handshake || 'never'}</span>
      </div>

      {/* Transfer */}
      <div className="text-[10px] font-mono text-[var(--text-secondary)]">
        {client.transfer_rx && client.transfer_tx
          ? `${client.transfer_rx} / ${client.transfer_tx}`
          : '—'
        }
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end w-24">
        <button
          onClick={onViewConfig}
          disabled={isLoadingConfig}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-50"
          title="View Config & QR"
        >
          {isLoadingConfig ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}
        </button>
        <button
          onClick={onToggle}
          disabled={isToggling}
          className={`p-1 rounded transition-colors disabled:opacity-50 ${
            client.enabled
              ? 'text-[var(--text-muted)] hover:text-[var(--warning)] hover:bg-[var(--warning)]/10'
              : 'text-[var(--text-muted)] hover:text-[var(--success)] hover:bg-[var(--success)]/10'
          }`}
          title={client.enabled ? 'Disable Client' : 'Enable Client'}
        >
          {isToggling ? <Loader2 size={11} className="animate-spin" /> : client.enabled ? <ShieldOff size={11} /> : <ShieldCheck size={11} />}
        </button>

        {showConfirmDelete ? (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => { onRemove(); setShowConfirmDelete(false); }}
              disabled={isRemoving}
              className="p-1 rounded bg-[var(--danger)] text-white transition-colors disabled:opacity-50"
              title="Confirm delete"
            >
              {isRemoving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            </button>
            <button
              onClick={() => setShowConfirmDelete(false)}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="Cancel"
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirmDelete(true)}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
            title="Remove Client"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
};
