/**
 * GAP 2 down-payment — `SlackChannelAdapter` parity test.
 *
 * Proves the new adapter behaves identically to the prior inline
 * implementation in `apps/api/src/routes/slack.routes.ts` for the
 * functions that matter to the route layer:
 *
 *   - `verifySignature` (HMAC-SHA256 v0 + 5-min replay window)
 *   - `handleHandshake` (Slack `url_verification` challenge)
 *   - `extractInbound` (drops bot echoes / edits / non-message events)
 *   - `resolveTenant` (Integration lookup + cred decrypt)
 *
 * No Fastify, no real Prisma — the adapter takes a `decrypt` fn + a
 * `ChannelAdapterDb` stub via constructor, so the unit test is
 * dependency-free.
 */
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { SlackChannelAdapter } from '../../../apps/api/src/channels/slack-adapter.js';
import type { ChannelAdapterDb } from '../../../apps/api/src/channels/channel-adapter.js';

const SIGNING_SECRET = 'test-signing-secret';

function buildSlackHeaders(body: string, secret: string, timestamp?: number) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const baseString = `v0:${ts}:${body}`;
  const sig = 'v0=' + crypto.createHmac('sha256', secret).update(baseString).digest('hex');
  return {
    'x-slack-request-timestamp': String(ts),
    'x-slack-signature': sig,
  };
}

const noopLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'info',
  child: () => noopLog,
} as unknown as Parameters<SlackChannelAdapter['resolveTenant']>[2];

describe('SlackChannelAdapter.verifySignature', () => {
  const adapter = new SlackChannelAdapter(SIGNING_SECRET, () => '{}');

  it('accepts a valid signature within the replay window', () => {
    const body = JSON.stringify({ type: 'event_callback' });
    const headers = buildSlackHeaders(body, SIGNING_SECRET);
    expect(adapter.verifySignature(body, headers)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ type: 'event_callback' });
    const headers = buildSlackHeaders(body, SIGNING_SECRET);
    // Mutate the body — signature was for the original.
    expect(adapter.verifySignature(body + '_tampered', headers)).toBe(false);
  });

  it('rejects a request older than 5 minutes (replay window)', () => {
    const body = JSON.stringify({ type: 'event_callback' });
    const stale = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const headers = buildSlackHeaders(body, SIGNING_SECRET, stale);
    expect(adapter.verifySignature(body, headers)).toBe(false);
  });

  it('rejects when signing secret is missing', () => {
    const headerlessAdapter = new SlackChannelAdapter('', () => '{}');
    const body = '{}';
    const headers = buildSlackHeaders(body, SIGNING_SECRET);
    expect(headerlessAdapter.verifySignature(body, headers)).toBe(false);
  });
});

describe('SlackChannelAdapter.handleHandshake', () => {
  const adapter = new SlackChannelAdapter(SIGNING_SECRET, () => '{}');

  it('answers the `url_verification` handshake', () => {
    const result = adapter.handleHandshake({ type: 'url_verification', challenge: 'abc' });
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.response).toEqual({ challenge: 'abc' });
    }
  });

  it('passes through non-handshake events', () => {
    const result = adapter.handleHandshake({ type: 'event_callback' });
    expect(result.handled).toBe(false);
  });
});

describe('SlackChannelAdapter.extractInbound', () => {
  const adapter = new SlackChannelAdapter(SIGNING_SECRET, () => '{}');

  it('returns null for bot echo (event.bot_id present)', () => {
    expect(
      adapter.extractInbound({
        event: { type: 'message', bot_id: 'B123', text: 'hi', channel: 'C1' },
      }),
    ).toBeNull();
  });

  it('returns null for message edits / deletes (event.subtype present)', () => {
    expect(
      adapter.extractInbound({
        event: { type: 'message', subtype: 'message_changed', text: 'hi', channel: 'C1' },
      }),
    ).toBeNull();
  });

  it('returns null for non-message / non-app_mention types', () => {
    expect(
      adapter.extractInbound({
        event: { type: 'reaction_added', text: 'hi', channel: 'C1' },
      }),
    ).toBeNull();
  });

  it('returns a normalized message for plain user message', () => {
    const result = adapter.extractInbound({
      team_id: 'T123',
      event: {
        type: 'message',
        user: 'U99',
        text: 'hello there  ',
        channel: 'C1',
        ts: '1700000000.000100',
        thread_ts: '1700000000.000050',
      },
    });
    expect(result).not.toBeNull();
    expect(result!.text).toBe('hello there');
    expect(result!.externalUserId).toBe('U99');
    expect(result!.threadKey).toBe('C1:1700000000.000050');
    expect(result!.replyContext['_adapter']).toBe('slack');
    expect(result!.replyContext['channel']).toBe('C1');
    expect(result!.replyContext['threadTs']).toBe('1700000000.000050');
  });
});

describe('SlackChannelAdapter.resolveTenant', () => {
  it('returns null when no integration matches', async () => {
    const db: ChannelAdapterDb = {
      integration: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const adapter = new SlackChannelAdapter(SIGNING_SECRET, () => '{}');
    const result = await adapter.resolveTenant({ team_id: 'T1' }, db, noopLog);
    expect(result).toBeNull();
  });

  it('returns null when team_id is missing', async () => {
    const db: ChannelAdapterDb = {
      integration: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const adapter = new SlackChannelAdapter(SIGNING_SECRET, () => '{}');
    const result = await adapter.resolveTenant({}, db, noopLog);
    expect(result).toBeNull();
  });

  it('returns tenantId + accessToken on integration hit', async () => {
    const db: ChannelAdapterDb = {
      integration: {
        findFirst: vi.fn().mockResolvedValue({
          tenantId: 'tenant-xyz',
          credentials: { accessTokenEnc: 'encrypted-blob' },
        }),
      },
    };
    const decrypt = vi.fn().mockReturnValue(JSON.stringify({ bot_token: 'xoxb-real-token' }));
    const adapter = new SlackChannelAdapter(SIGNING_SECRET, decrypt);
    const result = await adapter.resolveTenant({ team_id: 'T1' }, db, noopLog);
    expect(result).toEqual({ tenantId: 'tenant-xyz', accessToken: 'xoxb-real-token' });
  });

  it('returns null on decrypt error (logs but does not throw)', async () => {
    const db: ChannelAdapterDb = {
      integration: {
        findFirst: vi.fn().mockResolvedValue({
          tenantId: 'tenant-xyz',
          credentials: { accessTokenEnc: 'encrypted-blob' },
        }),
      },
    };
    const decrypt = vi.fn().mockImplementation(() => {
      throw new Error('bad key');
    });
    const adapter = new SlackChannelAdapter(SIGNING_SECRET, decrypt);
    const result = await adapter.resolveTenant({ team_id: 'T1' }, db, noopLog);
    expect(result).toBeNull();
  });
});
