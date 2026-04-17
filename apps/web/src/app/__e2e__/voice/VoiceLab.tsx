'use client';

import React from 'react';
import { VoiceInput } from '@/components/voice/VoiceInput';
import { TranscriptPanel } from '@/components/voice/TranscriptPanel';
import { useVoice } from '@/hooks/useVoice';

export function VoiceLab() {
  const voice = useVoice();

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-6" data-testid="voice-lab">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold">Voice Lab</h1>
          <p className="text-sm text-muted-foreground">E2E harness for voice input and transcript UI.</p>
        </div>

        <div className="rounded-xl border bg-card p-4" data-testid="voice-input">
          <VoiceInput />
        </div>

        <TranscriptPanel
          segments={voice.transcript}
          partialTranscript={voice.partialTranscript}
          isListening={voice.isListening}
          className="min-h-[220px]"
        />
      </div>
    </div>
  );
}
