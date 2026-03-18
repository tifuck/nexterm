import React, { useState, useCallback, useRef, useEffect } from 'react';
import Guacamole from 'guacamole-common-js';
import {
  ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2,
  MoreVertical, Shield, AppWindow, Camera,
  ArrowLeftRight, XCircle, ClipboardPaste, ClipboardCopy,
  Shrink, Expand, StretchHorizontal, WandSparkles,
  LogOut,
} from 'lucide-react';
import { getGuacEntry, applyScaleMode } from './RdpViewer';
import type { ScaleMode } from './RdpViewer';
import { useTabStore } from '@/store/tabStore';

// ---------------------------------------------------------------------------
// X11 keysyms used for special key combos
// ---------------------------------------------------------------------------
const KEYSYM = {
  CTRL_L:    0xFFE3,
  ALT_L:     0xFFE9,
  SHIFT_L:   0xFFE1,
  DELETE:    0xFFFF,
  BACKSPACE: 0xFF08,
  TAB:       0xFF09,
  SUPER_L:   0xFFEB,
  PRINT:     0xFF61,
  ESCAPE:    0xFF1B,
} as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RdpToolbarProps {
  tabId: string;
  protocol: 'rdp' | 'vnc';
}

// ---------------------------------------------------------------------------
// Zoom constants
// ---------------------------------------------------------------------------
const SCALE_STEP = 0.1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3.0;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RdpToolbar: React.FC<RdpToolbarProps> = ({ tabId, protocol }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [scaleMode, setScaleMode] = useState<ScaleMode>(() => {
    return (localStorage.getItem(`rdp_scale_${tabId}`) as ScaleMode) || 'fit';
  });
  const [isFsBarVisible, setIsFsBarVisible] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsBarHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsBarShowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Responsive ----
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ---- Visibility ----
  const showToolbar = useCallback((delay = 0) => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (delay > 0) {
      showTimeoutRef.current = setTimeout(() => {
        setIsVisible(true);
      }, delay);
    } else {
      setIsVisible(true);
    }
  }, []);

  const hideToolbar = useCallback(() => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 300);
  }, []);

  const toggleToolbar = useCallback(() => {
    setIsVisible((v) => !v);
  }, []);

  // ---- Fullscreen center bar visibility ----
  const showFsBar = useCallback((delay = 0) => {
    if (fsBarShowTimeoutRef.current) {
      clearTimeout(fsBarShowTimeoutRef.current);
      fsBarShowTimeoutRef.current = null;
    }
    if (fsBarHideTimeoutRef.current) {
      clearTimeout(fsBarHideTimeoutRef.current);
      fsBarHideTimeoutRef.current = null;
    }
    if (delay > 0) {
      fsBarShowTimeoutRef.current = setTimeout(() => {
        setIsFsBarVisible(true);
      }, delay);
    } else {
      setIsFsBarVisible(true);
    }
  }, []);

  const hideFsBar = useCallback(() => {
    if (fsBarShowTimeoutRef.current) {
      clearTimeout(fsBarShowTimeoutRef.current);
      fsBarShowTimeoutRef.current = null;
    }
    fsBarHideTimeoutRef.current = setTimeout(() => {
      setIsFsBarVisible(false);
    }, 300);
  }, []);

  // ---- Key combo helpers ----

  const sendKeyCombo = useCallback((keys: number[]) => {
    const entry = getGuacEntry(tabId);
    if (!entry) return;
    const { client } = entry;
    // Press all keys down in order
    for (const keysym of keys) {
      client.sendKeyEvent(1, keysym);
    }
    // Release in reverse order
    for (let i = keys.length - 1; i >= 0; i--) {
      client.sendKeyEvent(0, keys[i]);
    }
  }, [tabId]);

  const handleCtrlAltDel = useCallback(() => {
    sendKeyCombo([KEYSYM.CTRL_L, KEYSYM.ALT_L, KEYSYM.DELETE]);
  }, [sendKeyCombo]);

  const handleWindowsKey = useCallback(() => {
    const entry = getGuacEntry(tabId);
    if (!entry) return;
    entry.client.sendKeyEvent(1, KEYSYM.SUPER_L);
    entry.client.sendKeyEvent(0, KEYSYM.SUPER_L);
  }, [tabId]);

  const handlePrintScreen = useCallback(() => {
    const entry = getGuacEntry(tabId);
    if (!entry) return;
    entry.client.sendKeyEvent(1, KEYSYM.PRINT);
    entry.client.sendKeyEvent(0, KEYSYM.PRINT);
  }, [tabId]);

  const handleAltTab = useCallback(() => {
    sendKeyCombo([KEYSYM.ALT_L, KEYSYM.TAB]);
  }, [sendKeyCombo]);

  const handleCtrlAltBackspace = useCallback(() => {
    sendKeyCombo([KEYSYM.CTRL_L, KEYSYM.ALT_L, KEYSYM.BACKSPACE]);
  }, [sendKeyCombo]);

  // ---- Clipboard ----

  const handleClipboardPaste = useCallback(async () => {
    const entry = getGuacEntry(tabId);
    if (!entry) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const stream = entry.client.createClipboardStream('text/plain');
      const writer = new Guacamole.StringWriter(stream);
      writer.sendText(text);
      writer.sendEnd();
    } catch {
      // Clipboard API unavailable or permission denied
    }
  }, [tabId]);

  const handleClipboardCopy = useCallback(async () => {
    const entry = getGuacEntry(tabId);
    if (!entry) return;
    const text = entry.remoteClipboard;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable or permission denied
    }
  }, [tabId]);

  // ---- Scale mode ----

  const handleSetScaleMode = useCallback((mode: ScaleMode) => {
    const entry = getGuacEntry(tabId);
    if (!entry) return;
    entry.scaleMode = mode;
    entry.manualScale = null; // Clear manual zoom when switching modes
    setScaleMode(mode);
    localStorage.setItem(`rdp_scale_${tabId}`, mode);
    // Reapply scaling with the new mode
    const container = document.querySelector(`[data-rdp-tab-id="${tabId}"]`);
    if (container) {
      applyScaleMode(entry, (container as HTMLElement).offsetWidth, (container as HTMLElement).offsetHeight);
    }
  }, [tabId]);

  // ---- Zoom ----

  const applyManualScale = useCallback((entry: ReturnType<typeof getGuacEntry>, scale: number) => {
    if (!entry) return;
    const display = entry.client.getDisplay();
    entry.manualScale = scale;
    // display.scale() sets the uniform transform on the inner div,
    // which also clears any asymmetric stretch we may have set.
    display.scale(scale);
  }, []);

  const handleZoomIn = useCallback(() => {
    const entry = getGuacEntry(tabId);
    if (!entry) return;
    const display = entry.client.getDisplay();
    const currentScale = display.getScale();
    const newScale = Math.min(currentScale + SCALE_STEP, MAX_SCALE);
    applyManualScale(entry, newScale);
  }, [tabId, applyManualScale]);

  const handleZoomOut = useCallback(() => {
    const entry = getGuacEntry(tabId);
    if (!entry) return;
    const display = entry.client.getDisplay();
    const currentScale = display.getScale();
    const newScale = Math.max(currentScale - SCALE_STEP, MIN_SCALE);
    applyManualScale(entry, newScale);
  }, [tabId, applyManualScale]);

  const handleZoomReset = useCallback(() => {
    const entry = getGuacEntry(tabId);
    if (!entry) return;
    // Clear manual override -- let the current scale mode recalculate
    entry.manualScale = null;
    const container = document.querySelector(`[data-rdp-tab-id="${tabId}"]`);
    if (container) {
      applyScaleMode(entry, (container as HTMLElement).offsetWidth, (container as HTMLElement).offsetHeight);
    }
  }, [tabId]);

  // ---- Disconnect ----

  const handleDisconnect = useCallback(() => {
    useTabStore.getState().closeTab(tabId);
  }, [tabId]);

  // ---- Fullscreen ----

  const handleToggleFullscreen = useCallback(() => {
    const container = document.querySelector(`[data-rdp-tab-id="${tabId}"]`)?.parentElement;
    if (!document.fullscreenElement) {
      container?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, [tabId]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      // Hide fs bar when leaving fullscreen
      if (!document.fullscreenElement) {
        setIsFsBarVisible(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // ---- Render ----

  return (
    <>
      {/* Desktop: enlarged hover trigger zone - covers top-right corner (hidden in fullscreen) */}
      {!isMobile && !isFullscreen && (
        <div
          className="absolute top-0 right-0 w-48 h-12 z-10"
          onMouseEnter={() => showToolbar(1000)}
          onMouseLeave={hideToolbar}
        />
      )}

      {/* Mobile: always-visible toggle button */}
      {isMobile && !isFullscreen && (
        <button
          onClick={toggleToolbar}
          className="absolute top-1.5 right-1.5 z-30 p-1.5 rounded-md transition-colors"
          style={{ backgroundColor: 'rgba(15, 20, 25, 0.7)' }}
        >
          <MoreVertical size={16} className={isVisible ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'} />
        </button>
      )}

      {/* Toolbar (hidden in fullscreen — replaced by center bar) */}
      {!isFullscreen && <div
        className={`absolute ${isMobile ? 'top-9' : 'top-2'} right-2 z-20 flex flex-col items-end gap-1`}
        onMouseEnter={isMobile ? undefined : () => showToolbar(0)}
        onMouseLeave={isMobile ? undefined : hideToolbar}
      >
        <div
          className={`flex items-center gap-0.5 rounded-md px-1 py-0.5 transition-all duration-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none'
          }`}
          style={{ backgroundColor: 'rgba(15, 20, 25, 0.85)', backdropFilter: 'blur(8px)' }}
        >
          {/* Key combos section */}
          <ToolbarButton icon={<Shield size={14} />} title="Ctrl+Alt+Del" onClick={handleCtrlAltDel} />
          <ToolbarButton icon={<AppWindow size={14} />} title="Windows Key" onClick={handleWindowsKey} />
          <ToolbarButton icon={<Camera size={14} />} title="Print Screen" onClick={handlePrintScreen} />
          <ToolbarButton icon={<ArrowLeftRight size={14} />} title="Alt+Tab" onClick={handleAltTab} />
          {protocol === 'vnc' && (
            <ToolbarButton icon={<XCircle size={14} />} title="Ctrl+Alt+Backspace" onClick={handleCtrlAltBackspace} />
          )}

          <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />

          {/* Clipboard section */}
          <ToolbarButton icon={<ClipboardPaste size={14} />} title="Paste from clipboard" onClick={handleClipboardPaste} />
          <ToolbarButton icon={<ClipboardCopy size={14} />} title="Copy from remote" onClick={handleClipboardCopy} />

          <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />

          {/* Scale mode section */}
          <ToolbarButton icon={<Shrink size={14} />} title="Fit (contain)" onClick={() => handleSetScaleMode('fit')} active={scaleMode === 'fit'} />
          <ToolbarButton icon={<Expand size={14} />} title="Fill (cover)" onClick={() => handleSetScaleMode('fill')} active={scaleMode === 'fill'} />
          <ToolbarButton icon={<StretchHorizontal size={14} />} title="Stretch" onClick={() => handleSetScaleMode('stretch')} active={scaleMode === 'stretch'} />
          <ToolbarButton icon={<WandSparkles size={14} />} title="Smart (auto)" onClick={() => handleSetScaleMode('smart')} active={scaleMode === 'smart'} />

          <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />

          {/* Zoom section */}
          <ToolbarButton icon={<ZoomIn size={14} />} title="Zoom In" onClick={handleZoomIn} />
          <ToolbarButton icon={<ZoomOut size={14} />} title="Zoom Out" onClick={handleZoomOut} />
          <ToolbarButton icon={<RotateCcw size={14} />} title="Reset Zoom" onClick={handleZoomReset} />

          <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />

          {/* Fullscreen */}
          <ToolbarButton
            icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            onClick={handleToggleFullscreen}
          />
        </div>
      </div>}

      {/* Fullscreen center bar — only shown in fullscreen mode */}
      {isFullscreen && (
        <>
          {/* Invisible hover trigger zone — top center strip */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-8 z-40"
            onMouseEnter={() => showFsBar(1000)}
            onMouseLeave={hideFsBar}
          />

          {/* Floating center bar */}
          <div
            className={`absolute top-2 left-1/2 -translate-x-1/2 z-50 transition-all duration-200 ${
              isFsBarVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none'
            }`}
            onMouseEnter={() => showFsBar(0)}
            onMouseLeave={hideFsBar}
          >
            <div
              className="flex items-center gap-0.5 rounded-2xl px-2 py-1"
              style={{ backgroundColor: 'rgba(15, 20, 25, 0.5)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {/* Disconnect */}
              <ToolbarButton icon={<LogOut size={14} />} title="Disconnect (exit RDP)" onClick={handleDisconnect} />

              <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />

              {/* Ctrl+Alt+Del */}
              <ToolbarButton icon={<Shield size={14} />} title="Ctrl+Alt+Del" onClick={handleCtrlAltDel} />

              <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />

              {/* Scale modes */}
              <ToolbarButton icon={<Shrink size={14} />} title="Fit (contain)" onClick={() => handleSetScaleMode('fit')} active={scaleMode === 'fit'} />
              <ToolbarButton icon={<Expand size={14} />} title="Fill (cover)" onClick={() => handleSetScaleMode('fill')} active={scaleMode === 'fill'} />
              <ToolbarButton icon={<StretchHorizontal size={14} />} title="Stretch" onClick={() => handleSetScaleMode('stretch')} active={scaleMode === 'stretch'} />
              <ToolbarButton icon={<WandSparkles size={14} />} title="Smart (auto)" onClick={() => handleSetScaleMode('smart')} active={scaleMode === 'smart'} />

              <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />

              {/* Zoom */}
              <ToolbarButton icon={<ZoomIn size={14} />} title="Zoom In" onClick={handleZoomIn} />
              <ToolbarButton icon={<ZoomOut size={14} />} title="Zoom Out" onClick={handleZoomOut} />
              <ToolbarButton icon={<RotateCcw size={14} />} title="Reset Zoom" onClick={handleZoomReset} />

              <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />

              {/* Exit fullscreen */}
              <ToolbarButton icon={<Minimize2 size={14} />} title="Exit Fullscreen" onClick={handleToggleFullscreen} />
            </div>
          </div>
        </>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// ToolbarButton (same pattern as TerminalToolbar)
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ icon, title, onClick, active }) => (
  <button
    onClick={onClick}
    title={title}
    className={`p-1.5 rounded transition-colors ${
      active
        ? 'text-[var(--accent)] bg-[var(--accent-muted)]'
        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
    }`}
  >
    {icon}
  </button>
);

export default RdpToolbar;
