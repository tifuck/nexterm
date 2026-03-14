import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Terminal,
  Monitor,
  Eye,
  Globe,
  HardDrive,
  Clock,
  Zap,
  Inbox,
  X,
  Trash2,
  ChevronDown,
  ChevronRight,
  Key,
} from 'lucide-react';
import { useTabStore } from '@/store/tabStore';
import { useSessionStore } from '@/store/sessionStore';
import { useAuthStore } from '@/store/authStore';
import { useToastStore } from '@/store/toastStore';
import { encryptIfPresent } from '@/utils/crypto';
import type { Session } from '@/types/session';
import { PROTOCOL_COLORS, getProtocolColor } from '@/utils/protocolColors';
import type { Protocol } from '@/utils/protocolColors';
import { useConfigStore } from '@/store/configStore';

const SESSION_COLORS = [
  '#00e5ff',
  '#3fb950',
  '#f0b429',
  '#f85149',
  '#d2a8ff',
  '#ff7b72',
  '#79c0ff',
  '#ffa657',
  null,
] as const;

const protocols: { value: Protocol; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'ssh', label: 'SSH', icon: <Terminal size={14} />, color: PROTOCOL_COLORS.ssh },
  { value: 'rdp', label: 'RDP', icon: <Monitor size={14} />, color: PROTOCOL_COLORS.rdp },
  { value: 'vnc', label: 'VNC', icon: <Eye size={14} />, color: PROTOCOL_COLORS.vnc },
  { value: 'telnet', label: 'Telnet', icon: <Globe size={14} />, color: PROTOCOL_COLORS.telnet },
  { value: 'ftp', label: 'FTP', icon: <HardDrive size={14} />, color: PROTOCOL_COLORS.ftp },
];

function timeAgo(dateStr?: string): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(dateStr).toLocaleDateString();
}

