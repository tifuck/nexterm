import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Search, ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2, X, MoreVertical, Sparkles, Stethoscope, HelpCircle } from 'lucide-react';
import { getTerminalSearchAddon, getTerminalInstance, getTerminalFitAddon } from './TerminalContainer';

interface TerminalToolbarProps {
  tabId: string;
  aiCommandEnabled?: boolean;
  aiDiagnoseEnabled?: boolean;
  aiExplainEnabled?: boolean;
  onAICommand?: () => void;
  onAIDiagnose?: () => void;
  onAIExplain?: () => void;
}

const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

export const TerminalToolbar: React.FC<TerminalToolbarProps> = ({
  tabId,
  aiCommandEnabled,
  aiDiagnoseEnabled,
  aiExplainEnabled,
  onAICommand,
  onAIDiagnose,
  onAIExplain,
}) => {
  const hasAI = aiCommandEnabled || aiDiagnoseEnabled || aiExplainEnabled;
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect mobile viewport
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const showToolbar = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setIsVisible(true);
  }, []);

  const hideToolbar = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      if (!isSearchOpen) {
        setIsVisible(false);
      }
    }, 300);
  }, [isSearchOpen]);

  const toggleToolbar = useCallback(() => {
    setIsVisible((v) => !v);
  }, []);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      const searchAddon = getTerminalSearchAddon(tabId);
      if (searchAddon && query) {
        searchAddon.findNext(query, { caseSensitive: false, regex: false });
      }
    },
    [tabId]
  );

  const handleSearchNext = useCallback(() => {
    const searchAddon = getTerminalSearchAddon(tabId);
    if (searchAddon && searchQuery) {
      searchAddon.findNext(searchQuery);
    }
  }, [tabId, searchQuery]);

  const handleSearchPrev = useCallback(() => {
    const searchAddon = getTerminalSearchAddon(tabId);
    if (searchAddon && searchQuery) {
      searchAddon.findPrevious(searchQuery);
    }
  }, [tabId, searchQuery]);

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => {
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      return !prev;
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    const terminal = getTerminalInstance(tabId);
    const fitAddon = getTerminalFitAddon(tabId);
    if (terminal) {
      const currentSize = terminal.options.fontSize ?? DEFAULT_FONT_SIZE;
      const newSize = Math.min(currentSize + 1, MAX_FONT_SIZE);
      terminal.options.fontSize = newSize;
      fitAddon?.fit();
    }
  }, [tabId]);

  const handleZoomOut = useCallback(() => {
    const terminal = getTerminalInstance(tabId);
    const fitAddon = getTerminalFitAddon(tabId);
    if (terminal) {
      const currentSize = terminal.options.fontSize ?? DEFAULT_FONT_SIZE;
      const newSize = Math.max(currentSize - 1, MIN_FONT_SIZE);
      terminal.options.fontSize = newSize;
      fitAddon?.fit();
    }
  }, [tabId]);

  const handleZoomReset = useCallback(() => {
    const terminal = getTerminalInstance(tabId);
    const fitAddon = getTerminalFitAddon(tabId);
    if (terminal) {
      terminal.options.fontSize = DEFAULT_FONT_SIZE;
      fitAddon?.fit();
    }
  }, [tabId]);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      const termContainer = document.querySelector(`[data-tab-id="${tabId}"]`)?.parentElement;
      termContainer?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, [tabId]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        handleSearchPrev();
      } else {
        handleSearchNext();
      }
    }
    if (e.key === 'Escape') {
      setIsSearchOpen(false);
      setSearchQuery('');
    }
  };

  return (
    <>
      {/* Desktop: enlarged hover trigger zone - covers top-right corner */}
      {!isMobile && (
        <div
          className="absolute top-0 right-0 w-48 h-12 z-10"
          onMouseEnter={showToolbar}
          onMouseLeave={hideToolbar}
        />
      )}

      {/* Mobile: always-visible toggle button */}
      {isMobile && (
        <button
          onClick={toggleToolbar}
          className="absolute top-1.5 right-1.5 z-30 p-1.5 rounded-md transition-colors"
          style={{ backgroundColor: 'rgba(15, 20, 25, 0.7)' }}
        >
          <MoreVertical size={16} className={isVisible ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'} />
        </button>
      )}

      {/* Toolbar */}
      <div
        className={`absolute ${isMobile ? 'top-9' : 'top-2'} right-2 z-20 flex flex-col items-end gap-1`}
        onMouseEnter={isMobile ? undefined : showToolbar}
        onMouseLeave={isMobile ? undefined : hideToolbar}
      >
        {/* Toolbar buttons */}
        <div
          className={`flex items-center gap-0.5 rounded-md px-1 py-0.5 transition-all duration-200 ${
            isVisible || isSearchOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none'
          }`}
          style={{ backgroundColor: 'rgba(15, 20, 25, 0.85)', backdropFilter: 'blur(8px)' }}
        >
          <ToolbarButton icon={<Search size={14} />} title="Search (Ctrl+F)" onClick={handleToggleSearch} active={isSearchOpen} />
          <ToolbarButton icon={<ZoomIn size={14} />} title="Zoom In" onClick={handleZoomIn} />
          <ToolbarButton icon={<ZoomOut size={14} />} title="Zoom Out" onClick={handleZoomOut} />
          <ToolbarButton icon={<RotateCcw size={14} />} title="Reset Zoom" onClick={handleZoomReset} />
          <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
          <ToolbarButton
            icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            onClick={handleToggleFullscreen}
          />
          {hasAI && (
            <>
              <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
              {aiCommandEnabled && onAICommand && (
                <ToolbarButton icon={<Sparkles size={14} />} title="AI Command (Ctrl+K)" onClick={onAICommand} />
              )}
              {aiDiagnoseEnabled && onAIDiagnose && (
                <ToolbarButton icon={<Stethoscope size={14} />} title="Diagnose Error (Ctrl+Shift+D)" onClick={onAIDiagnose} />
              )}
              {aiExplainEnabled && onAIExplain && (
                <ToolbarButton icon={<HelpCircle size={14} />} title="Explain Command (Ctrl+Shift+E)" onClick={onAIExplain} />
              )}
            </>
          )}
        </div>

        {/* Search bar */}
        {isSearchOpen && (
          <div
            className="flex items-center gap-1 rounded-md px-2 py-1.5 animate-scale-in"
            style={{ backgroundColor: 'rgba(15, 20, 25, 0.92)', backdropFilter: 'blur(8px)' }}
          >
            <Search size={13} className="text-[var(--text-tertiary)] flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search..."
              className="bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none w-40"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                }}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
};

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

export default TerminalToolbar;
