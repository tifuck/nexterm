import React, { useCallback } from 'react';

interface PaneDividerProps {
  /** 'horizontal' for a vertical bar (left|right), 'vertical' for a horizontal bar (top|bottom). */
  direction: 'horizontal' | 'vertical';
  /** Called with the delta in pixels as the user drags. */
  onResize: (delta: number) => void;
}

/**
 * A draggable divider between split panes. Similar pattern to SidebarResizer.
 * Renders as a thin line with a wider invisible hit area for dragging.
 */
const PaneDivider: React.FC<PaneDividerProps> = ({ direction, onResize }) => {
  const isVertical = direction === 'vertical';
  const cursor = isVertical ? 'row-resize' : 'col-resize';

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startPos = isVertical ? e.clientY : e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        const currentPos = isVertical ? ev.clientY : ev.clientX;
        onResize(currentPos - startPos);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = cursor;
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [isVertical, cursor, onResize]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`group ${isVertical ? 'cursor-row-resize w-full h-1' : 'cursor-col-resize h-full w-1'}`}
    >
      {/* Visible line + hover highlight */}
      <div
        className={`transition-colors group-hover:bg-[var(--accent)] bg-[var(--border)] ${
          isVertical ? 'w-full h-px' : 'h-full w-px'
        }`}
        style={isVertical ? { marginTop: '1px' } : { marginLeft: '1px' }}
      />
    </div>
  );
};

export default PaneDivider;
