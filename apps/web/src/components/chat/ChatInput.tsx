'use client';

import React, { useRef, useCallback, useEffect } from 'react';
import { Send, Mic, MicOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useConversationStore } from '@/store/conversation-store';
import { useVoice } from '@/hooks/useVoice';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSend, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRoles = useConversationStore((s) => s.activeRoles);

  // ─── Voice input ───────────────────────────────────────────────────────
  // Final transcripts flow into the textarea via onChange; the textarea
  // itself IS the "confirm before send" UI — nothing auto-dispatches.
  // This matches the landing-page promise of "speak your intent" without
  // the silent-launch failure mode the audit flagged.
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const handleFinalTranscript = useCallback((text: string) => {
    const prev = valueRef.current;
    const next = prev.trim().length === 0 ? text : `${prev} ${text}`;
    onChange(next);
  }, [onChange]);

  const {
    startListening,
    stopListening,
    isListening,
    isSupported: voiceSupported,
    isPermissionGranted,
    error: voiceError,
    partialTranscript,
  } = useVoice({ onFinalTranscript: handleFinalTranscript });

  const handleMicClick = () => {
    if (disabled) return;
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

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
        if (isListening) stopListening();
        onSend();
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }
  };

  const handleSend = () => {
    if (value.trim() && !disabled) {
      if (isListening) stopListening();
      onSend();
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const showVoiceError = voiceError && (isPermissionGranted === false || !voiceSupported);

  return (
    <div className="chat-input-area p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* Input row */}
      <div className={cn(
        'flex items-end gap-2 rounded-xl border border-border bg-card px-4 py-3 transition-colors',
        'focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20',
        isListening && 'border-primary/50 ring-1 ring-primary/20',
      )}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isListening
              ? (partialTranscript || 'Listening… speak now')
              : activeRoles.length === 1
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

        {/* Mic button — only render when browser supports STT */}
        {voiceSupported && (
          <button
            onClick={handleMicClick}
            disabled={disabled}
            className={cn(
              'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all',
              isListening
                ? 'bg-primary/15 text-primary hover:bg-primary/25'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              disabled && 'opacity-40 cursor-not-allowed',
            )}
            aria-label={isListening ? 'Stop listening' : 'Start voice input'}
            title={isListening ? 'Stop listening' : 'Dictate with voice'}
          >
            {isListening ? (
              <>
                <Mic className="h-4 w-4" />
                <span className="absolute inset-0 animate-ping rounded-lg bg-primary/15" />
              </>
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
        )}

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
          {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {/* Voice error surface — only shown for permission/support issues */}
      {showVoiceError && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <MicOff className="h-3 w-3 shrink-0" />
          <span className="truncate">{voiceError}</span>
        </div>
      )}

      <p className="mt-1.5 text-center text-[10px] text-muted-foreground/40">
        JAK Swarm may produce inaccurate information. Verify important outputs.
      </p>
    </div>
  );
}
