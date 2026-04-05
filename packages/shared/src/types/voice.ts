export enum VoiceProvider {
  OPENAI_REALTIME = 'OPENAI_REALTIME',
  DEEPGRAM = 'DEEPGRAM',
  ELEVENLABS = 'ELEVENLABS',
  MOCK = 'MOCK',
}

export enum VoiceMode {
  PUSH_TO_TALK = 'PUSH_TO_TALK',
  HANDS_FREE = 'HANDS_FREE',
  TEXT_ONLY = 'TEXT_ONLY',
}

export interface TranscriptSegment {
  id: string;
  text: string;
  isFinal: boolean;
  startMs: number;
  endMs?: number;
  speaker?: string;
}

export interface VoiceSession {
  sessionId: string;
  tenantId: string;
  userId: string;
  provider: VoiceProvider;
  mode: VoiceMode;
  language: string;
  startedAt: Date;
  endedAt?: Date;
  segments: TranscriptSegment[];
}

export interface VoiceProviderConfig {
  provider: VoiceProvider;
  apiKey?: string;
  model?: string;
  language: string;
  /** TTS voice ID (e.g. ElevenLabs voice) */
  voice?: string;
  extraConfig: Record<string, unknown>;
}
