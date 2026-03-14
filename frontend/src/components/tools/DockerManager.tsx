import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Plus,
  Network,
  HardDrive,
  Layers,
  Download,
  Eye,
  Skull,
  ServerCrash,
  Activity,
  Ban,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Save,
  ArrowUpDown,
  Cpu,
  MemoryStick,
  Info,
  CircleDot,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost, apiDelete, getWsUrl } from '@/api/client';
import { useToastStore } from '@/store/toastStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DockerInstallCheck {
  supported: boolean;
  os: string;
  os_version: string;
  already_installed: boolean;
  reason: string;
  curl_available: boolean;
  has_systemd: boolean;
}

interface DockerInfo {
  installed: boolean;
  version: string;
  api_version: string;
  containers_running: number;
  containers_paused: number;
  containers_stopped: number;
  images_count: number;
  storage_driver: string;
  docker_root: string;
  os_type: string;
  architecture: string;
  daemon_running: boolean;
  disk_usage_images: string;
  disk_usage_containers: string;
  disk_usage_volumes: string;
  disk_usage_buildcache: string;
  disk_usage_total: string;
  networks_count: number;
  volumes_count: number;
  compose_installed: boolean;
  compose_version: string;
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
  cpu_percent: string;
  mem_usage: string;
  mem_limit: string;
  mem_percent: string;
  net_io: string;
  block_io: string;
  pids: string;
  compose_project: string;
  compose_service: string;
}

interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  subnet: string;
  gateway: string;
  containers_count: number;
  internal: boolean;
}

interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  size: string;
  created: string;
}

interface DockerComposeProject {
  name: string;
  status: string;
  config_files: string;
  running_count: number;
  total_count: number;
}

type TabId = 'containers' | 'images' | 'networks' | 'volumes' | 'compose';

type ViewState = 'loading' | 'check' | 'not_supported' | 'not_installed' | 'installing' | 'dashboard';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  connectionId: string;
}

