import type { VoiceProvider, VoiceProviderConfig, TranscriptSegment } from '@jak-swarm/shared';

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface VoiceSessionConfig {
  sessionId: string;
  type: 'webrtc' | 'websocket' | 'http';
  /** For WebRTC: ephemeral token for client-side use with OpenAI Realtime API */
  clientToken?: string;
  /** For WebSocket: the connection URL */
  websocketUrl?: string;
  /** For WebRTC: ICE servers configuration */
  iceServers?: RTCIceServer[];
  /** Provider-specific additional configuration */
  providerConfig?: Record<string, unknown>;
  /** When this session/token expires */
  expiresAt?: Date;
}

export interface IVoiceProvider {
  readonly providerType: VoiceProvider;

  /**
   * Create a session and return configuration for WebRTC/WebSocket setup on the client.
   * For OpenAI Realtime: returns an ephemeral token for browser WebRTC.
   * For Deepgram: returns a WebSocket URL.
   * For ElevenLabs: returns a WebSocket URL for conversational AI.
   */
  createSession(config: VoiceProviderConfig): Promise<VoiceSessionConfig>;

  /**
   * End/clean up a session.
   */
  endSession(sessionId: string): Promise<void>;

  /**
   * HTTP-based STT: transcribe an audio buffer (non-streaming).
   * Optional — only implemented by providers that support batch transcription.
   */
  transcribe?(audio: Buffer, language?: string): Promise<TranscriptSegment[]>;

  /**
   * HTTP-based TTS: synthesize text to an audio buffer.
   * Optional — only implemented by providers that support TTS.
   */
  synthesize?(text: string, voiceId?: string): Promise<Buffer>;
}
