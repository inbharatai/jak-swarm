'use client';

import React, { useCallback } from 'react';
import { Mosaic, MosaicWindow, type MosaicNode } from 'react-mosaic-component';
import { useShellStore } from '@/store/shell-store';
import { ModuleFrame } from './ModuleFrame';
import { getModule } from '@/modules/registry';

import 'react-mosaic-component/react-mosaic-component.css';

// ─── Custom toolbar for mosaic windows ───────────────────────────────────────

function EmptyToolbar() {
  return <div aria-hidden="true" className="mosaic-window-title" />;
}

// ─── Window Manager ──────────────────────────────────────────────────────────

export function WindowManager() {
  const layoutTree = useShellStore(s => s.layoutTree);
  const setLayoutTree = useShellStore(s => s.setLayoutTree);
  const openModules = useShellStore(s => s.openModules);

  const handleChange = useCallback(
    (newTree: MosaicNode<string> | null) => {
      setLayoutTree(newTree);
    },
    [setLayoutTree],
  );

  const renderTile = useCallback(
    (id: string, path: number[]) => {
      const moduleDef = getModule(id);
      if (!moduleDef) {
        return (
          <MosaicWindow<string>
            path={path}
            title=""
            renderToolbar={EmptyToolbar}
            className="mosaic-window-custom"
          >
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Module "{id}" not found
            </div>
          </MosaicWindow>
        );
      }

      return (
        <MosaicWindow<string>
          path={path}
          title=""
          renderToolbar={EmptyToolbar}
          className="mosaic-window-custom"
        >
          <ModuleFrame moduleId={id} showTitleBar={true} />
        </MosaicWindow>
      );
    },
    [],
  );

  // Nothing tiled — show welcome
  if (!layoutTree || openModules.size === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3 max-w-md px-4">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <svg className="h-8 w-8 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </div>
          </div>
          <h3 className="text-lg font-display font-semibold">Open a module to get started</h3>
          <p className="text-sm text-muted-foreground">
            Click any module in the dock to open it here. Drag edges to resize. Use the title bar to float, minimize, or close modules.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Mosaic<string>
      renderTile={renderTile}
      value={layoutTree}
      onChange={handleChange}
      className="mosaic-jak-theme"
      resize={{ minimumPaneSizePercentage: 10 }}
    />
  );
}
