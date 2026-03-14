import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Clock,
  RefreshCw,
  Loader2,
  X,
  Plus,
  Trash2,
  User,
  Server,
  Pencil,
  Search,
  Check,
  History,
  ChevronDown,
  ChevronRight,
  Calendar,
  Terminal,
  Copy,
  Play,
  Pause,
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
  enabled: boolean;
  comment: string;
  next_run: string;
}

interface CronList {
  jobs: CronJob[];
  total: number;
  active: number;
  disabled: number;
  user: string;
  system_jobs: CronJob[];
  env_vars: Record<string, string>;
}

interface CronHistoryEntry {
  timestamp: string;
  user: string;
  command: string;
  pid: string;
  message: string;
}

type TabId = 'user' | 'system' | 'history';
type FilterMode = 'all' | 'active' | 'disabled';

// ---------------------------------------------------------------------------
// Schedule builder types
// ---------------------------------------------------------------------------

interface ScheduleField {
  type: 'every' | 'interval' | 'specific';
  interval: number;
  specific: number[];
}

const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTHS = [
  { value: 1, label: 'Jan' }, { value: 2, label: 'Feb' }, { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' }, { value: 5, label: 'May' }, { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' }, { value: 8, label: 'Aug' }, { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' }, { value: 11, label: 'Nov' }, { value: 12, label: 'Dec' },
];
const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const SCHEDULE_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 min', value: '*/5 * * * *' },
  { label: 'Every 15 min', value: '*/15 * * * *' },
  { label: 'Every 30 min', value: '*/30 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Every 6h', value: '0 */6 * * *' },
  { label: 'Every 12h', value: '0 */12 * * *' },
  { label: 'Daily midnight', value: '0 0 * * *' },
  { label: 'Daily 3am', value: '0 3 * * *' },
  { label: 'Weekly Sun', value: '0 0 * * 0' },
  { label: 'Mon-Fri 9am', value: '0 9 * * 1-5' },
  { label: 'Monthly 1st', value: '0 0 1 * *' },
  { label: 'At reboot', value: '@reboot' },
];

const COMMAND_TEMPLATES = [
  { label: 'Shell script', template: '/path/to/script.sh' },
  { label: 'PHP script', template: '/usr/bin/php /path/to/script.php' },
  { label: 'Python script', template: '/usr/bin/python3 /path/to/script.py' },
  { label: 'MySQL backup', template: 'mysqldump -u root -pPASSWORD database > /backup/db_$(date +\\%Y\\%m\\%d).sql' },
  { label: 'Wget URL', template: '/usr/bin/wget --spider -q "https://example.com/cron"' },
  { label: 'Curl URL', template: '/usr/bin/curl -s "https://example.com/cron" > /dev/null' },
  { label: 'Log rotation', template: 'find /var/log/myapp -name "*.log" -mtime +30 -delete' },
  { label: 'Disk cleanup', template: 'find /tmp -type f -mtime +7 -delete' },
];

type OutputHandling = 'default' | 'mute' | 'file' | 'email';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fieldToExpression(field: ScheduleField, max: number, min: number = 0): string {
  if (field.type === 'every') return '*';
  if (field.type === 'interval') return `*/${field.interval}`;
  if (field.type === 'specific' && field.specific.length > 0) {
    return field.specific.sort((a, b) => a - b).join(',');
  }
  return '*';
}

function expressionToField(expr: string): ScheduleField {
  if (expr === '*') return { type: 'every', interval: 1, specific: [] };
  if (expr.startsWith('*/')) {
    const n = parseInt(expr.slice(2));
    return { type: 'interval', interval: isNaN(n) ? 1 : n, specific: [] };
  }
  // Specific values like "1,5,10" or "1-5"
  const values: number[] = [];
  for (const part of expr.split(',')) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= b; i++) values.push(i);
    } else {
      const n = parseInt(part);
      if (!isNaN(n)) values.push(n);
    }
  }
  return { type: 'specific', interval: 1, specific: values };
}

