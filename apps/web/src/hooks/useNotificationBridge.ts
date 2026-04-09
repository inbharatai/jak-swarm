'use client';

import { useEffect } from 'react';
import { eventBus, SHELL_EVENTS } from '@/lib/event-bus';
import { useNotificationStore } from '@/store/notification-store';

/**
 * Bridges eventBus NOTIFICATION_PUSH events into the notification Zustand store.
 * Must be mounted once in PlatformShell.
 */
export function useNotificationBridge() {
  useEffect(() => {
    const sub = eventBus.on(SHELL_EVENTS.NOTIFICATION_PUSH, (event) => {
      const payload = event.payload as Record<string, unknown>;
      if (!payload || typeof payload.title !== 'string' || typeof payload.moduleId !== 'string') return;
      useNotificationStore.getState().push({
        moduleId: payload.moduleId,
        title: payload.title,
        body: typeof payload.body === 'string' ? payload.body : undefined,
        priority: (['low', 'normal', 'high', 'urgent'] as const).includes(payload.priority as any)
          ? (payload.priority as 'low' | 'normal' | 'high' | 'urgent')
          : 'normal',
        action: payload.action && typeof (payload.action as any).label === 'string'
          ? (payload.action as { label: string; moduleId: string })
          : undefined,
      });
    });
    return () => sub.unsubscribe();
  }, []);
}
