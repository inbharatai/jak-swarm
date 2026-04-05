'use client';

import React, { useRef } from 'react';
import {
  Mic,
  MicOff,
  Radio,
  Type,
  Globe,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Badge } from '@/components/ui';
import { useVoice } from '@/hooks/useVoice';
import type { VoiceMode } from '@/types';

interface VoiceInputProps {
  onTranscript?: (text: string) => void;
  className?: string;
}

const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Español' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'zh-CN', label: '中文 (简体)' },
  { value: 'pt-BR', label: 'Português (BR)' },
];

const PROVIDER_LABELS: Record<string, string> = {
  'realtime-api': 'Realtime API',
  deepgram: 'Deepgram',
  'browser-stt': 'Browser STT',
  text: 'Text',
};

// Waveform visualization
function Waveform({ active, level }: { active: boolean; level: number }) {
  const bars = 8;
  return (
    <div className="flex items-center gap-0.5 h-6">
      {Array.from({ length: bars }).map((_, i) => {
        const height = active
          ? Math.max(4, level * 24 * (0.5 + 0.5 * Math.sin((i / bars) * Math.PI + Date.now() / 200)))
          : 4;
        return (
          <div
            key={i}
            className={cn(
              'w-1 rounded-full bg-primary transition-all duration-100',
              active && 'waveform-bar',
            )}
            style={{ height: `${Math.round(height)}px` }}
          />
        );
      })}
    </div>
  );
}

export function VoiceInput({ onTranscript, className }: VoiceInputProps) {
  const {
    startListening,
    stopListening,
    transcript,
    partialTranscript,
    isListening,
    isSupported,
    isPermissionGranted,
    error,
    mode,
    setMode,
    provider,
    language,
    setLanguage,
    audioLevel,
  } = useVoice({ onFinalTranscript: onTranscript });

  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push-to-talk: hold to record
  const handleMouseDown = () => {
    if (mode !== 'push-to-talk') return;
    holdTimeoutRef.current = setTimeout(() => {
      startListening();
    }, 100);
  };

  const handleMouseUp = () => {
    if (mode !== 'push-to-talk') return;
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
    }
    if (isListening) stopListening();
  };

  const handleHandsFreeToggle = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  if (!isSupported) {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <MicOff className="h-4 w-4" />
        <span>Voice input not supported in this browser</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Mode selector */}
        <div className="flex rounded-md border bg-background p-0.5 text-xs">
          {(['push-to-talk', 'hands-free'] as VoiceMode[]).map(m => (
            <button
              key={m}
              onClick={() => {
                if (isListening) stopListening();
                setMode(m);
              }}
              className={cn(
                'rounded px-2 py-1 font-medium transition-colors',
                mode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'push-to-talk' ? 'Push-to-Talk' : 'Hands-Free'}
            </button>
          ))}
        </div>

        {/* Language selector */}
        <div className="flex items-center gap-1">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {LANGUAGES.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        {/* Provider badge */}
        <Badge variant="outline" className="text-xs">
          {PROVIDER_LABELS[provider] ?? provider}
        </Badge>
      </div>

      {/* Main input area */}
      <div className="flex items-center gap-3">
        {/* Push-to-talk button */}
        {mode === 'push-to-talk' && (
          <button
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchEnd={handleMouseUp}
            className={cn(
              'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 transition-all',
              isListening
                ? 'border-primary bg-primary text-primary-foreground scale-110 shadow-lg shadow-primary/30'
                : 'border-border bg-background text-muted-foreground hover:border-primary hover:text-primary',
            )}
            title="Hold to talk"
            aria-label={isListening ? 'Recording…' : 'Hold to talk'}
          >
            {isListening ? (
              <Mic className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
            {isListening && (
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
            )}
          </button>
        )}

        {/* Hands-free toggle button */}
        {mode === 'hands-free' && (
          <Button
            variant={isListening ? 'default' : 'outline'}
            size="icon"
            onClick={handleHandsFreeToggle}
            className={cn(
              'h-12 w-12 rounded-full',
              isListening && 'animate-pulse-slow',
            )}
          >
            {isListening ? <Radio className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </Button>
        )}

        {/* Waveform + status */}
        <div className="flex flex-1 items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2">
          <Waveform active={isListening} level={audioLevel} />
          <div className="flex-1 min-w-0">
            {isListening && partialTranscript && (
              <p className="text-sm text-muted-foreground truncate">
                {partialTranscript}
                <span className="ml-1 animate-pulse">|</span>
              </p>
            )}
            {!isListening && transcript.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {mode === 'push-to-talk' ? 'Hold button to speak' : 'Click button to start listening'}
              </p>
            )}
            {!isListening && transcript.length > 0 && (
              <p className="text-sm truncate">{transcript[transcript.length - 1]?.text}</p>
            )}
            {isListening && !partialTranscript && (
              <div className="flex items-center gap-2 text-xs text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                Listening…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Permission error / general error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <MicOff className="h-3.5 w-3.5 shrink-0" />
          {error}
          {isPermissionGranted === false && (
            <button
              onClick={() => window.open('about:blank', '_blank')}
              className="ml-auto underline"
            >
              How to enable
            </button>
          )}
        </div>
      )}

      {/* Full transcript recent */}
      {transcript.length > 0 && (
        <div className="max-h-20 overflow-y-auto rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
          {transcript.slice(-3).map(seg => (
            <p key={seg.id}>{seg.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}