function describeSchedule(sched: string): string {
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

  // Minute
  if (min.startsWith('*/')) descs.push(`Every ${min.slice(2)} min`);
  else if (min !== '*' && min !== '0') descs.push(`At :${min.padStart(2, '0')}`);

  // Hour
  if (hour.startsWith('*/')) descs.push(`every ${hour.slice(2)}h`);
  else if (hour !== '*') {
    const h = parseInt(hour);
    const m = min === '*' ? '00' : min.padStart(2, '0');
    if (!isNaN(h)) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      descs.push(`at ${h12}:${m} ${ampm}`);
    } else {
      descs.push(`at ${hour}:${m}`);
    }
  }

  // Day of month
  if (dom !== '*') descs.push(`day ${dom}`);

  // Month
  if (mon !== '*') {
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mNum = parseInt(mon);
    descs.push(isNaN(mNum) ? mon : (monthNames[mNum] || mon));
  }

  // Day of week
  if (dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (dow === '1-5') descs.push('Mon-Fri');
    else if (dow === '0,6') descs.push('Sat-Sun');
    else {
      const dayParts = dow.split(',').map(d => {
        const n = parseInt(d);
        return isNaN(n) ? d : (days[n] || d);
      });
      descs.push(dayParts.join(', '));
    }
  }

  return descs.join(', ') || sched;
}

