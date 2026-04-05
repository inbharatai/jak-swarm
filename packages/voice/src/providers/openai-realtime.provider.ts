import { VoiceProvider } from '@jak-swarm/shared';
import type { VoiceProviderConfig, TranscriptSegment } from '@jak-swarm/shared';
import type { IVoiceProvider, VoiceSessionConfig } from './provider.interface.js';
import { generateId } from '@jak-swarm/shared';

/**
 * OpenAI Realtime API provider.
 *
 * This provider uses the OpenAI Realtime API to enable real-time voice conversations.
 * The session creation flow:
 *
 * 1. Server calls POST /v1/realtime/sessions to get an ephemeral token (expires in 60s)
 * 2. Server returns the clientToken to the browser
 * 3. Browser uses the clientToken to establish a WebRTC peer connection directly with OpenAI
 * 4. Browser sends audio via WebRTC data channel
 * 5. OpenAI responds with audio/text in real-time via the WebRTC connection
 *
 * The browser NEVER sees the actual API key — only the short-lived ephemeral token.
 *
 * Requires: OPENAI_API_KEY environment variable
 */
export class OpenAIRealtimeProvider implements IVoiceProvider {
  readonly providerType = VoiceProvider.OPENAI_REALTIME;
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
    if (!this.apiKey) {
      console.warn(
        '[OpenAIRealtimeProvider] No API key provided. Set OPENAI_API_KEY environment variable.',
      );
    }
  }

  async createSession(config: VoiceProviderConfig): Promise<VoiceSessionConfig> {
    const sessionId = generateId('oai_rt_');
    const model = (config.model as string | undefined) ?? 'gpt-4o-realtime-preview-2024-12-17';
    const voice = config.voice ?? 'alloy';

    const response = await fetch(`${this.baseUrl}/realtime/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        // Turn detection settings
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        // Input/output audio formats
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        // Language
        language: config.language ?? 'en',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenAI Realtime session creation failed: ${response.status} ${response.statusText} — ${errorBody}`,
      );
    }

    const data = await response.json() as {
      id?: string;
      client_secret?: { value?: string; expires_at?: number };
    };

    const clientToken = data.client_secret?.value;
    const expiresAt = data.client_secret?.expires_at
      ? new Date(data.client_secret.expires_at * 1000)
      : new Date(Date.now() + 60000); // 60s default

    return {
      sessionId: data.id ?? sessionId,
      type: 'webrtc',
      ...(clientToken !== undefined && { clientToken }),
      // OpenAI Realtime uses STUN for WebRTC
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      expiresAt,
      providerConfig: {
        model,
        voice,
        /**
         * Client-side setup instructions:
         * 1. Create RTCPeerConnection with iceServers
         * 2. Add audio track (getUserMedia)
         * 3. Create data channel named "oai-events"
         * 4. Create SDP offer
         * 5. POST to https://api.openai.com/v1/realtime?model={model}
         *    with Authorization: Bearer {clientToken}
         *    and body: offer.sdp
         * 6. Set remote description from response
         * 7. Audio streams in real-time via WebRTC
         */
        clientSetupInstructions:
          'Use the clientToken to POST to https://api.openai.com/v1/realtime?model=<model> with SDP offer. See OpenAI Realtime API docs.',
      },
    };
  }

  async endSession(_sessionId: string): Promise<void> {
    // OpenAI Realtime sessions are terminated by the client closing the WebRTC connection.
    // Server-side there is no explicit close endpoint.
    // No-op here; the client is responsible for calling peerConnection.close()
  }

  async transcribe(audio: Buffer, language = 'en'): Promise<TranscriptSegment[]> {
    // Use Whisper API for non-realtime transcription
    const formData = new FormData();
    formData.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    formData.append('response_format', 'verbose_json');

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Whisper transcription failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      segments?: Array<{
        id: number;
        text: string;
        start: number;
        end: number;
      }>;
      text?: string;
    };

    if (data.segments) {
      return data.segments.map((seg) => ({
        id: String(seg.id),
        text: seg.text.trim(),
        isFinal: true,
        startMs: Math.round(seg.start * 1000),
        endMs: Math.round(seg.end * 1000),
      }));
    }

    // Fallback: single segment
    return [
      {
        id: '0',
        text: data.text ?? '',
        isFinal: true,
        startMs: 0,
      },
    ];
  }
}
