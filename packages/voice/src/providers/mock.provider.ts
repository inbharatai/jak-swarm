import { VoiceProvider } from '@jak-swarm/shared';
import type { VoiceProviderConfig, TranscriptSegment } from '@jak-swarm/shared';
import type { IVoiceProvider, VoiceSessionConfig } from './provider.interface.js';
import { generateId } from '@jak-swarm/shared';

/**
 * Mock voice provider for testing and local development.
 *
 * - createSession: returns a fake session config with a mock websocket URL
 * - transcribe: returns configurable fake transcript segments
 * - synthesize: returns a small silent MP3 buffer
 * - No external API calls
 * - Useful for CI pipelines and local dev without API keys
 */

// 10-byte silent MP3 (enough to be a valid buffer without actual audio)
const SILENT_MP3 = Buffer.from([
  0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const MOCK_TRANSCRIPTS: Record<string, string[]> = {
  default: [
    'Please process the intake form for the new patient.',
    'Can you summarize the last five support tickets?',
    'Schedule a meeting with the claims team for tomorrow.',
    'Generate a daily operations report for logistics.',
    'Draft a response to the customer complaint.',
  ],
  healthcare: [
    'Process the patient intake form for John Smith.',
    'Check the prior authorization status for procedure code 99213.',
    'Schedule an appointment with Dr. Johnson for next Tuesday.',
  ],
  retail: [
    'Process the return request for order number 12345.',
    'Check inventory levels for SKU ABC-001.',
    'Draft a response to the customer who left a negative review.',
  ],
  finance: [
    'Process the invoice from Vendor XYZ for $15,000.',
    'Generate the monthly reconciliation report.',
    'Flag the expense report for review — it exceeds the approval threshold.',
  ],
};

export class MockVoiceProvider implements IVoiceProvider {
  readonly providerType = VoiceProvider.MOCK;
  private readonly mockTranscripts: string[];
  private transcriptIndex = 0;

  constructor(options?: {
    transcripts?: string[];
    industry?: string;
  }) {
    const industry = options?.industry ?? 'default';
    this.mockTranscripts =
      options?.transcripts ??
      MOCK_TRANSCRIPTS[industry] ??
      MOCK_TRANSCRIPTS['default'] ?? [];
  }

  async createSession(_config: VoiceProviderConfig): Promise<VoiceSessionConfig> {
    const sessionId = generateId('mock_');

    return {
      sessionId,
      type: 'websocket',
      websocketUrl: `ws://localhost:9999/mock-voice/${sessionId}`,
      providerConfig: {
        note: 'This is a mock provider. No real audio is processed.',
        sessionId,
      },
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
    };
  }

  async endSession(_sessionId: string): Promise<void> {
    // No-op for mock
  }

  async transcribe(_audio: Buffer, _language = 'en'): Promise<TranscriptSegment[]> {
    const transcript = this.mockTranscripts[this.transcriptIndex % this.mockTranscripts.length]
      ?? 'Mock transcript segment.';
    this.transcriptIndex++;

    const words = transcript.split(' ');
    const msPerWord = 300;

    return [
      {
        id: generateId('seg_'),
        text: transcript,
        isFinal: true,
        startMs: 0,
        endMs: words.length * msPerWord,
      },
    ];
  }

  async synthesize(text: string, _voiceId?: string): Promise<Buffer> {
    // Return a silent audio buffer
    // In a real scenario this would return actual synthesized audio
    const headerComment = `[Mock TTS: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"]`;
    this.logMock('synthesize', headerComment);
    return SILENT_MP3;
  }

  getNextMockTranscript(): string {
    return this.mockTranscripts[this.transcriptIndex % this.mockTranscripts.length]
      ?? 'Mock transcript segment.';
  }

  resetTranscriptIndex(): void {
    this.transcriptIndex = 0;
  }

  private logMock(operation: string, details: string): void {
    if (process.env['NODE_ENV'] !== 'test') {
      console.log(`[MockVoiceProvider] ${operation}: ${details}`);
    }
  }
}
