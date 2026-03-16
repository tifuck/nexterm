import React from 'react';
import { Square, Columns, Rows, LayoutGrid } from 'lucide-react';
import { useSplitStore, type SplitLayout } from '@/store/splitStore';

interface SplitLayoutMenuProps {
  onClose: () => void;
}

const layouts: { id: SplitLayout; label: string; icon: React.ReactNode }[] = [
  { id: 'single', label: 'Single', icon: <Square size={16} /> },
  { id: 'horizontal', label: 'Side by Side', icon: <Columns size={16} /> },
  { id: 'vertical', label: 'Top / Bottom', icon: <Rows size={16} /> },
  { id: 'quad', label: 'Quad', icon: <LayoutGrid size={16} /> },
];

/**
 * Dropdown menu for selecting the split-pane layout.
 * Appears below the LayoutGrid button in the TopBar.
 */
const SplitLayoutMenu: React.FC<SplitLayoutMenuProps> = ({ onClose }) => {
  const currentLayout = useSplitStore((s) => s.layout);
  const setLayout = useSplitStore((s) => s.setLayout);

  const handleSelect = (layout: SplitLayout) => {
    setLayout(layout);
    onClose();
  };

  return (
    <div className="absolute right-0 top-9 w-44 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md shadow-xl z-50 py-1 animate-slide-down">
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Layout
      </div>
      {layouts.map(({ id, label, icon }) => (
        <button
          key={id}
          onClick={() => handleSelect(id)}
          className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors ${
            currentLayout === id
              ? 'text-[var(--accent)] bg-[var(--accent-muted)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
};

export default SplitLayoutMenu;
