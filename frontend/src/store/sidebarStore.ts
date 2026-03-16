import { create } from 'zustand';

type SidebarPanel = 'sessions' | 'sftp';

interface SidebarState {
  isOpen: boolean;
  width: number;
  activePanel: SidebarPanel;
  searchQuery: string;
  _wasOpenBeforeEditor: boolean;
  toggle: () => void;
  setWidth: (n: number) => void;
  setActivePanel: (p: SidebarPanel) => void;
  setSearchQuery: (s: string) => void;
  collapseForEditor: () => void;
  restoreFromEditor: () => void;
}

function loadWidth(): number {
  try {
    const stored = localStorage.getItem('nexterm_sidebar_width');
    if (stored !== null) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= 200 && parsed <= 600) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return 280;
}

function loadActivePanel(): SidebarPanel {
  try {
    const stored = localStorage.getItem('nexterm_sidebar_panel');
    if (stored === 'sessions' || stored === 'sftp') {
      return stored;
    }
  } catch {
    // ignore
  }
  return 'sessions';
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isOpen: true,
  width: loadWidth(),
  activePanel: loadActivePanel(),
  searchQuery: '',
  _wasOpenBeforeEditor: false,

  toggle: () => {
    set((state) => ({ isOpen: !state.isOpen }));
  },

  setWidth: (n: number) => {
    const clamped = Math.max(200, Math.min(600, n));
    try {
      localStorage.setItem('nexterm_sidebar_width', String(clamped));
    } catch {
      // ignore
    }
    set({ width: clamped });
  },

  setActivePanel: (p: SidebarPanel) => {
    try {
      localStorage.setItem('nexterm_sidebar_panel', p);
    } catch {
      // ignore
    }
    set({ activePanel: p });
  },

  setSearchQuery: (s: string) => {
    set({ searchQuery: s });
  },

  collapseForEditor: () => {
    set((state) => ({
      _wasOpenBeforeEditor: state.isOpen,
      isOpen: false,
    }));
  },

  restoreFromEditor: () => {
    set((state) => ({
      isOpen: state._wasOpenBeforeEditor,
    }));
  },
}));
