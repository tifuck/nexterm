import React, { useEffect, useState, useCallback } from 'react';
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
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';

interface ServiceInfo {
  name: string;
  load_state: string;
  active_state: string;
  sub_state: string;
  description: string;
}

interface Props {
  connectionId: string;
}

type FilterMode = 'all' | 'active' | 'failed' | 'inactive';

export const ServiceManager: React.FC<Props> = ({ connectionId }) => {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [initSystem, setInitSystem] = useState('unknown');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/services`);
      setServices(data.services || []);
      setInitSystem(data.init_system || 'unknown');
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch services';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const handleAction = async (serviceName: string, action: string) => {
    setActionLoading(`${serviceName}:${action}`);
    try {
      await apiPost(`/api/tools/${connectionId}/services/${encodeURIComponent(serviceName)}/${action}`, {});
      // Refresh after action
      setTimeout(fetchServices, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to ${action} ${serviceName}`;
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  // Filter and search
  const filtered = services.filter((s) => {
    // Filter
    if (filter === 'active' && s.active_state !== 'active') return false;
    if (filter === 'failed' && s.active_state !== 'failed') return false;
    if (filter === 'inactive' && s.active_state !== 'inactive') return false;

    // Search
    if (search) {
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const statusCounts = {
    all: services.length,
    active: services.filter((s) => s.active_state === 'active').length,
    failed: services.filter((s) => s.active_state === 'failed').length,
    inactive: services.filter((s) => s.active_state === 'inactive').length,
  };

  return (
    <ToolModal title="Service Manager" icon={<Server size={18} />}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search services..."
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

        {/* Filter tabs */}
        <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
          {(['all', 'active', 'failed', 'inactive'] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                filter === f
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="ml-1 opacity-70">{statusCounts[f]}</span>
            </button>
          ))}
        </div>

        <button
          onClick={fetchServices}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>

        <div className="text-[10px] text-[var(--text-muted)]">
          Init: {initSystem}
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 rounded bg-[var(--danger)]/10 text-[var(--danger)] text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-2">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Services list */}
      <div className="overflow-auto max-h-[calc(80vh-180px)] space-y-1">
        {filtered.map((svc) => (
          <ServiceRow
            key={svc.name}
            service={svc}
            onAction={(action) => handleAction(svc.name, action)}
            actionLoading={actionLoading}
          />
        ))}
        {filtered.length === 0 && !loading && (
          <div className="py-8 text-center text-[var(--text-muted)] text-xs">
            {search ? 'No matching services' : 'No services found'}
          </div>
        )}
        {loading && services.length === 0 && (
          <div className="py-8 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading services...
          </div>
        )}
      </div>
    </ToolModal>
  );
};

/* ---- Sub-components ---- */

const ServiceRow: React.FC<{
  service: ServiceInfo;
  onAction: (action: string) => void;
  actionLoading: string | null;
}> = ({ service, onAction, actionLoading }) => {
  const isActive = service.active_state === 'active';
  const isFailed = service.active_state === 'failed';
  const currentAction = actionLoading?.startsWith(service.name + ':')
    ? actionLoading.split(':')[1]
    : null;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-hover)] transition-colors group">
      {/* Status indicator */}
      <div className="shrink-0">
        {isActive ? (
          <Check size={14} style={{ color: 'var(--success)' }} />
        ) : isFailed ? (
          <XCircle size={14} style={{ color: 'var(--danger)' }} />
        ) : (
          <Square size={12} className="text-[var(--text-muted)]" />
        )}
      </div>

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--text-primary)] font-mono truncate">
            {service.name}
          </span>
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-medium"
            style={{
              backgroundColor: isActive
                ? 'var(--success)'
                : isFailed
                ? 'var(--danger)'
                : 'var(--bg-tertiary)',
              color: isActive || isFailed ? 'white' : 'var(--text-muted)',
              opacity: isActive || isFailed ? 0.9 : 1,
            }}
          >
            {service.sub_state || service.active_state}
          </span>
        </div>
        {service.description && (
          <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
            {service.description}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isActive && (
          <ActionButton
            icon={<Play size={11} />}
            label="Start"
            onClick={() => onAction('start')}
            loading={currentAction === 'start'}
            color="var(--success)"
          />
        )}
        {isActive && (
          <ActionButton
            icon={<Square size={11} />}
            label="Stop"
            onClick={() => onAction('stop')}
            loading={currentAction === 'stop'}
            color="var(--danger)"
          />
        )}
        <ActionButton
          icon={<RotateCw size={11} />}
          label="Restart"
          onClick={() => onAction('restart')}
          loading={currentAction === 'restart'}
          color="var(--accent)"
        />
        <ActionButton
          icon={<ToggleRight size={11} />}
          label="Enable"
          onClick={() => onAction('enable')}
          loading={currentAction === 'enable'}
          color="var(--success)"
        />
        <ActionButton
          icon={<ToggleLeft size={11} />}
          label="Disable"
          onClick={() => onAction('disable')}
          loading={currentAction === 'disable'}
          color="var(--text-muted)"
        />
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
    className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
    title={label}
    style={{ color }}
  >
    {loading ? <Loader2 size={11} className="animate-spin" /> : icon}
  </button>
);
