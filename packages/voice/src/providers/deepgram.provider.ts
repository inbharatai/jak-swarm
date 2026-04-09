import { VoiceProvider } from '@jak-swarm/shared';
import type { VoiceProviderConfig, TranscriptSegment } from '@jak-swarm/shared';
import type { IVoiceProvider, VoiceSessionConfig } from './provider.interface.js';
import { generateId } from '@jak-swarm/shared';

/**
 * Deepgram STT provider.
 *
 * Supports two modes:
 * 1. Live streaming: WebSocket connection to Deepgram's streaming API
 * 2. Batch transcription: HTTP POST to /v1/listen
 *
 * Requires: DEEPGRAM_API_KEY environment variable
 *
 * WebSocket URL format:
 * wss://api.deepgram.com/v1/listen?model=nova-2&language=en&punctuate=true&...
 *
 * The API key is passed as a query parameter or Authorization header.
 * For browser clients, use a short-lived Deepgram temporary key instead.
 */
export class DeepgramProvider implements IVoiceProvider {
  readonly providerType = VoiceProvider.DEEPGRAM;
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.deepgram.com/v1';
  private readonly wsBaseUrl = 'wss://api.deepgram.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env['DEEPGRAM_API_KEY'] ?? '';
    if (!this.apiKey) {
      console.warn(
        '[DeepgramProvider] No API key provided. Set DEEPGRAM_API_KEY environment variable.',
      );
    }
  }

  async createSession(config: VoiceProviderConfig): Promise<VoiceSessionConfig> {
    const sessionId = generateId('dg_');
    const language = config.language ?? 'en';
    const model = (config.model as string | undefined) ?? 'nova-2';

    // Build WebSocket URL with query parameters
    const params = new URLSearchParams({
      model,
      language,
      punctuate: 'true',
      diarize: 'false',
      smart_format: 'true',
      interim_results: 'true',
      utterance_end_ms: '1000',
      vad_events: 'true',
      encoding: 'linear16',
      sample_rate: '16000',
    });

    // For production: use a temporary key instead of the raw API key in the WebSocket URL
    // The server should generate a temporary key: POST /v1/keys { time_to_live_in_seconds: 60 }
    let wsUrl: string;

    try {
      const tempKey = await this.createTemporaryKey(60);
      wsUrl = `${this.wsBaseUrl}/listen?${params.toString()}&token=${tempKey}`;
    } catch {
      // Refuse to expose the raw API key in a WebSocket URL — require temporary key
      throw new Error('Failed to create temporary Deepgram key. Cannot start session without a temporary key (raw API key in URLs is a security risk).');
    }

    return {
      sessionId,
      type: 'websocket',
      websocketUrl: wsUrl,
      providerConfig: {
        model,
        language,
        authHeader: `Token ${this.apiKey}`,
        note: 'Pass the Authorization header when connecting to the WebSocket URL',
      },
    };
  }

  async endSession(_sessionId: string): Promise<void> {
    // Deepgram WebSocket sessions are closed by the client.
    // Send a CloseStream message or simply close the WebSocket connection.
  }

  async transcribe(audio: Buffer, language = 'en'): Promise<TranscriptSegment[]> {
    const params = new URLSearchParams({
      model: 'nova-2',
      language,
      punctuate: 'true',
      smart_format: 'true',
      paragraphs: 'true',
    });

    const response = await fetch(`${this.baseUrl}/listen?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: audio,
    });

    if (!response.ok) {
      throw new Error(
        `Deepgram transcription failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json() as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{
            transcript?: string;
            words?: Array<{
              word: string;
              start: number;
              end: number;
            }>;
          }>;
        }>;
        utterances?: Array<{
          id?: string;
          transcript: string;
          start: number;
          end: number;
          speaker?: number;
        }>;
      };
    };

    const utterances = data.results?.utterances;
    if (utterances && utterances.length > 0) {
      return utterances.map((utt, idx) => ({
        id: utt.id ?? String(idx),
        text: utt.transcript,
        isFinal: true,
        startMs: Math.round(utt.start * 1000),
        endMs: Math.round(utt.end * 1000),
        ...(utt.speaker !== undefined && { speaker: `Speaker ${utt.speaker}` }),
      }));
    }

    // Fallback: use channel transcript
    const transcript =
      data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

    return [
      {
        id: '0',
        text: transcript,
        isFinal: true,
        startMs: 0,
      },
    ];
  }

  private async createTemporaryKey(ttlSeconds: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/keys`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: 'JAK Swarm temporary key',
        time_to_live_in_seconds: ttlSeconds,
        tags: ['jak-swarm'],
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create Deepgram temporary key: ${response.status}`);
    }

    const data = await response.json() as { key?: string };
    if (!data.key) throw new Error('Deepgram temporary key response missing key field');
    return data.key;
  }
}
