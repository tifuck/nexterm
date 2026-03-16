import React from 'react';
import { Link, Plus, X } from 'lucide-react';

interface ActiveConnection {
  connection_id: string;
  created_at: string;
}

interface AttachSessionDialogProps {
  isOpen: boolean;
  sessionName: string;
  connections: ActiveConnection[];
  onAttach: (connectionId: string) => void;
  onNewConnection: () => void;
  onCancel: () => void;
}

/**
 * Modal dialog shown when opening a saved session that already has an
 * active SSH connection. Lets the user choose to attach to the existing
 * connection (sharing the PTY) or start a new independent connection.
 */
const AttachSessionDialog: React.FC<AttachSessionDialogProps> = ({
  isOpen,
  sessionName,
  connections,
  onAttach,
  onNewConnection,
  onCancel,
}) => {
  if (!isOpen) return null;

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-md mx-4 animate-slide-down">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Active Session Found
          </h2>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{sessionName}</span>{' '}
            has {connections.length} active connection{connections.length > 1 ? 's' : ''}.
            You can attach to share the terminal or start a new connection.
          </p>

          {/* Active connections list */}
          <div className="space-y-2">
            {connections.map((conn) => (
              <button
                key={conn.connection_id}
                onClick={() => onAttach(conn.connection_id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors text-left group"
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-[var(--bg-tertiary)] group-hover:bg-[var(--accent-muted)] transition-colors">
                  <Link size={14} className="text-[var(--accent)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Attach to session
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    Connected since {formatTime(conn.created_at)}
                  </div>
                </div>
                <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Active" />
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onNewConnection}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Plus size={14} />
            New Connection
          </button>
        </div>
      </div>
    </div>
  );
};

export default AttachSessionDialog;
