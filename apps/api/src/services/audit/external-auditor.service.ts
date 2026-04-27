/**
 * ExternalAuditorService — Sprint 2.6 / Item B.
 *
 * Manages the lifecycle of external auditor access:
 *   1. createInvite: admin generates a per-(audit-run, email) invite.
 *      Returns the cleartext token EXACTLY ONCE in the response so it
 *      can be emailed; only the SHA-256 hash is persisted.
 *   2. acceptInvite: auditor presents the cleartext token. The system
 *      hashes + verifies, creates an EXTERNAL_AUDITOR User row (or
 *      reuses an existing one on the same email), creates an
 *      ExternalAuditorEngagement granting per-audit-run access, and
 *      issues a JWT.
 *   3. revokeInvite: admin revokes; subsequent JWTs from this auditor
 *      no longer pass the engagement-isolation check.
 *   4. logAction: writes ExternalAuditorAction rows for the audit
 *      trail every time the auditor views/comments/approves/rejects.
 *
 * Security invariants:
 *   - Cleartext tokens are NEVER stored.
 *   - Tokens are 32 bytes random, hex-encoded (64 chars).
 *   - Token verification is SHA-256-only constant-time compare.
 *   - Expired or revoked invites cannot be accepted.
 *   - All actions are tenant-scoped at the service layer.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';

const TOKEN_BYTE_LENGTH = 32;
const DEFAULT_INVITE_TTL_DAYS = 14;

export interface CreateInviteParams {
  tenantId: string;
  auditRunId: string;
  auditorEmail: string;
  auditorName?: string;
  scopes?: string[];
  createdBy: string;
  expiresInDays?: number;
}

export interface CreateInviteResult {
  inviteId: string;
  /**
   * Cleartext invite token. Returned ONCE. The caller (admin route or
   * email service) must hand this to the auditor immediately and never
   * persist it server-side. Format: 64-char lowercase hex string.
   */
  cleartextToken: string;
  expiresAt: Date;
  acceptUrl: string;
}

export interface AcceptInviteResult {
  userId: string;
  engagementId: string;
  auditRunId: string;
  tenantId: string;
  scopes: string[];
  expiresAt: Date;
}

export class ExternalAuditorService {
  constructor(
    private readonly db: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
    private readonly portalBaseUrl: string = 'https://app.jak-swarm.com',
  ) {}

  // ─── Token helpers ─────────────────────────────────────────────────────

  /** Generate a cryptographically random 32-byte hex token. */
  private generateCleartextToken(): string {
    return randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
  }

  /** Hash a cleartext token via SHA-256, hex-encoded. */
  private hashToken(cleartext: string): string {
    return createHash('sha256').update(cleartext).digest('hex');
  }

