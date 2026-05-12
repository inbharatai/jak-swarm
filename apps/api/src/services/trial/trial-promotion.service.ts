/**
 * trial-promotion.service.ts — promote a VERIFIED TrialSignup into a real
 * Tenant + first User (TENANT_ADMIN) + active 30-day trial Subscription.
 *
 * Called from POST /trial/verify/:token after the email-verification check
 * passes. Single transaction so we never end up with a half-created tenant
 * (e.g. tenant exists but user creation failed).
 *
 * Token returned by `promote()` is a JWT signed by the existing
 * AuthService.signToken — same shape as a /register or /login token, so the
 * cockpit can use it identically.
 *
 * Idempotency: if the signup row already says PROMOTED, returns the existing
 * tenant + a fresh JWT for the existing admin user instead of erroring. This
 * lets a user click the verify link twice (e.g. mobile-Safari preview-fetch)
 * without breaking the flow.
 *
 * Random-password design: trial signups have no password (intentional — the
 * landing-page CTA is email-only, no credit card, no password). We generate
 * a 32-byte URL-safe password, store its bcrypt hash, and present the
 * cleartext to the user EXACTLY ONCE so they can switch to a password-based
 * login flow later if they want. Most trial users will use the JWT
 * indefinitely; the password is the escape hatch.
 */

import { randomBytes } from 'node:crypto';
import type { PrismaClient, Prisma } from '@jak-swarm/db';
import type { FastifyInstance } from 'fastify';
import type { AuthSession } from '../../types.js';
import { AuthService } from '../auth.service.js';

interface TrialSignupLike {
  id: string;
  email: string;
  companyName: string | null;
  industry: string | null;
  status: string;
  tenantId: string | null;
  verifiedAt: Date | null;
}

export interface PromotionResult {
  /** JWT — the cockpit drops this in localStorage to land authenticated. */
  token: string;
  /** Cleartext one-time password (32B random hex). Shown ONCE. */
  initialPassword: string;
  tenant: { id: string; slug: string; name: string };
  user: AuthSession;
  /** True when the signup was already PROMOTED on a prior call. */
  reusedExistingTenant: boolean;
}

/**
 * Slug derivation for new tenants. Strict rules:
 *   - lowercase, [a-z0-9-] only
 *   - max 50 chars
 *   - must not collide; on collision append 4 random hex chars
 */
function slugifyCompany(companyName: string | null, fallback: string): string {
  const base = (companyName ?? fallback).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || `t-${randomBytes(4).toString('hex')}`;
}

export class TrialPromotionService {
  private readonly auth: AuthService;

  constructor(
    private readonly db: PrismaClient,
    private readonly fastify: FastifyInstance,
  ) {
    this.auth = new AuthService(db, fastify);
  }

