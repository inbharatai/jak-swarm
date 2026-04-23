'use client';

import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/cn';
import { ROLES, getRoleColor } from '@/lib/role-config';
import type { Message } from '@/store/conversation-store';

interface MessageThreadProps {
  messages: Message[];
}

export function MessageThread({ messages }: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // Track how many messages existed before this render to only animate new ones
  const prevLength = prevLengthRef.current;
  useEffect(() => {
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  return (
    <div ref={scrollRef} className="message-scroll flex-1 overflow-y-auto px-4 py-6" data-testid="message-thread">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg, i) => {
          const isNew = i >= prevLength;
          return (
            <div
              key={msg.id}
              className={isNew ? 'animate-message-appear' : undefined}
              style={isNew ? { animationDelay: `${Math.min((i - prevLength) * 30, 200)}ms` } : undefined}
            >
              {msg.role === 'user' ? (
                <UserMessage content={msg.content} />
              ) : (
                <AssistantMessage
                  content={msg.content}
                  agentRole={msg.agentRole}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── User Message ────────────────────────────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end" data-testid="user-message">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-4 py-2.5 text-sm leading-relaxed text-foreground">
        {content}
      </div>
    </div>
  );
}

// ─── Assistant Message ───────────────────────────────────────────────────────

function AssistantMessage({
  content,
  agentRole,
}: {
  content: string;
  agentRole: string | null;
}) {
  const role = agentRole && agentRole in ROLES ? ROLES[agentRole as keyof typeof ROLES] : null;
  const color = role ? getRoleColor(role.id) : null;
  const Icon = role?.icon;

  return (
    <div className="flex gap-3" data-testid="assistant-message" data-agent-role={agentRole ?? ''}>
      {/* Role avatar */}
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={color ? { backgroundColor: color.muted } : { backgroundColor: 'hsl(var(--muted))' }}
      >
        {Icon ? (
          <Icon className="h-3.5 w-3.5" style={{ color: color?.base }} />
        ) : (
          <span className="text-[10px] font-bold text-muted-foreground">AI</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {/* Role label */}
        {role && (
          <span
            className="role-chip mb-1"
            style={{ backgroundColor: color?.muted, color: color?.base }}
          >
            {role.label}
          </span>
        )}

        {/* Message body */}
        <div
          className={cn(
            'rounded-2xl rounded-tl-md bg-card border border-border px-4 py-2.5 text-sm leading-relaxed text-foreground',
            agentRole && `role-border-${agentRole}`,
          )}
        >
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    </div>
  );
}
