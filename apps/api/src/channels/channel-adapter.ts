/**
 * GAP 2 — Shared `ChannelAdapter` interface (Phase 1.1 down-payment).
 *
 * Today, Slack at `apps/api/src/routes/slack.routes.ts` and WhatsApp at
 * `apps/api/src/routes/whatsapp.routes.ts` each implement their own
 * webhook signature check, payload parser, tenant resolver, and outbound
 * messenger. There is no shared contract — a bug fix in Slack does not
 * propagate to WhatsApp, and a new channel (Discord, Telegram, etc.)
 * has nothing to extend.
 *
 * This file defines the contract every channel adapter must satisfy.
 * Phase 1.1 ships:
 *   - The interface (this file)
 *   - A `SlackChannelAdapter` (./slack-adapter.ts) implementing it
 *   - The Slack route migrated to use the adapter
 *
 * Phase 2 will migrate WhatsApp + Gmail. The reason they aren't migrated
 * here is honest, not lazy: each migration touches an in-flight inbound
 * code path + tenant secret-rotation contract + integration tests, and
 * doing all three in one session would breach the "no half measures"
 * bar. The down-payment proves the abstraction is real (one channel
 * actually uses it) without rushing the others.
 */

import type { FastifyBaseLogger } from 'fastify';

/**
 * The channel-agnostic shape every adapter must produce when an inbound
 * webhook fires. The route layer uses this shape to dispatch to a
 * workflow without knowing which channel originated the message.
 */
export interface NormalizedInboundMessage {
  /** Stable identifier the channel uses for THIS message — for idempotency. */
  externalMessageId: string;
  /** Free-form text payload from the user. */
  text: string;
  /** External user identifier — opaque to JAK; used for audit only. */
  externalUserId: string;
  /** Conversation/thread the user is in (channel + thread, etc.). */
  threadKey: string;
  /** Channel-native cursor for replying back into the same thread. */
  replyContext: ReplyContext;
  /** Timestamp from the channel — `null` if the channel didn't send one. */
  occurredAt: Date | null;
}

/**
 * Channel-native context required to reply back into the same thread.
 * Adapters embed whatever they need (Slack `channel` + `thread_ts`,
 * WhatsApp `phone_number_id` + `from`, etc.) — the route layer treats
 * this as opaque and passes it back unchanged.
 */
export type ReplyContext = Record<string, unknown> & {
  /** Tag so the adapter can sanity-check it owns this context. */
  readonly _adapter: string;
};

/**
 * The tenant + outbound credential resolved from an inbound webhook.
 * Adapters look this up via the existing `Integration` model — no new
 * persistence model is introduced.
 */
export interface ResolvedChannelTenant {
  tenantId: string;
  /** Decrypted access token for outbound replies. Adapter-specific. */
  accessToken: string;
}

export interface ChannelAdapter {
  /** Channel name, e.g. `'slack'`, `'whatsapp'`. Lowercase + stable. */
  readonly channel: string;

  /**
   * Verify the inbound webhook signature using the channel's native
   * scheme (Slack v0 HMAC, WhatsApp X-Hub-Signature-256, etc.). Returns
   * `false` for any tampered or replayed payload — the route layer must
   * reject the request when this returns `false`.
   *
   * `signingSecret` is read by the adapter from its env var so the
   * route layer doesn't need to know about it.
   */
  verifySignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;

  /**
   * Pre-parse hook — used by adapters whose payload includes a non-event
   * handshake (Slack `url_verification`). Return `{ handled: true,
   * response }` and the route layer ships `response` back without
   * further processing. Default: `{ handled: false }`.
   */
  handleHandshake(rawPayload: unknown): { handled: false } | { handled: true; response: unknown };

  /**
   * Pull the normalized inbound message out of a parsed webhook payload.
   * Returns `null` for payloads the adapter recognizes but should
   * silently drop (bot messages, edits, deletes). Returns a value for
   * payloads the route should turn into a workflow.
   */
  extractInbound(rawPayload: unknown): NormalizedInboundMessage | null;

  /**
   * Resolve the channel-side identifier (Slack team_id, WhatsApp phone
   * number, etc.) to a JAK tenant + decrypted access token. Returns
   * `null` when no integration is connected — the route layer logs +
   * silently drops, since publishing an "unknown tenant" warning in a
   * webhook would expose product internals.
   */
  resolveTenant(
    rawPayload: unknown,
    db: ChannelAdapterDb,
    log: FastifyBaseLogger,
  ): Promise<ResolvedChannelTenant | null>;

  /**
   * Reply into the same thread. Adapters keep their per-call retry
   * policy here (don't retry on 4xx; retry on 5xx with backoff is fine).
   * Errors are logged but never thrown — a failed reply must not crash
   * the inbound webhook handler.
   */
  reply(
    accessToken: string,
    context: ReplyContext,
    text: string,
    log: FastifyBaseLogger,
  ): Promise<void>;
}

/**
 * Minimal Prisma surface every adapter needs. We pass this in instead
 * of importing `PrismaClient` so the adapter package can be unit-tested
 * with a stub.
 *
 * Typed permissively (`any` arg, `Promise<any>` return) so a real
 * Prisma client AND a hand-rolled stub both satisfy it. The adapter
 * narrows the result internally — the type drift would not be caught
 * by Prisma's structural types anyway given how thoroughly it
 * generates conditional return shapes per query.
 */
export interface ChannelAdapterDb {
  integration: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findFirst: (args?: any) => Promise<any>;
  };
}
