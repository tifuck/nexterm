import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  History,
  RefreshCw,
  Search,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Ban,
  RotateCw,
  Play,
} from 'lucide-react';

import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';

interface ToolJob {
  id: string;
  tool: string;
  action: string;
  title: string;
  status: string;
  progress: number;
  resumable: boolean;
  cancel_requested: boolean;
  connection_id?: string;
  error_message?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

interface JobEvent {
  id: string;
  sequence: number;
  event_type: string;
  message: string;
  created_at?: string | null;
}

interface Props {
  connectionId: string;
}

const STATUS_OPTIONS = ['all', 'queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;

export const JobCenter: React.FC<Props> = ({ connectionId }) => {
  // Reserved for future per-connection filtering.
  void connectionId;

  const [jobs, setJobs] = useState<ToolJob[]>([]);
  const [events, setEvents] = useState<Record<string, JobEvent[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const params: Record<string, string | number> = { limit: 200 };
      if (status !== 'all') params.status = status;
      const data = await apiGet('/api/tools/jobs', params);
      setJobs(data.jobs || []);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load jobs';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  const fetchEvents = useCallback(async (jobId: string) => {
    try {
      const data = await apiGet(`/api/tools/jobs/${jobId}/events`, { limit: 300 });
      setEvents((prev) => ({ ...prev, [jobId]: data.events || [] }));
    } catch {
      // ignore event fetch errors to keep list usable
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(fetchJobs, 4000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchJobs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? jobs.filter((j) =>
          j.title.toLowerCase().includes(q)
          || j.tool.toLowerCase().includes(q)
          || j.action.toLowerCase().includes(q)
          || j.id.includes(q)
        )
      : jobs;
    return rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }, [jobs, search]);

  const runAction = async (jobId: string, action: 'cancel' | 'retry' | 'resume') => {
    setBusyJobId(jobId);
    try {
      await apiPost(`/api/tools/jobs/${jobId}/${action}`, {});
      await fetchJobs();
      if (expandedId === jobId) {
        await fetchEvents(jobId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to ${action} job`;
      setError(message);
    } finally {
      setBusyJobId(null);
    }
  };

  const toggleExpand = async (job: ToolJob) => {
    const next = expandedId === job.id ? null : job.id;
    setExpandedId(next);
    if (next && !events[next]) {
      await fetchEvents(next);
    }
  };

  return (
    <ToolModal title="Job Center" icon={<History size={18} />}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs..."
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
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])}
          className="px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
          ))}
        </select>

        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className={`px-2.5 py-1.5 rounded border text-xs transition-colors ${
            autoRefresh
              ? 'bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]'
              : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)]'
          }`}
        >
          Auto
        </button>

        <button
          onClick={fetchJobs}
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
          <Loader2 size={14} className="animate-spin" /> Loading jobs...
        </div>
      ) : (
        <div className="rounded border border-[var(--border)] overflow-auto max-h-[calc(80vh-180px)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--bg-secondary)] z-10 border-b border-[var(--border)]">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">Job</th>
                <th className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">Tool</th>
                <th className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">Status</th>
                <th className="px-2 py-1.5 text-right font-medium text-[var(--text-muted)]">Progress</th>
                <th className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">Created</th>
                <th className="px-2 py-1.5 text-right font-medium text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => {
                const isExpanded = expandedId === job.id;
                const isBusy = busyJobId === job.id;
                return (
                  <React.Fragment key={job.id}>
                    <tr className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => toggleExpand(job)}
                          className="flex items-center gap-1.5 text-left text-[var(--text-primary)]"
                        >
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <span className="truncate max-w-[260px]" title={job.title}>{job.title}</span>
                        </button>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">{job.id}</div>
                      </td>
                      <td className="px-2 py-1.5 text-[var(--text-secondary)]">{job.tool}</td>
                      <td className="px-2 py-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)]">
                          {job.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">
                        {job.progress}%
                      </td>
                      <td className="px-2 py-1.5 text-[var(--text-muted)]">
                        {job.created_at ? new Date(job.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          {(job.status === 'queued' || job.status === 'running') && (
                            <button
                              onClick={() => runAction(job.id, 'cancel')}
                              disabled={isBusy}
                              className="p-1 rounded hover:bg-[var(--danger)]/10 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors disabled:opacity-50"
                              title="Cancel"
                            >
                              <Ban size={12} />
                            </button>
                          )}
                          {(job.status === 'failed' || job.status === 'cancelled' || job.status === 'succeeded') && (
                            <button
                              onClick={() => runAction(job.id, 'retry')}
                              disabled={isBusy}
                              className="p-1 rounded hover:bg-[var(--accent)]/10 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
                              title="Retry"
                            >
                              <RotateCw size={12} />
                            </button>
                          )}
                          {job.resumable && (job.status === 'failed' || job.status === 'cancelled') && (
                            <button
                              onClick={() => runAction(job.id, 'resume')}
                              disabled={isBusy}
                              className="p-1 rounded hover:bg-[var(--success)]/10 text-[var(--text-muted)] hover:text-[var(--success)] transition-colors disabled:opacity-50"
                              title="Resume"
                            >
                              <Play size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/35">
                        <td colSpan={6} className="px-3 py-2">
                          {job.error_message && (
                            <div className="mb-2 text-[11px] text-[var(--danger)]">{job.error_message}</div>
                          )}
                          <div className="text-[10px] text-[var(--text-muted)] mb-1">Events</div>
                          <div className="max-h-36 overflow-auto rounded border border-[var(--border)] bg-[var(--bg-primary)] p-2">
                            {(events[job.id] || []).map((e) => (
                              <div key={e.id} className="text-[11px] text-[var(--text-secondary)] font-mono leading-relaxed">
                                [{e.sequence}] {e.message}
                              </div>
                            ))}
                            {(events[job.id] || []).length === 0 && (
                              <div className="text-[11px] text-[var(--text-muted)]">No events recorded yet</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-[var(--text-muted)]">
                    No jobs found
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
