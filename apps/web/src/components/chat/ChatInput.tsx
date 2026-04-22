'use client';

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Send, Mic, MicOff, Loader2, Paperclip, X, FileText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useConversationStore } from '@/store/conversation-store';
import { useVoice } from '@/hooks/useVoice';
import { documentApi, type TenantDocument } from '@/lib/api-client';

/**
 * Attachment shape carried in ChatInput state + surfaced to the parent.
 * Mirrors a TenantDocument row for ready docs; `status: 'uploading'` gets
 * a synthetic row while the POST /documents/upload is in flight.
 */
export interface ChatAttachment {
  id: string;               // server-assigned cuid once ready; temporary for uploading rows
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'uploading' | 'ready' | 'failed';
  errorMessage?: string;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  /**
   * Controlled attachments array. Owning this in the parent lets the parent
   * (ChatWorkspace) inject attachment references into the outgoing workflow
   * goal and clear them after send — without racing against component state.
   */
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
}

// Same accept + size limits as the /files page for consistency.
const ATTACH_ACCEPT = '.pdf,.txt,.md,.csv,.docx,.xlsx,.png,.jpg,.jpeg,.webp';
const ATTACH_MAX_BYTES = 25 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function tempId(): string {
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  attachments = [],
  onAttachmentsChange,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRoles = useConversationStore((s) => s.activeRoles);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Drag counter — the browser fires dragenter/leave for every child the
  // cursor crosses, so a naive boolean flickers. Incrementing on enter +
  // decrementing on leave gives us a stable "is hovering this zone" read.
  const dragDepth = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

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

  // ─── Attachment handling ─────────────────────────────────────────────────
  // Files get uploaded immediately on selection so the user sees the
  // "ready" chip before they hit Send. The doc ID/filename then piggy-backs
  // on the workflow goal text so agents (Legal / CMO / CTO / Finance / HR)
  // can resolve them via the find_document tool. No new backend surface —
  // this reuses POST /documents/upload from the Files tab (Track 2.5).

  const pushAttachments = useCallback(
    (next: ChatAttachment[]) => {
      onAttachmentsChange?.(next);
    },
    [onAttachmentsChange],
  );

  const uploadFile = useCallback(async (file: File) => {
    setAttachError(null);
    if (file.size > ATTACH_MAX_BYTES) {
      setAttachError(`${file.name} is ${formatBytes(file.size)} — max ${formatBytes(ATTACH_MAX_BYTES)}.`);
      return;
    }

    const tempRowId = tempId();
    const uploadingRow: ChatAttachment = {
      id: tempRowId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      status: 'uploading',
    };
    pushAttachments([...attachments, uploadingRow]);

    try {
      const res = await documentApi.upload(file);
      const doc: TenantDocument = res.data;
      pushAttachments([
        ...attachments.filter((a) => a.id !== tempRowId),
        {
          id: doc.id,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          status: 'ready',
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      // Mark the temp row as failed. The uploading row was added to `attachments`
      // a few lines up via pushAttachments, so it's guaranteed to be there.
      pushAttachments(
        [...attachments, uploadingRow].map((a) =>
          a.id === tempRowId
            ? { ...a, status: 'failed' as const, errorMessage: message }
            : a,
        ),
      );
      setAttachError(message);
    }
  }, [attachments, pushAttachments]);

  const handleFilesSelected = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    // Upload sequentially to avoid racing the controlled `attachments` state.
    (async () => {
      for (const file of arr) {
        await uploadFile(file);
      }
    })();
  }, [uploadFile]);

  const handleAttachClick = () => {
    if (disabled) return;
    setAttachError(null);
    fileInputRef.current?.click();
  };

  const handleRemoveAttachment = (id: string) => {
    pushAttachments(attachments.filter((a) => a.id !== id));
    // NOTE: we don't DELETE /documents/:id here — the doc stays in the
    // tenant's Files library for reuse. User can purge it from /files.
  };

  // ─── Drag-and-drop ───────────────────────────────────────────────────────
  // Matches Claude Code / Cursor pattern: drag a file anywhere over the
  // chat input region → highlights drop zone → release → uploads. Using
  // a depth counter so nested child dragenter/leave events don't flicker
  // the overlay.
  const handleDragEnter = (e: React.DragEvent) => {
    if (disabled) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFilesSelected(files);
    }
  };

  // ─── Clipboard paste ─────────────────────────────────────────────────────
  // Captures images pasted from the clipboard (screenshots, copy-from-browser).
  // Claude Code / Cursor rely heavily on this — it's the fastest way to share
  // a screenshot with an agent. Non-image clipboard data falls through to the
  // default textarea paste (normal text).
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          // Pasted screenshots often have a generic name like "image.png" —
          // prefix with timestamp so repeated pastes produce distinct docs.
          const renamed = new File(
            [file],
            `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}-${file.name || 'image.png'}`,
            { type: file.type },
          );
          imageFiles.push(renamed);
        }
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault(); // prevent the binary image bytes from being pasted as text
      handleFilesSelected(imageFiles);
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

  const hasUploading = attachments.some((a) => a.status === 'uploading');
  const canSend = (value.trim().length > 0 || attachments.some((a) => a.status === 'ready')) && !disabled && !hasUploading;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        if (isListening) stopListening();
        onSend();
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }
  };

  const handleSend = () => {
    if (canSend) {
      if (isListening) stopListening();
      onSend();
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const showVoiceError = voiceError && (isPermissionGranted === false || !voiceSupported);

  return (
    <div
      className={cn(
        'chat-input-area relative p-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
        isDragOver && 'bg-primary/5',
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop-zone overlay — only visible during an active drag. Matches
          Claude Code / Cursor visual language: dashed border + centered
          hint text. Pointer-events:none so dragleave fires on the parent
          when the cursor leaves the outer bounds. */}
      {isDragOver && (
        <div
          className="absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/60 bg-card/90 backdrop-blur-sm pointer-events-none"
          aria-hidden="true"
        >
          <div className="text-center">
            <Paperclip className="h-6 w-6 mx-auto mb-2 text-primary" />
            <p className="text-sm font-medium text-foreground">Drop files to attach</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, docs, images &middot; up to 25 MB</p>
          </div>
        </div>
      )}
      {/* Attachment chips — rendered ABOVE the input row so they're visible
          while the user is still typing. On mobile this stacks nicely above
          the input; on desktop it's a single wrapped row. */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" role="list" aria-label="Attached files">
          {attachments.map((a) => (
            <div
              key={a.id}
              role="listitem"
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-sans transition-colors',
                a.status === 'ready' && 'border-primary/30 bg-primary/10 text-foreground',
                a.status === 'uploading' && 'border-border bg-muted text-muted-foreground',
                a.status === 'failed' && 'border-destructive/40 bg-destructive/10 text-destructive',
              )}
              title={a.errorMessage || `${a.fileName} · ${formatBytes(a.sizeBytes)}`}
            >
              {a.status === 'uploading' ? (
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              ) : (
                <FileText className="h-3 w-3 shrink-0" />
              )}
              <span className="max-w-[180px] truncate">{a.fileName}</span>
              <span className="text-[10px] opacity-60">{formatBytes(a.sizeBytes)}</span>
              <button
                type="button"
                onClick={() => handleRemoveAttachment(a.id)}
                className="rounded p-0.5 opacity-60 hover:opacity-100 hover:bg-black/10"
                aria-label={`Remove ${a.fileName}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

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
          onPaste={handlePaste}
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

        {/* Hidden file input — triggered by the paperclip button. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACH_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            // Reset so selecting the same file twice in a row still fires.
            e.target.value = '';
          }}
        />

        {/* Paperclip (attach) button — before mic so it reads left-to-right
            as "attach, dictate, send". Wired to the existing /documents/upload
            pipeline; uploads land in the tenant's Files library and are
            resolvable by agents via the find_document tool. */}
        <button
          type="button"
          onClick={handleAttachClick}
          disabled={disabled}
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all',
            'text-muted-foreground hover:text-foreground hover:bg-muted',
            disabled && 'opacity-40 cursor-not-allowed',
          )}
          aria-label="Attach a file"
          title="Attach file (PDF, docs, images) — up to 25 MB"
        >
          <Paperclip className="h-4 w-4" />
        </button>

        {/* Mic button — only render when browser supports STT */}
        {voiceSupported && (
          <button
            type="button"
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
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all',
            canSend
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

      {/* Attachment error surface — size cap, auth failure, MIME reject. */}
      {attachError && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <X className="h-3 w-3 shrink-0" />
          <span className="truncate">{attachError}</span>
        </div>
      )}

      <p className="mt-1.5 text-center text-[10px] text-muted-foreground/40">
        JAK Swarm may produce inaccurate information. Verify important outputs.
      </p>
    </div>
  );
}