  /** Constant-time comparison of two hex SHA-256 hashes. */
  private hashesMatch(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
      return false;
    }
  }

  // ─── Invite lifecycle ──────────────────────────────────────────────────

  async createInvite(params: CreateInviteParams): Promise<CreateInviteResult> {
    const cleartextToken = this.generateCleartextToken();
    const tokenHash = this.hashToken(cleartextToken);
    const ttlDays = params.expiresInDays ?? DEFAULT_INVITE_TTL_DAYS;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    // Verify the audit run exists in this tenant before creating the invite.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auditRun = await (this.db as any).auditRun.findFirst({
      where: { id: params.auditRunId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!auditRun) {
      throw new Error(`AuditRun ${params.auditRunId} not found in tenant ${params.tenantId}`);
    }

    const invite = await this.db.externalAuditorInvite.create({
      data: {
        tenantId: params.tenantId,
        auditRunId: params.auditRunId,
        auditorEmail: params.auditorEmail.toLowerCase().trim(),
        auditorName: params.auditorName ?? null,
        tokenHash,
        scopes: params.scopes ?? [],
        status: 'PENDING',
        createdBy: params.createdBy,
        expiresAt,
      },
    });

    this.logger?.info?.(
      { inviteId: invite.id, auditorEmail: params.auditorEmail, auditRunId: params.auditRunId },
      '[ExternalAuditor] Invite created',
    );

    return {
      inviteId: invite.id,
      cleartextToken,
      expiresAt,
      acceptUrl: `${this.portalBaseUrl.replace(/\/$/, '')}/auditor/accept/${cleartextToken}`,
    };
  }

  async revokeInvite(params: { inviteId: string; tenantId: string; revokedBy: string }): Promise<void> {
    const invite = await this.db.externalAuditorInvite.findFirst({
      where: { id: params.inviteId, tenantId: params.tenantId },
    });
    if (!invite) throw new Error(`Invite ${params.inviteId} not found in tenant`);
    if (invite.status === 'REVOKED') return; // idempotent

    const now = new Date();
    await this.db.$transaction([
      this.db.externalAuditorInvite.update({
        where: { id: invite.id },
        data: { status: 'REVOKED', revokedAt: now, revokedBy: params.revokedBy },
      }),
      this.db.externalAuditorEngagement.updateMany({
        where: { inviteId: invite.id },
        data: { accessRevokedAt: now },
      }),
    ]);

    this.logger?.info?.(
      { inviteId: invite.id, revokedBy: params.revokedBy },
      '[ExternalAuditor] Invite revoked + engagement access revoked',
    );
  }

  async listInvitesForAuditRun(tenantId: string, auditRunId: string) {
    return this.db.externalAuditorInvite.findMany({
      where: { tenantId, auditRunId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        auditorEmail: true,
        auditorName: true,
        status: true,
        scopes: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Accept an invite by cleartext token. Returns the engagement payload
   * the route handler converts into a JWT. Throws on:
   *   - unknown token (bad hash)
   *   - already accepted
   *   - revoked
   *   - expired
   */
  async acceptInvite(params: { cleartextToken: string }): Promise<AcceptInviteResult> {
    const tokenHash = this.hashToken(params.cleartextToken);

    const invite = await this.db.externalAuditorInvite.findUnique({
      where: { tokenHash },
    });
    if (!invite) {
      // Defense in depth: the constant-time check below would also fail
      // but this short-circuits on missing rows.
      throw new Error('Invalid invite token');
    }
    if (!this.hashesMatch(invite.tokenHash, tokenHash)) {
      throw new Error('Invalid invite token');
    }
    if (invite.status !== 'PENDING') {
      throw new Error(`Invite is ${invite.status.toLowerCase()}; cannot accept`);
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      // Mark expired to keep the row truthful.
      await this.db.externalAuditorInvite.update({
        where: { id: invite.id },
        data: { status: 'EXPIRED' },
      });
      throw new Error('Invite has expired');
    }

    // Find or create an EXTERNAL_AUDITOR User row for this email + tenant.
    // We scope EXTERNAL_AUDITOR users to the tenant they were invited from.
    const email = invite.auditorEmail.toLowerCase().trim();
    let user = await this.db.user.findFirst({
      where: { tenantId: invite.tenantId, email, role: 'EXTERNAL_AUDITOR' },
    });
    if (!user) {
      user = await this.db.user.create({
        data: {
          tenantId: invite.tenantId,
          email,
          role: 'EXTERNAL_AUDITOR',
          name: invite.auditorName ?? email.split('@')[0] ?? 'External Auditor',
          // No password — invite-token-only. The user model has
          // passwordHash optional already.
        },
      });
    }

    // Create or refresh the engagement.
    const engagement = await this.db.externalAuditorEngagement.upsert({
      where: {
        // Composite-unique on (userId, auditRunId).
        userId_auditRunId: {
          userId: user.id,
          auditRunId: invite.auditRunId,
        },
      },
      create: {
        tenantId: invite.tenantId,
        userId: user.id,
        auditorEmail: email,
        auditRunId: invite.auditRunId,
        inviteId: invite.id,
        scopes: invite.scopes,
        expiresAt: invite.expiresAt,
      },
      update: {
        scopes: invite.scopes,
        accessRevokedAt: null,
        expiresAt: invite.expiresAt,
        inviteId: invite.id,
      },
    });

    // Mark invite as accepted.
    await this.db.externalAuditorInvite.update({
      where: { id: invite.id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        acceptedUserId: user.id,
      },
    });

    this.logger?.info?.(
      {
        inviteId: invite.id,
        userId: user.id,
        engagementId: engagement.id,
        auditRunId: invite.auditRunId,
      },
      '[ExternalAuditor] Invite accepted',
    );

    return {
      userId: user.id,
      engagementId: engagement.id,
      auditRunId: invite.auditRunId,
      tenantId: invite.tenantId,
      scopes: engagement.scopes,
      expiresAt: engagement.expiresAt,
    };
  }

  // ─── Engagement reads ──────────────────────────────────────────────────

  /**
   * Find an active engagement for (userId, auditRunId). Returns
   * undefined when not found, expired, or revoked. The middleware uses
   * this on every auditor request.
   */
  async findActiveEngagement(userId: string, auditRunId: string): Promise<{
    id: string;
    tenantId: string;
    userId: string;
    auditRunId: string;
    scopes: string[];
  } | undefined> {
    const engagement = await this.db.externalAuditorEngagement.findFirst({
      where: {
        userId,
        auditRunId,
        accessRevokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!engagement) return undefined;
    return {
      id: engagement.id,
      tenantId: engagement.tenantId,
      userId: engagement.userId,
      auditRunId: engagement.auditRunId,
      scopes: engagement.scopes,
    };
  }

  /** List all active engagements for an auditor (one per audit run). */
  async listEngagementsForAuditor(userId: string) {
    return this.db.externalAuditorEngagement.findMany({
      where: {
        userId,
        accessRevokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { accessGrantedAt: 'desc' },
    });
  }

  // ─── Action audit trail ────────────────────────────────────────────────

  async logAction(params: {
    tenantId: string;
    userId: string;
    auditorEmail: string;
    auditRunId: string;
    engagementId: string;
    objectType: 'workpaper' | 'evidence' | 'control' | 'final_pack' | 'engagement';
    objectId?: string;
    action: 'view' | 'comment' | 'approve' | 'reject' | 'request_changes' | 'download';
    comment?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.externalAuditorAction.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        auditorEmail: params.auditorEmail,
        auditRunId: params.auditRunId,
        engagementId: params.engagementId,
        objectType: params.objectType,
        objectId: params.objectId ?? null,
        action: params.action,
        comment: params.comment ?? null,
        metadata: (params.metadata as object) ?? null,
      },
    });
  }

  /** Read the action history for an audit run (admin view). */
  async listActionsForAuditRun(tenantId: string, auditRunId: string, limit = 100) {
    return this.db.externalAuditorAction.findMany({
      where: { tenantId, auditRunId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
