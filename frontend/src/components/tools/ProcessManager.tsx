import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ListTree,
  RefreshCw,
  Search,
  X,
  Skull,
  ArrowUpDown,
  Play,
  Pause,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';

interface ProcessInfo {
  pid: number;
  user: string;
  cpu_percent: number;
  mem_percent: number;
  vsz: number;
  rss: number;
  tty: string;
  stat: string;
  start: string;
  time: string;
  command: string;
}

type SortField = 'pid' | 'user' | 'cpu_percent' | 'mem_percent' | 'rss' | 'command';
type SortDir = 'asc' | 'desc';

interface Props {
  connectionId: string;
}

export const ProcessManager: React.FC<Props> = ({ connectionId }) => {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('cpu_percent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [killDialog, setKillDialog] = useState<{ pid: number; command: string } | null>(null);
  const [killSignal, setKillSignal] = useState('TERM');
  const [killLoading, setKillLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProcesses = useCallback(async () => {
    try {
      const data = await apiGet(`/api/tools/${connectionId}/processes`);
      setProcesses(data.processes || []);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch processes';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    fetchProcesses();
  }, [fetchProcesses]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchProcesses, 5000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchProcesses]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const handleKill = async () => {
    if (!killDialog) return;
    setKillLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/processes/${killDialog.pid}/kill`, {
        signal: killSignal,
      });
      setKillDialog(null);
      // Refresh after kill
      setTimeout(fetchProcesses, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to kill process';
      setError(message);
    } finally {
      setKillLoading(false);
    }
  };

  // Filter and sort
  const filtered = processes.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.command.toLowerCase().includes(q) ||
      p.user.toLowerCase().includes(q) ||
      String(p.pid).includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortField];
    const vb = b[sortField];
    const mult = sortDir === 'asc' ? 1 : -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
    return String(va).localeCompare(String(vb)) * mult;
  });

  return (
    <ToolModal title="Process Manager" icon={<ListTree size={18} />}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PID, user, or command..."
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
        <div className="flex items-center gap-1">
          <button
            onClick={fetchProcesses}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs transition-colors ${
              autoRefresh
                ? 'bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]'
                : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {autoRefresh ? <Pause size={12} /> : <Play size={12} />}
            {autoRefresh ? 'Auto' : 'Auto'}
          </button>
        </div>
        <div className="text-[10px] text-[var(--text-muted)] ml-auto">
          {sorted.length} / {processes.length} processes
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 rounded bg-[var(--danger)]/10 text-[var(--danger)] text-xs">
          {error}
        </div>
      )}

      {/* Process table */}
      <div className="overflow-auto max-h-[calc(80vh-180px)] rounded border border-[var(--border)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--bg-secondary)] z-10">
            <tr className="border-b border-[var(--border)]">
              <SortHeader label="PID" field="pid" current={sortField} dir={sortDir} onClick={handleSort} />
              <SortHeader label="User" field="user" current={sortField} dir={sortDir} onClick={handleSort} />
              <SortHeader label="CPU %" field="cpu_percent" current={sortField} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="MEM %" field="mem_percent" current={sortField} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="RSS" field="rss" current={sortField} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Command" field="command" current={sortField} dir={sortDir} onClick={handleSort} />
              <th className="px-2 py-1.5 text-right font-medium text-[var(--text-muted)]">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.pid}
                className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <td className="px-2 py-1 tabular-nums text-[var(--text-secondary)]">{p.pid}</td>
                <td className="px-2 py-1 text-[var(--text-secondary)]">{p.user}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  <span
                    style={{
                      color:
                        p.cpu_percent > 80
                          ? 'var(--danger)'
                          : p.cpu_percent > 50
                          ? 'var(--warning, #f59e0b)'
                          : 'var(--text-secondary)',
                    }}
                  >
                    {p.cpu_percent.toFixed(1)}
                  </span>
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  <span
                    style={{
                      color:
                        p.mem_percent > 50
                          ? 'var(--danger)'
                          : p.mem_percent > 20
                          ? 'var(--warning, #f59e0b)'
                          : 'var(--text-secondary)',
                    }}
                  >
                    {p.mem_percent.toFixed(1)}
                  </span>
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-[var(--text-muted)]">
                  {formatRSS(p.rss)}
                </td>
                <td className="px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)] max-w-[400px] truncate">
                  {p.command}
                </td>
                <td className="px-2 py-1 text-right">
                  <button
                    onClick={() => setKillDialog({ pid: p.pid, command: p.command })}
                    className="p-1 rounded hover:bg-[var(--danger)]/10 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                    title="Kill process"
                  >
                    <Skull size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-2 py-8 text-center text-[var(--text-muted)]">
                  {search ? 'No matching processes' : 'No processes found'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Kill confirmation dialog */}
      {killDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setKillDialog(null)} />
          <div className="relative bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-xl p-4 max-w-sm w-full">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Kill Process</h3>
            <p className="text-xs text-[var(--text-secondary)] mb-1">
              PID: <span className="font-mono text-[var(--accent)]">{killDialog.pid}</span>
            </p>
            <p className="text-[10px] text-[var(--text-muted)] font-mono truncate mb-3">
              {killDialog.command}
            </p>

            <div className="flex items-center gap-2 mb-3">
              <label className="text-xs text-[var(--text-secondary)]">Signal:</label>
              <select
                value={killSignal}
                onChange={(e) => setKillSignal(e.target.value)}
                className="px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none"
              >
                <option value="TERM">SIGTERM (graceful)</option>
                <option value="KILL">SIGKILL (force)</option>
                <option value="HUP">SIGHUP (reload)</option>
                <option value="INT">SIGINT (interrupt)</option>
                <option value="STOP">SIGSTOP (pause)</option>
                <option value="CONT">SIGCONT (resume)</option>
              </select>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setKillDialog(null)}
                className="px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleKill}
                disabled={killLoading}
                className="px-3 py-1.5 rounded bg-[var(--danger)] text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {killLoading ? 'Sending...' : `Send ${killSignal}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolModal>
  );
};

/* ---- Helpers ---- */

function formatRSS(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1048576) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / 1048576).toFixed(1)} GB`;
}

const SortHeader: React.FC<{
  label: string;
  field: SortField;
  current: SortField;
  dir: SortDir;
  onClick: (f: SortField) => void;
  align?: 'left' | 'right';
}> = ({ label, field, current, dir, onClick, align = 'left' }) => (
  <th
    className={`px-2 py-1.5 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] transition-colors select-none ${
      align === 'right' ? 'text-right' : 'text-left'
    }`}
    onClick={() => onClick(field)}
  >
    <span className="inline-flex items-center gap-0.5">
      {label}
      {current === field && (
        <ArrowUpDown
          size={10}
          className={`transition-transform ${dir === 'asc' ? 'rotate-180' : ''}`}
        />
      )}
    </span>
  </th>
);
