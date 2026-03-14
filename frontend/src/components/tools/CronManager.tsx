import React, { useEffect, useState, useCallback } from 'react';
import {
  Clock,
  RefreshCw,
  Loader2,
  X,
  Plus,
  Trash2,
  User,
  Server,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CronJob {
  schedule: string;
  command: string;
  user: string;
  line_number: number;
  raw: string;
}

interface CronList {
  jobs: CronJob[];
  total: number;
  user: string;
  system_jobs: CronJob[];
}

type TabId = 'user' | 'system';

// Schedule presets for quick entry
const SCHEDULE_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Daily at 3am', value: '0 3 * * *' },
  { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
  { label: 'Monthly (1st)', value: '0 0 1 * *' },
  { label: 'At reboot', value: '@reboot' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  connectionId: string;
}

export const CronManager: React.FC<Props> = ({ connectionId }) => {
  const [cronList, setCronList] = useState<CronList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('user');
  const [showAddForm, setShowAddForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);

  // Add form state
  const [schedule, setSchedule] = useState('0 * * * *');
  const [command, setCommand] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const fetchCron = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/cron`);
      setCronList(data);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to list cron jobs';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    fetchCron();
  }, [fetchCron]);

  const addJob = async () => {
    if (!schedule.trim() || !command.trim()) {
      setError('Schedule and command are required');
      return;
    }
    setAddLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/cron/add`, {
        schedule: schedule.trim(),
        command: command.trim(),
      });
      setShowAddForm(false);
      setCommand('');
      setSuccessMsg('Cron job added successfully');
      setTimeout(() => setSuccessMsg(''), 3000);
      setTimeout(fetchCron, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add cron job';
      setError(message);
    } finally {
      setAddLoading(false);
    }
  };

  const deleteJob = async (lineNumber: number) => {
    if (!confirm('Delete this cron job?')) return;
    setActionLoading(lineNumber);
    try {
      await apiPost(`/api/tools/${connectionId}/cron/delete`, { line_number: lineNumber });
      setSuccessMsg('Cron job deleted');
      setTimeout(() => setSuccessMsg(''), 3000);
      setTimeout(fetchCron, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete cron job';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const editJob = (job: CronJob) => {
    setEditingJob(job);
    setSchedule(job.schedule);
    setCommand(job.command);
    setShowAddForm(true);
  };

  const saveEditedJob = async () => {
    if (!editingJob || !schedule.trim() || !command.trim()) return;
    setAddLoading(true);
    try {
      // Delete old job then add new one
      await apiPost(`/api/tools/${connectionId}/cron/delete`, { line_number: editingJob.line_number });
      await apiPost(`/api/tools/${connectionId}/cron/add`, {
        schedule: schedule.trim(),
        command: command.trim(),
      });
      setShowAddForm(false);
      setEditingJob(null);
      setCommand('');
      setSuccessMsg('Cron job updated successfully');
      setTimeout(() => setSuccessMsg(''), 3000);
      setTimeout(fetchCron, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update cron job';
      setError(message);
    } finally {
      setAddLoading(false);
    }
  };

  const describeSchedule = (sched: string): string => {
    // Simple human-readable descriptions for common patterns
    if (sched === '* * * * *') return 'Every minute';
    if (sched === '@reboot') return 'At system boot';
    if (sched === '@hourly') return 'Every hour';
    if (sched === '@daily' || sched === '0 0 * * *') return 'Daily at midnight';
    if (sched === '@weekly') return 'Weekly';
    if (sched === '@monthly') return 'Monthly';
    if (sched === '@yearly' || sched === '@annually') return 'Yearly';

    const parts = sched.split(/\s+/);
    if (parts.length < 5) return sched;

    const [min, hour, dom, mon, dow] = parts;
    const descs: string[] = [];

    if (min.startsWith('*/')) descs.push(`Every ${min.slice(2)} min`);
    else if (min !== '*' && min !== '0') descs.push(`At :${min.padStart(2, '0')}`);

    if (hour.startsWith('*/')) descs.push(`every ${hour.slice(2)}h`);
    else if (hour !== '*') descs.push(`at ${hour}:${min === '*' ? '00' : min.padStart(2, '0')}`);

    if (dom !== '*') descs.push(`day ${dom}`);
    if (mon !== '*') descs.push(`month ${mon}`);
    if (dow !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const d = parseInt(dow);
      descs.push(isNaN(d) ? dow : (days[d] || dow));
    }

    return descs.join(', ') || sched;
  };

  return (
    <ToolModal title="Cron Manager" icon={<Clock size={18} />}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* Tabs */}
        <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
          <button
            onClick={() => setActiveTab('user')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
              activeTab === 'user'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <User size={13} />
            User Crontab
            {cronList && <span className="ml-0.5 opacity-70">({cronList.total})</span>}
          </button>
          <button
            onClick={() => setActiveTab('system')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
              activeTab === 'system'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Server size={13} />
            System
            {cronList && <span className="ml-0.5 opacity-70">({cronList.system_jobs.length})</span>}
          </button>
        </div>

        {cronList && (
          <span className="text-[10px] text-[var(--text-muted)]">
            User: <span className="font-medium text-[var(--text-secondary)]">{cronList.user}</span>
          </span>
        )}

        <div className="flex-1" />

        {activeTab === 'user' && (
          <button
            onClick={() => {
              setEditingJob(null);
              setSchedule('0 * * * *');
              setCommand('');
              setShowAddForm(!showAddForm);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Plus size={12} />
            Add Job
          </button>
        )}

        <button
          onClick={fetchCron}
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

      {/* Add form */}
      {showAddForm && (
        <div className="mb-3 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--accent)]/30 space-y-2">
          <div className="text-xs font-medium text-[var(--text-primary)] mb-2">
            {editingJob ? 'Edit Cron Job' : 'New Cron Job'}
          </div>

          {/* Schedule presets */}
          <div>
            <label className="text-[10px] text-[var(--text-muted)] block mb-1">Schedule (preset or custom)</label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {SCHEDULE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setSchedule(p.value)}
                  className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                    schedule === p.value
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="* * * * * (min hour dom mon dow)"
              className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] font-mono placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
            <div className="text-[9px] text-[var(--text-muted)] mt-0.5">
              {describeSchedule(schedule)}
            </div>
          </div>

          {/* Command */}
          <div>
            <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Command</label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="/path/to/script.sh >> /var/log/cron.log 2>&1"
              className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] font-mono placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addJob();
                }
              }}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={editingJob ? saveEditedJob : addJob}
              disabled={addLoading || !schedule.trim() || !command.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
            >
              {addLoading ? <Loader2 size={12} className="animate-spin" /> : editingJob ? <Pencil size={12} /> : <Plus size={12} />}
              {editingJob ? 'Save' : 'Add'}
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setEditingJob(null);
              }}
              className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && !cronList && (
        <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Loading cron jobs...
        </div>
      )}

      {/* Jobs list */}
      {cronList && (
        <div className="overflow-auto max-h-[calc(80vh-220px)]">
          {activeTab === 'user' && (
            <JobsList
              jobs={cronList.jobs}
              canDelete={true}
              canEdit={true}
              onDelete={deleteJob}
              onEdit={editJob}
              actionLoading={actionLoading}
              describeSchedule={describeSchedule}
              emptyMessage="No user cron jobs"
            />
          )}
          {activeTab === 'system' && (
            <JobsList
              jobs={cronList.system_jobs}
              canDelete={false}
              canEdit={false}
              onDelete={() => {}}
              onEdit={() => {}}
              actionLoading={null}
              describeSchedule={describeSchedule}
              emptyMessage="No system cron jobs found"
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

const JobsList: React.FC<{
  jobs: CronJob[];
  canDelete: boolean;
  canEdit: boolean;
  onDelete: (lineNumber: number) => void;
  onEdit: (job: CronJob) => void;
  actionLoading: number | null;
  describeSchedule: (s: string) => string;
  emptyMessage: string;
}> = ({ jobs, canDelete, canEdit, onDelete, onEdit, actionLoading, describeSchedule, emptyMessage }) => {
  if (jobs.length === 0) {
    return (
      <div className="py-8 text-center">
        <Clock size={20} className="mx-auto mb-2 text-[var(--text-muted)]" />
        <div className="text-xs text-[var(--text-muted)]">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {jobs.map((job, i) => (
        <div
          key={i}
          className="flex items-start gap-3 px-3 py-2.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-hover)] transition-colors group"
        >
          <Clock size={13} className="text-[var(--text-muted)] mt-0.5 shrink-0" />

          <div className="flex-1 min-w-0">
            {/* Schedule */}
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-mono font-medium text-[var(--accent)]">
                {job.schedule}
              </span>
              <span className="text-[9px] text-[var(--text-muted)]">
                {describeSchedule(job.schedule)}
              </span>
            </div>

            {/* Command */}
            <div className="text-[11px] font-mono text-[var(--text-primary)] break-all">
              {job.command}
            </div>

            {/* User badge */}
            {job.user && (
              <div className="mt-1">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                  {job.user}
                </span>
              </div>
            )}
          </div>

          {/* Edit / Delete buttons */}
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {canEdit && job.line_number > 0 && (
              <button
                onClick={() => onEdit(job)}
                className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
                title="Edit job"
              >
                <Pencil size={12} />
              </button>
            )}
            {canDelete && job.line_number > 0 && (
              <button
                onClick={() => onDelete(job.line_number)}
                disabled={actionLoading === job.line_number}
                className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-50"
                title="Delete job"
              >
                {actionLoading === job.line_number ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