function formatHour(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

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
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [showEnvVars, setShowEnvVars] = useState(false);

  // Create/Edit modal state
  const [showModal, setShowModal] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'visual' | 'raw' | 'preset'>('preset');
  const [rawSchedule, setRawSchedule] = useState('0 * * * *');
  const [minuteField, setMinuteField] = useState<ScheduleField>({ type: 'specific', interval: 1, specific: [0] });
  const [hourField, setHourField] = useState<ScheduleField>({ type: 'every', interval: 1, specific: [] });
  const [domField, setDomField] = useState<ScheduleField>({ type: 'every', interval: 1, specific: [] });
  const [monthField, setMonthField] = useState<ScheduleField>({ type: 'every', interval: 1, specific: [] });
  const [dowField, setDowField] = useState<ScheduleField>({ type: 'every', interval: 1, specific: [] });
  const [command, setCommand] = useState('');
  const [comment, setComment] = useState('');
  const [outputHandling, setOutputHandling] = useState<OutputHandling>('default');
  const [outputTarget, setOutputTarget] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // History state
  const [history, setHistory] = useState<CronHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Computed schedule expression from visual builder
  const visualSchedule = useMemo(() => {
    return [
      fieldToExpression(minuteField, 59, 0),
      fieldToExpression(hourField, 23, 0),
      fieldToExpression(domField, 31, 1),
      fieldToExpression(monthField, 12, 1),
      fieldToExpression(dowField, 6, 0),
    ].join(' ');
  }, [minuteField, hourField, domField, monthField, dowField]);

  const effectiveSchedule = scheduleMode === 'visual' ? visualSchedule : rawSchedule;

  // Build the full command with output handling
  const fullCommand = useMemo(() => {
    let cmd = command.trim();
    if (!cmd) return '';
    // Strip any existing output redirection the user may have added
    const base = cmd.replace(/\s*>\s*\/dev\/null\s*2>&1\s*$/, '')
      .replace(/\s*>>\s*\S+\s*2>&1\s*$/, '')
      .replace(/\s*2>&1\s*\|\s*mail\s+\S+\s*$/, '');

    if (outputHandling === 'mute') return `${base} > /dev/null 2>&1`;
    if (outputHandling === 'file' && outputTarget.trim()) return `${base} >> ${outputTarget.trim()} 2>&1`;
    if (outputHandling === 'email' && outputTarget.trim()) return `${base} 2>&1 | mail ${outputTarget.trim()}`;
    return cmd;
  }, [command, outputHandling, outputTarget]);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

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

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/cron/history`);
      setHistory(data.entries || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    fetchCron();
  }, [fetchCron]);

  useEffect(() => {
    if (activeTab === 'history' && history.length === 0) {
      fetchHistory();
    }
  }, [activeTab, history.length, fetchHistory]);

  // ---------------------------------------------------------------------------
  // CRUD actions
  // ---------------------------------------------------------------------------

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const addJob = async () => {
    if (!effectiveSchedule.trim() || !fullCommand.trim()) {
      setError('Schedule and command are required');
      return;
    }
    setAddLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/cron/add`, {
        schedule: effectiveSchedule.trim(),
        command: fullCommand.trim(),
        comment: comment.trim(),
      });
      closeModal();
      showSuccess('Cron job added successfully');
      setTimeout(fetchCron, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add cron job';
      setError(message);
    } finally {
      setAddLoading(false);
    }
  };

  const updateJob = async () => {
    if (!editingJob || !effectiveSchedule.trim() || !fullCommand.trim()) return;
    setAddLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/cron/update`, {
        line_number: editingJob.line_number,
        schedule: effectiveSchedule.trim(),
        command: fullCommand.trim(),
        comment: comment.trim(),
      });
      closeModal();
      showSuccess('Cron job updated successfully');
      setTimeout(fetchCron, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update cron job';
      setError(message);
    } finally {
      setAddLoading(false);
    }
  };

  const deleteJob = async (lineNumber: number) => {
    setActionLoading(`delete:${lineNumber}`);
    try {
      await apiPost(`/api/tools/${connectionId}/cron/delete`, { line_number: lineNumber });
      showSuccess('Cron job deleted');
      setTimeout(fetchCron, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete cron job';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const toggleJob = async (lineNumber: number, enable: boolean) => {
    setActionLoading(`toggle:${lineNumber}`);
    try {
      await apiPost(`/api/tools/${connectionId}/cron/toggle`, {
        line_number: lineNumber,
        enabled: enable,
      });
      showSuccess(`Cron job ${enable ? 'enabled' : 'disabled'}`);
      setTimeout(fetchCron, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to toggle cron job';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Modal management
  // ---------------------------------------------------------------------------

  const openCreateModal = () => {
    setEditingJob(null);
    setScheduleMode('preset');
    setRawSchedule('0 * * * *');
    setMinuteField({ type: 'specific', interval: 1, specific: [0] });
    setHourField({ type: 'every', interval: 1, specific: [] });
    setDomField({ type: 'every', interval: 1, specific: [] });
    setMonthField({ type: 'every', interval: 1, specific: [] });
    setDowField({ type: 'every', interval: 1, specific: [] });
    setCommand('');
    setComment('');
    setOutputHandling('default');
    setOutputTarget('');
    setShowModal(true);
  };

  const openEditModal = (job: CronJob) => {
    setEditingJob(job);
    setRawSchedule(job.schedule);
    setScheduleMode('raw');
    setCommand(job.command);
    setComment(job.comment);
    setOutputHandling('default');
    setOutputTarget('');
    // Parse schedule into visual fields
    if (!job.schedule.startsWith('@')) {
      const parts = job.schedule.split(/\s+/);
      if (parts.length >= 5) {
        setMinuteField(expressionToField(parts[0]));
        setHourField(expressionToField(parts[1]));
        setDomField(expressionToField(parts[2]));
        setMonthField(expressionToField(parts[3]));
        setDowField(expressionToField(parts[4]));
      }
    }
    // Detect output handling from command
    if (job.command.includes('> /dev/null 2>&1') || job.command.includes('>/dev/null 2>&1')) {
      setOutputHandling('mute');
    } else {
      const fileMatch = job.command.match(/>> (\S+) 2>&1/);
      if (fileMatch) {
        setOutputHandling('file');
        setOutputTarget(fileMatch[1]);
      }
      const mailMatch = job.command.match(/2>&1 \| mail (\S+)/);
      if (mailMatch) {
        setOutputHandling('email');
        setOutputTarget(mailMatch[1]);
      }
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingJob(null);
  };

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  const filteredJobs = useMemo(() => {
    if (!cronList) return [];
    let jobs = activeTab === 'system' ? cronList.system_jobs : cronList.jobs;

    if (filter === 'active') jobs = jobs.filter(j => j.enabled);
    if (filter === 'disabled') jobs = jobs.filter(j => !j.enabled);

    if (search) {
      const q = search.toLowerCase();
      jobs = jobs.filter(j =>
        j.command.toLowerCase().includes(q) ||
        j.schedule.toLowerCase().includes(q) ||
        j.comment.toLowerCase().includes(q) ||
        j.user.toLowerCase().includes(q)
      );
    }

    return jobs;
  }, [cronList, activeTab, filter, search]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ToolModal title="Cron Manager" icon={<Clock size={18} />}>
      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col animate-slide-down">
            {/* Modal header */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] rounded-t-lg shrink-0">
              <Clock size={14} className="text-[var(--accent)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)] flex-1">
                {editingJob ? 'Edit Cron Job' : 'New Cron Job'}
              </span>
              <button onClick={closeModal} className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                <X size={14} />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Schedule section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <Calendar size={12} />
                    Schedule
                  </label>
                  <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
                    {(['preset', 'visual', 'raw'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => {
                          if (mode === 'raw' && scheduleMode === 'visual') {
                            setRawSchedule(visualSchedule);
                          }
                          setScheduleMode(mode);
                        }}
                        className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                          scheduleMode === mode
                            ? 'bg-[var(--accent)] text-white'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {mode === 'preset' ? 'Presets' : mode === 'visual' ? 'Visual' : 'Expression'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preset mode */}
                {scheduleMode === 'preset' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1">
                      {SCHEDULE_PRESETS.map(p => (
                        <button
                          key={p.value}
                          onClick={() => setRawSchedule(p.value)}
                          className={`px-2 py-1.5 rounded text-[10px] font-medium transition-colors text-left ${
                            rawSchedule === p.value
                              ? 'bg-[var(--accent)] text-white'
                              : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={rawSchedule}
                      onChange={e => setRawSchedule(e.target.value)}
                      placeholder="* * * * *"
                      className="w-full px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                )}

                {/* Visual builder mode */}
                {scheduleMode === 'visual' && (
                  <div className="space-y-3">
                    <ScheduleFieldBuilder
                      label="Minute"
                      field={minuteField}
                      onChange={setMinuteField}
                      values={MINUTES}
                      columns={10}
                      formatLabel={(v) => String(v).padStart(2, '0')}
                      intervalOptions={[1, 2, 5, 10, 15, 30]}
                    />
                    <ScheduleFieldBuilder
                      label="Hour"
                      field={hourField}
                      onChange={setHourField}
                      values={HOURS}
                      columns={8}
                      formatLabel={formatHour}
                      intervalOptions={[1, 2, 3, 4, 6, 8, 12]}
                    />
                    <ScheduleFieldBuilder
                      label="Day of Month"
                      field={domField}
                      onChange={setDomField}
                      values={DAYS_OF_MONTH}
                      columns={10}
                      formatLabel={(v) => String(v)}
                      intervalOptions={[1, 2, 5, 10, 15]}
                    />
                    <ScheduleFieldBuilder
                      label="Month"
                      field={monthField}
                      onChange={setMonthField}
                      values={MONTHS.map(m => m.value)}
                      columns={6}
                      formatLabel={(v) => MONTHS.find(m => m.value === v)?.label || String(v)}
                      intervalOptions={[1, 2, 3, 4, 6]}
                    />
                    <ScheduleFieldBuilder
                      label="Day of Week"
                      field={dowField}
                      onChange={setDowField}
                      values={DAYS_OF_WEEK.map(d => d.value)}
                      columns={7}
                      formatLabel={(v) => DAYS_OF_WEEK.find(d => d.value === v)?.label || String(v)}
                      intervalOptions={[]}
                    />
                  </div>
                )}

                {/* Raw expression mode */}
                {scheduleMode === 'raw' && (
                  <div>
                    <input
                      type="text"
                      value={rawSchedule}
                      onChange={e => setRawSchedule(e.target.value)}
                      placeholder="* * * * * (min hour dom mon dow)"
                      className="w-full px-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                    />
                    <div className="mt-1.5 flex items-center gap-3 text-[9px] text-[var(--text-muted)] font-mono">
                      <span>min(0-59)</span>
                      <span>hour(0-23)</span>
                      <span>day(1-31)</span>
                      <span>month(1-12)</span>
                      <span>weekday(0-6)</span>
                    </div>
                  </div>
                )}

                {/* Schedule preview */}
                <div className="mt-2 px-3 py-2 rounded bg-[var(--accent)]/5 border border-[var(--accent)]/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-[var(--accent)]">Expression:</span>
                      <code className="text-[11px] font-mono font-semibold text-[var(--text-primary)]">{effectiveSchedule}</code>
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(effectiveSchedule)}
                      className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                      title="Copy expression"
                    >
                      <Copy size={10} />
                    </button>
                  </div>
                  <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                    {describeSchedule(effectiveSchedule)}
                  </div>
                </div>
              </div>

              {/* Command section */}
              <div>
                <label className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5 mb-2">
                  <Terminal size={12} />
                  Command
                </label>
                <div className="flex flex-wrap gap-1 mb-2">
                  {COMMAND_TEMPLATES.map(t => (
                    <button
                      key={t.label}
                      onClick={() => setCommand(t.template)}
                      className="px-1.5 py-0.5 rounded text-[9px] bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={command}
                  onChange={e => setCommand(e.target.value)}
                  placeholder="/path/to/command --args"
                  rows={2}
                  className="w-full px-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
                />
              </div>

              {/* Output handling */}
              <div>
                <label className="text-xs font-semibold text-[var(--text-primary)] mb-2 block">Output Handling</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {([
                    { id: 'default' as OutputHandling, label: 'Default', desc: 'Standard cron behavior' },
                    { id: 'mute' as OutputHandling, label: 'Mute', desc: 'Discard all output' },
                    { id: 'file' as OutputHandling, label: 'Log to file', desc: 'Append to a file' },
                    { id: 'email' as OutputHandling, label: 'Email', desc: 'Send output via mail' },
                  ]).map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setOutputHandling(opt.id)}
                      className={`p-2 rounded text-left transition-colors ${
                        outputHandling === opt.id
                          ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/50 text-[var(--accent)]'
                          : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]'
                      }`}
                    >
                      <div className="text-[10px] font-medium">{opt.label}</div>
                      <div className="text-[8px] opacity-70">{opt.desc}</div>
                    </button>
                  ))}
                </div>
                {(outputHandling === 'file' || outputHandling === 'email') && (
                  <input
                    type="text"
                    value={outputTarget}
                    onChange={e => setOutputTarget(e.target.value)}
                    placeholder={outputHandling === 'file' ? '/var/log/cron-job.log' : 'admin@example.com'}
                    className="w-full mt-2 px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                  />
                )}
              </div>

              {/* Comment */}
              <div>
                <label className="text-xs font-semibold text-[var(--text-primary)] mb-1 block">Comment (optional)</label>
                <input
                  type="text"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Description of what this job does"
                  className="w-full px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              {/* Full preview */}
              {fullCommand && (
                <div className="px-3 py-2 rounded bg-[#0d1117] border border-[var(--border)]">
                  <div className="text-[9px] text-[var(--text-muted)] mb-1">Crontab line preview:</div>
                  <code className="text-[10px] font-mono text-[#c9d1d9] break-all">
                    {effectiveSchedule} {fullCommand}
                  </code>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-secondary)] rounded-b-lg shrink-0">
              <button
                onClick={closeModal}
                className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={editingJob ? updateJob : addJob}
                disabled={addLoading || !effectiveSchedule.trim() || !fullCommand.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
              >
                {addLoading ? <Loader2 size={12} className="animate-spin" /> : editingJob ? <Pencil size={12} /> : <Plus size={12} />}
                {editingJob ? 'Update Job' : 'Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {cronList && (
        <div className="mb-3">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <InfoCard label="Total Jobs" value={String(cronList.total)} />
            <InfoCard label="Active" value={String(cronList.active)} color="var(--success)" />
            <InfoCard label="Disabled" value={String(cronList.disabled)} color="var(--text-muted)" />
            <InfoCard label="System Jobs" value={String(cronList.system_jobs.length)} color="var(--accent)" />
            <InfoCard label="User" value={cronList.user || '—'} />
            <InfoCard label="Cron Status" value="Running" color="var(--success)" />
          </div>

          {/* Environment variables expandable */}
          {Object.keys(cronList.env_vars).length > 0 && (
            <>
              <button
                onClick={() => setShowEnvVars(!showEnvVars)}
                className="mt-2 flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {showEnvVars ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {showEnvVars ? 'Hide' : 'Show'} crontab environment ({Object.keys(cronList.env_vars).length} vars)
              </button>
              {showEnvVars && (
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px]">
                  {Object.entries(cronList.env_vars).map(([key, val]) => (
                    <div key={key}>
                      <span className="text-[var(--text-muted)]">{key}:</span>{' '}
                      <span className="font-mono text-[var(--text-primary)] break-all">{val}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Toolbar: tabs + search + actions */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
          {([
            { id: 'user' as TabId, icon: User, label: 'User Jobs', count: cronList?.total ?? 0 },
            { id: 'system' as TabId, icon: Server, label: 'System', count: cronList?.system_jobs.length ?? 0 },
            { id: 'history' as TabId, icon: History, label: 'History', count: history.length },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <tab.icon size={11} />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="text-[9px] opacity-75">({tab.count})</span>
            </button>
          ))}
        </div>

        {activeTab !== 'history' && (
          <>
            <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
              {(['all', 'active', 'disabled'] as FilterMode[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2 py-1 rounded text-[9px] font-medium transition-colors ${
                    filter === f
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-[120px] max-w-[220px]">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter..."
                className="w-full pl-7 pr-7 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <X size={10} />
                </button>
              )}
            </div>
          </>
        )}

        <div className="flex-1" />

        {activeTab === 'user' && (
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-[10px] font-medium hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Plus size={11} />
            New Job
          </button>
        )}

        <button
          onClick={activeTab === 'history' ? fetchHistory : fetchCron}
          disabled={loading || historyLoading}
          className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={12} className={(loading || historyLoading) ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Messages */}
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

      {/* Loading state */}
      {loading && !cronList && (
        <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Loading cron jobs...
        </div>
      )}

      {/* User Jobs / System Jobs tabs */}
      {cronList && activeTab !== 'history' && (
        <div className="overflow-auto max-h-[calc(80vh-280px)]">
          {filteredJobs.length === 0 ? (
            <div className="py-8 text-center">
              <Clock size={20} className="mx-auto mb-2 text-[var(--text-muted)]" />
              <div className="text-xs text-[var(--text-muted)]">
                {search ? 'No matching cron jobs' : activeTab === 'system' ? 'No system cron jobs found' : 'No user cron jobs'}
              </div>
              {activeTab === 'user' && !search && (
                <button
                  onClick={openCreateModal}
                  className="mt-2 text-[10px] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                >
                  Create your first cron job
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-secondary)]">
              {/* Table header */}
              <div className="grid grid-cols-[auto_1fr_2fr_auto_auto] gap-2 px-3 py-2 bg-[var(--bg-primary)]/50 border-b border-[var(--border)] text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                <div className="w-4"></div>
                <div>Schedule</div>
                <div>Command</div>
                <div className="text-right">Next Run</div>
                <div className="w-24 text-right">Actions</div>
              </div>
              {/* Rows */}
              <div className="divide-y divide-[var(--border)]">
                {filteredJobs.map((job, idx) => (
                  <CronJobRow
                    key={`${job.line_number}-${idx}`}
                    job={job}
                    isUserTab={activeTab === 'user'}
                    onEdit={() => openEditModal(job)}
                    onDelete={() => deleteJob(job.line_number)}
                    onToggle={() => toggleJob(job.line_number, !job.enabled)}
                    actionLoading={actionLoading}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* History tab */}
      {activeTab === 'history' && (
        <div className="overflow-auto max-h-[calc(80vh-280px)]">
          {historyLoading && (
            <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Loading cron history...
            </div>
          )}
          {!historyLoading && history.length === 0 && (
            <div className="py-8 text-center">
              <History size={20} className="mx-auto mb-2 text-[var(--text-muted)]" />
              <div className="text-xs text-[var(--text-muted)]">No cron execution history found</div>
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                History is read from system logs (journalctl, /var/log/cron, /var/log/syslog)
              </div>
            </div>
          )}
          {!historyLoading && history.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-secondary)]">
              <div className="grid grid-cols-[auto_auto_1fr_auto] gap-3 px-3 py-2 bg-[var(--bg-primary)]/50 border-b border-[var(--border)] text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                <div>Time</div>
                <div>User</div>
                <div>Command</div>
                <div>PID</div>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {history.map((entry, i) => (
                  <div key={i} className="grid grid-cols-[auto_auto_1fr_auto] gap-3 px-3 py-2 items-center hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                    <div className="text-[10px] font-mono text-[var(--text-secondary)] whitespace-nowrap">
                      {entry.timestamp || '—'}
                    </div>
                    <div className="text-[10px] text-[var(--text-secondary)]">
                      {entry.user ? (
                        <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-[9px]">
                          {entry.user}
                        </span>
                      ) : '—'}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-primary)] truncate" title={entry.command || entry.message}>
                      {entry.command || entry.message}
                    </div>
                    <div className="text-[9px] font-mono text-[var(--text-muted)]">
                      {entry.pid || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </ToolModal>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const InfoCard: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div className="px-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
    <div className="text-[9px] text-[var(--text-muted)] mb-0.5">{label}</div>
    <div className="text-sm font-semibold truncate" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
  </div>
);

const CronJobRow: React.FC<{
  job: CronJob;
  isUserTab: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  actionLoading: string | null;
}> = ({ job, isUserTab, onEdit, onDelete, onToggle, actionLoading }) => {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const isToggling = actionLoading === `toggle:${job.line_number}`;
  const isDeleting = actionLoading === `delete:${job.line_number}`;

  return (
    <div className={`grid grid-cols-[auto_1fr_2fr_auto_auto] gap-2 px-3 py-2.5 items-center hover:bg-[var(--bg-tertiary)]/50 transition-colors ${!job.enabled ? 'opacity-50' : ''}`}>
      {/* Status dot */}
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
        job.enabled ? 'bg-[var(--success)] shadow-[0_0_4px_var(--success)]' : 'bg-[var(--text-muted)]'
      }`} />

      {/* Schedule */}
      <div className="min-w-0">
        <div className="text-[11px] font-mono font-semibold text-[var(--accent)] truncate">{job.schedule}</div>
        <div className="text-[9px] text-[var(--text-muted)] truncate">{describeSchedule(job.schedule)}</div>
        {job.user && !isUserTab && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">{job.user}</span>
        )}
      </div>

      {/* Command */}
      <div className="min-w-0">
        <div className="text-[10px] font-mono text-[var(--text-primary)] truncate" title={job.command}>
          {job.command}
        </div>
        {job.comment && (
          <div className="text-[9px] text-[var(--text-muted)] truncate italic">{job.comment}</div>
        )}
      </div>

      {/* Next run */}
      <div className="text-[9px] text-[var(--text-secondary)] whitespace-nowrap text-right">
        {job.enabled ? (job.next_run || '—') : (
          <span className="text-[var(--text-muted)] italic">disabled</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 justify-end w-24">
        {isUserTab && job.line_number > 0 && (
          <>
            <button
              onClick={onEdit}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
              title="Edit job"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={onToggle}
              disabled={isToggling}
              className={`p-1 rounded transition-colors disabled:opacity-50 ${
                job.enabled
                  ? 'text-[var(--text-muted)] hover:text-[var(--warning)] hover:bg-[var(--warning)]/10'
                  : 'text-[var(--text-muted)] hover:text-[var(--success)] hover:bg-[var(--success)]/10'
              }`}
              title={job.enabled ? 'Disable job' : 'Enable job'}
            >
              {isToggling ? <Loader2 size={11} className="animate-spin" /> : job.enabled ? <Pause size={11} /> : <Play size={11} />}
            </button>
            {showConfirmDelete ? (
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => { onDelete(); setShowConfirmDelete(false); }}
                  disabled={isDeleting}
                  className="p-1 rounded bg-[var(--danger)] text-white transition-colors disabled:opacity-50"
                  title="Confirm delete"
                >
                  {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
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
                title="Delete job"
              >
                <Trash2 size={11} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Schedule field visual builder
// ---------------------------------------------------------------------------

const ScheduleFieldBuilder: React.FC<{
  label: string;
  field: ScheduleField;
  onChange: (field: ScheduleField) => void;
  values: number[];
  columns: number;
  formatLabel: (v: number) => string;
  intervalOptions: number[];
}> = ({ label, field, onChange, values, columns, formatLabel, intervalOptions }) => {
  const toggleSpecific = (v: number) => {
    const current = field.specific;
    const next = current.includes(v) ? current.filter(x => x !== v) : [...current, v];
    onChange({ ...field, type: 'specific', specific: next });
  };

  return (
    <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium text-[var(--text-primary)]">{label}</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onChange({ ...field, type: 'every', specific: [] })}
            className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
              field.type === 'every' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Every
          </button>
          {intervalOptions.length > 0 && (
            <button
              onClick={() => onChange({ ...field, type: 'interval', specific: [] })}
              className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
                field.type === 'interval' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Every N
            </button>
          )}
          <button
            onClick={() => onChange({ ...field, type: 'specific' })}
            className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
              field.type === 'specific' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Specific
          </button>
        </div>
      </div>

      {field.type === 'interval' && intervalOptions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {intervalOptions.map(n => (
            <button
              key={n}
              onClick={() => onChange({ ...field, interval: n })}
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                field.interval === n
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              */{n}
            </button>
          ))}
        </div>
      )}

      {field.type === 'specific' && (
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {values.map(v => (
            <button
              key={v}
              onClick={() => toggleSpecific(v)}
              className={`py-0.5 rounded text-[8px] font-mono transition-colors ${
                field.specific.includes(v)
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {formatLabel(v)}
            </button>
          ))}
        </div>
      )}

      {field.type === 'every' && (
        <div className="text-[9px] text-[var(--text-muted)] italic">Every {label.toLowerCase()}</div>
      )}
    </div>
  );
};
