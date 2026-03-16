import React, { useEffect, useState, useCallback } from 'react';
import { Monitor, Eye } from 'lucide-react';
import { useTabStore } from '@/store/tabStore';
import { useSplitStore, type SplitLayout } from '@/store/splitStore';
import HomeTab from '../tabs/HomeTab';
import SettingsTab from '../tabs/SettingsTab';
import FileEditor from '../editor/FileEditor';
import FilePreview from '../editor/FilePreview';
import TerminalContainer, { getTerminalInstance } from '../terminal/TerminalContainer';
import { TerminalToolbar } from '../terminal/TerminalToolbar';
import { MobileHotkeyBar } from '../terminal/MobileHotkeyBar';
import SplitChrome from './SplitContainer';
import type { ConnectionConfig } from '../terminal/TerminalContainer';
import type { Tab } from '@/types/session';

/**
 * Hook that returns a CSS height offset to compensate for the mobile virtual
 * keyboard.  Uses the Visual Viewport API so the terminal container shrinks
 * when the keyboard is open, keeping the cursor row visible.
 * Also returns whether the keyboard is currently open.
 */
function useKeyboardHeight(): { kbHeight: number; isKeyboardOpen: boolean } {
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const diff = Math.max(0, window.innerHeight - vv.height);
      setKbHeight(diff > 100 ? diff : 0);
    };

    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  return { kbHeight, isKeyboardOpen: kbHeight > 0 };
}

/** Detect mobile viewport (< 640px, matching Tailwind's sm breakpoint). */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}

