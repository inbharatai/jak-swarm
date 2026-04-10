'use client';

import { useEffect } from 'react';
import { eventBus, SHELL_EVENTS } from '@/lib/event-bus';
import { useNotificationStore } from '@/store/notification-store';

const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
type Priority = (typeof VALID_PRIORITIES)[number];

function isValidPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (VALID_PRIORITIES as readonly string[]).includes(v);
}

function isActionPayload(v: unknown): v is { label: string; moduleId: string } {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.label === 'string' && typeof obj.moduleId === 'string';
}

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
        priority: isValidPriority(payload.priority) ? payload.priority : 'normal',
        action: isActionPayload(payload.action) ? payload.action : undefined,
      });
    });
    return () => sub.unsubscribe();
  }, []);
}
