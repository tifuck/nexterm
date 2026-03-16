import React from 'react';
import { RefreshCw } from 'lucide-react';

interface ReconnectOverlayProps {
  reason: string;
  onReconnect: () => void;
  isReconnecting: boolean;
}

/**
 * Overlay shown at the bottom of the terminal when an SSH connection is lost.
 * Provides a reconnect button to re-establish the session.
 */
export const ReconnectOverlay: React.FC<ReconnectOverlayProps> = ({
  reason,
  onReconnect,
  isReconnecting,
}) => {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] shadow-lg backdrop-blur-sm">
      <span className="text-sm text-[var(--text-secondary)] max-w-[300px] truncate">
        {reason}
      </span>
      <button
        onClick={onReconnect}
        disabled={isReconnecting}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          isReconnecting
            ? 'bg-[var(--accent-muted)] text-[var(--accent)] cursor-wait'
            : 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] active:scale-95'
        }`}
      >
        <RefreshCw size={14} className={isReconnecting ? 'animate-spin' : ''} />
        {isReconnecting ? 'Reconnecting...' : 'Reconnect'}
      </button>
    </div>
  );
};
