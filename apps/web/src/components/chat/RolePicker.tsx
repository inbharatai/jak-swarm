'use client';

import React from 'react';
import { cn } from '@/lib/cn';
import { ROLE_LIST, getRoleColor, MAX_RECOMMENDED_ROLES, type RoleId } from '@/lib/role-config';
import { useConversationStore } from '@/store/conversation-store';

interface RolePickerProps {
  compact?: boolean;
}

export function RolePicker({ compact = false }: RolePickerProps) {
  const activeRoles = useConversationStore((s) => s.activeRoles);
  const toggleRole = useConversationStore((s) => s.toggleRole);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ROLE_LIST.map((role) => {
        const color = getRoleColor(role.id);
        const isActive = activeRoles.includes(role.id);
        const Icon = role.icon;

        return (
          <button
            key={role.id}
            onClick={() => toggleRole(role.id)}
            title={role.description}
            aria-pressed={isActive}
            className={cn(
              'role-chip border transition-all',
              isActive
                ? 'border-transparent text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80',
              compact && 'px-1.5 py-0.5 text-[10px]',
            )}
            style={
              isActive
                ? { backgroundColor: color.muted, borderColor: color.accent }
                : undefined
            }
          >
            <Icon className={cn('shrink-0', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} style={isActive ? { color: color.base } : undefined} />
            <span>{compact ? role.shortLabel : role.label}</span>
          </button>
        );
      })}

      {activeRoles.length > MAX_RECOMMENDED_ROLES && (
        <span className="text-[10px] text-muted-foreground/70 ml-1">
          {activeRoles.length} roles active — consider fewer for focused results
        </span>
      )}
    </div>
  );
}
