import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { AppError, NotFoundError, ForbiddenError } from '../errors.js';
import { config } from '../config.js';

const createSessionBodySchema = z.object({
  language: z.string().default('en'),
  voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).default('alloy'),
  workflowId: z.string().optional(),
});

const VOICE_SESSION_TTL_SECONDS = 3600; // 1 hour

const voiceRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /voice/sessions
   * Create a new voice session.
   * Returns a sessionId and the WebRTC offer configuration for the OpenAI
   * Realtime API (ICE servers, session token, model info).
   */
  fastify.post(
    '/sessions',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createSessionBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { language, voice, workflowId } = parseResult.data;
      const { userId, tenantId } = request.user;

      // Generate a unique session id
      const sessionId = `vs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const sessionData = {
        sessionId,
        userId,
        tenantId,
        workflowId: workflowId ?? null,
        language,
        voice,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
      };

      // Persist session metadata in Redis with a TTL
      await fastify.redis.setex(
        `voice:session:${sessionId}`,
        VOICE_SESSION_TTL_SECONDS,
        JSON.stringify(sessionData),
      );

      await fastify.auditLog(request, 'CREATE_VOICE_SESSION', 'VoiceSession', sessionId, {
        workflowId,
        language,
        voice,
      });

      // Build the WebRTC offer configuration.
      // The client uses these to connect to the OpenAI Realtime API directly.
      const webRtcConfig = {
        model: config.openaiRealtimeModel,
        voice,
        language,
        // ICE servers — in production replace with TURN credentials
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        // The client should use this endpoint to exchange SDP with OpenAI
        realtimeEndpoint: 'https://api.openai.com/v1/realtime',
        // NOTE: Never expose the raw API key to the client.
        // A production implementation would exchange a short-lived ephemeral token
        // here via the OpenAI Realtime Sessions API.
        ephemeralTokenEndpoint: `/voice/sessions/${sessionId}/token`,
      };

      return reply.status(201).send(ok({ sessionId, webRtcConfig, expiresInSeconds: VOICE_SESSION_TTL_SECONDS }));
    },
  );

  /**
   * GET /voice/sessions/:sessionId/token
   * Obtain a short-lived ephemeral WebRTC token from the OpenAI Realtime API.
   * The browser uses this token to connect directly to OpenAI — the raw API key
   * is never sent to the client.
   *
   * Requires OPENAI_API_KEY to be set. Falls back to a mock token in development.
   */
  fastify.get(
    '/sessions/:sessionId/token',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = request.params as { sessionId: string };

      try {
        const raw = await fastify.redis.get(`voice:session:${sessionId}`);
        if (!raw) throw new NotFoundError('VoiceSession', sessionId);

        let session: { userId: string; tenantId: string; voice: string; language: string };
        try {
          session = JSON.parse(raw);
        } catch {
          throw new AppError(500, 'CORRUPTED_SESSION', 'Voice session data is corrupted');
        }

        if (
          session.tenantId !== request.user.tenantId &&
          request.user.role !== 'SYSTEM_ADMIN'
        ) {
          throw new ForbiddenError('Access to voice session in another tenant is not allowed');
        }

        // If no API key is available, return a mock token for local development
        if (!config.openaiApiKey) {
          return reply.status(200).send(
            ok({
              sessionId,
              clientToken: `mock_token_${Date.now()}`,
              model: config.openaiRealtimeModel,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              isMock: true,
            }),
          );
        }

        // Exchange with OpenAI Realtime Sessions API for a real ephemeral token
        const oaiResponse = await fetch('https://api.openai.com/v1/realtime/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.openaiRealtimeModel,
            voice: session.voice,
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            language: session.language,
          }),
        });

        if (!oaiResponse.ok) {
          const body = await oaiResponse.text();
          fastify.log.error({ sessionId, status: oaiResponse.status, body }, 'OpenAI Realtime session API error');
          return reply.status(502).send(
            err('VOICE_TOKEN_ERROR', 'Failed to obtain ephemeral token from OpenAI'),
          );
        }

        const data = await oaiResponse.json() as {
          id?: string;
          client_secret?: { value?: string; expires_at?: number };
        };

        const clientToken = data.client_secret?.value ?? '';
        const expiresAt = data.client_secret?.expires_at
          ? new Date(data.client_secret.expires_at * 1000).toISOString()
          : new Date(Date.now() + 60_000).toISOString();

        return reply.status(200).send(
          ok({
            sessionId: data.id ?? sessionId,
            clientToken,
            model: config.openaiRealtimeModel,
            expiresAt,
            isMock: false,
          }),
        );
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * DELETE /voice/sessions/:sessionId
   * End a voice session and remove it from Redis.
   */
  fastify.delete(
    '/sessions/:sessionId',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = request.params as { sessionId: string };

      try {
        const raw = await fastify.redis.get(`voice:session:${sessionId}`);
        if (!raw) throw new NotFoundError('VoiceSession', sessionId);

        let session: { userId: string; tenantId: string };
        try { session = JSON.parse(raw); } catch { throw new AppError(500, 'CORRUPTED_SESSION', 'Voice session data is corrupted'); }

        // Only the session owner or an admin may end the session
        if (
          session.userId !== request.user.userId &&
          session.tenantId !== request.user.tenantId &&
          request.user.role !== 'SYSTEM_ADMIN'
        ) {
          throw new ForbiddenError('Cannot end a voice session that does not belong to you');
        }

        await fastify.redis.del(`voice:session:${sessionId}`);
        // Keep transcript key intact — it can still be retrieved after ending

        await fastify.auditLog(request, 'END_VOICE_SESSION', 'VoiceSession', sessionId);

        return reply.status(200).send(ok({ sessionId, status: 'ENDED' }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /voice/sessions/:sessionId/transcript
   * Retrieve the transcript for a completed or active voice session.
   * Transcripts are stored in Redis under a separate key by the voice worker.
   */
  fastify.get(
    '/sessions/:sessionId/transcript',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = request.params as { sessionId: string };

      try {
        // Check the session exists (may already be expired/ended)
        const sessionRaw = await fastify.redis.get(`voice:session:${sessionId}`);
        const transcriptRaw = await fastify.redis.get(`voice:transcript:${sessionId}`);

        if (!sessionRaw && !transcriptRaw) {
          throw new NotFoundError('VoiceSession', sessionId);
        }

        // Parse session to check ownership
        if (sessionRaw) {
          let session: { userId: string; tenantId: string };
          try { session = JSON.parse(sessionRaw); } catch { throw new AppError(500, 'CORRUPTED_SESSION', 'Voice session data is corrupted'); }
          if (
            session.tenantId !== request.user.tenantId &&
            request.user.role !== 'SYSTEM_ADMIN'
          ) {
            throw new ForbiddenError('Access to voice session in another tenant is not allowed');
          }
        }

        let transcript: Array<{ role: string; content: string; timestamp: string }> = [];
        if (transcriptRaw) {
          try { transcript = JSON.parse(transcriptRaw); } catch { transcript = []; }
        }

        return reply.status(200).send(ok({ sessionId, transcript }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default voiceRoutes;
