import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Server,
  RefreshCw,
  Search,
  X,
  Play,
  Square,
  RotateCw,
  Check,
  XCircle,
  Loader2,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronRight,
  FileText,
  ScrollText,
  Info,
  ArrowUpDown,
  Copy,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceInfo {
  name: string;
  load_state: string;
  active_state: string;
  sub_state: string;
  description: string;
  enabled: string;
  service_type: string;
  main_pid: number;
  memory: string;
  cpu: string;
  started_at: string;
  uptime: string;
}

interface ServiceListData {
  services: ServiceInfo[];
  init_system: string;
  total: number;
  running: number;
  failed: number;
  inactive: number;
  enabled_count: number;
}

interface ServiceDetail {
  name: string;
  description: string;
  load_state: string;
  active_state: string;
  sub_state: string;
  enabled: string;
  service_type: string;
  main_pid: number;
  exec_main_pid: number;
  memory_current: string;
  cpu_usage: string;
  tasks_current: string;
  restart_policy: string;
  restart_count: number;
  started_at: string;
  active_enter: string;
  inactive_enter: string;
  unit_file_path: string;
  fragment_path: string;
  wants: string[];
  required_by: string[];
  after: string[];
  before: string[];
  environment: string[];
  exec_start: string;
  user: string;
  group: string;
  working_directory: string;
  root_directory: string;
  properties: Record<string, string>;
}

interface ServiceLogEntry {
  timestamp: string;
  message: string;
  priority: string;
}

type FilterMode = 'all' | 'active' | 'failed' | 'inactive' | 'enabled' | 'disabled';
type SortMode = 'name' | 'state' | 'memory';
type DetailTab = 'overview' | 'logs' | 'unit-file';

interface Props {
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMemory(raw: string): string {
  if (!raw || raw === '[not set]') return '—';
  const bytes = parseInt(raw);
  if (isNaN(bytes) || bytes <= 0) return raw || '—';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)}G`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${bytes}B`;
}

