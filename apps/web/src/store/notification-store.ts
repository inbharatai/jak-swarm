import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Notification {
  id: string;
  moduleId: string;
  title: string;
  body?: string;
  priority: NotificationPriority;
  action?: { label: string; moduleId: string };
  read: boolean;
  timestamp: number;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isOpen: boolean;
}

interface NotificationActions {
  push: (notification: Omit<Notification, 'id' | 'read' | 'timestamp'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

let notifCounter = 0;

export const useNotificationStore = create<NotificationState & NotificationActions>()(
  immer((set) => ({
    notifications: [],
    unreadCount: 0,
    isOpen: false,

    push: (notification) => {
      set((state) => {
        notifCounter += 1;
        const newNotif: Notification = {
          ...notification,
          id: `notif-${notifCounter}-${Date.now()}`,
          read: false,
          timestamp: Date.now(),
        };
        state.notifications.unshift(newNotif);
        // Keep last 100 notifications
        if (state.notifications.length > 100) {
          state.notifications = state.notifications.slice(0, 100);
        }
        state.unreadCount = state.notifications.filter(n => !n.read).length;
      });
    },

    markRead: (id) => {
      set((state) => {
        const notif = state.notifications.find(n => n.id === id);
        if (notif) {
          notif.read = true;
          state.unreadCount = state.notifications.filter(n => !n.read).length;
        }
      });
    },

    markAllRead: () => {
      set((state) => {
        for (const n of state.notifications) {
          n.read = true;
        }
        state.unreadCount = 0;
      });
    },

    dismiss: (id) => {
      set((state) => {
        state.notifications = state.notifications.filter(n => n.id !== id);
        state.unreadCount = state.notifications.filter(n => !n.read).length;
      });
    },

    clearAll: () => {
      set((state) => {
        state.notifications = [];
        state.unreadCount = 0;
      });
    },

    setOpen: (open) => {
      set((state) => {
        state.isOpen = open;
      });
    },

    toggle: () => {
      set((state) => {
        state.isOpen = !state.isOpen;
      });
    },
  })),
);
