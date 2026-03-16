import React, { useCallback, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useSplitStore } from '@/store/splitStore';
import { useTabStore } from '@/store/tabStore';
import PaneDivider from './PaneDivider';

/**
 * Empty pane overlay — shown when a pane has no tab assigned.
 * Renders a "Select Tab" dropdown so the user can pick which tab to display.
 */
const EmptyPaneOverlay: React.FC<{ paneIndex: number }> = ({ paneIndex }) => {
  const tabs = useTabStore((s) => s.tabs);
  const assignTab = useSplitStore((s) => s.assignTab);
  const setActivePane = useSplitStore((s) => s.setActivePane);
  const [showSelector, setShowSelector] = React.useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setShowSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
      <div className="relative" ref={selectorRef}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowSelector(!showSelector);
            setActivePane(paneIndex);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-md border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors"
        >
          Select Tab
          <ChevronDown size={14} />
        </button>
        {showSelector && tabs.length > 0 && (
          <div className="absolute top-10 left-1/2 -translate-x-1/2 w-48 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md shadow-xl z-50 py-1 animate-slide-down">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={(e) => {
                  e.stopPropagation();
                  assignTab(paneIndex, tab.id);
                  setShowSelector(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors truncate"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    tab.isConnected ? 'bg-green-500' : 'bg-[var(--text-muted)]'
                  }`}
                />
                {tab.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Split chrome overlay — renders ONLY the visual chrome for split layouts:
 * - Draggable dividers between panes
 * - Empty pane selectors (when a pane has no tab assigned)
 * - Focus ring around the active pane
 *
 * This component does NOT render any tab content. Tab content is rendered
 * in MainContent's backing layer and positioned via CSS to fill pane bounds.
 * This component is rendered with pointer-events: none on the container,
 * with pointer-events: auto on interactive elements (dividers, buttons).
 */
const SplitChrome: React.FC = () => {
  const layout = useSplitStore((s) => s.layout);
  const panes = useSplitStore((s) => s.panes);
  const activePaneIndex = useSplitStore((s) => s.activePaneIndex);
  const sizes = useSplitStore((s) => s.sizes);
  const setSizes = useSplitStore((s) => s.setSizes);
  const setActivePane = useSplitStore((s) => s.setActivePane);

  const containerRef = useRef<HTMLDivElement>(null);

  const makeResizeHandler = useCallback(
    (sizeIndexA: number, sizeIndexB: number, direction: 'horizontal' | 'vertical') => {
      return (delta: number) => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const totalSize = direction === 'horizontal' ? rect.width : rect.height;
        const deltaPercent = (delta / totalSize) * 100;

        const currentSizes = useSplitStore.getState().sizes;
        const newSizes = [...currentSizes];
        const a = Math.max(15, Math.min(85, currentSizes[sizeIndexA] + deltaPercent));
        newSizes[sizeIndexA] = a;
        newSizes[sizeIndexB] = 100 - a;
        setSizes(newSizes);
      };
    },
    [setSizes]
  );

  /** Render a pane's chrome (focus ring + empty overlay if no tab) */
  const renderPaneChrome = (paneIndex: number, style: React.CSSProperties) => {
    const pane = panes[paneIndex];
    const isActive = activePaneIndex === paneIndex;
    const isEmpty = !pane?.tabId;

    return (
      <div
        key={paneIndex}
        className="absolute"
        style={style}
        onClick={() => setActivePane(paneIndex)}
      >
        {/* Focus ring */}
        {isActive && (
          <div className="absolute inset-0 ring-1 ring-[var(--accent)] ring-inset pointer-events-none z-20" />
        )}
        {/* Empty pane selector */}
        {isEmpty && <EmptyPaneOverlay paneIndex={paneIndex} />}
      </div>
    );
  };

  if (layout === 'horizontal') {
    return (
      <div ref={containerRef} className="relative w-full h-full">
        {renderPaneChrome(0, { top: 0, left: 0, width: `${sizes[0]}%`, height: '100%' })}
        {renderPaneChrome(1, { top: 0, left: `${sizes[0]}%`, width: `${sizes[1]}%`, height: '100%' })}
        {/* Divider */}
        <div className="absolute top-0 bottom-0 pointer-events-auto z-30" style={{ left: `${sizes[0]}%`, transform: 'translateX(-50%)' }}>
          <PaneDivider direction="horizontal" onResize={makeResizeHandler(0, 1, 'horizontal')} />
        </div>
      </div>
    );
  }

  if (layout === 'vertical') {
    return (
      <div ref={containerRef} className="relative w-full h-full">
        {renderPaneChrome(0, { top: 0, left: 0, width: '100%', height: `${sizes[0]}%` })}
        {renderPaneChrome(1, { top: `${sizes[0]}%`, left: 0, width: '100%', height: `${sizes[1]}%` })}
        {/* Divider */}
        <div className="absolute left-0 right-0 pointer-events-auto z-30" style={{ top: `${sizes[0]}%`, transform: 'translateY(-50%)' }}>
          <PaneDivider direction="vertical" onResize={makeResizeHandler(0, 1, 'vertical')} />
        </div>
      </div>
    );
  }

  if (layout === 'quad') {
    const lw = sizes[0], th = sizes[2];
    return (
      <div ref={containerRef} className="relative w-full h-full">
        {renderPaneChrome(0, { top: 0, left: 0, width: `${sizes[0]}%`, height: `${sizes[2]}%` })}
        {renderPaneChrome(1, { top: 0, left: `${sizes[0]}%`, width: `${sizes[1]}%`, height: `${sizes[2]}%` })}
        {renderPaneChrome(2, { top: `${sizes[2]}%`, left: 0, width: `${sizes[0]}%`, height: `${sizes[3]}%` })}
        {renderPaneChrome(3, { top: `${sizes[2]}%`, left: `${sizes[0]}%`, width: `${sizes[1]}%`, height: `${sizes[3]}%` })}
        {/* Horizontal divider */}
        <div className="absolute top-0 bottom-0 pointer-events-auto z-30" style={{ left: `${lw}%`, transform: 'translateX(-50%)' }}>
          <PaneDivider direction="horizontal" onResize={makeResizeHandler(0, 1, 'horizontal')} />
        </div>
        {/* Vertical divider */}
        <div className="absolute left-0 right-0 pointer-events-auto z-30" style={{ top: `${th}%`, transform: 'translateY(-50%)' }}>
          <PaneDivider direction="vertical" onResize={makeResizeHandler(2, 3, 'vertical')} />
        </div>
      </div>
    );
  }

  return null;
};

export default SplitChrome;
