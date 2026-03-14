import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Thermometer,
  Server,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { ToolModal } from './ToolModal';
import { apiGet } from '@/api/client';
import { getWsUrl } from '@/api/client';

interface DashboardMetrics {
  cpu_percent: number;
  cpu_cores: number[];
  mem_total: number;
  mem_used: number;
  mem_percent: number;
  swap_total: number;
  swap_used: number;
  swap_percent: number;
  disk_total: number;
  disk_used: number;
  disk_percent: number;
  net_rx_rate: number;
  net_tx_rate: number;
  load_avg: number[];
  uptime: number;
  os_name: string;
  top_cpu_procs: { pid: string; user: string; cpu: string; command: string }[];
  top_mem_procs: { pid: string; user: string; mem: string; command: string }[];
  io_read_rate: number;
  io_write_rate: number;
  gpu_temp: string;
  cpu_temp: string;
}

interface SystemInfo {
  hostname: string;
  kernel: string;
  os_name: string;
  os_version: string;
  architecture: string;
  cpu_model: string;
  cpu_cores: number;
  cpu_threads: number;
  total_memory: string;
  uptime: string;
  uptime_seconds: number;
  gpu_info: string;
  block_devices: Array<{
    name: string;
    size: number;
    type: string;
    mountpoint: string | null;
    fstype: string | null;
    model: string | null;
    children?: Array<{
      name: string;
      size: number;
      type: string;
      mountpoint: string | null;
      fstype: string | null;
    }>;
  }>;
}

interface ChartPoint {
  time: string;
  cpu: number;
  mem: number;
  netRx: number;
  netTx: number;
  diskRead: number;
  diskWrite: number;
}

