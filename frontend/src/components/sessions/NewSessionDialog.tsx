import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { X, Terminal, Monitor, Eye, Radio, FolderOpen, Save } from 'lucide-react';
import { useSessionStore } from '@/store/sessionStore';
import { useAuthStore } from '@/store/authStore';
import { encryptIfPresent } from '@/utils/crypto';
import type { Session } from '@/types/session';

type Protocol = 'ssh' | 'rdp' | 'vnc' | 'telnet' | 'ftp';

interface NewSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editSession?: Session;
}

const PROTOCOL_CONFIG: Record<
  Protocol,
  { label: string; icon: React.ReactNode; defaultPort: number }
> = {
  ssh: { label: 'SSH', icon: <Terminal size={14} />, defaultPort: 22 },
  rdp: { label: 'RDP', icon: <Monitor size={14} />, defaultPort: 3389 },
  vnc: { label: 'VNC', icon: <Eye size={14} />, defaultPort: 5900 },
  telnet: { label: 'Telnet', icon: <Radio size={14} />, defaultPort: 23 },
  ftp: { label: 'FTP', icon: <FolderOpen size={14} />, defaultPort: 21 },
};

const AUTH_TYPES = ['password', 'sshKey'] as const;
type AuthType = (typeof AUTH_TYPES)[number];

const RESOLUTIONS = [
  '1920x1080',
  '1600x900',
  '1440x900',
  '1366x768',
  '1280x1024',
  '1280x720',
  '1024x768',
  'Auto',
] as const;

const FTP_SECURITY = ['FTP', 'FTPS'] as const;

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

interface FormState {
  name: string;
  host: string;
  port: number;
  protocol: Protocol;
  username: string;
  password: string;
  sshKey: string;
  authType: AuthType;
  folderId: string;
  color: string | null;
  // RDP-specific
  domain: string;
  resolution: string;
  // FTP-specific
  ftpSecurity: string;
}

function getDefaultState(protocol: Protocol): FormState {
  return {
    name: '',
    host: '',
    port: PROTOCOL_CONFIG[protocol].defaultPort,
    protocol,
    username: '',
    password: '',
    sshKey: '',
    authType: 'password',
    folderId: '',
    color: null,
    domain: '',
    resolution: '1920x1080',
    ftpSecurity: 'FTP',
  };
}

function parseProtocolSettings(session: Session): Record<string, string> {
  if (!session.protocol_settings) return {};
  try {
    return JSON.parse(session.protocol_settings);
  } catch {
    return {};
  }
}

function sessionToFormState(session: Session): FormState {
  const proto = parseProtocolSettings(session);
  return {
    name: session.name,
    host: session.host,
    port: session.port,
    protocol: session.session_type as Protocol,
    username: session.username ?? '',
    password: session.password ?? '',
    sshKey: session.ssh_key ?? '',
    authType: session.ssh_key ? 'sshKey' : 'password',
    folderId: session.folder_id ?? '',
    color: session.color ?? null,
    domain: proto.domain ?? '',
    resolution: proto.resolution ?? '1920x1080',
    ftpSecurity: proto.ftpSecurity ?? 'FTP',
  };
}

