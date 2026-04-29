/**
 * `SlackChannelAdapter` — Phase 1.1 down-payment for GAP 2.
 *
 * Implements the `ChannelAdapter` interface for Slack v0 webhooks. The
 * code lifted out of `slack.routes.ts` here is line-for-line identical
 * to the route's prior inline implementation — this is a refactor, not
 * a behavior change. After the route migrates to the adapter
 * (`slack.routes.ts` will import + delegate to this), the inline
 * versions get deleted.
 */

import crypto from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ChannelAdapter,
  ChannelAdapterDb,
  NormalizedInboundMessage,
  ReplyContext,
  ResolvedChannelTenant,
} from './channel-adapter.js';

/** Slack webhook payload — narrow shape mirroring the route's prior `SlackEvent`. */
interface SlackWebhookPayload {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: {
    type?: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
  };
}

export class SlackChannelAdapter implements ChannelAdapter {
  readonly channel = 'slack' as const;

  constructor(
    private readonly signingSecret: string,
    /** Lazy import for crypto helpers — `decrypt` lives in `apps/api/src/utils/crypto.ts`. */
    private readonly decrypt: (cipherText: string) => string,
  ) {}

  verifySignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const timestamp = first(headers['x-slack-request-timestamp']);
    const signature = first(headers['x-slack-signature']);
    if (!timestamp || !signature || !this.signingSecret) return false;

    // Replay protection — Slack docs recommend a 5-minute window.
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 300) return false;

    const baseString = `v0:${timestamp}:${rawBody}`;
    const expected =
      'v0=' +
      crypto
        .createHmac('sha256', this.signingSecret)
        .update(baseString)
        .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  handleHandshake(
    rawPayload: unknown,
  ): { handled: false } | { handled: true; response: unknown } {
    const payload = rawPayload as SlackWebhookPayload;
    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
      return { handled: true, response: { challenge: payload.challenge } };
    }
    return { handled: false };
  }

  extractInbound(rawPayload: unknown): NormalizedInboundMessage | null {
    const payload = rawPayload as SlackWebhookPayload;
    const ev = payload.event;

    // Drop bot echoes + message edits/deletes — these mirror the
    // existing route behavior in `slack.routes.ts:179`.
    if (!ev || ev.bot_id || ev.subtype) return null;

    // Only message + app_mention create real workflows.
    if (ev.type !== 'message' && ev.type !== 'app_mention') return null;

    const text = ev.text?.trim();
    if (!text || !ev.channel) return null;

    const replyContext: ReplyContext = {
      _adapter: 'slack',
      channel: ev.channel,
      // `ts` doubles as the thread root when a user opens a new thread;
      // existing replies preserve the thread by passing thread_ts.
      threadTs: ev.thread_ts ?? ev.ts ?? '',
    };

    return {
      externalMessageId: ev.ts ?? '',
      text,
      externalUserId: ev.user ?? '',
      threadKey: `${ev.channel}:${ev.thread_ts ?? ev.ts ?? ''}`,
      replyContext,
      occurredAt: ev.ts ? new Date(Number(ev.ts) * 1000) : null,
    };
  }

  async resolveTenant(
    rawPayload: unknown,
    db: ChannelAdapterDb,
    log: FastifyBaseLogger,
  ): Promise<ResolvedChannelTenant | null> {
    const payload = rawPayload as SlackWebhookPayload;
    const teamId = payload.team_id;
    if (!teamId) return null;

    const integration = (await db.integration.findFirst({
      where: {
        provider: 'SLACK',
        status: 'CONNECTED',
        metadata: { path: ['team_id'], equals: teamId },
      },
      include: { credentials: true },
    })) as
      | {
          tenantId: string;
          credentials: { accessTokenEnc: string } | null;
        }
      | null;

    if (!integration?.credentials) return null;

    let creds: Record<string, string>;
    try {
      creds = JSON.parse(this.decrypt(integration.credentials.accessTokenEnc)) as Record<
        string,
        string
      >;
    } catch (err) {
      log.error({ teamId, err }, '[slack-adapter] failed to decrypt credentials');
      return null;
    }
    const accessToken = creds['bot_token'] ?? creds['access_token'] ?? '';
    if (!accessToken) return null;

    return { tenantId: integration.tenantId, accessToken };
  }

  async reply(
    accessToken: string,
    context: ReplyContext,
    text: string,
    log: FastifyBaseLogger,
  ): Promise<void> {
    if (context['_adapter'] !== 'slack') {
      log.warn(
        { adapter: context['_adapter'] },
        '[slack-adapter] replyContext is for a different adapter — dropping reply',
      );
      return;
    }
    const channel = context['channel'] as string | undefined;
    const threadTs = context['threadTs'] as string | undefined;
    if (!channel || !threadTs) {
      log.warn('[slack-adapter] reply context missing channel or threadTs');
      return;
    }

    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel, thread_ts: threadTs, text }),
      });
      if (!res.ok) {
        log.warn({ status: res.status }, '[slack-adapter] failed to post reply');
      }
    } catch (err) {
      log.error({ err }, '[slack-adapter] error posting reply');
    }
  }
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
