import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck,
  RefreshCw,
  Search,
  X,
  Loader2,
} from 'lucide-react';

import { ToolModal } from './ToolModal';
import { apiGet } from '@/api/client';

interface AuditEntry {
  id: string;
  username: string;
  user_role: string;
  method: string;
  tool: string;
  action: string;
  path: string;
  status_code: number;
  outcome: string;
  dry_run: boolean;
  created_at?: string | null;
  record_hash: string;
  prev_hash: string;
}

interface Props {
  connectionId: string;
}

export const AuditLogViewer: React.FC<Props> = ({ connectionId }) => {
  // Reserved for future per-connection filtering.
  void connectionId;

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tool, setTool] = useState('');
  const [outcome, setOutcome] = useState('');

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 500 };
      if (tool) params.tool = tool;
      if (outcome) params.outcome = outcome;
      const data = await apiGet('/api/tools/audit', params);
      setEntries(data.entries || []);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load audit logs';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [tool, outcome]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      e.tool.toLowerCase().includes(q)
      || e.action.toLowerCase().includes(q)
      || e.username.toLowerCase().includes(q)
      || e.method.toLowerCase().includes(q)
      || e.path.toLowerCase().includes(q)
      || e.record_hash.includes(q)
    );
  }, [entries, search]);

  const tools = useMemo(() => {
    return Array.from(new Set(entries.map((e) => e.tool))).sort();
  }, [entries]);

  return (
    <ToolModal title="Audit Log" icon={<ClipboardCheck size={18} />}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search audit logs..."
            className="w-full pl-8 pr-8 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <select
          value={tool}
          onChange={(e) => setTool(e.target.value)}
          className="px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="">All tools</option>
          {tools.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="">All outcomes</option>
          <option value="success">success</option>
          <option value="error">error</option>
          <option value="forbidden">forbidden</option>
          <option value="dry_run">dry_run</option>
          <option value="exception">exception</option>
        </select>

        <button
          onClick={fetchAudit}
          title="Refresh"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 rounded bg-[var(--danger)]/10 text-[var(--danger)] text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading audit logs...
        </div>
      ) : (
        <div className="rounded border border-[var(--border)] overflow-auto max-h-[calc(80vh-180px)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--bg-secondary)] z-10 border-b border-[var(--border)]">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">Time</th>
                <th className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">User</th>
                <th className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">Action</th>
                <th className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">Path</th>
                <th className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">Outcome</th>
                <th className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">Hash</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
                  <td className="px-2 py-1.5 text-[var(--text-muted)]">
                    {entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                    {entry.username}
                    <div className="text-[10px] text-[var(--text-muted)]">{entry.user_role}</div>
                  </td>
                  <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                    <div>{entry.method} {entry.tool}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{entry.action}</div>
                  </td>
                  <td className="px-2 py-1.5 text-[var(--text-muted)] max-w-[300px] truncate" title={entry.path}>{entry.path}</td>
                  <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-secondary)] border border-[var(--border)]">
                      {entry.outcome} ({entry.status_code})
                    </span>
                    {entry.dry_run && <div className="text-[10px] text-[var(--accent)] mt-0.5">dry_run</div>}
                  </td>
                  <td className="px-2 py-1.5 text-[10px] font-mono text-[var(--text-muted)] max-w-[260px] truncate" title={entry.record_hash}>
                    {entry.record_hash}
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-[var(--text-muted)]">
                    No audit entries found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </ToolModal>
  );
};