/** Placeholder for content types not yet implemented */
const Placeholder: React.FC<{ label: string; icon: React.ReactNode }> = ({ label, icon }) => (
  <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
    {icon}
    <span className="text-sm font-medium">{label}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Pane geometry computation — maps split layout + sizes to CSS bounds for
// each pane slot. Returns an array of { top, left, width, height } as
// percentage strings. Index matches the pane index in splitStore.panes.
// ---------------------------------------------------------------------------
interface PaneBounds {
  top: string;
  left: string;
  width: string;
  height: string;
}

function computePaneBounds(layout: SplitLayout, sizes: number[]): PaneBounds[] {
  if (layout === 'horizontal') {
    return [
      { top: '0%', left: '0%', width: `${sizes[0]}%`, height: '100%' },
      { top: '0%', left: `${sizes[0]}%`, width: `${sizes[1]}%`, height: '100%' },
    ];
  }
  if (layout === 'vertical') {
    return [
      { top: '0%', left: '0%', width: '100%', height: `${sizes[0]}%` },
      { top: `${sizes[0]}%`, left: '0%', width: '100%', height: `${sizes[1]}%` },
    ];
  }
  if (layout === 'quad') {
    // sizes: [leftW%, rightW%, topH%, bottomH%]
    const lw = sizes[0], rw = sizes[1], th = sizes[2], bh = sizes[3];
    return [
      { top: '0%', left: '0%', width: `${lw}%`, height: `${th}%` },        // top-left
      { top: '0%', left: `${lw}%`, width: `${rw}%`, height: `${th}%` },     // top-right
      { top: `${th}%`, left: '0%', width: `${lw}%`, height: `${bh}%` },     // bottom-left
      { top: `${th}%`, left: `${lw}%`, width: `${rw}%`, height: `${bh}%` }, // bottom-right
    ];
  }
  return []; // single — not used
}

/**
 * Renders content for every open tab.
 *
 * **Architecture**: All tab content (especially terminal instances) is ALWAYS
 * rendered in a single flat layer. Terminals are NEVER unmounted during layout
 * changes — their wrapper divs are repositioned via CSS to fill pane slots.
 * This prevents xterm.js corruption from calling terminal.open() twice.
 */
const MainContent: React.FC = () => {
  const tabs = useTabStore((s) => s.tabs);
  const activeTab = useTabStore((s) => s.activeTab);
  const { kbHeight: keyboardHeight, isKeyboardOpen } = useKeyboardHeight();
  const isMobile = useIsMobile();
  const splitLayout = useSplitStore((s) => s.layout);
  const panes = useSplitStore((s) => s.panes);
  const sizes = useSplitStore((s) => s.sizes);

  const isSplit = splitLayout !== 'single';
  const showHome = activeTab === 'home';

  // Determine if the active tab is a terminal (for showing the hotkey bar)
  const activeTabObj = tabs.find((t) => t.id === activeTab);
  const isActiveTerminal = activeTabObj?.type === 'ssh' || activeTabObj?.type === 'telnet';
  const showHotkeyBar = isMobile && isKeyboardOpen && isActiveTerminal;

  // Send hotkey data through the terminal's input method (triggers onData -> WebSocket)
  const handleHotkeySend = useCallback(
    (data: string) => {
      if (!activeTab) return;
      const terminal = getTerminalInstance(activeTab);
      if (terminal) {
        terminal.input(data, true);
        terminal.focus();
      }
    },
    [activeTab],
  );

  // Build a map: tabId -> pane index (for tabs assigned to panes)
  const tabToPaneIndex = new Map<string, number>();
  if (isSplit) {
    panes.forEach((p, i) => {
      if (p.tabId) tabToPaneIndex.set(p.tabId, i);
    });
  }

  // Compute pane bounds for split layouts
  const paneBounds = isSplit ? computePaneBounds(splitLayout, sizes) : [];

  // When the keyboard is open, shrink the content area. The hotkey bar sits
  // inside the reduced area, so we don't subtract its height from the offset.
  const contentStyle: React.CSSProperties = keyboardHeight > 0
    ? { height: `calc(100% - ${keyboardHeight}px)` }
    : {};

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-primary)]" style={contentStyle}>
      {/* Terminal area — takes remaining space */}
      <div className="flex-1 relative overflow-hidden min-h-0">
      {/* Home view — always rendered, z-20 so it's above split chrome */}
      <div
        className="absolute inset-0 transition-opacity duration-150 ease-in-out"
        style={{
          opacity: showHome ? 1 : 0,
          pointerEvents: showHome ? 'auto' : 'none',
          zIndex: showHome ? 20 : 0,
        }}
      >
        <HomeTab />
      </div>

      {/* All tab contents — ALWAYS mounted, NEVER unmounted on layout change.
          In single mode: active tab fills the area, rest are hidden.
          In split mode: tabs assigned to panes are positioned to match
          pane bounds. Tabs not in any pane are hidden. */}
      {tabs.map((tab) => {
        const isTerminal = tab.type === 'ssh' || tab.type === 'telnet';
        const paneIndex = tabToPaneIndex.get(tab.id);
        const isInPane = paneIndex !== undefined;

        let style: React.CSSProperties;

        if (isSplit && isInPane) {
          // Tab is assigned to a pane — position it to fill the pane bounds
          const bounds = paneBounds[paneIndex];
          style = {
            position: 'absolute',
            top: bounds.top,
            left: bounds.left,
            width: bounds.width,
            height: bounds.height,
            opacity: 1,
            pointerEvents: 'auto',
            zIndex: 1,
            transition: 'none',
          };
        } else if (!isSplit && tab.id === activeTab) {
          // Single mode, active tab — fill the area
          style = {
            opacity: 1,
            pointerEvents: 'auto',
            zIndex: 1,
          };
        } else {
          // Hidden tab (not active in single mode, or not in a pane in split mode)
          style = {
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 0,
          };
        }

        return (
          <div
            key={tab.id}
            className={isSplit && isInPane ? '' : 'absolute inset-0 transition-opacity duration-150 ease-in-out'}
            style={style}
          >
            {/* Render tab content */}
            {tab.type === 'home' && <HomeTab />}

            {isTerminal && (
              <div className="relative w-full h-full">
                <TerminalContainer
                  tabId={tab.id}
                  sessionId={tab.sessionId}
                  connectionConfig={
                    tab.meta
                      ? ({
                          host: tab.meta.host,
                          port: tab.meta.port,
                          username: tab.meta.username,
                          password: tab.meta.password,
                          sshKey: tab.meta.sshKey,
                        } as ConnectionConfig)
                      : undefined
                  }
                />
                <TerminalToolbar tabId={tab.id} />
              </div>
            )}

            {tab.type === 'rdp' && <Placeholder label="RDP Coming Soon" icon={<Monitor size={40} />} />}
            {tab.type === 'vnc' && <Placeholder label="VNC Coming Soon" icon={<Eye size={40} />} />}
            {tab.type === 'editor' && <FileEditor tab={tab} />}
            {tab.type === 'preview' && <FilePreview tab={tab} />}
            {tab.type === 'settings' && <SettingsTab />}
          </div>
        );
      })}

      {/* Split chrome overlay: dividers, empty-pane selectors, focus rings.
          Rendered on top of the positioned tab containers. */}
      {isSplit && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <SplitChrome />
        </div>
      )}
      </div>

      {/* Mobile hotkey bar — shown above the keyboard when a terminal is active */}
      {showHotkeyBar && <MobileHotkeyBar onSend={handleHotkeySend} />}
    </div>
  );
};

export default MainContent;
