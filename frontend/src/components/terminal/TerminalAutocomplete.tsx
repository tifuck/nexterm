/**
 * Autocomplete overlay for SSH terminal sessions.
 *
 * Two visual elements:
 * 1. **Ghost text** -- the remaining portion of the closest matching command
 *    rendered in faint text directly at the cursor position (inline preview,
 *    like fish shell).
 * 2. **Dropdown list** -- all matching suggestions below (or above) the
 *    cursor, styled to match the user's terminal theme with a semi-transparent
 *    background.
 *
 * Positioning strategy:
 * We measure the terminal cursor once when the dropdown first opens to
 * establish a "prompt anchor" (the pixel X where the shell prompt ends).
 * Because the SSH echo for the triggering keystroke (and any preceding
 * backspace) may still be in flight, we measure twice: immediately (so the
 * overlay appears without delay) and again after a short timeout to let
 * pending echoes settle.  The second measurement silently corrects the
 * anchor if needed.
 *
 * Subsequent ghost/dropdown positions are computed purely from
 * inputPrefix.length * cellWidth, avoiding any dependency on the async
 * SSH echo timing that updates terminal.buffer.active.cursorX.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getTerminalInstance } from './TerminalContainer';
import { useThemeStore } from '@/store/themeStore';
import { TERMINAL_THEMES } from '@/themes/terminal-themes';

interface TerminalAutocompleteProps {
  tabId: string;
  suggestions: string[];
  selectedIndex: number;
  isOpen: boolean;
  inputPrefix: string;
  /** Called when a suggestion is double-clicked/tapped to fill the command. */
  onSelect?: (command: string) => void;
}