  /**
   * Promote a VERIFIED signup. Caller MUST have already validated the
   * verify-token + marked the signup VERIFIED.
   *
   * Behaviour:
   *   - signup.status === 'PROMOTED' && signup.tenantId set
   *      → idempotent return: fresh JWT for the existing admin user
   *   - signup.status === 'VERIFIED'
   *      → create Tenant + admin User + Subscription(trialing) atomically
   *      → mark signup PROMOTED + set tenantId
   *   - any other status → throws (caller must ensure VERIFIED)
   */
  async promote(signup: TrialSignupLike): Promise<PromotionResult> {
    // Idempotent path — already promoted.
    if (signup.status === 'PROMOTED' && signup.tenantId) {
      const existing = await this.db.user.findFirst({
        where: { tenantId: signup.tenantId, email: signup.email.toLowerCase() },
        include: { tenant: { select: { id: true, slug: true, name: true } } },
      });
      if (!existing) {
        throw new Error(
          `[trial-promotion] PROMOTED signup ${signup.id} has no admin user row — corrupt state`,
        );
      }
      const session: AuthSession = {
        sub: existing.id,
        userId: existing.id,
        tenantId: existing.tenantId,
        email: existing.email,
        name: existing.name ?? '',
        role: existing.role as AuthSession['role'],
        jobFunction: existing.jobFunction ?? null,
      };
      return {
        token: this.auth.signToken(session),
        initialPassword: '<already-set>',
        tenant: existing.tenant,
        user: session,
        reusedExistingTenant: true,
      };
    }

    if (signup.status !== 'VERIFIED') {
      throw new Error(
        `[trial-promotion] cannot promote signup with status='${signup.status}' (expected VERIFIED)`,
      );
    }

    // Verify the email isn't already attached to a non-trial user (rare but possible).
    const existingByEmail = await this.db.user.findFirst({
      where: { email: signup.email.toLowerCase() },
    });
    if (existingByEmail) {
      throw new Error(
        '[trial-promotion] email already has a user account; cannot promote trial',
      );
    }

    // Generate password + slug.
    const initialPasswordCleartext = randomBytes(24).toString('base64url');
    const passwordHash = await this.auth.hashPassword(initialPasswordCleartext);
    const baseSlug = slugifyCompany(signup.companyName, signup.email.split('@')[0] ?? 'trial');
    const slug = await this.findFreeSlug(baseSlug);

    const tenantName = signup.companyName ?? signup.email.split('@')[0] ?? 'My workspace';
    const userName = signup.email.split('@')[0] ?? 'admin';
    const now = new Date();

    // Create Tenant + User + Subscription + mark signup PROMOTED, atomically.
    const result = await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          slug,
          status: 'ACTIVE',
          industry: signup.industry ?? null,
          plan: 'FREE',
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: signup.email.toLowerCase(),
          name: userName,
          passwordHash,
          role: 'TENANT_ADMIN',
          jobFunction: 'founder',
        },
      });

      // Subscription is created by usage-counter.service via upsert — but
      // we run it inside this transaction would mean creating a separate
      // service that takes `tx`. Simpler: create the subscription row
      // directly here with the same defaults the service would produce.
      const trialEndsAt = new Date(now);
      trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 30);
      const periodEnd = new Date(now);
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: 'trial_30d',
          status: 'trialing',
          trialStartedAt: now,
          trialEndsAt,
          periodStart: now,
          periodEnd,
          dailyResetAt: now,
        },
      });

      // Bootstrap an OnboardingState so the dashboard knows this is fresh.
      await tx.onboardingState.create({
        data: {
          tenantId: tenant.id,
          completedSteps: ['signup', 'verify_email'],
          dismissed: false,
        },
      });

      // Mark the signup PROMOTED + link to the tenant.
      await tx.trialSignup.update({
        where: { id: signup.id },
        data: { status: 'PROMOTED', promotedAt: now, tenantId: tenant.id },
      });

      return { tenant, user };
    });

    const session: AuthSession = {
      sub: result.user.id,
      userId: result.user.id,
      tenantId: result.tenant.id,
      email: result.user.email,
      name: result.user.name ?? '',
      role: 'TENANT_ADMIN',
      jobFunction: result.user.jobFunction ?? null,
    };

    this.fastify.log.info(
      { tenantId: result.tenant.id, userId: result.user.id, signupId: signup.id },
      '[trial-promotion] new trial workspace bootstrapped',
    );

    return {
      token: this.auth.signToken(session),
      initialPassword: initialPasswordCleartext,
      tenant: { id: result.tenant.id, slug: result.tenant.slug, name: result.tenant.name },
      user: session,
      reusedExistingTenant: false,
    };
  }

  /** Find a free slug; on collision append 4 random hex chars (try ≤ 5 times). */
  private async findFreeSlug(base: string): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const candidate = i === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      const taken = await this.db.tenant.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    // Fallback — extremely unlikely.
    return `${base}-${randomBytes(4).toString('hex')}`;
  }
}
