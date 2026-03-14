import React, { useEffect, useState, useCallback } from 'react';
import {
  Flame,
  RefreshCw,
  Loader2,
  X,
  Plus,
  Trash2,
  Shield,
  ShieldOff,
  AlertTriangle,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FirewallRule {
  number: number;
  action: string;
  direction: string;
  protocol: string;
  port: string;
  source: string;
  destination: string;
  raw: string;
}

interface FirewallStatus {
  backend: string;
  active: boolean;
  rules: FirewallRule[];
  default_incoming: string;
  default_outgoing: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  connectionId: string;
}

export const FirewallManager: React.FC<Props> = ({ connectionId }) => {
  const [status, setStatus] = useState<FirewallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Add rule form state
  const [ruleAction, setRuleAction] = useState<'allow' | 'deny' | 'reject' | 'limit'>('allow');
  const [ruleDirection, setRuleDirection] = useState<'in' | 'out'>('in');
  const [ruleProtocol, setRuleProtocol] = useState<'tcp' | 'udp' | 'any'>('tcp');
  const [rulePort, setRulePort] = useState('');
  const [ruleSource, setRuleSource] = useState('any');
  const [addLoading, setAddLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/firewall`);
      setStatus(data);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to get firewall status';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const toggleFirewall = async () => {
    if (!status) return;
    const action = status.active ? 'disable' : 'enable';
    if (!confirm(`Are you sure you want to ${action} the firewall?`)) return;

    setActionLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/toggle`, {});
      setTimeout(fetchStatus, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to toggle firewall';
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const addRule = async () => {
    if (!rulePort.trim()) {
      setError('Port is required');
      return;
    }
    setAddLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/add-rule`, {
        action: ruleAction,
        direction: ruleDirection,
        protocol: ruleProtocol,
        port: rulePort.trim(),
        source: ruleSource.trim() || 'any',
      });
      setShowAddForm(false);
      setRulePort('');
      setRuleSource('any');
      setTimeout(fetchStatus, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add rule';
      setError(message);
    } finally {
      setAddLoading(false);
    }
  };

  const deleteRule = async (ruleNumber: number) => {
    if (!confirm(`Delete rule #${ruleNumber}?`)) return;
    setActionLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/delete-rule`, {
        rule_number: ruleNumber,
      });
      setTimeout(fetchStatus, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete rule';
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <ToolModal title="Firewall Manager" icon={<Flame size={18} />}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* Status badge */}
        {status && (
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium ${
              status.active
                ? 'bg-[var(--success)]/15 text-[var(--success)]'
                : 'bg-[var(--danger)]/15 text-[var(--danger)]'
            }`}>
              {status.active ? <Shield size={13} /> : <ShieldOff size={13} />}
              {status.active ? 'Active' : 'Inactive'}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] uppercase font-medium">
              {status.backend || 'none'}
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* Toggle button */}
        {status && status.backend && status.backend !== 'none' && (
          <button
            onClick={toggleFirewall}
            disabled={actionLoading}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
              status.active
                ? 'bg-[var(--danger)]/15 text-[var(--danger)] hover:bg-[var(--danger)]/25'
                : 'bg-[var(--success)]/15 text-[var(--success)] hover:bg-[var(--success)]/25'
            }`}
          >
            {actionLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : status.active ? (
              <ShieldOff size={12} />
            ) : (
              <Shield size={12} />
            )}
            {status.active ? 'Disable' : 'Enable'}
          </button>
        )}

        {/* Add rule */}
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
        >
          <Plus size={12} />
          Add Rule
        </button>

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
          <button onClick={() => setError('')} className="ml-2">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Add rule form */}
      {showAddForm && (
        <div className="mb-3 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--accent)]/30 space-y-2">
          <div className="text-xs font-medium text-[var(--text-primary)] mb-2">New Firewall Rule</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {/* Action */}
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Action</label>
              <select
                value={ruleAction}
                onChange={(e) => setRuleAction(e.target.value as typeof ruleAction)}
                className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
                <option value="reject">Reject</option>
                <option value="limit">Limit</option>
              </select>
            </div>

            {/* Direction */}
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Direction</label>
              <select
                value={ruleDirection}
                onChange={(e) => setRuleDirection(e.target.value as typeof ruleDirection)}
                className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="in">Incoming</option>
                <option value="out">Outgoing</option>
              </select>
            </div>

            {/* Protocol */}
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Protocol</label>
              <select
                value={ruleProtocol}
                onChange={(e) => setRuleProtocol(e.target.value as typeof ruleProtocol)}
                className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="any">Any</option>
              </select>
            </div>

            {/* Port */}
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Port</label>
              <input
                type="text"
                value={rulePort}
                onChange={(e) => setRulePort(e.target.value)}
                placeholder="e.g. 80, 443, 8000:9000"
                className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* Source */}
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Source</label>
              <input
                type="text"
                value={ruleSource}
                onChange={(e) => setRuleSource(e.target.value)}
                placeholder="any or IP/CIDR"
                className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={addRule}
              disabled={addLoading || !rulePort.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
            >
              {addLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Add
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Defaults info */}
      {status && (status.default_incoming || status.default_outgoing) && (
        <div className="mb-3 flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
          <span>Default incoming: <span className="font-medium text-[var(--text-secondary)]">{status.default_incoming || '—'}</span></span>
          <span>Default outgoing: <span className="font-medium text-[var(--text-secondary)]">{status.default_outgoing || '—'}</span></span>
        </div>
      )}

      {loading && !status && (
        <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Loading firewall status...
        </div>
      )}

      {/* No firewall */}
      {status && (!status.backend || status.backend === 'none') && (
        <div className="py-8 text-center">
          <AlertTriangle size={24} className="mx-auto mb-2 text-[var(--warning)]" />
          <div className="text-xs text-[var(--text-primary)] font-medium mb-1">
            No Firewall Detected
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">
            Install ufw, firewalld, or iptables to manage firewall rules.
          </div>
        </div>
      )}

      {/* Rules table */}
      {status && status.backend && status.backend !== 'none' && (
        <div className="overflow-auto max-h-[calc(80vh-260px)]">
          {status.rules.length === 0 ? (
            <div className="py-8 text-center text-[var(--text-muted)] text-xs">
              No firewall rules configured
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="py-2 px-2 font-medium w-12">#</th>
                  <th className="py-2 px-2 font-medium">Action</th>
                  <th className="py-2 px-2 font-medium">Direction</th>
                  <th className="py-2 px-2 font-medium">Rule</th>
                  <th className="py-2 px-2 font-medium w-12"></th>
                </tr>
              </thead>
              <tbody>
                {status.rules.map((rule, i) => (
                  <tr
                    key={i}
                    className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-secondary)] transition-colors group"
                  >
                    <td className="py-1.5 px-2 text-[var(--text-muted)] font-mono">{rule.number}</td>
                    <td className="py-1.5 px-2">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                        rule.action.toLowerCase() === 'allow' || rule.action.toLowerCase() === 'accept'
                          ? 'bg-[var(--success)]/20 text-[var(--success)]'
                          : rule.action.toLowerCase() === 'deny' || rule.action.toLowerCase() === 'drop'
                          ? 'bg-[var(--danger)]/20 text-[var(--danger)]'
                          : rule.action.toLowerCase() === 'limit'
                          ? 'bg-[var(--warning)]/20 text-[var(--warning)]'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                      }`}>
                        {rule.action}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-[var(--text-secondary)]">
                      {rule.direction || '—'}
                    </td>
                    <td className="py-1.5 px-2 text-[var(--text-secondary)] font-mono text-[10px] truncate max-w-[400px]">
                      {rule.raw}
                    </td>
                    <td className="py-1.5 px-2">
                      {rule.number > 0 && status.backend === 'ufw' && (
                        <button
                          onClick={() => deleteRule(rule.number)}
                          disabled={actionLoading}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                          title="Delete rule"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </ToolModal>
  );
};