const MAX_HISTORY = 60;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatBytesRate(bytes: number): string {
  if (Math.abs(bytes) < 1024) return bytes.toFixed(0) + ' B/s';
  if (Math.abs(bytes) < 1048576) return (bytes / 1024).toFixed(1) + ' KB/s';
  return (bytes / 1048576).toFixed(1) + ' MB/s';
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m`;
}

interface Props {
  connectionId: string;
}

export const SystemDashboard: React.FC<Props> = ({ connectionId }) => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [history, setHistory] = useState<ChartPoint[]>([]);
  const [error, setError] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch system info once
  useEffect(() => {
    apiGet(`/api/tools/${connectionId}/system-info`)
      .then((data) => setSystemInfo(data))
      .catch((err) => setError(err.message || 'Failed to fetch system info'));
  }, [connectionId]);

  // WebSocket for streaming metrics with reconnection
  useEffect(() => {
    let retryCount = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      const wsUrl = getWsUrl('/ws/tools');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCount = 0;
        setError('');
        ws.send(JSON.stringify({ type: 'subscribe_dashboard', connection_id: connectionId }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'dashboard_metrics' && msg.data) {
            const m = msg.data as DashboardMetrics;
            setMetrics(m);
            setHistory((prev) => {
              const now = new Date().toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              const next = [
                ...prev,
                {
                  time: now,
                  cpu: m.cpu_percent,
                  mem: m.mem_percent,
                  netRx: m.net_rx_rate,
                  netTx: m.net_tx_rate,
                  diskRead: m.io_read_rate,
                  diskWrite: m.io_write_rate,
                },
              ];
              return next.slice(-MAX_HISTORY);
            });
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
      };

      ws.onclose = () => {
        if (cancelled) return;
        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        retryCount++;
        retryTimeout = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      const ws = wsRef.current;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'unsubscribe_dashboard' }));
        }
        ws.close();
      }
    };
  }, [connectionId]);

  const alerts: string[] = [];
  if (metrics) {
    if (metrics.cpu_percent > 90) alerts.push(`CPU at ${metrics.cpu_percent}%`);
    if (metrics.mem_percent > 85) alerts.push(`Memory at ${metrics.mem_percent}%`);
    if (metrics.disk_percent > 90) alerts.push(`Disk at ${metrics.disk_percent}%`);
    if (metrics.swap_percent > 80) alerts.push(`Swap at ${metrics.swap_percent}%`);
  }

  const chartColors = {
    cpu: 'var(--accent)',
    mem: '#a78bfa',
    netRx: '#34d399',
    netTx: '#f87171',
  };

  return (
    <ToolModal title="System Dashboard" icon={<Activity size={18} />}>
      {error && (
        <div className="mb-4 p-2 rounded bg-[var(--danger)]/10 text-[var(--danger)] text-xs">
          {error}
        </div>
      )}

      {/* Anomaly alerts */}
      {alerts.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {alerts.map((alert, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--danger)]/10 text-[var(--danger)] text-xs font-medium"
            >
              <AlertTriangle size={12} />
              {alert}
            </div>
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryCard
          icon={<Server size={14} />}
          label="Host"
          value={systemInfo?.hostname || '...'}
          sub={systemInfo?.os_name || ''}
        />
        <SummaryCard
          icon={<Cpu size={14} />}
          label="CPU"
          value={systemInfo?.cpu_model?.split(' ').slice(0, 3).join(' ') || '...'}
          sub={systemInfo ? `${systemInfo.cpu_cores}C / ${systemInfo.cpu_threads}T` : ''}
        />
        <SummaryCard
          icon={<Clock size={14} />}
          label="Uptime"
          value={metrics ? formatUptime(metrics.uptime) : systemInfo?.uptime || '...'}
          sub={metrics?.load_avg ? `Load: ${metrics.load_avg.map((l) => l.toFixed(2)).join(', ')}` : ''}
        />
        <SummaryCard
          icon={<Thermometer size={14} />}
          label="Temperature"
          value={metrics?.cpu_temp ? `${metrics.cpu_temp}°C` : 'N/A'}
          sub={metrics?.gpu_temp ? `GPU: ${metrics.gpu_temp}°C` : ''}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* CPU + Memory chart */}
        <ChartCard title="CPU & Memory">
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={history} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColors.cpu} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartColors.cpu} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColors.mem} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartColors.mem} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" hide />
              <YAxis domain={[0, 100]} hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: 'var(--text-primary)',
                }}
                formatter={(value, name) => [
                  `${Number(value ?? 0).toFixed(1)}%`,
                  name === 'cpu' ? 'CPU' : 'Memory',
                ]}
              />
              <Area
                type="monotone"
                dataKey="cpu"
                stroke={chartColors.cpu}
                fill="url(#cpuGrad)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="mem"
                stroke={chartColors.mem}
                fill="url(#memGrad)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-1 px-1">
            <ChartLegend color={chartColors.cpu} label={`CPU ${metrics?.cpu_percent?.toFixed(1) || 0}%`} />
            <ChartLegend color={chartColors.mem} label={`Mem ${metrics?.mem_percent?.toFixed(1) || 0}%`} />
          </div>
        </ChartCard>

        {/* Network chart */}
        <ChartCard title="Network I/O">
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={history} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColors.netRx} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartColors.netRx} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColors.netTx} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartColors.netTx} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: 'var(--text-primary)',
                }}
                formatter={(value, name) => [
                  formatBytesRate(Number(value ?? 0)),
                  name === 'netRx' ? 'Download' : 'Upload',
                ]}
              />
              <Area
                type="monotone"
                dataKey="netRx"
                stroke={chartColors.netRx}
                fill="url(#rxGrad)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="netTx"
                stroke={chartColors.netTx}
                fill="url(#txGrad)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-1 px-1">
            <ChartLegend color={chartColors.netRx} label={`RX ${metrics ? formatBytesRate(metrics.net_rx_rate) : '0 B/s'}`} />
            <ChartLegend color={chartColors.netTx} label={`TX ${metrics ? formatBytesRate(metrics.net_tx_rate) : '0 B/s'}`} />
          </div>
        </ChartCard>
      </div>

      {/* Gauges row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <GaugeCard
          icon={<Cpu size={14} />}
          label="CPU"
          percent={metrics?.cpu_percent || 0}
          detail={metrics?.cpu_cores ? `${metrics.cpu_cores.length} cores` : ''}
        />
        <GaugeCard
          icon={<MemoryStick size={14} />}
          label="Memory"
          percent={metrics?.mem_percent || 0}
          detail={metrics ? `${formatBytes(metrics.mem_used)} / ${formatBytes(metrics.mem_total)}` : ''}
        />
        <GaugeCard
          icon={<HardDrive size={14} />}
          label="Disk"
          percent={metrics?.disk_percent || 0}
          detail={metrics ? `${formatBytes(metrics.disk_used)} / ${formatBytes(metrics.disk_total)}` : ''}
        />
        <GaugeCard
          icon={<Network size={14} />}
          label="Swap"
          percent={metrics?.swap_percent || 0}
          detail={
            metrics && metrics.swap_total > 0
              ? `${formatBytes(metrics.swap_used)} / ${formatBytes(metrics.swap_total)}`
              : 'Not configured'
          }
        />
      </div>

      {/* Top processes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <TopProcessTable title="Top CPU Processes" processes={metrics?.top_cpu_procs || []} valueKey="cpu" valueSuffix="%" />
        <TopProcessTable title="Top Memory Processes" processes={metrics?.top_mem_procs || []} valueKey="mem" valueSuffix="%" />
      </div>

      {/* Block devices */}
      {systemInfo?.block_devices && systemInfo.block_devices.length > 0 && (
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-3">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
            <HardDrive size={12} /> Block Devices
          </h3>
          <div className="space-y-1">
            {systemInfo.block_devices.map((dev, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-[var(--accent)]">{dev.name}</span>
                  <span className="text-[var(--text-muted)]">{dev.type}</span>
                  <span className="text-[var(--text-secondary)]">{formatBytes(dev.size || 0)}</span>
                  {dev.mountpoint && (
                    <span className="text-[var(--text-muted)]">@ {dev.mountpoint}</span>
                  )}
                  {dev.fstype && (
                    <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-[10px]">
                      {dev.fstype}
                    </span>
                  )}
                  {dev.model && (
                    <span className="text-[var(--text-muted)] truncate">{dev.model}</span>
                  )}
                </div>
                {dev.children?.map((child, j) => (
                  <div key={j} className="flex items-center gap-2 text-xs font-mono ml-4">
                    <span className="text-[var(--text-muted)]">|-</span>
                    <span className="text-[var(--text-primary)]">{child.name}</span>
                    <span className="text-[var(--text-muted)]">{child.type}</span>
                    <span className="text-[var(--text-secondary)]">{formatBytes(child.size || 0)}</span>
                    {child.mountpoint && (
                      <span className="text-[var(--text-muted)]">@ {child.mountpoint}</span>
                    )}
                    {child.fstype && (
                      <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-[10px]">
                        {child.fstype}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </ToolModal>
  );
};

/* ---- Sub-components ---- */

const SummaryCard: React.FC<{ icon: React.ReactNode; label: string; value: string; sub: string }> = ({
  icon,
  label,
  value,
  sub,
}) => (
  <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-3">
    <div className="flex items-center gap-1.5 text-[var(--text-muted)] mb-1">
      {icon}
      <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
    </div>
    <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{value}</div>
    {sub && <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{sub}</div>}
  </div>
);

const GaugeCard: React.FC<{ icon: React.ReactNode; label: string; percent: number; detail: string }> = ({
  icon,
  label,
  percent,
  detail,
}) => {
  const color =
    percent > 90 ? 'var(--danger)' : percent > 70 ? 'var(--warning, #f59e0b)' : 'var(--accent)';
  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
          {icon}
          <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
        </div>
        <span className="text-sm font-bold tabular-nums" style={{ color }}>
          {percent.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
        />
      </div>
      {detail && <div className="text-[10px] text-[var(--text-muted)] mt-1.5 truncate">{detail}</div>}
    </div>
  );
};

const ChartCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-3">
    <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">{title}</h3>
    {children}
  </div>
);

const ChartLegend: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
    {label}
  </div>
);

const TopProcessTable: React.FC<{
  title: string;
  processes: Array<{ pid: string; user: string; cpu?: string; mem?: string; command: string }>;
  valueKey: 'cpu' | 'mem';
  valueSuffix: string;
}> = ({ title, processes, valueKey, valueSuffix }) => (
  <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-3">
    <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">{title}</h3>
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-[var(--text-muted)] border-b border-[var(--border)]">
          <th className="text-left py-1 font-medium">PID</th>
          <th className="text-left py-1 font-medium">User</th>
          <th className="text-right py-1 font-medium">{valueKey === 'cpu' ? 'CPU' : 'MEM'}</th>
          <th className="text-left py-1 pl-3 font-medium">Command</th>
        </tr>
      </thead>
      <tbody>
        {processes.map((p, i) => (
          <tr key={i} className="border-b border-[var(--border)]/50 text-[var(--text-secondary)]">
            <td className="py-1 tabular-nums">{p.pid}</td>
            <td className="py-1">{p.user}</td>
            <td className="py-1 text-right tabular-nums text-[var(--accent)]">
              {(p as Record<string, string>)[valueKey]}{valueSuffix}
            </td>
            <td className="py-1 pl-3 truncate max-w-[200px] font-mono text-[10px]">{p.command}</td>
          </tr>
        ))}
        {processes.length === 0 && (
          <tr>
            <td colSpan={4} className="py-2 text-center text-[var(--text-muted)]">
              Waiting for data...
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
