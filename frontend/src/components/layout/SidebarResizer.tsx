import React, { useCallback } from 'react';
import { useSidebarStore } from '@/store/sidebarStore';

const SidebarResizer: React.FC = () => {
  const setWidth = useSidebarStore((s) => s.setWidth);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = useSidebarStore.getState().width;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.min(600, Math.max(200, startWidth + delta));
        setWidth(newWidth);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [setWidth]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="relative shrink-0 w-0 z-10 cursor-col-resize group"
    >
      {/* Invisible wide hit area for dragging */}
      <div className="absolute top-0 bottom-0 -left-1 w-2 group-hover:bg-[var(--accent-muted)] transition-colors" />
    </div>
  );
};

export default SidebarResizer;