interface BasePosition {
  /** Pixel X of the end of the shell prompt (before any user input). */
  promptX: number;
  /** Pixel Y of the cursor row. */
  y: number;
  cellWidth: number;
  cellHeight: number;
  containerHeight: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Measure the terminal and compute the prompt anchor position.
 *
 * Reads terminal.buffer.active.cursorX/Y to determine where the cursor
 * currently sits, then subtracts prefixLength cells to find where the
 * shell prompt ends.  Because echoes are asynchronous, the caller should
 * invoke this twice (immediately + after a short delay) to ensure accuracy.
 */
function measureBasePosition(
  tabId: string,
  containerEl: HTMLElement,
  prefixLength: number,
): BasePosition | null {
  const terminal = getTerminalInstance(tabId);
  if (!terminal) return null;

  const screenEl = containerEl.querySelector('.xterm-screen') as HTMLElement | null;
  if (!screenEl) return null;

  const positionedParent = containerEl.parentElement;
  if (!positionedParent) return null;

  const screenRect = screenEl.getBoundingClientRect();
  const parentRect = positionedParent.getBoundingClientRect();

  const cellWidth = screenRect.width / terminal.cols;
  const cellHeight = screenRect.height / terminal.rows;

  const cursorX = terminal.buffer.active.cursorX;
  const cursorY = terminal.buffer.active.cursorY;

  const cursorPixelX = screenRect.left - parentRect.left + cursorX * cellWidth;
  const cursorPixelY = screenRect.top - parentRect.top + cursorY * cellHeight;

  // The prompt ends at cursorX minus the characters the user has already typed.
  const promptX = cursorPixelX - prefixLength * cellWidth;

  return {
    promptX,
    y: cursorPixelY,
    cellWidth,
    cellHeight,
    containerHeight: parentRect.height,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TerminalAutocomplete: React.FC<TerminalAutocompleteProps> = ({
  tabId,
  suggestions,
  selectedIndex,
  isOpen,
  inputPrefix,
  onSelect,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Base position is measured once when the dropdown opens.
  const [basePos, setBasePos] = useState<BasePosition | null>(null);

  // Keep inputPrefix in a ref so the measure callback can read the
  // current value without needing it as a dependency (which would cause
  // re-measurement on every keystroke, racing the async SSH echo).
  const inputPrefixRef = useRef(inputPrefix);
  inputPrefixRef.current = inputPrefix;

  // Generation counter: bumped every time isOpen transitions to true.
  // This ensures a fresh measurement even if isOpen goes false→true
  // within a single React batch (where an effect for the false state
  // would never run and the old basePos would survive).
  const [openGen, setOpenGen] = useState(0);
  const prevIsOpenRef = useRef(false);

  // Detect false→true transition during render (safe setState-during-render
  // pattern: React will re-render with the new value before committing).
  if (isOpen && !prevIsOpenRef.current) {
    setOpenGen((g) => g + 1);
  }
  prevIsOpenRef.current = isOpen;

  // Derive colors from the user's active terminal theme.
  const terminalThemeName = useThemeStore((s) => s.terminalTheme);
  const storedFontSize = useThemeStore((s) => s.fontSize);
  const theme = TERMINAL_THEMES[terminalThemeName] ?? TERMINAL_THEMES.nextermDark;

  const bgColor = hexToRgba(theme.background ?? '#050505', 0.85);
  const borderColor = hexToRgba(theme.foreground ?? '#b3b1ad', 0.15);
  const textColor = theme.foreground ?? '#b3b1ad';
  const accentColor = theme.cursor ?? '#00e5ff';
  const selectionBg = theme.selectionBackground ?? hexToRgba(accentColor, 0.35);
  const hoverBg = hexToRgba(theme.foreground ?? '#b3b1ad', 0.08);

  // Measure base position when dropdown transitions from closed → open.
  // Uses inputPrefixRef so this callback identity is stable across
  // keystrokes — preventing re-measurement on every keystroke.
  const measure = useCallback(() => {
    const container = document.querySelector(
      `[data-tab-id="${tabId}"]`,
    ) as HTMLElement | null;
    if (!container) return;

    const pos = measureBasePosition(tabId, container, inputPrefixRef.current.length);
    if (pos) setBasePos(pos);
  }, [tabId]);

  useEffect(() => {
    if (!isOpen) {
      setBasePos(null);
      return;
    }
    // Measure immediately so the overlay appears without delay.
    // The terminal cursor may not yet reflect pending echoes (the
    // triggering character or a preceding backspace), so re-measure
    // after 50 ms to let in-flight echoes settle and silently correct
    // the prompt anchor if needed.
    measure();
    const timer = setTimeout(measure, 50);
    return () => clearTimeout(timer);
  }, [openGen, isOpen, measure]);

  // Scroll the selected item into view when navigating.
  useEffect(() => {
    if (!isOpen || selectedIndex < 0 || !dropdownRef.current) return;
    const items = dropdownRef.current.children;
    if (selectedIndex < items.length) {
      items[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, isOpen]);

  if (!isOpen || suggestions.length === 0 || !basePos) {
    return null;
  }

  // Derive current cursor X from the stable prompt anchor + prefix length.
  const cursorX = basePos.promptX + inputPrefix.length * basePos.cellWidth;
  // The ghost text starts at the cursor position -- the cell where the
  // next character would be typed.  This matches fish-shell-style inline
  // suggestions where the ghost overlaps/replaces the cursor block.
  const ghostX = cursorX;

  // The ghost text shows the remaining portion of the top (or selected) suggestion.
  const ghostSuggestion = selectedIndex >= 0 ? suggestions[selectedIndex] : suggestions[0];
  const ghostRemainder = ghostSuggestion.slice(inputPrefix.length);

  // Determine whether to render the dropdown above or below the cursor.
  const dropdownMaxHeight = 240;
  const cursorBottom = basePos.y + basePos.cellHeight;
  const spaceBelow = basePos.containerHeight - cursorBottom;
  const renderAbove = spaceBelow < dropdownMaxHeight + 20 && basePos.y > dropdownMaxHeight;

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    left: Math.max(0, cursorX),
    zIndex: 50,
    maxHeight: dropdownMaxHeight,
    backgroundColor: bgColor,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderColor,
    ...(renderAbove
      ? { bottom: basePos.containerHeight - basePos.y + 2 }
      : { top: cursorBottom + 2 }),
  };

  const ghostContainerStyle: React.CSSProperties = {
    position: 'absolute',
    left: ghostX,
    top: basePos.y,
    height: basePos.cellHeight,
    lineHeight: `${basePos.cellHeight}px`,
    fontSize: storedFontSize ?? 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
    color: hexToRgba(theme.foreground ?? '#b3b1ad', 0.35),
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    zIndex: 40,
    overflow: 'hidden',
  };

  const ghostCellStyle: React.CSSProperties = {
    display: 'inline-block',
    width: basePos.cellWidth,
    textAlign: 'center',
  };

  return (
    <>
      {/* Ghost text -- inline preview at cursor position */}
      {ghostRemainder && (
        <span style={ghostContainerStyle}>
          {Array.from(ghostRemainder).map((ch, i) => (
            <span key={i} style={ghostCellStyle}>{ch}</span>
          ))}
        </span>
      )}

      {/* Dropdown list */}
      <div
        ref={dropdownRef}
        style={dropdownStyle}
        className="min-w-[200px] max-w-[500px] overflow-y-auto rounded-md border shadow-xl"
        onMouseDown={(e) => e.preventDefault()}
      >
        {suggestions.map((cmd, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <div
              key={cmd}
              className="px-3 py-1.5 text-xs font-mono cursor-default truncate transition-colors"
              style={{
                color: isSelected ? '#fff' : textColor,
                backgroundColor: isSelected ? selectionBg : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = hoverBg;
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                }
              }}
              onDoubleClick={() => onSelect?.(cmd)}
            >
              <span style={{ color: isSelected ? '#fff' : accentColor, fontWeight: isSelected ? 600 : 400 }}>
                {cmd.slice(0, inputPrefix.length)}
              </span>
              <span>{cmd.slice(inputPrefix.length)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default TerminalAutocomplete;
