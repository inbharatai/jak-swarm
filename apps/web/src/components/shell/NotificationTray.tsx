'use client';

import React from 'react';
import { X, CheckCheck, Trash2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useNotificationStore, type Notification } from '@/store/notification-store';
import { useShellStore } from '@/store/shell-store';
import { getModule } from '@/modules/registry';
import { formatDistanceToNow } from 'date-fns';

function NotificationItem({ notification }: { notification: Notification }) {
  const markRead = useNotificationStore(s => s.markRead);
  const dismiss = useNotificationStore(s => s.dismiss);
  const openModule = useShellStore(s => s.openModule);

  const moduleDef = notification.action?.moduleId
    ? getModule(notification.action.moduleId)
    : null;

  const handleClick = () => {
    markRead(notification.id);
    if (notification.action?.moduleId) {
      openModule(notification.action.moduleId);
    }
  };

  return (
    <div
      className={cn(
        'flex gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer hover:bg-muted/50',
        !notification.read && 'bg-primary/5',
      )}
      onClick={handleClick}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn('text-xs font-medium truncate', !notification.read && 'text-foreground')}>
            {notification.title}
          </p>
          {!notification.read && (
            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
          )}
        </div>
        {notification.body && (
          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{notification.body}</p>
        )}
        <p className="text-[9px] text-muted-foreground/60 mt-1">
          {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
        </p>
      </div>

      <div className="flex items-start gap-0.5 shrink-0">
        {notification.action?.moduleId && moduleDef && (
          <button
            onClick={(e) => { e.stopPropagation(); openModule(notification.action!.moduleId); }}
            className="p-1 rounded hover:bg-accent transition-colors"
            title={`Open ${moduleDef.title}`}
          >
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(notification.id); }}
          className="p-1 rounded hover:bg-destructive/20 transition-colors"
          title="Dismiss"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

export function NotificationTray() {
  const { notifications, isOpen, unreadCount } = useNotificationStore();
  const setOpen = useNotificationStore(s => s.setOpen);
  const markAllRead = useNotificationStore(s => s.markAllRead);
  const clearAll = useNotificationStore(s => s.clearAll);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />

      {/* Tray */}
      <div className="fixed right-3 top-12 z-[71] w-80 max-h-[70vh] flex flex-col rounded-xl border bg-popover shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-[10px] text-primary font-medium">{unreadCount} new</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="p-1 rounded hover:bg-accent transition-colors"
                title="Mark all as read"
              >
                <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="p-1 rounded hover:bg-accent transition-colors"
                title="Clear all"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded hover:bg-accent transition-colors"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-1.5">
          {notifications.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-xs text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {notifications.map(n => (
                <NotificationItem key={n.id} notification={n} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
