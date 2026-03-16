import React, { useCallback } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';

/**
 * Hotkey definitions for the mobile terminal bar.
 * Each entry maps a display label to the escape sequence sent to the terminal.
 */
const HOTKEYS: { label: string | React.ReactNode; seq: string; title: string }[] = [
  { label: 'Tab', seq: '\t', title: 'Tab' },
  { label: 'Esc', seq: '\x1b', title: 'Escape' },
  { label: 'C-c', seq: '\x03', title: 'Ctrl+C (interrupt)' },
  { label: 'C-d', seq: '\x04', title: 'Ctrl+D (EOF)' },
  { label: 'C-z', seq: '\x1a', title: 'Ctrl+Z (suspend)' },
  { label: 'C-a', seq: '\x01', title: 'Ctrl+A (start of line)' },
  { label: 'C-l', seq: '\x0c', title: 'Ctrl+L (clear)' },
  { label: <ArrowUp size={14} />, seq: '\x1b[A', title: 'Up arrow' },
  { label: <ArrowDown size={14} />, seq: '\x1b[B', title: 'Down arrow' },
  { label: <ArrowLeft size={14} />, seq: '\x1b[D', title: 'Left arrow' },
  { label: <ArrowRight size={14} />, seq: '\x1b[C', title: 'Right arrow' },
];

interface MobileHotkeyBarProps {
  /** Callback to send data to the terminal/WebSocket */
  onSend: (data: string) => void;
}

export const HOTKEY_BAR_HEIGHT = 36;

export const MobileHotkeyBar: React.FC<MobileHotkeyBarProps> = ({ onSend }) => {
  const handlePress = useCallback(
    (seq: string) => {
      onSend(seq);
    },
    [onSend],
  );

  return (
    <div
      className="flex items-center gap-1 px-1.5 overflow-x-auto no-scrollbar shrink-0 select-none"
      style={{
        height: HOTKEY_BAR_HEIGHT,
        minHeight: HOTKEY_BAR_HEIGHT,
        backgroundColor: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {HOTKEYS.map((hk, i) => (
        <button
          key={i}
          onPointerDown={(e) => {
            e.preventDefault(); // prevent focus steal from terminal
            handlePress(hk.seq);
          }}
          title={hk.title}
          className="flex items-center justify-center shrink-0 rounded px-2 py-1 text-[11px] font-medium transition-colors active:bg-[var(--accent-muted)] active:text-[var(--accent)]"
          style={{
            minWidth: 32,
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
        >
          {hk.label}
        </button>
      ))}
    </div>
  );
};

export default MobileHotkeyBar;
