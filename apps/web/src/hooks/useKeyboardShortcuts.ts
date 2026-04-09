'use client';

import { useEffect } from 'react';
import { useShellStore } from '@/store/shell-store';
import { MODULE_DEFINITIONS } from '@/modules/registry';

export function useKeyboardShortcuts() {
  const openModules = useShellStore(s => s.openModules);
  const activeModuleId = useShellStore(s => s.activeModuleId);
  const setActiveModule = useShellStore(s => s.setActiveModule);
  const closeModule = useShellStore(s => s.closeModule);
  const minimizeModule = useShellStore(s => s.minimizeModule);
  const dockOrder = useShellStore(s => s.dockOrder);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+1..9 — switch to module by visual dock order (not insertion order)
      if (isCtrl && e.key >= '1' && e.key <= '9') {
        const openIds = dockOrder.filter(id => openModules.has(id));
        const index = parseInt(e.key, 10) - 1;
        if (index < openIds.length) {
          e.preventDefault();
          setActiveModule(openIds[index]);
        }
      }

      // Alt+W — close active module (Ctrl+W is browser-reserved)
      if (e.altKey && e.key === 'w') {
        if (activeModuleId) {
          e.preventDefault();
          closeModule(activeModuleId);
        }
      }

      // Alt+M — minimize active module (Ctrl+M is browser-reserved on Windows)
      if (e.altKey && e.key === 'm') {
        if (activeModuleId) {
          e.preventDefault();
          minimizeModule(activeModuleId);
        }
      }

      // Ctrl+Shift+A — open all modules quick list (like VS Code's Ctrl+Tab)
      if (isCtrl && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        // Cycle to next open module
        const openIds = Array.from(openModules.keys());
        if (openIds.length > 1 && activeModuleId) {
          const currentIndex = openIds.indexOf(activeModuleId);
          const nextIndex = (currentIndex + 1) % openIds.length;
          setActiveModule(openIds[nextIndex]);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openModules, activeModuleId, setActiveModule, closeModule, minimizeModule, dockOrder]);
}
