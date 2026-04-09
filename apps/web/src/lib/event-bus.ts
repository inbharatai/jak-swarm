type EventCallback<T = unknown> = (payload: T) => void;

interface Subscription {
  unsubscribe: () => void;
}

export interface ModuleEvent<T = unknown> {
  source?: string;
  type: string;
  payload: T;
  timestamp: number;
}

class EventBus {
  private listeners = new Map<string, Set<EventCallback<any>>>();

  on<T>(eventType: string, callback: EventCallback<ModuleEvent<T>>): Subscription {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);

    return {
      unsubscribe: () => {
        this.listeners.get(eventType)?.delete(callback);
      },
    };
  }

  emit<T>(type: string, payload: T, source?: string): void {
    const event: ModuleEvent<T> = {
      source,
      type,
      payload,
      timestamp: Date.now(),
    };

    const callbacks = this.listeners.get(type);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(event);
        } catch (err) {
          console.error(`[EventBus] Error in handler for "${type}":`, err);
        }
      }
    }

    // Also emit to wildcard listeners
    const wildcardCallbacks = this.listeners.get('*');
    if (wildcardCallbacks) {
      for (const cb of wildcardCallbacks) {
        try {
          cb(event);
        } catch (err) {
          console.error(`[EventBus] Error in wildcard handler:`, err);
        }
      }
    }
  }

  off(eventType: string, callback?: EventCallback<any>): void {
    if (callback) {
      this.listeners.get(eventType)?.delete(callback);
    } else {
      this.listeners.delete(eventType);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

// Singleton instance
export const eventBus = new EventBus();

// ─── Typed event names ───────────────────────────────────────────────────────

export const SHELL_EVENTS = {
  // CEO → Swarm
  MISSION_LAUNCHED: 'mission:launched',
  MISSION_COMPLETED: 'mission:completed',
  // CMO → CRM
  LEAD_IDENTIFIED: 'lead:identified',
  CAMPAIGN_CREATED: 'campaign:created',
  // Workflow events
  WORKFLOW_STARTED: 'workflow:started',
  WORKFLOW_COMPLETED: 'workflow:completed',
  WORKFLOW_FAILED: 'workflow:failed',
  // Approval events
  APPROVAL_NEEDED: 'approval:needed',
  APPROVAL_DECIDED: 'approval:decided',
  // Module events
  MODULE_OPENED: 'module:opened',
  MODULE_CLOSED: 'module:closed',
  MODULE_FOCUSED: 'module:focused',
  // Notification
  NOTIFICATION_PUSH: 'notification:push',
} as const;
