'use client';

import React from 'react';
import { Rnd } from 'react-rnd';
import { useShellStore } from '@/store/shell-store';
import { ModuleFrame } from './ModuleFrame';
import { Anchor } from 'lucide-react';

export function FloatingLayer() {
  const floatingWindows = useShellStore(s => s.floatingWindows);
  const updateFloatingWindow = useShellStore(s => s.updateFloatingWindow);
  const bringToFront = useShellStore(s => s.bringToFront);
  const dockModule = useShellStore(s => s.dockModule);

  if (floatingWindows.size === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 50 }}>
      {Array.from(floatingWindows.entries()).map(([moduleId, win]) => (
        <Rnd
          key={moduleId}
          position={{ x: win.x, y: win.y }}
          size={{ width: win.width, height: win.height }}
          style={{
            zIndex: win.zIndex,
            pointerEvents: 'auto',
          }}
          minWidth={320}
          minHeight={200}
          bounds="parent"
          dragHandleClassName="module-title-bar"
          onMouseDown={() => bringToFront(moduleId)}
          onDragStop={(_e, data) => {
            updateFloatingWindow(moduleId, { x: data.x, y: data.y });
          }}
          onResizeStop={(_e, _dir, ref, _delta, position) => {
            updateFloatingWindow(moduleId, {
              width: parseInt(ref.style.width, 10),
              height: parseInt(ref.style.height, 10),
              x: position.x,
              y: position.y,
            });
          }}
          className="rounded-xl shadow-2xl shadow-black/30 border border-border/50 overflow-hidden"
        >
          <div className="h-full flex flex-col relative">
            <ModuleFrame moduleId={moduleId} showTitleBar={true} />
            {/* Dock-back button (bottom-right of floating window) */}
            <button
              onClick={() => dockModule(moduleId)}
              className="absolute bottom-2 right-2 p-1.5 rounded-md bg-muted/80 backdrop-blur-sm border border-border/50 hover:bg-accent transition-colors z-10"
              title="Dock back to tiles"
            >
              <Anchor className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        </Rnd>
      ))}
    </div>
  );
}