function formatCpuNs(raw: string): string {
  if (!raw || raw === '[not set]') return '—';
  const ns = parseInt(raw);
  if (isNaN(ns) || ns <= 0) return raw || '—';
  const ms = ns / 1000000;
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}min`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ServiceManager: React.FC<Props> = ({ connectionId }) => {
  const [data, setData] = useState<ServiceListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<SortMode>('name');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  // Detail panel state
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [logs, setLogs] = useState<ServiceLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logLines, setLogLines] = useState(100);
  const [unitFile, setUnitFile] = useState('');
  const [unitFilePath, setUnitFilePath] = useState('');
  const [unitFileLoading, setUnitFileLoading] = useState(false);
  const [showSort, setShowSort] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiGet(`/api/tools/${connectionId}/services`);
      setData(resp);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch services';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  const fetchDetail = useCallback(async (serviceName: string) => {
    setDetailLoading(true);
    try {
      const resp = await apiGet(`/api/tools/${connectionId}/services/${encodeURIComponent(serviceName)}/detail`);
      setDetail(resp);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [connectionId]);

  const fetchLogs = useCallback(async (serviceName: string, lines: number = 100) => {
    setLogsLoading(true);
    try {
      const resp = await apiGet(`/api/tools/${connectionId}/services/${encodeURIComponent(serviceName)}/logs?lines=${lines}`);
      setLogs(resp.lines || []);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [connectionId]);

  const fetchUnitFile = useCallback(async (serviceName: string) => {
    setUnitFileLoading(true);
    try {
      const resp = await apiGet(`/api/tools/${connectionId}/services/${encodeURIComponent(serviceName)}/unit-file`);
      setUnitFile(resp.content || '');
      setUnitFilePath(resp.path || '');
    } catch {
      setUnitFile('');
      setUnitFilePath('');
    } finally {
      setUnitFileLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleAction = async (serviceName: string, action: string) => {
    setActionLoading(`${serviceName}:${action}`);
    try {
      await apiPost(`/api/tools/${connectionId}/services/${encodeURIComponent(serviceName)}/${action}`, {});
      showSuccess(`${serviceName}: ${action} successful`);
      setTimeout(fetchServices, 1000);
      // Refresh detail if viewing this service
      if (expandedService === serviceName) {
        setTimeout(() => fetchDetail(serviceName), 1200);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to ${action} ${serviceName}`;
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Detail expansion
  // ---------------------------------------------------------------------------

  const toggleServiceDetail = (serviceName: string) => {
    if (expandedService === serviceName) {
      setExpandedService(null);
      setDetail(null);
      setLogs([]);
      setUnitFile('');
    } else {
      setExpandedService(serviceName);
      setDetailTab('overview');
      setDetail(null);
      setLogs([]);
      setUnitFile('');
      fetchDetail(serviceName);
    }
  };

  const handleDetailTabChange = (tab: DetailTab, serviceName: string) => {
    setDetailTab(tab);
    if (tab === 'logs' && logs.length === 0) fetchLogs(serviceName, logLines);
    if (tab === 'unit-file' && !unitFile) fetchUnitFile(serviceName);
  };

  // ---------------------------------------------------------------------------
  // Filtering / sorting
  // ---------------------------------------------------------------------------

  const filtered = useMemo(() => {
    if (!data) return [];
    let svcs = [...data.services];

    // Filter
    if (filter === 'active') svcs = svcs.filter(s => s.active_state === 'active');
    else if (filter === 'failed') svcs = svcs.filter(s => s.active_state === 'failed');
    else if (filter === 'inactive') svcs = svcs.filter(s => s.active_state === 'inactive');
    else if (filter === 'enabled') svcs = svcs.filter(s => s.enabled === 'enabled' || s.enabled === 'enabled-runtime');
    else if (filter === 'disabled') svcs = svcs.filter(s => s.enabled === 'disabled');

    // Search
    if (search) {
      const q = search.toLowerCase();
      svcs = svcs.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    }

    // Sort
    svcs.sort((a, b) => {
      if (sort === 'state') {
        const order: Record<string, number> = { failed: 0, active: 1, inactive: 2 };
        return (order[a.active_state] ?? 3) - (order[b.active_state] ?? 3);
      }
      if (sort === 'memory') {
        // Sort by memory usage descending (services with memory first)
        const aMem = a.memory ? 1 : 0;
        const bMem = b.memory ? 1 : 0;
        return bMem - aMem || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });

    return svcs;
  }, [data, filter, search, sort]);

  const statusCounts = useMemo(() => ({
    all: data?.total ?? 0,
    active: data?.running ?? 0,
    failed: data?.failed ?? 0,
    inactive: data?.inactive ?? 0,
    enabled: data?.enabled_count ?? 0,
    disabled: (data?.total ?? 0) - (data?.enabled_count ?? 0),
  }), [data]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ToolModal title="Service Manager" icon={<Server size={18} />}>
      {/* Summary cards */}
      {data && (
        <div className="mb-3">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <InfoCard label="Total" value={String(data.total)} />
            <InfoCard label="Running" value={String(data.running)} color="var(--success)" />
            <InfoCard label="Failed" value={String(data.failed)} color={data.failed > 0 ? 'var(--danger)' : 'var(--text-muted)'} />
            <InfoCard label="Inactive" value={String(data.inactive)} color="var(--text-muted)" />
            <InfoCard label="Enabled" value={String(data.enabled_count)} color="var(--accent)" />
            <InfoCard label="Init System" value={data.init_system} />
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-[260px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search services..."
            className="w-full pl-7 pr-7 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X size={10} />
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
          {([
            { id: 'all' as FilterMode, label: 'All' },
            { id: 'active' as FilterMode, label: 'Active' },
            { id: 'failed' as FilterMode, label: 'Failed' },
            { id: 'inactive' as FilterMode, label: 'Inactive' },
            { id: 'enabled' as FilterMode, label: 'Enabled' },
            { id: 'disabled' as FilterMode, label: 'Disabled' },
          ]).map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-1.5 py-1 rounded text-[9px] font-medium transition-colors ${
                filter === f.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {f.label}
              <span className="ml-0.5 opacity-70">{statusCounts[f.id]}</span>
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSort(!showSort)}
            className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
          >
            <ArrowUpDown size={10} />
            {sort === 'name' ? 'Name' : sort === 'state' ? 'State' : 'Memory'}
          </button>
          {showSort && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSort(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--bg-primary)] border border-[var(--border)] rounded shadow-lg py-1 min-w-[100px]">
                {(['name', 'state', 'memory'] as SortMode[]).map(s => (
                  <button
                    key={s}
                    onClick={() => { setSort(s); setShowSort(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] hover:bg-[var(--bg-secondary)] transition-colors ${
                      sort === s ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    Sort by {s}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex-1" />

        <button
          onClick={fetchServices}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
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
      {loading && !data && (
        <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Loading services...
        </div>
      )}

      {/* Services list */}
      {data && (
        <div className="overflow-auto max-h-[calc(80vh-250px)]">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-[var(--text-muted)] text-xs">
              {search ? 'No matching services' : 'No services found'}
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-secondary)]">
              {/* Table header */}
              <div className="grid grid-cols-[auto_1.5fr_auto_auto_auto_auto_1fr_auto] gap-2 px-3 py-2 bg-[var(--bg-primary)]/50 border-b border-[var(--border)] text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                <div className="w-4"></div>
                <div>Service</div>
                <div>Type</div>
                <div>PID</div>
                <div>Memory</div>
                <div>CPU</div>
                <div>Uptime</div>
                <div className="w-32 text-right">Actions</div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-[var(--border)]">
                {filtered.map(svc => (
                  <React.Fragment key={svc.name}>
                    <ServiceRow
                      service={svc}
                      onAction={(action) => handleAction(svc.name, action)}
                      onExpand={() => toggleServiceDetail(svc.name)}
                      isExpanded={expandedService === svc.name}
                      actionLoading={actionLoading}
                    />
                    {/* Expanded detail panel */}
                    {expandedService === svc.name && (
                      <ServiceDetailPanel
                        service={svc}
                        detail={detail}
                        detailLoading={detailLoading}
                        logs={logs}
                        logsLoading={logsLoading}
                        logLines={logLines}
                        unitFile={unitFile}
                        unitFilePath={unitFilePath}
                        unitFileLoading={unitFileLoading}
                        activeTab={detailTab}
                        onTabChange={(tab) => handleDetailTabChange(tab, svc.name)}
                        onRefreshLogs={() => fetchLogs(svc.name, logLines)}
                        onLogLinesChange={(lines) => { setLogLines(lines); fetchLogs(svc.name, lines); }}
                        onAction={(action) => handleAction(svc.name, action)}
                        actionLoading={actionLoading}
                      />
                    )}
                  </React.Fragment>
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

const ServiceRow: React.FC<{
  service: ServiceInfo;
  onAction: (action: string) => void;
  onExpand: () => void;
  isExpanded: boolean;
  actionLoading: string | null;
}> = ({ service, onAction, onExpand, isExpanded, actionLoading }) => {
  const isActive = service.active_state === 'active';
  const isFailed = service.active_state === 'failed';
  const currentAction = actionLoading?.startsWith(service.name + ':')
    ? actionLoading.split(':')[1]
    : null;

  const statusColor = isFailed
    ? 'bg-[var(--danger)] shadow-[0_0_4px_var(--danger)]'
    : isActive
      ? 'bg-[var(--success)] shadow-[0_0_4px_var(--success)]'
      : 'bg-[var(--text-muted)]';

  const enabledBadge = service.enabled === 'enabled' || service.enabled === 'enabled-runtime';

  return (
    <div
      className={`grid grid-cols-[auto_1.5fr_auto_auto_auto_auto_1fr_auto] gap-2 px-3 py-2.5 items-center hover:bg-[var(--bg-tertiary)]/50 transition-colors cursor-pointer group ${isExpanded ? 'bg-[var(--bg-tertiary)]/30' : ''}`}
      onClick={onExpand}
    >
      {/* Status dot */}
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColor}`} />

      {/* Name + description */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-[var(--text-primary)] font-mono truncate">{service.name}</span>
          <span
            className="px-1 py-0.5 rounded text-[8px] font-medium shrink-0"
            style={{
              backgroundColor: isFailed ? 'var(--danger)' : isActive ? 'var(--success)' : 'var(--bg-tertiary)',
              color: isFailed || isActive ? 'white' : 'var(--text-muted)',
              opacity: isFailed || isActive ? 0.9 : 1,
            }}
          >
            {service.sub_state || service.active_state}
          </span>
          {enabledBadge && (
            <span className="px-1 py-0.5 rounded text-[7px] font-medium bg-[var(--accent)]/10 text-[var(--accent)]">
              enabled
            </span>
          )}
        </div>
        {service.description && (
          <div className="text-[9px] text-[var(--text-muted)] truncate mt-0.5">{service.description}</div>
        )}
      </div>

      {/* Type */}
      <div className="text-[9px] font-mono text-[var(--text-muted)] shrink-0">
        {service.service_type || '—'}
      </div>

      {/* PID */}
      <div className="text-[9px] font-mono text-[var(--text-secondary)] shrink-0 min-w-[35px] text-right">
        {service.main_pid > 0 ? service.main_pid : '—'}
      </div>

      {/* Memory */}
      <div className="text-[9px] font-mono text-[var(--text-secondary)] shrink-0 min-w-[40px] text-right">
        {service.memory || '—'}
      </div>

      {/* CPU */}
      <div className="text-[9px] font-mono text-[var(--text-secondary)] shrink-0 min-w-[40px] text-right">
        {service.cpu || '—'}
      </div>

      {/* Uptime */}
      <div className="text-[9px] text-[var(--text-secondary)] truncate">
        {service.uptime || '—'}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 justify-end w-32 shrink-0" onClick={e => e.stopPropagation()}>
        {!isActive && (
          <ActionButton icon={<Play size={10} />} label="Start" onClick={() => onAction('start')} loading={currentAction === 'start'} color="var(--success)" />
        )}
        {isActive && (
          <ActionButton icon={<Square size={10} />} label="Stop" onClick={() => onAction('stop')} loading={currentAction === 'stop'} color="var(--danger)" />
        )}
        <ActionButton icon={<RotateCw size={10} />} label="Restart" onClick={() => onAction('restart')} loading={currentAction === 'restart'} color="var(--accent)" />
        <ActionButton icon={<ToggleRight size={10} />} label="Enable" onClick={() => onAction('enable')} loading={currentAction === 'enable'} color="var(--success)" />
        <ActionButton icon={<ToggleLeft size={10} />} label="Disable" onClick={() => onAction('disable')} loading={currentAction === 'disable'} color="var(--text-muted)" />
        <button
          onClick={onExpand}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
          title="Details"
        >
          {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
      </div>
    </div>
  );
};

const ActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  loading: boolean;
  color: string;
}> = ({ icon, label, onClick, loading, color }) => (
  <button
    onClick={onClick}
    disabled={loading}
    className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
    title={label}
    style={{ color }}
  >
    {loading ? <Loader2 size={10} className="animate-spin" /> : icon}
  </button>
);

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

const ServiceDetailPanel: React.FC<{
  service: ServiceInfo;
  detail: ServiceDetail | null;
  detailLoading: boolean;
  logs: ServiceLogEntry[];
  logsLoading: boolean;
  logLines: number;
  unitFile: string;
  unitFilePath: string;
  unitFileLoading: boolean;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onRefreshLogs: () => void;
  onLogLinesChange: (lines: number) => void;
  onAction: (action: string) => void;
  actionLoading: string | null;
}> = ({ service, detail, detailLoading, logs, logsLoading, logLines, unitFile, unitFilePath, unitFileLoading, activeTab, onTabChange, onRefreshLogs, onLogLinesChange, onAction, actionLoading }) => {
  return (
    <div className="col-span-full bg-[var(--bg-primary)] border-t border-[var(--border)]">
      {/* Detail tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)]/50">
        {([
          { id: 'overview' as DetailTab, icon: Info, label: 'Overview' },
          { id: 'logs' as DetailTab, icon: ScrollText, label: 'Logs' },
          { id: 'unit-file' as DetailTab, icon: FileText, label: 'Unit File' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <tab.icon size={10} />
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        {/* Quick actions in detail */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onAction('restart')}
            disabled={actionLoading?.startsWith(service.name + ':')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors disabled:opacity-50"
          >
            <RotateCw size={9} /> Restart
          </button>
          <button
            onClick={() => onAction('reload')}
            disabled={actionLoading?.startsWith(service.name + ':')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={9} /> Reload
          </button>
        </div>
      </div>

      <div className="p-3 max-h-[300px] overflow-auto">
        {/* Overview tab */}
        {activeTab === 'overview' && (
          <>
            {detailLoading && (
              <div className="py-6 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Loading details...
              </div>
            )}
            {!detailLoading && detail && (
              <div className="space-y-3">
                {/* Key properties grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-[10px]">
                  <DetailRow label="Active State" value={detail.active_state} color={detail.active_state === 'active' ? 'var(--success)' : detail.active_state === 'failed' ? 'var(--danger)' : undefined} />
                  <DetailRow label="Sub State" value={detail.sub_state} />
                  <DetailRow label="Enabled" value={detail.enabled} color={detail.enabled === 'enabled' ? 'var(--success)' : undefined} />
                  <DetailRow label="Type" value={detail.service_type} />
                  <DetailRow label="Main PID" value={detail.main_pid > 0 ? String(detail.main_pid) : '—'} />
                  <DetailRow label="Memory" value={formatMemory(detail.memory_current)} />
                  <DetailRow label="CPU Time" value={formatCpuNs(detail.cpu_usage)} />
                  <DetailRow label="Tasks" value={detail.tasks_current || '—'} />
                  <DetailRow label="Restart Policy" value={detail.restart_policy || '—'} />
                  <DetailRow label="Restart Count" value={String(detail.restart_count)} />
                  <DetailRow label="Started At" value={detail.started_at || '—'} />
                  <DetailRow label="Fragment Path" value={detail.fragment_path || '—'} />
                  {detail.user && <DetailRow label="User" value={detail.user} />}
                  {detail.group && <DetailRow label="Group" value={detail.group} />}
                  {detail.working_directory && <DetailRow label="Working Dir" value={detail.working_directory} />}
                  {detail.exec_start && <DetailRow label="ExecStart" value={detail.exec_start} />}
                </div>

                {/* Dependencies */}
                {(detail.after.length > 0 || detail.required_by.length > 0) && (
                  <div className="pt-2 border-t border-[var(--border)]">
                    <div className="text-[10px] font-semibold text-[var(--text-primary)] mb-1">Dependencies</div>
                    <div className="grid grid-cols-2 gap-3 text-[9px]">
                      {detail.after.length > 0 && (
                        <div>
                          <span className="text-[var(--text-muted)]">After:</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {detail.after.slice(0, 10).map(d => (
                              <span key={d} className="px-1 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)] font-mono text-[8px]">{d}</span>
                            ))}
                            {detail.after.length > 10 && <span className="text-[var(--text-muted)]">+{detail.after.length - 10} more</span>}
                          </div>
                        </div>
                      )}
                      {detail.required_by.length > 0 && (
                        <div>
                          <span className="text-[var(--text-muted)]">Required by:</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {detail.required_by.map(d => (
                              <span key={d} className="px-1 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)] font-mono text-[8px]">{d}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Environment */}
                {detail.environment.length > 0 && (
                  <div className="pt-2 border-t border-[var(--border)]">
                    <div className="text-[10px] font-semibold text-[var(--text-primary)] mb-1">Environment</div>
                    <div className="space-y-0.5">
                      {detail.environment.map((env, i) => (
                        <div key={i} className="text-[9px] font-mono text-[var(--text-secondary)] break-all">{env}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!detailLoading && !detail && (
              <div className="py-6 text-center text-[var(--text-muted)] text-xs">
                Failed to load service details
              </div>
            )}
          </>
        )}

        {/* Logs tab */}
        {activeTab === 'logs' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-muted)]">Lines:</span>
                {[50, 100, 200, 500].map(n => (
                  <button
                    key={n}
                    onClick={() => onLogLinesChange(n)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                      logLines === n
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => navigator.clipboard.writeText(logs.map(l => `${l.timestamp} ${l.message}`).join('\n'))}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Copy size={9} /> Copy
                </button>
                <button
                  onClick={onRefreshLogs}
                  disabled={logsLoading}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={9} className={logsLoading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
            </div>
            {logsLoading && (
              <div className="py-6 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Loading logs...
              </div>
            )}
            {!logsLoading && logs.length === 0 && (
              <div className="py-6 text-center text-[var(--text-muted)] text-xs">
                No log entries found (journalctl may not be available)
              </div>
            )}
            {!logsLoading && logs.length > 0 && (
              <div className="rounded bg-[#0d1117] border border-[var(--border)] p-2 max-h-[240px] overflow-auto">
                <pre className="text-[9px] font-mono text-[#c9d1d9] whitespace-pre-wrap leading-relaxed">
                  {logs.map((entry, i) => (
                    <div key={i} className="hover:bg-white/5">
                      <span className="text-[#7ee787]">{entry.timestamp}</span>{' '}
                      <span className="text-[#c9d1d9]">{entry.message}</span>
                    </div>
                  ))}
                </pre>
              </div>
            )}
          </>
        )}

        {/* Unit file tab */}
        {activeTab === 'unit-file' && (
          <>
            {unitFileLoading && (
              <div className="py-6 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Loading unit file...
              </div>
            )}
            {!unitFileLoading && !unitFile && (
              <div className="py-6 text-center text-[var(--text-muted)] text-xs">
                Unit file not found or not accessible
              </div>
            )}
            {!unitFileLoading && unitFile && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{unitFilePath || 'Unit file'}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(unitFile)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <Copy size={9} /> Copy
                  </button>
                </div>
                <div className="rounded bg-[#0d1117] border border-[var(--border)] p-3 max-h-[240px] overflow-auto">
                  <pre className="text-[10px] font-mono text-[#c9d1d9] whitespace-pre-wrap leading-relaxed">
                    {unitFile.split('\n').map((line, i) => {
                      // Syntax highlighting for unit files
                      if (line.startsWith('#')) {
                        return <div key={i} className="text-[#8b949e]">{line}</div>;
                      }
                      if (line.startsWith('[') && line.endsWith(']')) {
                        return <div key={i} className="text-[#d2a8ff] font-semibold">{line}</div>;
                      }
                      if (line.includes('=')) {
                        const [key, ...rest] = line.split('=');
                        return (
                          <div key={i}>
                            <span className="text-[#79c0ff]">{key}</span>
                            <span className="text-[#c9d1d9]">=</span>
                            <span className="text-[#a5d6ff]">{rest.join('=')}</span>
                          </div>
                        );
                      }
                      return <div key={i}>{line}</div>;
                    })}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const DetailRow: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div>
    <div className="text-[var(--text-muted)]">{label}</div>
    <div className="font-mono break-all" style={{ color: color || 'var(--text-primary)' }}>{value || '—'}</div>
  </div>
);
