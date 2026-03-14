import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Plus,
  Trash2,
  Terminal,
  Key,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WireGuardPeer {
  public_key: string;
  endpoint: string;
  allowed_ips: string;
  latest_handshake: string;
  transfer_rx: string;
  transfer_tx: string;
  persistent_keepalive: string;
}

interface WireGuardInterface {
  name: string;
  public_key: string;
  listening_port: string;
  address: string;
  peers: WireGuardPeer[];
  active: boolean;
}

interface WireGuardStatus {
  installed: boolean;
  version: string;
  interfaces: WireGuardInterface[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  connectionId: string;
}

export const WireGuardManager: React.FC<Props> = ({ connectionId }) => {
  const [status, setStatus] = useState<WireGuardStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedIface, setExpandedIface] = useState<string | null>(null);
  const hasAutoExpanded = useRef(false);

  // Add peer form
  const [showAddPeer, setShowAddPeer] = useState<string | null>(null);
  const [peerPubKey, setPeerPubKey] = useState('');
  const [peerAllowedIps, setPeerAllowedIps] = useState('0.0.0.0/0');
  const [peerEndpoint, setPeerEndpoint] = useState('');
  const [peerKeepalive, setPeerKeepalive] = useState(25);
  const [peerLoading, setPeerLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/wireguard`);
      setStatus(data);
      setError('');
      // Auto-expand first interface on first load
      if (data.interfaces?.length > 0 && !hasAutoExpanded.current) {
        setExpandedIface(data.interfaces[0].name);
        hasAutoExpanded.current = true;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to get WireGuard status';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const toggleInterface = async (iface: string) => {
    setActionLoading(iface);
    try {
      await apiPost(`/api/tools/${connectionId}/wireguard/${iface}/toggle`, {});
      setTimeout(fetchStatus, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to toggle ${iface}`;
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const addPeer = async (iface: string) => {
    if (!peerPubKey.trim() || !peerAllowedIps.trim()) return;
    setPeerLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/wireguard/${iface}/add-peer`, {
        public_key: peerPubKey.trim(),
        allowed_ips: peerAllowedIps.trim(),
        endpoint: peerEndpoint.trim(),
        persistent_keepalive: peerKeepalive,
      });
      setShowAddPeer(null);
      setPeerPubKey('');
      setPeerEndpoint('');
      setSuccessMsg('Peer added successfully');
      setTimeout(() => setSuccessMsg(''), 3000);
      setTimeout(fetchStatus, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add peer';
      setError(message);
    } finally {
      setPeerLoading(false);
    }
  };

  const removePeer = async (iface: string, publicKey: string) => {
    if (!confirm('Remove this peer?')) return;
    setActionLoading(`peer:${publicKey.slice(0, 8)}`);
    try {
      await apiPost(`/api/tools/${connectionId}/wireguard/${iface}/remove-peer`, {
        public_key: publicKey,
      });
      setSuccessMsg('Peer removed');
      setTimeout(() => setSuccessMsg(''), 3000);
      setTimeout(fetchStatus, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove peer';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const generateKeypair = async () => {
    setActionLoading('keygen');
    try {
      const data = await apiPost(`/api/tools/${connectionId}/wireguard/generate-keypair`, {});
      setPeerPubKey(data.public_key || '');
      setSuccessMsg(`Key pair generated. Private: ${(data.private_key || '').slice(0, 12)}... (shown once)`);
      setTimeout(() => setSuccessMsg(''), 8000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate key pair';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  if (status && !status.installed) {
    return (
      <ToolModal title="WireGuard Manager" icon={<Network size={18} />}>
        <div className="py-8 text-center">
          <AlertTriangle size={28} className="mx-auto mb-3 text-[var(--warning)]" />
          <div className="text-sm text-[var(--text-primary)] font-medium mb-2">WireGuard Not Installed</div>
          <div className="text-xs text-[var(--text-muted)] mb-4">
            WireGuard is not installed on this server. Install it to manage VPN tunnels.
          </div>
          <div className="max-w-md mx-auto text-left bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-3">
            <div className="text-[10px] font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
              <Terminal size={11} /> Install Commands
            </div>
            <div className="space-y-1.5 text-[10px] font-mono text-[var(--text-muted)]">
              <div><span className="text-[var(--accent)]">Ubuntu/Debian:</span> sudo apt install wireguard</div>
              <div><span className="text-[var(--accent)]">RHEL/CentOS:</span> sudo dnf install wireguard-tools</div>
              <div><span className="text-[var(--accent)]">Arch:</span> sudo pacman -S wireguard-tools</div>
            </div>
          </div>
        </div>
      </ToolModal>
    );
  }

  return (
    <ToolModal title="WireGuard Manager" icon={<Network size={18} />}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {status && (
          <span className="text-[10px] text-[var(--text-muted)]">
            WireGuard <span className="text-[var(--accent)] font-medium">{status.version}</span>
            {' '} — {status.interfaces.length} interface{status.interfaces.length !== 1 ? 's' : ''}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 rounded bg-[var(--danger)]/10 text-[var(--danger)] text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-2"><X size={12} /></button>
        </div>
      )}

      {successMsg && (
        <div className="mb-3 p-2 rounded bg-[var(--success)]/10 text-[var(--success)] text-xs">
          {successMsg}
        </div>
      )}

      {loading && !status && (
        <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Loading WireGuard status...
        </div>
      )}

      {status && status.interfaces.length === 0 && (
        <div className="py-8 text-center">
          <Network size={24} className="mx-auto mb-2 text-[var(--text-muted)]" />
          <div className="text-xs text-[var(--text-primary)] font-medium mb-1">No WireGuard Interfaces</div>
          <div className="text-[10px] text-[var(--text-muted)]">
            No WireGuard interfaces are configured. Create a configuration in /etc/wireguard/.
          </div>
        </div>
      )}

      {/* Interfaces */}
      {status && (
        <div className="space-y-3 overflow-auto max-h-[calc(80vh-180px)]">
          {status.interfaces.map((iface) => {
            const isExpanded = expandedIface === iface.name;
            return (
              <div key={iface.name} className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
                {/* Interface header */}
                <div
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
                  onClick={() => setExpandedIface(isExpanded ? null : iface.name)}
                >
                  {/* Status */}
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${iface.active ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]'}`} />

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)] font-mono">{iface.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                        iface.active
                          ? 'bg-[var(--success)]/15 text-[var(--success)]'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                      }`}>
                        {iface.active ? 'UP' : 'DOWN'}
                      </span>
                      {iface.address && (
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">{iface.address}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      Port {iface.listening_port || '—'} — {iface.peers.length} peer{iface.peers.length !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleInterface(iface.name);
                    }}
                    disabled={actionLoading === iface.name}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-medium transition-colors disabled:opacity-50 ${
                      iface.active
                        ? 'bg-[var(--danger)]/15 text-[var(--danger)] hover:bg-[var(--danger)]/25'
                        : 'bg-[var(--success)]/15 text-[var(--success)] hover:bg-[var(--success)]/25'
                    }`}
                  >
                    {actionLoading === iface.name ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : iface.active ? (
                      <PowerOff size={11} />
                    ) : (
                      <Power size={11} />
                    )}
                    {iface.active ? 'Down' : 'Up'}
                  </button>

                  {/* Expand chevron */}
                  <span className="text-[var(--text-muted)]">
                    {isExpanded ? <ChevronDown size={14} /> : <ArrowDownUp size={14} />}
                  </span>
                </div>

                {/* Expanded: Interface details + Peers */}
                {isExpanded && (
                  <div className="border-t border-[var(--border)]">
                    {/* Interface details */}
                    <div className="px-3 py-2 grid grid-cols-2 gap-2 text-[10px] bg-[var(--bg-primary)]/50">
                      <div>
                        <span className="text-[var(--text-muted)]">Public Key: </span>
                        <span className="font-mono text-[var(--text-secondary)] break-all">{iface.public_key || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Listen Port: </span>
                        <span className="font-mono text-[var(--text-secondary)]">{iface.listening_port || '—'}</span>
                      </div>
                    </div>

                    {/* Add peer button */}
                    <div className="px-3 py-1.5 border-t border-[var(--border)] flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAddPeer(showAddPeer === iface.name ? null : iface.name);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
                      >
                        <Plus size={10} /> Add Peer
                      </button>
                    </div>

                    {/* Add peer form */}
                    {showAddPeer === iface.name && (
                      <div className="px-3 py-2.5 border-t border-[var(--accent)]/30 bg-[var(--bg-primary)]/50 space-y-2">
                        <div className="text-[10px] font-medium text-[var(--text-primary)]">New Peer</div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={peerPubKey}
                            onChange={(e) => setPeerPubKey(e.target.value)}
                            placeholder="Peer Public Key"
                            className="flex-1 px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                          />
                          <button
                            onClick={generateKeypair}
                            disabled={actionLoading === 'keygen'}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                            title="Generate key pair"
                          >
                            {actionLoading === 'keygen' ? <Loader2 size={9} className="animate-spin" /> : <Key size={9} />}
                            Gen
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={peerAllowedIps}
                            onChange={(e) => setPeerAllowedIps(e.target.value)}
                            placeholder="Allowed IPs (e.g. 0.0.0.0/0)"
                            className="col-span-1 px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                          />
                          <input
                            type="text"
                            value={peerEndpoint}
                            onChange={(e) => setPeerEndpoint(e.target.value)}
                            placeholder="Endpoint (optional)"
                            className="col-span-1 px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                          />
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] text-[var(--text-muted)]">Keepalive:</span>
                            <input
                              type="number"
                              value={peerKeepalive}
                              onChange={(e) => setPeerKeepalive(Math.max(0, Number(e.target.value)))}
                              className="w-12 px-1 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px] text-[var(--text-primary)] text-center focus:outline-none"
                              min={0}
                            />
                            <span className="text-[9px] text-[var(--text-muted)]">s</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => addPeer(iface.name)}
                            disabled={peerLoading || !peerPubKey.trim() || !peerAllowedIps.trim()}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--accent)] text-white text-[10px] font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
                          >
                            {peerLoading ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                            Add
                          </button>
                          <button
                            onClick={() => setShowAddPeer(null)}
                            className="px-2 py-1 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Peers */}
                    {iface.peers.length === 0 ? (
                      <div className="px-3 py-4 text-center text-[10px] text-[var(--text-muted)]">No peers configured</div>
                    ) : (
                      <div className="divide-y divide-[var(--border)]">
                        {iface.peers.map((peer, i) => (
                          <PeerRow
                            key={i}
                            peer={peer}
                            onRemove={() => removePeer(iface.name, peer.public_key)}
                            removing={actionLoading === `peer:${peer.public_key.slice(0, 8)}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ToolModal>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const PeerRow: React.FC<{
  peer: WireGuardPeer;
  onRemove: () => void;
  removing: boolean;
}> = ({ peer, onRemove, removing }) => {
  const keyShort = peer.public_key ? `${peer.public_key.slice(0, 8)}...${peer.public_key.slice(-4)}` : '—';
  const hasHandshake = peer.latest_handshake && peer.latest_handshake !== '0';

  return (
    <div className="px-3 py-2.5 hover:bg-[var(--bg-tertiary)]/50 transition-colors group">
      <div className="flex items-center gap-2 mb-1.5">
        <Users size={12} className="text-[var(--text-muted)] shrink-0" />
        <span className="text-[10px] font-mono font-medium text-[var(--text-primary)]" title={peer.public_key}>
          {keyShort}
        </span>
        {hasHandshake && (
          <Check size={11} style={{ color: 'var(--success)' }} />
        )}
        <div className="flex-1" />
        <button
          onClick={onRemove}
          disabled={removing}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
          title="Remove peer"
        >
          {removing ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[10px] ml-5">
        <div>
          <Globe size={10} className="inline mr-1 text-[var(--text-muted)]" />
          <span className="text-[var(--text-muted)]">Endpoint: </span>
          <span className="font-mono text-[var(--text-secondary)]">{peer.endpoint || '(none)'}</span>
        </div>
        <div>
          <Network size={10} className="inline mr-1 text-[var(--text-muted)]" />
          <span className="text-[var(--text-muted)]">Allowed: </span>
          <span className="font-mono text-[var(--text-secondary)]">{peer.allowed_ips || '—'}</span>
        </div>
        <div>
          <ArrowDownUp size={10} className="inline mr-1 text-[var(--text-muted)]" />
          <span className="text-[var(--text-muted)]">RX/TX: </span>
          <span className="font-mono text-[var(--text-secondary)]">{peer.transfer_rx || '0'} / {peer.transfer_tx || '0'}</span>
        </div>
        <div>
          <Clock size={10} className="inline mr-1 text-[var(--text-muted)]" />
          <span className="text-[var(--text-muted)]">Handshake: </span>
          <span className="font-mono text-[var(--text-secondary)]">{peer.latest_handshake || 'never'}</span>
        </div>
      </div>
    </div>
  );
};
