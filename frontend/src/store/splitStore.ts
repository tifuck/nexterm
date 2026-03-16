import { create } from 'zustand';

export type SplitLayout = 'single' | 'horizontal' | 'vertical' | 'quad';

interface Pane {
  tabId: string | null;
}

interface SplitState {
  layout: SplitLayout;
  panes: Pane[];
  activePaneIndex: number;
  /** Sizes as percentages (0-100). Length matches pane count. */
  sizes: number[];

  setLayout: (layout: SplitLayout) => void;
  assignTab: (paneIndex: number, tabId: string | null) => void;
  setActivePane: (paneIndex: number) => void;
  setSizes: (sizes: number[]) => void;

  /**
   * Called when a tab is activated from the tab bar.
   * Places the tab in the currently active pane.
   */
  activateTabInPane: (tabId: string) => void;

  /**
   * Remove a tab from all panes it appears in (e.g. when the tab is closed).
   */
  removeTabFromPanes: (tabId: string) => void;
}

function defaultPanes(layout: SplitLayout): Pane[] {
  const count = layout === 'quad' ? 4 : layout === 'single' ? 1 : 2;
  return Array.from({ length: count }, () => ({ tabId: null }));
}

function defaultSizes(layout: SplitLayout): number[] {
  if (layout === 'quad') return [50, 50, 50, 50];
  if (layout === 'single') return [100];
  return [50, 50];
}

export const useSplitStore = create<SplitState>((set, get) => ({
  layout: 'single',
  panes: [{ tabId: null }],
  activePaneIndex: 0,
  sizes: [100],

  setLayout: (layout) => {
    const current = get();
    if (current.layout === layout) return;

    const newPanes = defaultPanes(layout);
    const newSizes = defaultSizes(layout);

    // Carry over tab assignments from old panes where possible
    for (let i = 0; i < Math.min(current.panes.length, newPanes.length); i++) {
      newPanes[i].tabId = current.panes[i].tabId;
    }

    set({
      layout,
      panes: newPanes,
      sizes: newSizes,
      activePaneIndex: Math.min(current.activePaneIndex, newPanes.length - 1),
    });
  },

  assignTab: (paneIndex, tabId) => {
    set((state) => ({
      panes: state.panes.map((p, i) =>
        i === paneIndex ? { ...p, tabId } : p
      ),
    }));
  },

  setActivePane: (paneIndex) => {
    set({ activePaneIndex: paneIndex });
  },

  setSizes: (sizes) => {
    set({ sizes });
  },

  activateTabInPane: (tabId) => {
    const { panes, activePaneIndex } = get();
    // If the tab is already visible in another pane, just focus that pane
    const existingIndex = panes.findIndex((p) => p.tabId === tabId);
    if (existingIndex >= 0) {
      set({ activePaneIndex: existingIndex });
      return;
    }
    // Otherwise, assign to the active pane
    set({
      panes: panes.map((p, i) =>
        i === activePaneIndex ? { ...p, tabId } : p
      ),
    });
  },

  removeTabFromPanes: (tabId) => {
    set((state) => ({
      panes: state.panes.map((p) =>
        p.tabId === tabId ? { ...p, tabId: null } : p
      ),
    }));
  },
}));
