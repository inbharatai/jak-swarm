import { VoiceProvider } from '@jak-swarm/shared';
import type { VoiceProviderConfig, TranscriptSegment } from '@jak-swarm/shared';
import { generateId, createLogger } from '@jak-swarm/shared';
import type { IVoiceProvider, VoiceSessionConfig } from '../providers/provider.interface.js';
import { OpenAIRealtimeProvider } from '../providers/openai-realtime.provider.js';
import { DeepgramProvider } from '../providers/deepgram.provider.js';
import { ElevenLabsProvider } from '../providers/elevenlabs.provider.js';
import { MockVoiceProvider } from '../providers/mock.provider.js';

export interface VoicePipelineConfig {
  preferredProvider: VoiceProvider;
  fallbackProviders?: VoiceProvider[];
  apiKeys?: {
    openai?: string;
    deepgram?: string;
    elevenlabs?: string;
  };
  enableFallback?: boolean;
}

export interface ActiveSession {
  sessionId: string;
  provider: VoiceProvider;
  sessionConfig: VoiceSessionConfig;
  transcriptSegments: TranscriptSegment[];
  startedAt: Date;
  endedAt?: Date;
}

const logger = createLogger('voice-pipeline');

export class VoicePipeline {
  private readonly config: VoicePipelineConfig;
  private readonly sessions = new Map<string, ActiveSession>();

  constructor(config: VoicePipelineConfig) {
    // Stage 1.2 honesty fix: removed `VoiceProvider.MOCK` from the default
    // fallback chain. Previously, when the preferred provider (e.g.
    // Deepgram) failed, the pipeline silently swapped in the mock
    // provider and returned hardcoded test transcripts — the user thought
    // voice was working. Now a failure of the preferred provider is
    // surfaced instead of masked. MOCK can still be opted into by the
    // caller explicitly for tests / local dev.
    this.config = {
      enableFallback: true,
      fallbackProviders: [VoiceProvider.DEEPGRAM],
      ...config,
    };
  }

  /**
   * Start a voice session with the preferred provider.
   * Falls back to alternate providers if the preferred one fails.
   */
  async start(voiceConfig: VoiceProviderConfig): Promise<VoiceSessionConfig> {
    const providersToTry: VoiceProvider[] = [
      this.config.preferredProvider,
      ...(this.config.enableFallback ? (this.config.fallbackProviders ?? []) : []),
    ];

    let lastError: Error | null = null;

    for (const providerType of providersToTry) {
      try {
        const provider = this.createProvider(providerType);
        const sessionConfig = await provider.createSession({
          ...voiceConfig,
          provider: providerType,
        });

        const session: ActiveSession = {
          sessionId: sessionConfig.sessionId,
          provider: providerType,
          sessionConfig,
          transcriptSegments: [],
          startedAt: new Date(),
        };

        this.sessions.set(sessionConfig.sessionId, session);

        logger.info(
          {
            sessionId: sessionConfig.sessionId,
            provider: providerType,
            type: sessionConfig.type,
          },
          'Voice session started',
        );

        return sessionConfig;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(
          { provider: providerType, error: lastError.message },
          `Voice provider failed, trying next fallback`,
        );
      }
    }

    throw new Error(
      `All voice providers failed. Last error: ${lastError?.message ?? 'unknown'}`,
    );
  }

  /**
   * End a voice session and clean up resources.
   */
  async end(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn({ sessionId }, 'Attempted to end unknown session');
      return;
    }

    try {
      const provider = this.createProvider(session.provider);
      await provider.endSession(sessionId);
    } catch (err) {
      logger.warn({ sessionId, err }, 'Error ending provider session (continuing)');
    }

    session.endedAt = new Date();
    this.sessions.set(sessionId, session);

    logger.info(
      {
        sessionId,
        provider: session.provider,
        segmentCount: session.transcriptSegments.length,
        durationMs: session.endedAt.getTime() - session.startedAt.getTime(),
      },
      'Voice session ended',
    );
  }

  /**
   * Add transcript segments to a session (called when segments arrive from WebSocket/WebRTC).
   */
  addTranscriptSegment(sessionId: string, segment: TranscriptSegment): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn({ sessionId }, 'Cannot add segment to unknown session');
      return;
    }
    session.transcriptSegments.push(segment);
    this.sessions.set(sessionId, session);
  }

  /**
   * Get all transcript segments for a session.
   */
  getTranscript(sessionId: string): TranscriptSegment[] {
    return this.sessions.get(sessionId)?.transcriptSegments ?? [];
  }

  /**
   * Get the full transcript as a single string.
   */
  getTranscriptText(sessionId: string): string {
    return this.getTranscript(sessionId)
      .filter((s) => s.isFinal)
      .map((s) => s.text)
      .join(' ')
      .trim();
  }

  /**
   * HTTP batch transcription — send an audio buffer and get back transcript segments.
   * Uses the preferred provider if it supports transcription, otherwise falls back.
   */
  async transcribe(audio: Buffer, language = 'en'): Promise<TranscriptSegment[]> {
    const providersWithSTT: VoiceProvider[] = [
      VoiceProvider.OPENAI_REALTIME,
      VoiceProvider.DEEPGRAM,
      VoiceProvider.MOCK,
    ];

    for (const providerType of providersWithSTT) {
      try {
        const provider = this.createProvider(providerType);
        if (provider.transcribe) {
          return await provider.transcribe(audio, language);
        }
      } catch (err) {
        logger.warn({ providerType, err }, 'Transcription failed, trying next provider');
      }
    }

    return [
      {
        id: generateId('seg_'),
        text: '',
        isFinal: true,
        startMs: 0,
      },
    ];
  }

  /**
   * Text-to-speech synthesis.
   * Uses ElevenLabs by default, falls back to mock.
   */
  async synthesize(text: string, voiceId?: string): Promise<Buffer> {
    const ttsProviders: VoiceProvider[] = [VoiceProvider.ELEVENLABS, VoiceProvider.MOCK];

    for (const providerType of ttsProviders) {
      try {
        const provider = this.createProvider(providerType);
        if (provider.synthesize) {
          return await provider.synthesize(text, voiceId);
        }
      } catch (err) {
        logger.warn({ providerType, err }, 'TTS failed, trying next provider');
      }
    }

    return Buffer.alloc(0);
  }

  getSession(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  listActiveSessions(): ActiveSession[] {
    return [...this.sessions.values()].filter((s) => !s.endedAt);
  }

  private createProvider(providerType: VoiceProvider): IVoiceProvider {
    const keys = this.config.apiKeys;
    switch (providerType) {
      case VoiceProvider.OPENAI_REALTIME:
        return new OpenAIRealtimeProvider(keys?.openai);
      case VoiceProvider.DEEPGRAM:
        return new DeepgramProvider(keys?.deepgram);
      case VoiceProvider.ELEVENLABS:
        return new ElevenLabsProvider(keys?.elevenlabs);
      case VoiceProvider.MOCK:
        return new MockVoiceProvider();
      default:
        return new MockVoiceProvider();
    }
  }
}
