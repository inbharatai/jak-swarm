/**
 * Voice Pipeline — Behavioral Tests
 *
 * Tests the real VoicePipeline class with the MockVoiceProvider.
 * Verifies session lifecycle, transcript management, provider fallback,
 * and TTS/STT contracts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VoicePipeline } from '@jak-swarm/voice';
import { VoiceProvider } from '@jak-swarm/shared';

describe('VoicePipeline — Behavioral', () => {
  let pipeline: VoicePipeline;

  beforeEach(() => {
    pipeline = new VoicePipeline({
      preferredProvider: VoiceProvider.MOCK,
      enableFallback: false,
    });
  });

  it('creates a session and returns a valid sessionId', async () => {
    const session = await pipeline.start({
      mode: 'realtime',
      model: 'gpt-4o-realtime',
      voice: 'alloy',
    });

    expect(session).toBeDefined();
    expect(session.sessionId).toBeTruthy();
    expect(typeof session.sessionId).toBe('string');
  });

  it('ends a session without error', async () => {
    const session = await pipeline.start({
      mode: 'realtime',
      model: 'gpt-4o-realtime',
      voice: 'alloy',
    });

    await expect(pipeline.end(session.sessionId)).resolves.not.toThrow();
  });

  it('ending an unknown session does not throw', async () => {
    await expect(pipeline.end('nonexistent_session_id')).resolves.not.toThrow();
  });

  it('tracks transcript segments for a session', async () => {
    const session = await pipeline.start({
      mode: 'realtime',
      model: 'gpt-4o-realtime',
      voice: 'alloy',
    });

    pipeline.addTranscriptSegment(session.sessionId, {
      id: 'seg_1',
      text: 'Hello world',
      isFinal: true,
      startMs: 0,
    });

    pipeline.addTranscriptSegment(session.sessionId, {
      id: 'seg_2',
      text: 'How are you',
      isFinal: true,
      startMs: 1000,
    });

    const transcript = pipeline.getTranscript(session.sessionId);
    expect(transcript).toHaveLength(2);
    expect(transcript[0]!.text).toBe('Hello world');
    expect(transcript[1]!.text).toBe('How are you');
  });

  it('getTranscriptText joins final segments', async () => {
    const session = await pipeline.start({
      mode: 'realtime',
      model: 'gpt-4o-realtime',
      voice: 'alloy',
    });

    pipeline.addTranscriptSegment(session.sessionId, {
      id: 'seg_a',
      text: 'First sentence.',
      isFinal: true,
      startMs: 0,
    });
    pipeline.addTranscriptSegment(session.sessionId, {
      id: 'seg_b',
      text: 'partially heard',
      isFinal: false,
      startMs: 500,
    });
    pipeline.addTranscriptSegment(session.sessionId, {
      id: 'seg_c',
      text: 'Second sentence.',
      isFinal: true,
      startMs: 1000,
    });

    const text = pipeline.getTranscriptText(session.sessionId);
    expect(text).toBe('First sentence. Second sentence.');
    // Non-final segment excluded
    expect(text).not.toContain('partially');
  });

  it('getTranscript returns empty array for unknown session', () => {
    const transcript = pipeline.getTranscript('nonexistent');
    expect(transcript).toEqual([]);
  });

  it('transcribe returns at least one segment from mock provider', async () => {
    const audio = Buffer.from('fake audio data');
    const segments = await pipeline.transcribe(audio, 'en');

    expect(segments).toBeDefined();
    expect(segments.length).toBeGreaterThanOrEqual(1);
    // Each segment should have the right shape
    for (const seg of segments) {
      expect(seg.id).toBeTruthy();
      expect(typeof seg.isFinal).toBe('boolean');
    }
  });

  it('synthesize returns a Buffer from mock provider', async () => {
    const result = await pipeline.synthesize('Hello world', 'alloy');

    expect(result).toBeInstanceOf(Buffer);
  });

  it('falls back to mock provider when preferred fails', async () => {
    const fallbackPipeline = new VoicePipeline({
      preferredProvider: VoiceProvider.OPENAI_REALTIME, // Will fail without API key
      fallbackProviders: [VoiceProvider.MOCK],
      enableFallback: true,
    });

    const session = await fallbackPipeline.start({
      mode: 'realtime',
      model: 'gpt-4o-realtime',
      voice: 'alloy',
    });

    expect(session).toBeDefined();
    expect(session.sessionId).toBeTruthy();
  }, 20_000);

  it('multiple sessions are tracked independently', async () => {
    const s1 = await pipeline.start({ mode: 'realtime', model: 'gpt-4o-realtime', voice: 'alloy' });
    const s2 = await pipeline.start({ mode: 'realtime', model: 'gpt-4o-realtime', voice: 'echo' });

    pipeline.addTranscriptSegment(s1.sessionId, { id: 'a1', text: 'Session one', isFinal: true, startMs: 0 });
    pipeline.addTranscriptSegment(s2.sessionId, { id: 'b1', text: 'Session two', isFinal: true, startMs: 0 });

    expect(pipeline.getTranscript(s1.sessionId)).toHaveLength(1);
    expect(pipeline.getTranscript(s2.sessionId)).toHaveLength(1);
    expect(pipeline.getTranscriptText(s1.sessionId)).toBe('Session one');
    expect(pipeline.getTranscriptText(s2.sessionId)).toBe('Session two');
  });
});
