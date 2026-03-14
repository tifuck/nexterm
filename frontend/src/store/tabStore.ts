import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Tab } from '../types/session';
import { destroyTerminal } from '../components/terminal/TerminalContainer';

interface TabState {
  tabs: Tab[];
  activeTab: string;
  recentlyClosed: Tab[];

  // Core actions
  addTab: (tab: Tab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, partial: Partial<Tab>) => void;
  reopenTab: (tabId: string) => void;
  clearAll: () => void;

  // Aliases used by TabBar
  closeTab: (tabId: string) => void;
  restoreTab: (tabId: string) => void;
}

const MAX_RECENT = 20;
const MAX_TABS = 20;

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => {
  // ---- removeTab / closeTab implementation ----
  const removeTab = (tabId: string) => {
    const { tabs, activeTab } = get();

    const tabIndex = tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;

    const closedTab = { ...tabs[tabIndex], closedAt: Date.now() };
    const filteredTabs = tabs.filter((t) => t.id !== tabId);

    let newActiveTab = activeTab;
    if (activeTab === tabId) {
      const nextTab = filteredTabs[Math.min(tabIndex, filteredTabs.length - 1)];
      newActiveTab = nextTab?.id ?? 'home';
    }

    // Clean up terminal instance from cache
    const tab = tabs[tabIndex];
    if (tab.type === 'ssh' || tab.type === 'telnet') {
      destroyTerminal(tabId);
    }

    set((state) => ({
      tabs: filteredTabs,
      activeTab: newActiveTab,
      recentlyClosed: [closedTab, ...state.recentlyClosed].slice(0, MAX_RECENT),
    }));
  };

  // ---- reopenTab / restoreTab implementation ----
  const reopenTab = (tabId: string) => {
    const { recentlyClosed, tabs } = get();
    if (tabs.length >= MAX_TABS) return;
    const tab = recentlyClosed.find((t) => t.id === tabId);
    if (!tab) return;

    const restoredTab: Tab = { ...tab, closedAt: undefined };

    set((state) => ({
      tabs: [...state.tabs, restoredTab],
      activeTab: tabId,
      recentlyClosed: state.recentlyClosed.filter((t) => t.id !== tabId),
    }));
  };

  return {
    tabs: [],
    activeTab: 'home',
    recentlyClosed: [],

    addTab: (tab: Tab) => {
      const { tabs } = get();
      const existing = tabs.find((t) => t.id === tab.id);
      if (existing) {
        set({ activeTab: tab.id });
        return;
      }
      if (tabs.length >= MAX_TABS) return;
      set({ tabs: [...tabs, tab], activeTab: tab.id });
    },

    removeTab,
    closeTab: removeTab,

    setActiveTab: (tabId: string) => {
      set({ activeTab: tabId });
    },

    updateTab: (tabId: string, partial: Partial<Tab>) => {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, ...partial } : t
        ),
      }));
    },

    reopenTab,
    restoreTab: reopenTab,

    clearAll: () => {
      set({ tabs: [], activeTab: 'home', recentlyClosed: [] });
    },
  };
    },
    {
      name: 'nexterm_tabs',
      partialize: (state) => ({
        tabs: state.tabs.map((t) => ({
          ...t,
          // Mark all connection-based tabs as disconnected on restore
          isConnected: false,
        })),
        activeTab: state.activeTab,
        // Don't persist recentlyClosed
      }),
      merge: (persisted: any, current: TabState) => {
        if (!persisted) return current;
        const persistedState = persisted as Partial<TabState>;
        // Filter out the legacy 'home' tab that was previously stored in the tabs array
        const tabs = (persistedState.tabs || []).filter((t: Tab) => t.id !== 'home');
        const activeTab = persistedState.activeTab === 'home' || !tabs.find((t: Tab) => t.id === persistedState.activeTab)
          ? 'home'
          : persistedState.activeTab!;
        return {
          ...current,
          tabs,
          activeTab,
        };
      },
    }
  )
);