export const NewSessionDialog: React.FC<NewSessionDialogProps> = ({
  isOpen,
  onClose,
  editSession,
}) => {
  const { createSession, updateSession, folders } = useSessionStore();
  const [form, setForm] = useState<FormState>(getDefaultState('ssh'));
  const [isSaving, setIsSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      if (editSession) {
        setForm(sessionToFormState(editSession));
      } else {
        setForm(getDefaultState('ssh'));
      }
    }
  }, [isOpen, editSession]);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    // Wait for exit animation to finish
    const timeout = setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 150);
    return () => clearTimeout(timeout);
  }, [onClose]);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleProtocolChange = useCallback(
    (protocol: Protocol) => {
      setForm((prev) => ({
        ...prev,
        protocol,
        port: PROTOCOL_CONFIG[protocol].defaultPort,
      }));
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || !form.host.trim()) return;

    const cryptoKey = useAuthStore.getState().cryptoKey;
    if (!cryptoKey) {
      console.error('No encryption key available — please re-login');
      return;
    }

    setIsSaving(true);
    try {
      // Encrypt credentials client-side before sending to the backend
      const rawPassword = form.password || undefined;
      const rawSshKey = form.authType === 'sshKey' ? form.sshKey : undefined;

      const [encrypted_password, encrypted_ssh_key] = await Promise.all([
        encryptIfPresent(rawPassword, cryptoKey),
        encryptIfPresent(rawSshKey, cryptoKey),
      ]);

      // Build protocol-specific settings as JSON
      const protoSettings: Record<string, string> = {};
      if (form.protocol === 'rdp') {
        if (form.domain) protoSettings.domain = form.domain;
        if (form.resolution) protoSettings.resolution = form.resolution;
      } else if (form.protocol === 'ftp') {
        if (form.ftpSecurity) protoSettings.ftpSecurity = form.ftpSecurity;
      }

      const sessionData = {
        name: form.name.trim(),
        host: form.host.trim(),
        port: form.port,
        session_type: form.protocol,
        username: form.username || undefined,
        encrypted_password,
        encrypted_ssh_key,
        folder_id: form.folderId || undefined,
        color: form.color ?? undefined,
        protocol_settings: Object.keys(protoSettings).length > 0
          ? JSON.stringify(protoSettings)
          : undefined,
      };

      if (editSession) {
        await updateSession(editSession.id, sessionData);
      } else {
        await createSession(sessionData);
      }
      onClose();
    } catch (err) {
      console.error('Failed to save session:', err);
    } finally {
      setIsSaving(false);
    }
  }, [form, editSession, createSession, updateSession, onClose]);

  const isValid = useMemo(() => {
    return form.name.trim().length > 0 && form.host.trim().length > 0;
  }, [form.name, form.host]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && isValid) handleSave();
    },
    [handleClose, handleSave, isValid]
  );

  if (!isOpen && !isClosing) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-150"
        style={{ opacity: isClosing ? 0 : 1 }}
        onClick={handleClose}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="relative w-full max-w-lg mx-4 bg-[var(--bg-modal)] border border-[var(--border-primary)] rounded-xl shadow-2xl overflow-hidden transition-all duration-150"
        style={{
          opacity: isClosing ? 0 : 1,
          transform: isClosing ? 'scale(0.95)' : 'scale(1)',
          animation: !isClosing ? 'scaleIn 200ms ease-out forwards' : undefined,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {editSession ? 'Edit Session' : 'New Session'}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors active:scale-90"
          >
            <X size={16} />
          </button>
        </div>

        {/* Protocol selector */}
        <div className="flex border-b border-[var(--border-primary)]">
          {(Object.keys(PROTOCOL_CONFIG) as Protocol[]).map((proto) => {
            const config = PROTOCOL_CONFIG[proto];
            const isActive = form.protocol === proto;
            return (
              <button
                key={proto}
                onClick={() => handleProtocolChange(proto)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                  isActive
                    ? 'text-[var(--accent)] border-[var(--accent)] bg-[var(--accent-muted)]'
                    : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {config.icon}
                {config.label}
              </button>
            );
          })}
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Common fields */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name" className="col-span-2">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="My Server"
                className="form-input"
                autoFocus
              />
            </FormField>

            <FormField label="Host">
              <input
                type="text"
                value={form.host}
                onChange={(e) => setField('host', e.target.value)}
                placeholder="192.168.1.1"
                className="form-input"
              />
            </FormField>

            <FormField label="Port">
              <input
                type="number"
                value={form.port}
                onChange={(e) => setField('port', parseInt(e.target.value, 10) || 0)}
                className="form-input"
              />
            </FormField>
          </div>

          {/* Folder — common to all protocols */}
          {folders.length > 0 && (
            <FormField label="Folder">
              <select
                value={form.folderId}
                onChange={(e) => setField('folderId', e.target.value)}
                className="form-input"
              >
                <option value="">No Folder</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          {/* SSH-specific */}
          {form.protocol === 'ssh' && (
            <>
              <FormField label="Username">
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setField('username', e.target.value)}
                  placeholder="root"
                  className="form-input"
                />
              </FormField>

              <FormField label="Authentication">
                <div className="flex gap-2 mb-2">
                  {AUTH_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => setField('authType', type)}
                      className={`px-3 py-1.5 text-xs rounded-md border transition-colors active:scale-95 ${
                        form.authType === type
                          ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-muted)]'
                          : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      {type === 'password' ? 'Password' : 'SSH Key'}
                    </button>
                  ))}
                </div>
                {form.authType === 'password' ? (
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setField('password', e.target.value)}
                    placeholder="Password"
                    className="form-input"
                  />
                ) : (
                  <textarea
                    value={form.sshKey}
                    onChange={(e) => setField('sshKey', e.target.value)}
                    placeholder="Paste your private key here..."
                    rows={4}
                    className="form-input resize-none font-mono text-[11px]"
                  />
                )}
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Color">
                  <div className="flex items-center gap-1.5 pt-1">
                    {SESSION_COLORS.map((color, i) => (
                      <button
                        key={i}
                        onClick={() => setField('color', color)}
                        className={`w-5 h-5 rounded-full border-2 transition-transform active:scale-90 ${
                          form.color === color
                            ? 'border-white scale-110'
                            : 'border-transparent hover:scale-110'
                        }`}
                        style={{
                          backgroundColor: color ?? 'transparent',
                          ...(color === null
                            ? {
                                border: '2px dashed var(--border-secondary)',
                              }
                            : {}),
                        }}
                        title={color ?? 'None'}
                      />
                    ))}
                  </div>
                </FormField>
              </div>
            </>
          )}

          {/* RDP-specific */}
          {form.protocol === 'rdp' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Username">
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setField('username', e.target.value)}
                    placeholder="Administrator"
                    className="form-input"
                  />
                </FormField>

                <FormField label="Domain">
                  <input
                    type="text"
                    value={form.domain}
                    onChange={(e) => setField('domain', e.target.value)}
                    placeholder="WORKGROUP"
                    className="form-input"
                  />
                </FormField>
              </div>

              <FormField label="Password">
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setField('password', e.target.value)}
                  placeholder="Password"
                  className="form-input"
                />
              </FormField>

              <FormField label="Resolution">
                <select
                  value={form.resolution}
                  onChange={(e) => setField('resolution', e.target.value)}
                  className="form-input"
                >
                  {RESOLUTIONS.map((res) => (
                    <option key={res} value={res}>
                      {res}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          )}

          {/* VNC-specific */}
          {form.protocol === 'vnc' && (
            <FormField label="Password">
              <input
                type="password"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                placeholder="VNC Password"
                className="form-input"
              />
            </FormField>
          )}

          {/* Telnet-specific: no extra fields beyond host/port */}

          {/* FTP-specific */}
          {form.protocol === 'ftp' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Username">
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setField('username', e.target.value)}
                    placeholder="anonymous"
                    className="form-input"
                  />
                </FormField>

                <FormField label="Security">
                  <select
                    value={form.ftpSecurity}
                    onChange={(e) => setField('ftpSecurity', e.target.value)}
                    className="form-input"
                  >
                    {FTP_SECURITY.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <FormField label="Password">
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setField('password', e.target.value)}
                  placeholder="Password"
                  className="form-input"
                />
              </FormField>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-primary)]">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-hover)] transition-colors active:scale-95"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid || isSaving}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md transition-all active:scale-95 ${
              isValid && !isSaving
                ? 'bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]'
                : 'bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-not-allowed'
            }`}
          >
            <Save size={13} />
            {isSaving ? 'Saving...' : editSession ? 'Update' : 'Save'}
          </button>
        </div>
      </div>

      {/* Form input styles injected as a scoped style */}
      <style>{`
        .form-input {
          width: 100%;
          height: 34px;
          padding: 0 10px;
          font-size: 12px;
          color: var(--text-primary);
          background-color: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 6px;
          outline: none;
          transition: border-color 150ms, box-shadow 150ms;
        }
        .form-input:focus {
          border-color: var(--border-focus);
          box-shadow: 0 0 0 2px rgba(0, 229, 255, 0.1);
        }
        .form-input::placeholder {
          color: var(--text-muted);
        }
        textarea.form-input {
          height: auto;
          padding: 8px 10px;
        }
        select.form-input {
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          padding-right: 28px;
        }
      `}</style>
    </div>
  );
};

interface FormFieldProps {
  label: string;
  className?: string;
  children: React.ReactNode;
}

const FormField: React.FC<FormFieldProps> = ({ label, className, children }) => (
  <div className={className}>
    <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1.5">
      {label}
    </label>
    {children}
  </div>
);

export default NewSessionDialog;
