import React, { useEffect, useState, useCallback } from 'react';
import {
  Container,
  RefreshCw,
  Loader2,
  X,
  Play,
  Square,
  RotateCw,
  Trash2,
  FileText,
  Image,
  AlertTriangle,
  Pause,
  Search,
  Terminal,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost, apiDelete } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DockerInfo {
  installed: boolean;
  version: string;
  api_version: string;
  containers_running: number;
  containers_paused: number;
  containers_stopped: number;
  images: number;
  storage_driver: string;
}

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
  ports: string;
  size: string;
}

interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

type TabId = 'containers' | 'images';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  connectionId: string;
}

export const DockerManager: React.FC<Props> = ({ connectionId }) => {
  const [info, setInfo] = useState<DockerInfo | null>(null);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('containers');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState<string | null>(null);
  const [logsContent, setLogsContent] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [containerSearch, setContainerSearch] = useState('');

  const fetchInfo = useCallback(async () => {
    try {
      const data = await apiGet(`/api/tools/${connectionId}/docker/info`);
      setInfo(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to get Docker info';
      setError(message);
    }
  }, [connectionId]);

  const fetchContainers = useCallback(async () => {
    try {
      const data = await apiGet(`/api/tools/${connectionId}/docker/containers`);
      setContainers(data.containers || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to list containers';
      setError(message);
    }
  }, [connectionId]);

  const fetchImages = useCallback(async () => {
    try {
      const data = await apiGet(`/api/tools/${connectionId}/docker/images`);
      setImages(data.images || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to list images';
      setError(message);
    }
  }, [connectionId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    await Promise.all([fetchInfo(), fetchContainers(), fetchImages()]);
    setLoading(false);
  }, [fetchInfo, fetchContainers, fetchImages]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const containerAction = async (containerId: string, action: string) => {
    if (action === 'remove' && !confirm(`Remove container ${containerId}?`)) return;
    setActionLoading(`${containerId}:${action}`);
    try {
      await apiPost(`/api/tools/${connectionId}/docker/containers/${containerId}/action`, { action });
      setTimeout(() => {
        fetchContainers();
        fetchInfo();
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to ${action} container`;
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const viewLogs = async (containerId: string) => {
    if (logsOpen === containerId) {
      setLogsOpen(null);
      return;
    }
    setLogsOpen(containerId);
    setLogsLoading(true);
    setLogsContent('');
    try {
      const data = await apiGet(`/api/tools/${connectionId}/docker/containers/${containerId}/logs`, { tail: 200 });
      setLogsContent(data.logs || 'No logs');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch logs';
      setLogsContent(`Error: ${message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const deleteImage = async (imageId: string) => {
    if (!confirm(`Delete image ${imageId}?`)) return;
    setActionLoading(`img:${imageId}`);
    try {
      await apiDelete(`/api/tools/${connectionId}/docker/images/${encodeURIComponent(imageId)}`);
      setTimeout(() => {
        fetchImages();
        fetchInfo();
      }, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete image';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  if (info && !info.installed) {
    return (
      <ToolModal title="Docker Manager" icon={<Container size={18} />}>
        <div className="py-8 text-center">
          <AlertTriangle size={28} className="mx-auto mb-3 text-[var(--warning)]" />
          <div className="text-sm text-[var(--text-primary)] font-medium mb-2">Docker Not Installed</div>
          <div className="text-xs text-[var(--text-muted)] mb-4">
            Docker is not installed on this server. Install Docker to manage containers.
          </div>
          <div className="max-w-md mx-auto text-left bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-3">
            <div className="text-[10px] font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
              <Terminal size={11} /> Install Commands
            </div>
            <div className="space-y-1.5 text-[10px] font-mono text-[var(--text-muted)]">
              <div><span className="text-[var(--accent)]">Ubuntu/Debian:</span> curl -fsSL https://get.docker.com | sh</div>
              <div><span className="text-[var(--accent)]">RHEL/CentOS:</span> sudo dnf install docker-ce docker-ce-cli containerd.io</div>
              <div><span className="text-[var(--accent)]">Arch:</span> sudo pacman -S docker</div>
              <div className="pt-1 text-[9px]">Then: sudo systemctl enable --now docker</div>
            </div>
          </div>
        </div>
      </ToolModal>
    );
  }

  return (
    <ToolModal title="Docker Manager" icon={<Container size={18} />}>
      {/* Info bar */}
      {info && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
          <InfoCard label="Version" value={info.version || '—'} />
          <InfoCard label="Running" value={String(info.containers_running)} color="var(--success)" />
          <InfoCard label="Stopped" value={String(info.containers_stopped)} color="var(--text-muted)" />
          <InfoCard label="Paused" value={String(info.containers_paused)} color="var(--warning)" />
          <InfoCard label="Images" value={String(info.images)} color="var(--accent)" />
        </div>
      )}

      {/* Tabs + search + refresh */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
          <button
            onClick={() => setActiveTab('containers')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
              activeTab === 'containers'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Container size={13} />
            Containers ({containers.length})
          </button>
          <button
            onClick={() => setActiveTab('images')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
              activeTab === 'images'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Image size={13} />
            Images ({images.length})
          </button>
        </div>

        {activeTab === 'containers' && (
          <div className="relative flex-1 min-w-[150px] max-w-[250px]">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={containerSearch}
              onChange={(e) => setContainerSearch(e.target.value)}
              placeholder="Filter containers..."
              className="w-full pl-7 pr-7 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
            {containerSearch && (
              <button
                onClick={() => setContainerSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X size={11} />
              </button>
            )}
          </div>
        )}

        <div className="flex-1" />
        <button
          onClick={fetchAll}
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

      {loading && !info && (
        <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Loading Docker info...
        </div>
      )}

      {/* Containers tab */}
      {activeTab === 'containers' && (() => {
        const filtered = containerSearch
          ? containers.filter((c) => {
              const q = containerSearch.toLowerCase();
              return c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
            })
          : containers;
        return (
        <div className="overflow-auto max-h-[calc(80vh-220px)] space-y-1">
          {filtered.length === 0 && !loading && (
            <div className="py-8 text-center text-[var(--text-muted)] text-xs">
              {containerSearch ? 'No matching containers' : 'No containers found'}
            </div>
          )}
          {filtered.map((c) => {
            const isRunning = c.state === 'running';
            const isPaused = c.state === 'paused';
            const currentAction = actionLoading?.startsWith(c.id + ':')
              ? actionLoading.split(':')[1]
              : null;

            return (
              <div key={c.id}>
                <div className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-hover)] transition-colors group">
                  {/* Status dot */}
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: isRunning ? 'var(--success)' : isPaused ? 'var(--warning)' : 'var(--text-muted)',
                    }}
                  />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--text-primary)] font-mono truncate">
                        {c.name}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] font-mono">
                        {c.id.slice(0, 12)}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                      {c.image} — {c.status}
                      {c.ports && ` — ${c.ports}`}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Logs */}
                    <ActionBtn
                      icon={<FileText size={11} />}
                      label="Logs"
                      onClick={() => viewLogs(c.id)}
                      loading={false}
                      color="var(--accent)"
                    />
                    {!isRunning && (
                      <ActionBtn icon={<Play size={11} />} label="Start" onClick={() => containerAction(c.id, 'start')} loading={currentAction === 'start'} color="var(--success)" />
                    )}
                    {isRunning && (
                      <ActionBtn icon={<Square size={11} />} label="Stop" onClick={() => containerAction(c.id, 'stop')} loading={currentAction === 'stop'} color="var(--danger)" />
                    )}
                    {isRunning && !isPaused && (
                      <ActionBtn icon={<Pause size={11} />} label="Pause" onClick={() => containerAction(c.id, 'pause')} loading={currentAction === 'pause'} color="var(--warning)" />
                    )}
                    {isPaused && (
                      <ActionBtn icon={<Play size={11} />} label="Unpause" onClick={() => containerAction(c.id, 'unpause')} loading={currentAction === 'unpause'} color="var(--success)" />
                    )}
                    <ActionBtn icon={<RotateCw size={11} />} label="Restart" onClick={() => containerAction(c.id, 'restart')} loading={currentAction === 'restart'} color="var(--accent)" />
                    <ActionBtn icon={<Trash2 size={11} />} label="Remove" onClick={() => containerAction(c.id, 'remove')} loading={currentAction === 'remove'} color="var(--danger)" />
                  </div>
                </div>

                {/* Logs panel */}
                {logsOpen === c.id && (
                  <div className="mt-1 mb-2 ml-5 rounded bg-[var(--bg-primary)] border border-[var(--border)] overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                      <span className="text-[10px] font-medium text-[var(--text-secondary)]">Container Logs — {c.name}</span>
                      <button onClick={() => setLogsOpen(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                        <X size={12} />
                      </button>
                    </div>
                    {logsLoading ? (
                      <div className="p-4 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
                        <Loader2 size={12} className="animate-spin" />
                        Loading logs...
                      </div>
                    ) : (
                      <pre className="p-3 text-[10px] font-mono text-[var(--text-secondary)] overflow-auto max-h-[250px] whitespace-pre-wrap">
                        {logsContent}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        );
      })()}

      {/* Images tab */}
      {activeTab === 'images' && (
        <div className="overflow-auto max-h-[calc(80vh-220px)]">
          {images.length === 0 && !loading ? (
            <div className="py-8 text-center text-[var(--text-muted)] text-xs">No images found</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="py-2 px-2 font-medium">Repository</th>
                  <th className="py-2 px-2 font-medium">Tag</th>
                  <th className="py-2 px-2 font-medium">ID</th>
                  <th className="py-2 px-2 font-medium">Size</th>
                  <th className="py-2 px-2 font-medium">Created</th>
                  <th className="py-2 px-2 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {images.map((img, i) => (
                  <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-secondary)] transition-colors group">
                    <td className="py-1.5 px-2 font-mono font-medium text-[var(--text-primary)] truncate max-w-[200px]">
                      {img.repository}
                    </td>
                    <td className="py-1.5 px-2">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--accent)]/15 text-[var(--accent)]">
                        {img.tag}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 font-mono text-[var(--text-muted)] text-[10px]">{img.id.slice(0, 12)}</td>
                    <td className="py-1.5 px-2 text-[var(--text-secondary)]">{img.size}</td>
                    <td className="py-1.5 px-2 text-[var(--text-muted)]">{img.created}</td>
                    <td className="py-1.5 px-2">
                      <button
                        onClick={() => deleteImage(img.id)}
                        disabled={actionLoading === `img:${img.id}`}
                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                        title="Delete image"
                      >
                        {actionLoading === `img:${img.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const InfoCard: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
    <div className="text-[9px] text-[var(--text-muted)] mb-0.5">{label}</div>
    <div className="text-xs font-semibold font-mono truncate" style={{ color: color || 'var(--text-primary)' }}>
      {value}
    </div>
  </div>
);

const ActionBtn: React.FC<{
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