export const DockerManager: React.FC<Props> = ({ connectionId }) => {
  const addToast = useToastStore((s) => s.addToast);

  // View state
  const [view, setView] = useState<ViewState>('loading');
  const [info, setInfo] = useState<DockerInfo | null>(null);
  const [installCheck, setInstallCheck] = useState<DockerInstallCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('containers');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Data
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [composeProjects, setComposeProjects] = useState<DockerComposeProject[]>([]);

  // Search/filter
  const [containerSearch, setContainerSearch] = useState('');

  // Install flow
  const [installOutput, setInstallOutput] = useState<string[]>([]);
  const [installStatus, setInstallStatus] = useState<'idle' | 'running' | 'completed' | 'failed' | 'killed'>('idle');
  const installOutputRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Container logs streaming
  const [logsOpen, setLogsOpen] = useState<string | null>(null);
  const [logsContent, setLogsContent] = useState<string[]>([]);
  const [logsStreaming, setLogsStreaming] = useState(false);
  const logsWsRef = useRef<WebSocket | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  // Container inspect
  const [inspectOpen, setInspectOpen] = useState<string | null>(null);
  const [inspectData, setInspectData] = useState<string>('');
  const [inspectLoading, setInspectLoading] = useState(false);

  // Image pull
  const [pullImageName, setPullImageName] = useState('');
  const [pullOutput, setPullOutput] = useState<string[]>([]);
  const [pullStatus, setPullStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const pullWsRef = useRef<WebSocket | null>(null);
  const pullOutputRef = useRef<HTMLDivElement>(null);

  // Network create dialog
  const [showNetworkCreate, setShowNetworkCreate] = useState(false);
  const [newNetworkName, setNewNetworkName] = useState('');
  const [newNetworkDriver, setNewNetworkDriver] = useState('bridge');
  const [newNetworkSubnet, setNewNetworkSubnet] = useState('');

  // Volume create dialog
  const [showVolumeCreate, setShowVolumeCreate] = useState(false);
  const [newVolumeName, setNewVolumeName] = useState('');
  const [newVolumeDriver, setNewVolumeDriver] = useState('local');

  // Compose file editor
  const [composeFileOpen, setComposeFileOpen] = useState<string | null>(null);
  const [composeFileContent, setComposeFileContent] = useState('');
  const [composeFileLoading, setComposeFileLoading] = useState(false);
  const [composeFileSaving, setComposeFileSaving] = useState(false);

  // Uninstall confirm
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [uninstallLoading, setUninstallLoading] = useState(false);

  // Kill confirm for install
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  // Expanded info panel
  const [showInfoPanel, setShowInfoPanel] = useState(false);

  // -------------------------------------------------------------------
  // Initial check
  // -------------------------------------------------------------------

  const runCheck = useCallback(async () => {
    setView('loading');
    try {
      const check: DockerInstallCheck = await apiGet(`/api/tools/${connectionId}/docker/check`);
      setInstallCheck(check);

      if (check.already_installed) {
        setView('dashboard');
        return;
      }

      if (!check.supported) {
        setView('not_supported');
        return;
      }

      setView('not_installed');
    } catch {
      addToast('Failed to check Docker status', 'error');
      setView('not_supported');
    }
  }, [connectionId, addToast]);

  // -------------------------------------------------------------------
  // Dashboard data
  // -------------------------------------------------------------------

  const fetchInfo = useCallback(async () => {
    try {
      const data: DockerInfo = await apiGet(`/api/tools/${connectionId}/docker/info`);
      setInfo(data);
      if (!data.installed) {
        setView('not_installed');
        runCheck();
        return;
      }
    } catch {
      addToast('Failed to get Docker info', 'error');
    }
  }, [connectionId, addToast, runCheck]);

  const fetchContainers = useCallback(async () => {
    try {
      const data = await apiGet(`/api/tools/${connectionId}/docker/containers`);
      setContainers(data.containers || []);
    } catch {
      addToast('Failed to list containers', 'error');
    }
  }, [connectionId, addToast]);

  const fetchImages = useCallback(async () => {
    try {
      const data = await apiGet(`/api/tools/${connectionId}/docker/images`);
      setImages(data.images || []);
    } catch {
      addToast('Failed to list images', 'error');
    }
  }, [connectionId, addToast]);

  const fetchNetworks = useCallback(async () => {
    try {
      const data = await apiGet(`/api/tools/${connectionId}/docker/networks`);
      setNetworks(data.networks || []);
    } catch {
      addToast('Failed to list networks', 'error');
    }
  }, [connectionId, addToast]);

  const fetchVolumes = useCallback(async () => {
    try {
      const data = await apiGet(`/api/tools/${connectionId}/docker/volumes`);
      setVolumes(data.volumes || []);
    } catch {
      addToast('Failed to list volumes', 'error');
    }
  }, [connectionId, addToast]);

  const fetchCompose = useCallback(async () => {
    try {
      const data = await apiGet(`/api/tools/${connectionId}/docker/compose/projects`);
      setComposeProjects(data.projects || []);
    } catch {
      // Compose may not be installed — not an error
    }
  }, [connectionId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchInfo(), fetchContainers(), fetchImages(), fetchNetworks(), fetchVolumes(), fetchCompose()]);
    setLoading(false);
  }, [fetchInfo, fetchContainers, fetchImages, fetchNetworks, fetchVolumes, fetchCompose]);

  useEffect(() => {
    if (view === 'dashboard') {
      fetchAll();
    }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  // -------------------------------------------------------------------
  // Install via WebSocket
  // -------------------------------------------------------------------

  const startInstall = useCallback(() => {
    setView('installing');
    setInstallOutput([]);
    setInstallStatus('running');

    const ws = new WebSocket(getWsUrl('/ws/tools'));
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'docker_install',
        connection_id: connectionId,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'docker_install_output') {
          if (msg.data) {
            setInstallOutput((prev) => [...prev, msg.data]);
          }
          if (msg.status === 'completed') {
            setInstallStatus('completed');
            addToast('Docker installed successfully!', 'success');
            ws.close();
            setTimeout(() => setView('dashboard'), 2000);
          } else if (msg.status === 'failed') {
            setInstallStatus('failed');
            addToast('Docker installation failed', 'error');
            ws.close();
          } else if (msg.status === 'killed') {
            setInstallStatus('killed');
            addToast('Installation process killed', 'info');
            ws.close();
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      setInstallStatus('failed');
      addToast('WebSocket connection error during install', 'error');
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, [connectionId, addToast]);

  const killInstall = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'docker_install_kill' }));
    }
    setShowKillConfirm(false);
  }, []);

  // Auto-scroll install output
  useEffect(() => {
    if (installOutputRef.current) {
      installOutputRef.current.scrollTop = installOutputRef.current.scrollHeight;
    }
  }, [installOutput]);

  // -------------------------------------------------------------------
  // Container actions
  // -------------------------------------------------------------------

  const containerAction = async (containerId: string, action: string) => {
    if (action === 'remove' && !confirm(`Remove container ${containerId.slice(0, 12)}? This will delete the container permanently.`)) return;
    setActionLoading(`${containerId}:${action}`);
    try {
      await apiPost(`/api/tools/${connectionId}/docker/containers/${containerId}/action`, { action });
      addToast(`Container ${action} successful`, 'success');
      setTimeout(() => {
        fetchContainers();
        fetchInfo();
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to ${action} container`;
      addToast(message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // -------------------------------------------------------------------
  // Container logs streaming
  // -------------------------------------------------------------------

  const startLogStream = useCallback((containerId: string) => {
    // If already streaming this container, stop
    if (logsOpen === containerId && logsStreaming) {
      stopLogStream();
      return;
    }

    // Stop existing stream
    if (logsWsRef.current) {
      logsWsRef.current.close();
      logsWsRef.current = null;
    }

    setLogsOpen(containerId);
    setLogsContent([]);
    setLogsStreaming(true);

    const ws = new WebSocket(getWsUrl('/ws/tools'));
    logsWsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'docker_logs_stream',
        connection_id: connectionId,
        container_id: containerId,
        tail: 200,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'docker_logs_lines' && msg.lines) {
          setLogsContent((prev) => [...prev, ...msg.lines].slice(-2000));
        } else if (msg.type === 'docker_logs_ended') {
          setLogsStreaming(false);
          addToast(msg.reason || 'Log streaming ended', 'info');
        } else if (msg.type === 'docker_logs_error') {
          setLogsStreaming(false);
          addToast(msg.message || 'Log streaming error', 'error');
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      setLogsStreaming(false);
    };

    ws.onclose = () => {
      logsWsRef.current = null;
      setLogsStreaming(false);
    };
  }, [connectionId, logsOpen, logsStreaming, addToast]);

  const stopLogStream = useCallback(() => {
    if (logsWsRef.current && logsWsRef.current.readyState === WebSocket.OPEN) {
      logsWsRef.current.send(JSON.stringify({ type: 'docker_logs_stop' }));
    }
    if (logsWsRef.current) {
      logsWsRef.current.close();
      logsWsRef.current = null;
    }
    setLogsStreaming(false);
  }, []);

  const closeLogsPanel = useCallback(() => {
    stopLogStream();
    setLogsOpen(null);
    setLogsContent([]);
  }, [stopLogStream]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logsContent]);

  // -------------------------------------------------------------------
  // Container inspect
  // -------------------------------------------------------------------

  const inspectContainer = async (containerId: string) => {
    if (inspectOpen === containerId) {
      setInspectOpen(null);
      return;
    }
    setInspectOpen(containerId);
    setInspectLoading(true);
    setInspectData('');
    try {
      const data = await apiGet(`/api/tools/${connectionId}/docker/containers/${containerId}/inspect`);
      setInspectData(JSON.stringify(data.inspect || data, null, 2));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to inspect container';
      setInspectData(`Error: ${message}`);
    } finally {
      setInspectLoading(false);
    }
  };

  // -------------------------------------------------------------------
  // Image pull via WebSocket
  // -------------------------------------------------------------------

  const startPull = useCallback(() => {
    if (!pullImageName.trim()) {
      addToast('Enter an image name to pull', 'error');
      return;
    }

    setPullOutput([]);
    setPullStatus('running');

    const ws = new WebSocket(getWsUrl('/ws/tools'));
    pullWsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'docker_pull_image',
        connection_id: connectionId,
        image: pullImageName.trim(),
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'docker_pull_output') {
          if (msg.data) {
            setPullOutput((prev) => [...prev, msg.data]);
          }
          if (msg.status === 'completed') {
            setPullStatus('completed');
            addToast(`Image ${pullImageName} pulled successfully`, 'success');
            ws.close();
            setPullImageName('');
            setTimeout(() => {
              fetchImages();
              fetchInfo();
            }, 1000);
          } else if (msg.status === 'failed') {
            setPullStatus('failed');
            addToast(`Failed to pull ${pullImageName}`, 'error');
            ws.close();
          }
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      setPullStatus('failed');
      addToast('WebSocket error during pull', 'error');
    };

    ws.onclose = () => {
      pullWsRef.current = null;
    };
  }, [connectionId, pullImageName, addToast, fetchImages, fetchInfo]);

  // Auto-scroll pull output
  useEffect(() => {
    if (pullOutputRef.current) {
      pullOutputRef.current.scrollTop = pullOutputRef.current.scrollHeight;
    }
  }, [pullOutput]);

  // -------------------------------------------------------------------
  // Image delete
  // -------------------------------------------------------------------

  const deleteImage = async (imageId: string) => {
    if (!confirm(`Delete image ${imageId.slice(0, 12)}?`)) return;
    setActionLoading(`img:${imageId}`);
    try {
      await apiDelete(`/api/tools/${connectionId}/docker/images/${encodeURIComponent(imageId)}`);
      addToast('Image deleted', 'success');
      setTimeout(() => {
        fetchImages();
        fetchInfo();
      }, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete image';
      addToast(message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // -------------------------------------------------------------------
  // Network create / delete
  // -------------------------------------------------------------------

  const createNetwork = async () => {
    if (!newNetworkName.trim()) return;
    setActionLoading('create-network');
    try {
      await apiPost(`/api/tools/${connectionId}/docker/networks/create`, {
        name: newNetworkName.trim(),
        driver: newNetworkDriver,
        subnet: newNetworkSubnet || '',
      });
      addToast(`Network "${newNetworkName}" created`, 'success');
      setShowNetworkCreate(false);
      setNewNetworkName('');
      setNewNetworkSubnet('');
      fetchNetworks();
      fetchInfo();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create network';
      addToast(message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteNetwork = async (networkId: string, name: string) => {
    if (!confirm(`Delete network "${name}"?`)) return;
    setActionLoading(`net:${networkId}`);
    try {
      await apiDelete(`/api/tools/${connectionId}/docker/networks/${networkId}`);
      addToast(`Network "${name}" deleted`, 'success');
      fetchNetworks();
      fetchInfo();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete network';
      addToast(message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // -------------------------------------------------------------------
  // Volume create / delete
  // -------------------------------------------------------------------

  const createVolume = async () => {
    if (!newVolumeName.trim()) return;
    setActionLoading('create-volume');
    try {
      await apiPost(`/api/tools/${connectionId}/docker/volumes/create`, {
        name: newVolumeName.trim(),
        driver: newVolumeDriver,
      });
      addToast(`Volume "${newVolumeName}" created`, 'success');
      setShowVolumeCreate(false);
      setNewVolumeName('');
      fetchVolumes();
      fetchInfo();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create volume';
      addToast(message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteVolume = async (volumeName: string) => {
    if (!confirm(`Delete volume "${volumeName}"? Data will be lost.`)) return;
    setActionLoading(`vol:${volumeName}`);
    try {
      await apiDelete(`/api/tools/${connectionId}/docker/volumes/${encodeURIComponent(volumeName)}`);
      addToast(`Volume "${volumeName}" deleted`, 'success');
      fetchVolumes();
      fetchInfo();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete volume';
      addToast(message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // -------------------------------------------------------------------
  // Compose actions
  // -------------------------------------------------------------------

  const composeAction = async (project: DockerComposeProject, action: string) => {
    if (!project.config_files) return;
    const dir = project.config_files.substring(0, project.config_files.lastIndexOf('/')) || project.config_files;
    setActionLoading(`compose:${project.name}:${action}`);
    try {
      await apiPost(`/api/tools/${connectionId}/docker/compose/action`, {
        project_dir: dir,
        action,
      });
      addToast(`Compose ${action} on "${project.name}" successful`, 'success');
      setTimeout(() => {
        fetchCompose();
        fetchContainers();
        fetchInfo();
      }, 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to ${action} compose project`;
      addToast(message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const openComposeFile = async (configPath: string) => {
    if (composeFileOpen === configPath) {
      setComposeFileOpen(null);
      return;
    }
    setComposeFileOpen(configPath);
    setComposeFileLoading(true);
    try {
      const data = await apiPost(`/api/tools/${connectionId}/docker/compose/file/read`, { path: configPath });
      setComposeFileContent(data.content || '');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to read compose file';
      addToast(message, 'error');
      setComposeFileContent(`# Error: ${message}`);
    } finally {
      setComposeFileLoading(false);
    }
  };

  const saveComposeFile = async () => {
    if (!composeFileOpen) return;
    setComposeFileSaving(true);
    try {
      await apiPost(`/api/tools/${connectionId}/docker/compose/file/save`, {
        path: composeFileOpen,
        content: composeFileContent,
      });
      addToast('Compose file saved', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save compose file';
      addToast(message, 'error');
    } finally {
      setComposeFileSaving(false);
    }
  };

  // -------------------------------------------------------------------
  // Uninstall
  // -------------------------------------------------------------------

  const uninstallDocker = async () => {
    setUninstallLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/docker/uninstall`, {});
      addToast('Docker removed successfully', 'success');
      setShowUninstallConfirm(false);
      setInfo(null);
      runCheck();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to uninstall Docker';
      addToast(message, 'error');
    } finally {
      setUninstallLoading(false);
    }
  };

  // -------------------------------------------------------------------
  // Cleanup on unmount
  // -------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (logsWsRef.current) logsWsRef.current.close();
      if (pullWsRef.current) pullWsRef.current.close();
    };
  }, []);

  // ===================================================================
  // RENDER - Loading
  // ===================================================================

  if (view === 'loading') {
    return (
      <ToolModal title="Docker Manager" icon={<Container size={18} />}>
        <div className="py-16 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          Checking Docker status...
        </div>
      </ToolModal>
    );
  }

  // ===================================================================
  // RENDER - Not supported
  // ===================================================================

  if (view === 'not_supported') {
    return (
      <ToolModal title="Docker Manager" icon={<Container size={18} />}>
        <div className="py-12 text-center">
          <ServerCrash size={32} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <div className="text-sm text-[var(--text-primary)] font-medium mb-2">System Not Supported</div>
          <div className="text-xs text-[var(--text-muted)] mb-4 max-w-md mx-auto">
            {installCheck?.reason || 'Docker installation is not supported on this system.'}
          </div>
          {installCheck && (
            <div className="text-[10px] text-[var(--text-muted)]">
              Detected: {installCheck.os} {installCheck.os_version}
            </div>
          )}
        </div>
      </ToolModal>
    );
  }

  // ===================================================================
  // RENDER - Not installed
  // ===================================================================

  if (view === 'not_installed') {
    return (
      <ToolModal title="Docker Manager" icon={<Container size={18} />}>
        <div className="max-w-lg mx-auto py-8">
          <div className="text-center mb-6">
            <Container size={36} className="mx-auto mb-3 text-[var(--accent)]" />
            <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">Install Docker Engine</div>
            <div className="text-xs text-[var(--text-muted)]">
              Docker is not installed on this server. Click below to install using the official installer.
            </div>
          </div>

          {installCheck && (
            <div className="mb-4 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">OS</span>
                <span className="text-[var(--text-primary)] font-mono">{installCheck.os} {installCheck.os_version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">curl</span>
                <span className={installCheck.curl_available ? 'text-green-400' : 'text-red-400'}>
                  {installCheck.curl_available ? 'Available' : 'Not found'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">systemd</span>
                <span className={installCheck.has_systemd ? 'text-green-400' : 'text-yellow-400'}>
                  {installCheck.has_systemd ? 'Available' : 'Not found'}
                </span>
              </div>
            </div>
          )}

          <div className="mb-4 p-3 rounded bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-400 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div>
              This will install Docker Engine using the official <span className="font-mono">get.docker.com</span> script.
              It requires root/sudo access and may take a few minutes.
            </div>
          </div>

          <button
            onClick={startInstall}
            className="w-full py-2.5 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Download size={15} />
            Install Docker
          </button>
        </div>
      </ToolModal>
    );
  }

  // ===================================================================
  // RENDER - Installing
  // ===================================================================

  if (view === 'installing') {
    return (
      <ToolModal title="Docker Manager" icon={<Container size={18} />}>
        <div className="max-w-2xl mx-auto py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {installStatus === 'running' && <Loader2 size={14} className="animate-spin text-[var(--accent)]" />}
              {installStatus === 'completed' && <CheckCircle size={14} className="text-green-400" />}
              {installStatus === 'failed' && <AlertTriangle size={14} className="text-red-400" />}
              {installStatus === 'killed' && <Ban size={14} className="text-yellow-400" />}
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {installStatus === 'running' ? 'Installing Docker...' :
                 installStatus === 'completed' ? 'Installation Complete' :
                 installStatus === 'failed' ? 'Installation Failed' :
                 'Installation Cancelled'}
              </span>
            </div>

            {installStatus === 'running' && (
              <button
                onClick={() => setShowKillConfirm(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-colors"
              >
                <Skull size={12} />
                Kill
              </button>
            )}

            {(installStatus === 'failed' || installStatus === 'killed') && (
              <button
                onClick={startInstall}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
              >
                <RotateCw size={12} />
                Retry
              </button>
            )}
          </div>

          <div
            ref={installOutputRef}
            className="rounded bg-black border border-[var(--border)] p-3 font-mono text-[11px] text-green-300 overflow-auto leading-relaxed"
            style={{ height: '50vh' }}
          >
            {installOutput.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap">{line}</div>
            ))}
            {installStatus === 'running' && (
              <div className="inline-block w-2 h-4 bg-green-400 animate-pulse ml-0.5" />
            )}
          </div>

          {installStatus === 'completed' && (
            <div className="mt-3 text-center text-xs text-[var(--text-muted)]">
              Transitioning to dashboard...
            </div>
          )}
        </div>

        {/* Kill confirmation dialog */}
        {showKillConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowKillConfirm(false)} />
            <div className="relative bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-5 max-w-sm mx-4 shadow-2xl">
              <div className="text-center">
                <AlertTriangle size={28} className="mx-auto mb-3 text-red-400" />
                <div className="text-sm font-medium text-[var(--text-primary)] mb-2">Kill Installation?</div>
                <div className="text-xs text-[var(--text-muted)] mb-4">
                  This will abort the Docker installation. The system may be left in a partially installed state.
                </div>
                <div className="flex items-center gap-2 justify-center">
                  <button
                    onClick={() => setShowKillConfirm(false)}
                    className="px-4 py-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={killInstall}
                    className="px-4 py-1.5 rounded bg-red-500 text-white text-xs hover:bg-red-600 transition-colors"
                  >
                    Kill Process
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </ToolModal>
    );
  }

  // ===================================================================
  // RENDER - Dashboard
  // ===================================================================

  const totalContainers = (info?.containers_running || 0) + (info?.containers_paused || 0) + (info?.containers_stopped || 0);

  const filteredContainers = containerSearch
    ? containers.filter((c) => {
        const q = containerSearch.toLowerCase();
        return c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.compose_project.toLowerCase().includes(q);
      })
    : containers;

  return (
    <ToolModal title="Docker Manager" icon={<Container size={18} />}>
      {/* Info bar */}
      {info && (
        <div className="mb-3">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <InfoCard label="Version" value={info.version || '--'} />
            <InfoCard label="Running" value={String(info.containers_running)} color="var(--success)" />
            <InfoCard label="Stopped" value={String(info.containers_stopped)} color="var(--text-muted)" />
            <InfoCard label="Images" value={String(info.images_count)} color="var(--accent)" />
            <InfoCard label="Networks" value={String(info.networks_count)} />
            <InfoCard label="Volumes" value={String(info.volumes_count)} />
          </div>

          {/* Expandable detail row */}
          <button
            onClick={() => setShowInfoPanel(!showInfoPanel)}
            className="mt-2 flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {showInfoPanel ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            {showInfoPanel ? 'Hide' : 'Show'} details
          </button>

          {showInfoPanel && (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px]">
              <DetailRow label="API Version" value={info.api_version} />
              <DetailRow label="Storage Driver" value={info.storage_driver} />
              <DetailRow label="Docker Root" value={info.docker_root} />
              <DetailRow label="OS / Arch" value={`${info.os_type} / ${info.architecture}`} />
              <DetailRow label="Daemon" value={info.daemon_running ? 'Running' : 'Stopped'} color={info.daemon_running ? 'var(--success)' : 'var(--danger)'} />
              <DetailRow label="Paused" value={String(info.containers_paused)} />
              {info.compose_installed && (
                <DetailRow label="Compose" value={info.compose_version || 'Installed'} color="var(--accent)" />
              )}
              {info.disk_usage_total && (
                <>
                  <DetailRow label="Disk Total" value={info.disk_usage_total} />
                  <DetailRow label="Disk Images" value={info.disk_usage_images} />
                  <DetailRow label="Disk Containers" value={info.disk_usage_containers} />
                  <DetailRow label="Disk Volumes" value={info.disk_usage_volumes} />
                  <DetailRow label="Disk Build Cache" value={info.disk_usage_buildcache} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabs + search + actions */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
          {([
            { id: 'containers' as TabId, icon: Container, label: 'Containers', count: totalContainers },
            { id: 'images' as TabId, icon: Image, label: 'Images', count: images.length },
            { id: 'networks' as TabId, icon: Network, label: 'Networks', count: networks.length },
            { id: 'volumes' as TabId, icon: HardDrive, label: 'Volumes', count: volumes.length },
            ...(info?.compose_installed ? [{ id: 'compose' as TabId, icon: Layers, label: 'Compose', count: composeProjects.length }] : []),
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <tab.icon size={12} />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="text-[9px] opacity-75">({tab.count})</span>
            </button>
          ))}
        </div>

        {activeTab === 'containers' && (
          <div className="relative flex-1 min-w-[120px] max-w-[220px]">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={containerSearch}
              onChange={(e) => setContainerSearch(e.target.value)}
              placeholder="Filter..."
              className="w-full pl-7 pr-7 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
            {containerSearch && (
              <button onClick={() => setContainerSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={10} />
              </button>
            )}
          </div>
        )}

        <div className="flex-1" />

        <button
          onClick={fetchAll}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
          title="Refresh all"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>

        <button
          onClick={() => setShowUninstallConfirm(true)}
          className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          title="Uninstall Docker"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Tab content */}
      <div className="overflow-auto" style={{ maxHeight: 'calc(80vh - 240px)' }}>
        {/* ===================== CONTAINERS TAB ===================== */}
        {activeTab === 'containers' && (
          <div className="space-y-1">
            {filteredContainers.length === 0 && !loading && (
              <div className="py-8 text-center text-[var(--text-muted)] text-xs">
                {containerSearch ? 'No matching containers' : 'No containers found'}
              </div>
            )}
            {filteredContainers.map((c) => {
              const isRunning = c.state === 'running';
              const isPaused = c.state === 'paused';
              const currentAction = actionLoading?.startsWith(c.id + ':') ? actionLoading.split(':')[1] : null;

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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-[var(--text-primary)] font-mono truncate">{c.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] font-mono">{c.id.slice(0, 12)}</span>
                        {c.compose_project && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium">
                            {c.compose_project}{c.compose_service ? ` / ${c.compose_service}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{c.image}</span>
                        <span>--</span>
                        <span>{c.status}</span>
                        {c.ports && <span className="text-[var(--accent)]">{c.ports}</span>}
                      </div>
                      {/* Inline stats for running containers */}
                      {isRunning && (c.cpu_percent || c.mem_usage) && (
                        <div className="flex items-center gap-3 mt-1 text-[9px] text-[var(--text-muted)]">
                          {c.cpu_percent && (
                            <span className="flex items-center gap-0.5">
                              <Cpu size={9} /> {c.cpu_percent}
                            </span>
                          )}
                          {c.mem_usage && (
                            <span className="flex items-center gap-0.5">
                              <MemoryStick size={9} /> {c.mem_usage}{c.mem_limit ? ` / ${c.mem_limit}` : ''}
                            </span>
                          )}
                          {c.net_io && (
                            <span className="flex items-center gap-0.5">
                              <ArrowUpDown size={9} /> {c.net_io}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ActionBtn icon={<FileText size={11} />} label="Logs" onClick={() => startLogStream(c.id)} loading={false} color={logsOpen === c.id ? 'var(--accent)' : 'var(--text-muted)'} />
                      <ActionBtn icon={<Eye size={11} />} label="Inspect" onClick={() => inspectContainer(c.id)} loading={inspectLoading && inspectOpen === c.id} color={inspectOpen === c.id ? 'var(--accent)' : 'var(--text-muted)'} />
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
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium text-[var(--text-secondary)]">Logs -- {c.name}</span>
                          {logsStreaming && (
                            <span className="flex items-center gap-1 text-[9px] text-green-400">
                              <Activity size={9} className="animate-pulse" /> Live
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {logsStreaming ? (
                            <button
                              onClick={stopLogStream}
                              className="px-2 py-0.5 rounded text-[9px] bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                              Stop
                            </button>
                          ) : (
                            <button
                              onClick={() => startLogStream(c.id)}
                              className="px-2 py-0.5 rounded text-[9px] bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                            >
                              Resume
                            </button>
                          )}
                          <button onClick={closeLogsPanel} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                      <div
                        ref={logsRef}
                        className="p-3 font-mono text-[10px] text-[var(--text-secondary)] overflow-auto whitespace-pre-wrap leading-relaxed"
                        style={{ maxHeight: '250px' }}
                      >
                        {logsContent.length === 0 ? (
                          <span className="text-[var(--text-muted)]">
                            {logsStreaming ? 'Waiting for logs...' : 'No logs available'}
                          </span>
                        ) : (
                          logsContent.map((line, i) => <div key={i}>{line}</div>)
                        )}
                      </div>
                    </div>
                  )}

                  {/* Inspect panel */}
                  {inspectOpen === c.id && (
                    <div className="mt-1 mb-2 ml-5 rounded bg-[var(--bg-primary)] border border-[var(--border)] overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                        <span className="text-[10px] font-medium text-[var(--text-secondary)]">Inspect -- {c.name}</span>
                        <button onClick={() => setInspectOpen(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                          <X size={12} />
                        </button>
                      </div>
                      {inspectLoading ? (
                        <div className="p-4 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
                          <Loader2 size={12} className="animate-spin" />
                          Loading...
                        </div>
                      ) : (
                        <pre className="p-3 text-[10px] font-mono text-[var(--text-secondary)] overflow-auto whitespace-pre-wrap" style={{ maxHeight: '300px' }}>
                          {inspectData}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ===================== IMAGES TAB ===================== */}
        {activeTab === 'images' && (
          <div>
            {/* Pull image form */}
            <div className="mb-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Download size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={pullImageName}
                  onChange={(e) => setPullImageName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && pullStatus !== 'running' && startPull()}
                  placeholder="Image name (e.g. nginx:latest)"
                  className="w-full pl-7 pr-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <button
                onClick={startPull}
                disabled={pullStatus === 'running' || !pullImageName.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
              >
                {pullStatus === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                Pull
              </button>
            </div>

            {/* Pull output */}
            {pullOutput.length > 0 && (
              <div className="mb-3 rounded bg-black border border-[var(--border)] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-[var(--text-secondary)]">Pull Output</span>
                    {pullStatus === 'running' && <Loader2 size={10} className="animate-spin text-[var(--accent)]" />}
                    {pullStatus === 'completed' && <CheckCircle size={10} className="text-green-400" />}
                    {pullStatus === 'failed' && <AlertTriangle size={10} className="text-red-400" />}
                  </div>
                  <button onClick={() => { setPullOutput([]); setPullStatus('idle'); }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <X size={12} />
                  </button>
                </div>
                <div ref={pullOutputRef} className="p-2 font-mono text-[10px] text-green-300 overflow-auto" style={{ maxHeight: '150px' }}>
                  {pullOutput.map((line, i) => <div key={i} className="whitespace-pre-wrap">{line}</div>)}
                </div>
              </div>
            )}

            {/* Images table */}
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

        {/* ===================== NETWORKS TAB ===================== */}
        {activeTab === 'networks' && (
          <div>
            <div className="mb-3 flex justify-end">
              <button
                onClick={() => setShowNetworkCreate(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
              >
                <Plus size={12} />
                Create Network
              </button>
            </div>

            {networks.length === 0 && !loading ? (
              <div className="py-8 text-center text-[var(--text-muted)] text-xs">No networks found</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="py-2 px-2 font-medium">Name</th>
                    <th className="py-2 px-2 font-medium">Driver</th>
                    <th className="py-2 px-2 font-medium">Scope</th>
                    <th className="py-2 px-2 font-medium">Subnet</th>
                    <th className="py-2 px-2 font-medium">Gateway</th>
                    <th className="py-2 px-2 font-medium">Containers</th>
                    <th className="py-2 px-2 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {networks.map((net) => {
                    const isBuiltin = ['bridge', 'host', 'none'].includes(net.name);
                    return (
                      <tr key={net.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-secondary)] transition-colors group">
                        <td className="py-1.5 px-2 font-mono font-medium text-[var(--text-primary)]">
                          <div className="flex items-center gap-1.5">
                            {net.name}
                            {net.internal && <span className="text-[8px] px-1 py-0.5 rounded bg-yellow-500/15 text-yellow-400">internal</span>}
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-[var(--text-secondary)]">{net.driver}</td>
                        <td className="py-1.5 px-2 text-[var(--text-muted)]">{net.scope}</td>
                        <td className="py-1.5 px-2 font-mono text-[var(--text-muted)] text-[10px]">{net.subnet || '--'}</td>
                        <td className="py-1.5 px-2 font-mono text-[var(--text-muted)] text-[10px]">{net.gateway || '--'}</td>
                        <td className="py-1.5 px-2 text-[var(--text-secondary)]">{net.containers_count}</td>
                        <td className="py-1.5 px-2">
                          {!isBuiltin && (
                            <button
                              onClick={() => deleteNetwork(net.id, net.name)}
                              disabled={actionLoading === `net:${net.id}`}
                              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                              title="Delete network"
                            >
                              {actionLoading === `net:${net.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ===================== VOLUMES TAB ===================== */}
        {activeTab === 'volumes' && (
          <div>
            <div className="mb-3 flex justify-end">
              <button
                onClick={() => setShowVolumeCreate(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
              >
                <Plus size={12} />
                Create Volume
              </button>
            </div>

            {volumes.length === 0 && !loading ? (
              <div className="py-8 text-center text-[var(--text-muted)] text-xs">No volumes found</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="py-2 px-2 font-medium">Name</th>
                    <th className="py-2 px-2 font-medium">Driver</th>
                    <th className="py-2 px-2 font-medium">Mountpoint</th>
                    <th className="py-2 px-2 font-medium">Size</th>
                    <th className="py-2 px-2 font-medium">Created</th>
                    <th className="py-2 px-2 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {volumes.map((vol) => (
                    <tr key={vol.name} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-secondary)] transition-colors group">
                      <td className="py-1.5 px-2 font-mono font-medium text-[var(--text-primary)] truncate max-w-[200px]">{vol.name}</td>
                      <td className="py-1.5 px-2 text-[var(--text-secondary)]">{vol.driver}</td>
                      <td className="py-1.5 px-2 font-mono text-[var(--text-muted)] text-[10px] truncate max-w-[250px]">{vol.mountpoint}</td>
                      <td className="py-1.5 px-2 text-[var(--text-secondary)]">{vol.size || '--'}</td>
                      <td className="py-1.5 px-2 text-[var(--text-muted)]">{vol.created}</td>
                      <td className="py-1.5 px-2">
                        <button
                          onClick={() => deleteVolume(vol.name)}
                          disabled={actionLoading === `vol:${vol.name}`}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                          title="Delete volume"
                        >
                          {actionLoading === `vol:${vol.name}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ===================== COMPOSE TAB ===================== */}
        {activeTab === 'compose' && (
          <div className="space-y-2">
            {composeProjects.length === 0 && !loading ? (
              <div className="py-8 text-center text-[var(--text-muted)] text-xs">
                No Compose projects found. Projects are discovered via <code className="font-mono text-[var(--accent)]">docker compose ls</code>.
              </div>
            ) : (
              composeProjects.map((project) => {
                const isComposeActionLoading = (action: string) => actionLoading === `compose:${project.name}:${action}`;
                return (
                  <div key={project.name} className="rounded bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Layers size={14} className="text-[var(--accent)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-[var(--text-primary)]">{project.name}</div>
                        <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                          {project.config_files || 'Unknown config'}
                          <span className="ml-2">
                            {project.running_count}/{project.total_count} running
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <ActionBtn icon={<Play size={11} />} label="Up" onClick={() => composeAction(project, 'up')} loading={isComposeActionLoading('up')} color="var(--success)" />
                        <ActionBtn icon={<Square size={11} />} label="Down" onClick={() => composeAction(project, 'down')} loading={isComposeActionLoading('down')} color="var(--danger)" />
                        <ActionBtn icon={<RotateCw size={11} />} label="Restart" onClick={() => composeAction(project, 'restart')} loading={isComposeActionLoading('restart')} color="var(--accent)" />
                        <ActionBtn icon={<Download size={11} />} label="Pull" onClick={() => composeAction(project, 'pull')} loading={isComposeActionLoading('pull')} color="var(--text-secondary)" />
                        {project.config_files && (
                          <ActionBtn
                            icon={<FileText size={11} />}
                            label="Edit"
                            onClick={() => openComposeFile(project.config_files)}
                            loading={composeFileLoading && composeFileOpen === project.config_files}
                            color={composeFileOpen === project.config_files ? 'var(--accent)' : 'var(--text-muted)'}
                          />
                        )}
                      </div>
                    </div>

                    {/* Compose file editor */}
                    {composeFileOpen === project.config_files && (
                      <div className="border-t border-[var(--border)]">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-tertiary)]">
                          <span className="text-[10px] font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
                            <FolderOpen size={10} /> {project.config_files}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={saveComposeFile}
                              disabled={composeFileSaving}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
                            >
                              {composeFileSaving ? <Loader2 size={9} className="animate-spin" /> : <Save size={9} />}
                              Save
                            </button>
                            <button onClick={() => setComposeFileOpen(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                        {composeFileLoading ? (
                          <div className="p-4 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
                            <Loader2 size={12} className="animate-spin" />
                            Loading...
                          </div>
                        ) : (
                          <textarea
                            value={composeFileContent}
                            onChange={(e) => setComposeFileContent(e.target.value)}
                            className="w-full p-3 bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono text-[11px] leading-relaxed resize-none border-0 focus:outline-none"
                            style={{ minHeight: '300px' }}
                            spellCheck={false}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ===================== NETWORK CREATE DIALOG ===================== */}
      {showNetworkCreate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowNetworkCreate(false)} />
          <div className="relative bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-5 max-w-sm mx-4 shadow-2xl w-full">
            <div className="text-sm font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <Network size={16} className="text-[var(--accent)]" />
              Create Network
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-medium text-[var(--text-muted)] block mb-1">Name</label>
                <input
                  type="text"
                  value={newNetworkName}
                  onChange={(e) => setNewNetworkName(e.target.value)}
                  placeholder="my-network"
                  className="w-full px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-[var(--text-muted)] block mb-1">Driver</label>
                <select
                  value={newNetworkDriver}
                  onChange={(e) => setNewNetworkDriver(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="bridge">bridge</option>
                  <option value="overlay">overlay</option>
                  <option value="macvlan">macvlan</option>
                  <option value="ipvlan">ipvlan</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-[var(--text-muted)] block mb-1">Subnet (optional)</label>
                <input
                  type="text"
                  value={newNetworkSubnet}
                  onChange={(e) => setNewNetworkSubnet(e.target.value)}
                  placeholder="172.20.0.0/16"
                  className="w-full px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end mt-4">
              <button
                onClick={() => setShowNetworkCreate(false)}
                className="px-4 py-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createNetwork}
                disabled={!newNetworkName.trim() || actionLoading === 'create-network'}
                className="px-4 py-1.5 rounded bg-[var(--accent)] text-white text-xs hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
              >
                {actionLoading === 'create-network' ? <Loader2 size={12} className="animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== VOLUME CREATE DIALOG ===================== */}
      {showVolumeCreate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowVolumeCreate(false)} />
          <div className="relative bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-5 max-w-sm mx-4 shadow-2xl w-full">
            <div className="text-sm font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <HardDrive size={16} className="text-[var(--accent)]" />
              Create Volume
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-medium text-[var(--text-muted)] block mb-1">Name</label>
                <input
                  type="text"
                  value={newVolumeName}
                  onChange={(e) => setNewVolumeName(e.target.value)}
                  placeholder="my-volume"
                  className="w-full px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-[var(--text-muted)] block mb-1">Driver</label>
                <select
                  value={newVolumeDriver}
                  onChange={(e) => setNewVolumeDriver(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="local">local</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end mt-4">
              <button
                onClick={() => setShowVolumeCreate(false)}
                className="px-4 py-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createVolume}
                disabled={!newVolumeName.trim() || actionLoading === 'create-volume'}
                className="px-4 py-1.5 rounded bg-[var(--accent)] text-white text-xs hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
              >
                {actionLoading === 'create-volume' ? <Loader2 size={12} className="animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== UNINSTALL DIALOG ===================== */}
      {showUninstallConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowUninstallConfirm(false)} />
          <div className="relative bg-[var(--bg-primary)] border border-red-500/30 rounded-lg p-5 max-w-sm mx-4 shadow-2xl">
            <div className="text-center">
              <Skull size={32} className="mx-auto mb-3 text-red-400" />
              <div className="text-sm font-medium text-[var(--text-primary)] mb-2">Uninstall Docker?</div>
              <div className="text-xs text-[var(--text-muted)] mb-2">
                This will remove Docker Engine from this server.
              </div>
              <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 mb-4 text-left space-y-1">
                <div className="font-medium">WARNING: This action may:</div>
                <div>-- Stop and remove ALL running containers</div>
                <div>-- Delete ALL images, volumes, and networks</div>
                <div>-- Remove Docker configuration files</div>
                <div>-- This CANNOT be undone</div>
              </div>
              <div className="flex items-center gap-2 justify-center">
                <button
                  onClick={() => setShowUninstallConfirm(false)}
                  className="px-4 py-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={uninstallDocker}
                  disabled={uninstallLoading}
                  className="px-4 py-1.5 rounded bg-red-500 text-white text-xs hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {uninstallLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Uninstall
                </button>
              </div>
            </div>
          </div>
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

const DetailRow: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div className="flex justify-between py-0.5">
    <span className="text-[var(--text-muted)]">{label}</span>
    <span className="font-mono text-right truncate ml-2" style={{ color: color || 'var(--text-secondary)' }}>{value || '--'}</span>
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
