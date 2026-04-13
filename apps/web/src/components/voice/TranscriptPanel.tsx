'use client';

import React, { useEffect, useRef } from 'react';
import { Copy, Download, User2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/cn';
import { Button, EmptyState } from '@/components/ui';
import type { TranscriptSegment } from '@/types';

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  partialTranscript?: string;
  isListening?: boolean;
  className?: string;
}

export function TranscriptPanel({
  segments,
  partialTranscript,
  isListening,
  className,
}: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments, partialTranscript]);

  const handleCopy = () => {
    const text = segments.map(s => s.text).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleExport = () => {
    const lines = segments.map(seg => {
      const time = format(new Date(seg.timestamp), 'HH:mm:ss');
      const speaker = seg.speaker ?? 'User';
      return `[${time}] ${speaker}: ${seg.text}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn('flex flex-col rounded-xl border bg-card', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Transcript</h3>
          {isListening && (
            <span className="flex items-center gap-1 text-xs text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              Live
            </span>
          )}
          {segments.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {segments.length} segment{segments.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopy}
            aria-label="Copy transcript"
            title="Copy transcript"
            disabled={segments.length === 0}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleExport}
            aria-label="Export transcript"
            title="Export transcript"
            disabled={segments.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Transcript content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {segments.length === 0 && !partialTranscript ? (
          <EmptyState
            icon={<User2 className="h-5 w-5" />}
            title="No transcript yet"
            description="Start speaking to see your transcript here"
          />
        ) : (
          <>
            {segments.map(seg => (
              <TranscriptSegmentItem key={seg.id} segment={seg} />
            ))}

            {/* Partial transcript in progress */}
            {partialTranscript && (
              <div className="flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User2 className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground italic">
                    {partialTranscript}
                    <span className="ml-1 animate-pulse not-italic">|</span>
                  </p>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function TranscriptSegmentItem({ segment }: { segment: TranscriptSegment }) {
  return (
    <div className="flex gap-3 group">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <User2 className="h-3 w-3 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-xs font-medium">
            {segment.speaker ?? 'User'}
          </span>
          <span className="text-xs text-muted-foreground">
            {format(new Date(segment.timestamp), 'HH:mm:ss')}
          </span>
          {segment.language && segment.language !== 'en-US' && (
            <span className="text-xs text-muted-foreground">[{segment.language}]</span>
          )}
        </div>
        <p className={cn('text-sm break-words', !segment.isFinal && 'text-muted-foreground italic')}>
          {segment.text}
        </p>
      </div>
    </div>
  );
}
