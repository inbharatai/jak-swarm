'use client';

import React, { useEffect } from 'react';
import { Dock } from './Dock';
import { ShellHeader } from './ShellHeader';
import { WindowManager } from './WindowManager';
import { FloatingLayer } from './FloatingLayer';
import { NotificationTray } from './NotificationTray';
import { useShellStore } from '@/store/shell-store';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useLayoutPersistence } from '@/hooks/useLayoutPersistence';
import { useNotificationBridge } from '@/hooks/useNotificationBridge';

export function PlatformShell() {
  const setReady = useShellStore(s => s.setReady);
  const openModule = useShellStore(s => s.openModule);
  const isReady = useShellStore(s => s.isReady);
  const openModules = useShellStore(s => s.openModules);

  // Persist layout to localStorage + backend (must run before default module logic)
  useLayoutPersistence();

  // Open default module only after persistence has had a chance to hydrate
  useEffect(() => {
    if (!isReady) {
      // Give persistence a tick to hydrate from localStorage
      const timer = setTimeout(() => {
        const state = useShellStore.getState();
        if (!state.isReady) {
          // Persistence didn't hydrate — mark ready and open default
          state.setReady(true);
          state.openModule('dashboard-home');
        }
      }, 100);
      return () => clearTimeout(timer);
    }
    // isReady is true (hydration happened), open default if nothing loaded
    if (openModules.size === 0) {
      openModule('dashboard-home');
    }
  }, [isReady, openModules.size, openModule, setReady]);

  // Register keyboard shortcuts
  useKeyboardShortcuts();

  // Bridge eventBus notifications into Zustand store
  useNotificationBridge();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Left dock */}
      <Dock />

      {/* Main area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header with module tabs */}
        <ShellHeader />

        {/* Tiled window manager */}
        <main className="flex-1 min-h-0 relative">
          <WindowManager />
        </main>
      </div>

      {/* Floating windows layer */}
      <FloatingLayer />

      {/* Notification tray */}
      <NotificationTray />
    </div>
  );
}