const HomeTab: React.FC = () => {
  const addTab = useTabStore((s) => s.addTab);
  const appName = useConfigStore((s) => s.appName);
  const { sessions, folders, fetchSessions, fetchFolders, createSession, deleteSession } = useSessionStore();
  const addToast = useToastStore((s) => s.addToast);
  const [protocol, setProtocol] = useState<Protocol>('ssh');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sshKey, setSshKey] = useState('');
  const [authType, setAuthType] = useState<'password' | 'sshKey'>('password');
  const [folderId, setFolderId] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [autoSave, setAutoSave] = useState(true);

  useEffect(() => {
    fetchSessions().catch(() => {});
    fetchFolders().catch(() => {});
  }, [fetchSessions, fetchFolders]);

  const recentSessions = useMemo(() => {
    return [...sessions]
      .sort((a, b) => {
        const aTime = a.last_connected ? new Date(a.last_connected).getTime() : new Date(a.created_at).getTime();
        const bTime = b.last_connected ? new Date(b.last_connected).getTime() : new Date(b.created_at).getTime();
        return bTime - aTime;
      })
      .slice(0, 6);
  }, [sessions]);

  const defaultPorts: Record<Protocol, string> = {
    ssh: '22',
    rdp: '3389',
    vnc: '5900',
    telnet: '23',
    ftp: '21',
  };

  const handleConnect = async () => {
    if (!host) return;
    const resolvedPort = Number(port || defaultPorts[protocol]);
    const title = `${username ? username + '@' : ''}${host}`;
    const isSSH = protocol === 'ssh';
    const effectiveSshKey = isSSH && authType === 'sshKey' ? sshKey : undefined;
    const effectivePassword = isSSH && authType === 'sshKey' ? undefined : password;

    let sessionId: string | undefined;
    if (autoSave) {
      try {
        // Encrypt credentials client-side before saving
        const cryptoKey = useAuthStore.getState().cryptoKey;
        let encrypted_password: string | undefined;
        let encrypted_ssh_key: string | undefined;

        if (cryptoKey) {
          [encrypted_password, encrypted_ssh_key] = await Promise.all([
            encryptIfPresent(effectivePassword || undefined, cryptoKey),
            encryptIfPresent(effectiveSshKey || undefined, cryptoKey),
          ]);
        }

        const saved = await createSession({
          name: title,
          session_type: protocol,
          host,
          port: resolvedPort,
          username: username || undefined,
          ...(cryptoKey
            ? { encrypted_password, encrypted_ssh_key }
            : { password: effectivePassword || undefined }),
          ...(isSSH && folderId ? { folder_id: folderId } : {}),
          ...(isSSH && color ? { color } : {}),
        } as Partial<Session>);
        sessionId = saved.id;
        addToast('Session saved', 'success');
      } catch (err) {
        console.error('Auto-save failed:', err);
        addToast('Failed to save session', 'error');
      }
    }

    addTab({
      id: sessionId ? `session-${sessionId}-${Date.now()}` : `quick-${protocol}-${Date.now()}`,
      title,
      type: protocol,
      sessionId,
      isConnected: false,
      meta: {
        host,
        port: resolvedPort,
        username,
        password: effectivePassword,
        sshKey: effectiveSshKey,
      },
    });
    setHost('');
    setPort('');
    setUsername('');
    setPassword('');
    setSshKey('');
    setAuthType('password');
    setFolderId('');
    setColor(null);
    setShowAdvanced(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConnect();
  };

  const handleDeleteRecent = useCallback(async (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    try {
      await deleteSession(session.id);
      addToast('Session removed', 'success');
    } catch {
      addToast('Failed to remove session', 'error');
    }
  }, [deleteSession, addToast]);

  const handleClearAllRecent = useCallback(async () => {
    try {
      for (const session of recentSessions) {
        await deleteSession(session.id);
      }
      addToast('All recent sessions cleared', 'success');
    } catch {
      addToast('Failed to clear sessions', 'error');
    }
  }, [recentSessions, deleteSession, addToast]);

  return (
    <div className="flex flex-col items-center h-full overflow-y-auto py-10 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8 animate-fade-in">
        <div className="p-2.5 rounded-xl bg-[var(--accent-muted)]">
          <Zap size={28} className="text-[var(--accent)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">{appName}</h1>
          <p className="text-sm text-[var(--text-muted)]">Remote connection manager</p>
        </div>
      </div>

      {/* Quick Connect */}
      <div className="w-full max-w-xl bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-5 mb-8 animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Connect
          </h2>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-[11px] text-[var(--text-muted)]">Auto-save</span>
            <button
              role="switch"
              aria-checked={autoSave}
              onClick={() => setAutoSave((v) => !v)}
              className={`
                relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-200
                ${autoSave ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)] border border-[var(--border)]'}
              `}
            >
              <span
                className={`
                  inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform duration-200
                  ${autoSave ? 'translate-x-3.5' : 'translate-x-0.5'}
                `}
              />
            </button>
          </label>
        </div>

        {/* Protocol selector */}
        <div className="flex gap-1.5 mb-4">
          {protocols.map((p) => (
            <button
              key={p.value}
              onClick={() => {
                setProtocol(p.value);
                setPort('');
              }}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all duration-150
                ${
                  protocol === p.value
                    ? 'bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent)] scale-[1.02]'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] hover:border-[var(--text-muted)]'
                }
              `}
            >
              <span style={{ color: p.color }}>{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-[1fr_80px] gap-2 mb-3">
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Hostname or IP address"
            className="px-3 py-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
          />
          <input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={defaultPorts[protocol]}
            className="px-3 py-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Username"
            className="px-3 py-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
          />
          {protocol === 'ssh' ? (
            <div className="flex gap-1.5">
              <button
                onClick={() => setAuthType('password')}
                className={`flex-1 px-2 py-2 rounded text-xs font-medium border transition-colors ${
                  authType === 'password'
                    ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-muted)]'
                    : 'border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-tertiary)] hover:border-[var(--text-muted)]'
                }`}
              >
                Password
              </button>
              <button
                onClick={() => setAuthType('sshKey')}
                className={`flex-1 px-2 py-2 rounded text-xs font-medium border transition-colors flex items-center justify-center gap-1 ${
                  authType === 'sshKey'
                    ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-muted)]'
                    : 'border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-tertiary)] hover:border-[var(--text-muted)]'
                }`}
              >
                <Key size={12} />
                SSH Key
              </button>
            </div>
          ) : (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Password"
              className="px-3 py-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
            />
          )}
        </div>

        {/* SSH authentication field */}
        {protocol === 'ssh' && (
          <div className="mb-3">
            {authType === 'password' ? (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Password"
                className="w-full px-3 py-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
              />
            ) : (
              <textarea
                value={sshKey}
                onChange={(e) => setSshKey(e.target.value)}
                placeholder="Paste your private key here..."
                rows={4}
                className="w-full px-3 py-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors resize-none"
              />
            )}
          </div>
        )}

        {/* SSH advanced options: folder & color (only when auto-save is on) */}
        {protocol === 'ssh' && autoSave && (
          <div className="mb-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors mb-2"
            >
              {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Folder & Color
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Folder</label>
                  <select
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors appearance-none cursor-pointer"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 8px center',
                      paddingRight: '24px',
                    }}
                  >
                    <option value="">No Folder</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Color</label>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    {SESSION_COLORS.map((c, i) => (
                      <button
                        key={i}
                        onClick={() => setColor(c)}
                        className={`w-5 h-5 rounded-full border-2 transition-transform active:scale-90 ${
                          color === c
                            ? 'border-white scale-110'
                            : 'border-transparent hover:scale-110'
                        }`}
                        style={{
                          backgroundColor: c ?? 'transparent',
                          ...(c === null
                            ? { border: '2px dashed var(--border)' }
                            : {}),
                        }}
                        title={c ?? 'None'}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Connect button - add top margin only when no advanced section precedes it */}
        {!(protocol === 'ssh' && autoSave) && <div className="mb-1" />}
        <button
          onClick={handleConnect}
          disabled={!host}
          className="w-full py-2 rounded bg-[var(--accent)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-[var(--accent-contrast)] transition-all active:scale-[0.98]"
        >
          Connect
        </button>
      </div>

      {/* Recent Sessions */}
      <div className="w-full max-w-xl animate-fade-in">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Clock size={14} className="text-[var(--text-muted)]" />
            Recent Sessions
          </h2>
          {recentSessions.length > 0 && (
            <button
              onClick={handleClearAllRecent}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)] rounded hover:bg-[var(--bg-tertiary)] transition-colors"
              title="Clear all recent sessions"
            >
              <Trash2 size={11} />
              Clear all
            </button>
          )}
        </div>

        {recentSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Inbox size={28} className="text-[var(--text-muted)] mb-2" />
            <p className="text-xs text-[var(--text-secondary)]">No sessions yet</p>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Create a session from the sidebar or use Quick Connect above
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {recentSessions.map((session) => (
              <button
                key={session.id}
                onClick={() =>
                  addTab({
                    id: `recent-${session.id}-${Date.now()}`,
                    title: session.name,
                    type: session.session_type,
                    sessionId: session.id,
                    isConnected: false,
                    meta: {
                      host: session.host,
                      port: session.port,
                      username: session.username,
                    },
                  })
                }
                className="relative flex flex-col gap-1 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)] transition-all duration-150 text-left group hover:scale-[1.01]"
              >
                {/* Delete button */}
                <span
                  onClick={(e) => handleDeleteRecent(e, session)}
                  className="absolute top-1.5 right-1.5 p-0.5 rounded opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-tertiary)] transition-all"
                  title="Remove session"
                >
                  <X size={12} />
                </span>

                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: getProtocolColor(session.session_type) }}
                  />
                  <span className="text-xs font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors">
                    {session.name}
                  </span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)] truncate">{session.host}</span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {timeAgo(session.last_connected)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HomeTab;
