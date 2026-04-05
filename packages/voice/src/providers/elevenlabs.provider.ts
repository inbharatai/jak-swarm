import { VoiceProvider } from '@jak-swarm/shared';
import type { VoiceProviderConfig, TranscriptSegment } from '@jak-swarm/shared';
import type { IVoiceProvider, VoiceSessionConfig } from './provider.interface.js';
import { generateId } from '@jak-swarm/shared';

/**
 * ElevenLabs TTS and Conversational AI provider.
 *
 * Supports:
 * 1. Text-to-Speech: POST /v1/text-to-speech/{voice_id} — returns audio buffer (MP3)
 * 2. Conversational AI: WebSocket connection for real-time voice conversations
 *    wss://api.elevenlabs.io/v1/convai/conversation?agent_id={agentId}
 *
 * Requires: ELEVENLABS_API_KEY environment variable
 * Optional: ELEVENLABS_AGENT_ID for Conversational AI mode
 */
export class ElevenLabsProvider implements IVoiceProvider {
  readonly providerType = VoiceProvider.ELEVENLABS;
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.elevenlabs.io/v1';
  private readonly wsBaseUrl = 'wss://api.elevenlabs.io/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env['ELEVENLABS_API_KEY'] ?? '';
    if (!this.apiKey) {
      console.warn(
        '[ElevenLabsProvider] No API key provided. Set ELEVENLABS_API_KEY environment variable.',
      );
    }
  }

  async createSession(config: VoiceProviderConfig): Promise<VoiceSessionConfig> {
    const sessionId = generateId('el_');
    const agentId = (config.extraConfig?.['agentId'] as string | undefined) ??
      process.env['ELEVENLABS_AGENT_ID'];

    if (!agentId) {
      throw new Error(
        'ElevenLabs Conversational AI requires an agent_id. ' +
        'Set ELEVENLABS_AGENT_ID or provide in extraConfig.agentId.',
      );
    }

    // Get a signed URL for the WebSocket connection (avoids exposing API key in browser)
    let websocketUrl: string;

    try {
      const signedUrlResponse = await fetch(
        `${this.baseUrl}/convai/conversation/get_signed_url?agent_id=${agentId}`,
        {
          headers: {
            'xi-api-key': this.apiKey,
          },
        },
      );

      if (signedUrlResponse.ok) {
        const data = await signedUrlResponse.json() as { signed_url?: string };
        websocketUrl = data.signed_url ?? `${this.wsBaseUrl}/convai/conversation?agent_id=${agentId}`;
      } else {
        // Fallback to API key auth
        websocketUrl = `${this.wsBaseUrl}/convai/conversation?agent_id=${agentId}`;
      }
    } catch {
      websocketUrl = `${this.wsBaseUrl}/convai/conversation?agent_id=${agentId}`;
    }

    return {
      sessionId,
      type: 'websocket',
      websocketUrl,
      providerConfig: {
        agentId,
        voice: config.voice ?? 'Rachel',
        language: config.language ?? 'en',
        authHeader: `xi-api-key: ${this.apiKey}`,
        note: 'WebSocket expects audio_chunk messages (base64 PCM16) and returns audio/text responses',
      },
    };
  }

  async endSession(_sessionId: string): Promise<void> {
    // ElevenLabs Conversational AI sessions are closed by the client.
    // Send { type: "conversation_initiation_client_data", ... } then close the WebSocket.
  }

  async synthesize(text: string, voiceId?: string): Promise<Buffer> {
    const voice = voiceId ?? process.env['ELEVENLABS_VOICE_ID'] ?? 'Rachel';

    const response = await fetch(`${this.baseUrl}/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `ElevenLabs TTS failed: ${response.status} ${response.statusText} — ${errorBody}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async transcribe(_audio: Buffer, _language = 'en'): Promise<TranscriptSegment[]> {
    // ElevenLabs is primarily a TTS provider.
    // For STT, use OpenAI Realtime or Deepgram.
    throw new Error(
      'ElevenLabsProvider does not support STT transcription. Use OpenAIRealtimeProvider or DeepgramProvider for transcription.',
    );
  }

  /**
   * List available voices.
   */
  async listVoices(): Promise<Array<{ voiceId: string; name: string; previewUrl: string }>> {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list ElevenLabs voices: ${response.status}`);
    }

    const data = await response.json() as {
      voices?: Array<{
        voice_id: string;
        name: string;
        preview_url: string;
      }>;
    };

    return (data.voices ?? []).map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      previewUrl: v.preview_url,
    }));
  }
}
