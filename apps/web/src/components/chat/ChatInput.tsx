'use client';

import React, { useRef, useCallback, useEffect } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useConversationStore } from '@/store/conversation-store';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSend, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRoles = useConversationStore((s) => s.activeRoles);

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) {
        onSend();
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }
  };

  const handleSend = () => {
    if (value.trim() && !disabled) {
      onSend();
      // Return focus to textarea after send
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  return (
    <div className="chat-input-area p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* Input row */}
      <div className={cn(
        'flex items-end gap-2 rounded-xl border border-border bg-card px-4 py-3 transition-colors',
        'focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20',
      )}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            activeRoles.length === 1
              ? `Message ${activeRoles[0].toUpperCase()}...`
              : `Message ${activeRoles.length} roles...`
          }
          disabled={disabled}
          rows={1}
          className={cn(
            'flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60',
            'focus:outline-none leading-relaxed',
            'disabled:opacity-50',
          )}
        />

        <button
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all',
            value.trim() && !disabled
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'text-muted-foreground/40',
          )}
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-1.5 text-center text-[10px] text-muted-foreground/40">
        JAK Swarm may produce inaccurate information. Verify important outputs.
      </p>
    </div>
  );
}
