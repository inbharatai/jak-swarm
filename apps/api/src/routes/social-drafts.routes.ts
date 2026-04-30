/**
 * Sprint 6 Part D — POST /social-drafts.
 *
 * Wires the existing platform adapters' `buildDraft()` methods into a
 * real HTTP route. Closes the previously-Partial criterion #10
 * (social media draft workflows) by giving the user a reachable
 * surface that produces real draft text + checklist + hashtags.
 *
 * Honest scope:
 *   - This route NEVER publishes. It produces a draft + checklist
 *     for the user to copy/paste into the platform's own composer
 *     (or, in a follow-up sprint, into a /browser-sessions/.../record_publish
 *     call after an explicit approval).
 *   - Tenant + user from auth context; no cross-tenant.
 *   - Stateless — adapters' `buildDraft` is deterministic.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import {
  linkedInAdapter,
  instagramAdapter,
  youtubeAdapter,
  metaAdapter,
  type PlatformAdapter,
} from '@jak-swarm/tools';

const ADAPTERS: Record<string, PlatformAdapter> = {
  LINKEDIN: linkedInAdapter,
  INSTAGRAM: instagramAdapter,
  YOUTUBE_STUDIO: youtubeAdapter,
  META_BUSINESS_SUITE: metaAdapter,
};

const draftBodySchema = z.object({
  platform: z.enum(['LINKEDIN', 'INSTAGRAM', 'YOUTUBE_STUDIO', 'META_BUSINESS_SUITE']),
  topic: z.string().min(1).max(500),
  tone: z.enum(['professional', 'casual', 'enthusiastic']).optional(),
});

const socialDraftsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parse = draftBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      const { platform, topic, tone } = parse.data;
      const adapter = ADAPTERS[platform];
      if (!adapter) {
        return reply.status(400).send(err('UNKNOWN_PLATFORM', `Platform ${platform} is not supported.`));
      }

      try {
        const draft = adapter.buildDraft({ topic, ...(tone !== undefined ? { tone } : {}) });

        // Audit log — every draft request is logged with tenant + user
        // for compliance. NEVER includes credentials (the adapter is
        // stateless; no credentials are ever passed in or out).
        try {
          await fastify.db.auditLog.create({
            data: {
              tenantId: request.user.tenantId,
              userId: request.user.userId,
              action: 'SOCIAL_DRAFT_CREATED',
              resource: 'social_draft',
              resourceId: `${platform.toLowerCase()}_${Date.now()}`,
              details: {
                platform,
                topic: topic.slice(0, 200),
                tone: tone ?? 'professional',
                draftKind: draft.kind,
                draftLength: draft.body.length,
              } as never,
              severity: 'INFO',
            },
          });
        } catch (auditErr) {
          fastify.log.warn({ err: auditErr }, '[social-drafts] audit emission failed (non-fatal)');
        }

        return reply.status(200).send(ok({
          adapter: adapter.id,
          displayName: adapter.displayName,
          draft,
          manualHandoffRequired: true,
          manualHandoffMessage: `Draft ready for ${adapter.displayName}. JAK never auto-publishes — copy the body into the platform's own composer, or use /browser-sessions/.../platform/${platform.toLowerCase()}/action with action='record_publish' after explicit approval.`,
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'draft generation failed';
        return reply.status(500).send(err('SOCIAL_DRAFT_FAILED', msg));
      }
    },
  );
};

export default socialDraftsRoutes;
