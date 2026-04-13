import bcrypt from 'bcryptjs';
import { type PrismaClient, type Prisma } from '@jak-swarm/db';
import type { FastifyInstance } from 'fastify';
import type { AuthSession } from '../types.js';
import { config } from '../config.js';
import { CreditService } from '../billing/credit-service.js';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors.js';

const BCRYPT_ROUNDS = 12;

interface SupabaseIdentity {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

export class AuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly fastify: FastifyInstance,
  ) {}

  /**
   * Register a new tenant and its first admin user.
   * Returns the signed JWT and the created user record.
   */
  async register(
    email: string,
    password: string,
    name: string,
    tenantName: string,
    tenantSlug: string,
  ): Promise<{ token: string; user: AuthSession }> {
    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(tenantSlug)) {
      throw new ValidationError(
        'Tenant slug must contain only lowercase letters, numbers and hyphens',
      );
    }

    // Check for duplicate slug
    const existingTenant = await this.db.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (existingTenant) {
      throw new ConflictError(`Tenant slug '${tenantSlug}' is already taken`);
    }

    // Check for duplicate email across the whole system
    const existingUser = await this.db.user.findFirst({
      where: { email: email.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictError(`Email '${email}' is already registered`);
    }

    const hashedPassword = await this.hashPassword(password);

    // Create tenant + admin user in a transaction
    const { tenant, user } = await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          slug: tenantSlug,
          status: 'ACTIVE',
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: email.toLowerCase(),
          name,
          passwordHash: hashedPassword,
          role: 'TENANT_ADMIN',
        },
      });

      return { tenant, user };
    });

    const session: AuthSession = {
      sub: user.id,
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      name: user.name ?? '',
      role: user.role as AuthSession['role'],
      jobFunction: null,
    };

    const token = this.signToken(session);

    this.fastify.log.info(
      { userId: user.id, tenantId: tenant.id },
      'New tenant and admin user registered',
    );

    return { token, user: session };
  }

  /**
   * Authenticate with email + password.
   * tenantSlug is optional — when supplied it narrows the lookup to that tenant.
   */
  async login(
    email: string,
    password: string,
    tenantSlug?: string,
  ): Promise<{ token: string; user: AuthSession }> {
    const whereClause = tenantSlug
      ? {
          email: email.toLowerCase(),
          tenant: { slug: tenantSlug },
        }
      : { email: email.toLowerCase() };

    const user = await this.db.user.findFirst({
      where: whereClause,
      include: { tenant: { select: { id: true, slug: true, status: true } } },
    });

    if (!user) {
      // Use a generic message to avoid user enumeration
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.active) {
      throw new UnauthorizedError('Account is not active');
    }

    if (user.tenant.status !== 'ACTIVE') {
      throw new UnauthorizedError('Tenant account is suspended or deleted');
    }

    const passwordValid = await this.verifyPassword(password, user.passwordHash ?? '');
    if (!passwordValid) {
      // Log the failure WITHOUT the email address to avoid PII in logs.
      // The userId is already found at this point — use that for correlation.
      this.fastify.log.warn(
        { userId: user.id, tenantId: user.tenantId },
        'Failed login attempt — invalid password',
      );
      throw new UnauthorizedError('Invalid email or password');
    }

    const session: AuthSession = {
      sub: user.id,
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name ?? '',
      role: user.role as AuthSession['role'],
      jobFunction: user.jobFunction ?? null,
    };

    const token = this.signToken(session);

    this.fastify.log.info({ userId: user.id, tenantId: user.tenantId }, 'User logged in');

    return { token, user: session };
  }

  /** Hash a plain-text password with bcrypt */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  /** Verify a plain-text password against a bcrypt hash */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /** Sign a JWT with the application secret */
  signToken(payload: AuthSession): string {
    return this.fastify.jwt.sign(payload, {
      expiresIn: config.jwtExpiresIn,
    } as Parameters<typeof this.fastify.jwt.sign>[1]);
  }

  /** Verify and decode a JWT — throws on invalid/expired tokens */
  verifyToken(token: string): AuthSession {
    return this.fastify.jwt.verify<AuthSession>(token);
  }

  /**
   * Get the full user record by id, enriched with tenant info.
   * Used by GET /auth/me to return fresh data after token validation.
   */
  async getUserById(userId: string): Promise<AuthSession> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    return {
      sub: user.id,
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name ?? '',
      role: user.role as AuthSession['role'],
      jobFunction: user.jobFunction ?? null,
    };
  }

  async authenticateSupabaseToken(accessToken: string): Promise<AuthSession> {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new UnauthorizedError('Supabase authentication is not configured');
    }

    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new UnauthorizedError('Invalid or expired Supabase session');
    }

    const identity = await response.json() as SupabaseIdentity;
    return this.resolveSupabaseIdentity(identity);
  }

  private async resolveSupabaseIdentity(identity: SupabaseIdentity): Promise<AuthSession> {
    const email = identity.email?.toLowerCase().trim();
    if (!email) {
      throw new UnauthorizedError('Supabase session is missing an email address');
    }

    const existingUser = await this.db.user.findFirst({
      where: { email },
      include: { tenant: { select: { id: true, status: true } } },
    });

    if (existingUser) {
      if (!existingUser.active) {
        throw new UnauthorizedError('Account is not active');
      }
      if (existingUser.tenant.status !== 'ACTIVE') {
        throw new UnauthorizedError('Tenant account is suspended or deleted');
      }

      const profile = this.extractSupabaseProfile(identity);
      if (
        (profile.name && profile.name !== existingUser.name) ||
        profile.jobFunction !== existingUser.jobFunction ||
        profile.avatarUrl !== existingUser.avatarUrl
      ) {
        await this.db.user.update({
          where: { id: existingUser.id },
          data: {
            ...(profile.name ? { name: profile.name } : {}),
            jobFunction: profile.jobFunction,
            avatarUrl: profile.avatarUrl,
          },
        });
      }

      return {
        sub: existingUser.id,
        userId: existingUser.id,
        tenantId: existingUser.tenantId,
        email: existingUser.email,
        name: profile.name ?? existingUser.name ?? '',
        role: existingUser.role as AuthSession['role'],
        jobFunction: profile.jobFunction ?? existingUser.jobFunction ?? null,
      };
    }

    const provisionedUser = await this.provisionUserFromSupabase(identity, email);

    return {
      sub: provisionedUser.id,
      userId: provisionedUser.id,
      tenantId: provisionedUser.tenantId,
      email: provisionedUser.email,
      name: provisionedUser.name ?? '',
      role: provisionedUser.role as AuthSession['role'],
      jobFunction: provisionedUser.jobFunction ?? null,
    };
  }

  private async provisionUserFromSupabase(identity: SupabaseIdentity, email: string) {
    const profile = this.extractSupabaseProfile(identity);
    const desiredRole = this.mapSupabaseRole(profile.role);
    const requestedTenantId = typeof profile.tenantId === 'string' && profile.tenantId.trim()
      ? profile.tenantId.trim()
      : null;

    return this.db.$transaction(async (tx) => {
      let tenant = requestedTenantId
        ? await tx.tenant.findUnique({ where: { id: requestedTenantId } })
        : null;

      if (!tenant) {
        const tenantName = profile.tenantName || this.deriveTenantNameFromEmail(email);
        const tenantSlug = await this.generateTenantSlug(tx, tenantName);

        tenant = await tx.tenant.create({
          data: {
            name: tenantName,
            slug: tenantSlug,
            status: 'ACTIVE',
          },
        });
      }

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          name: profile.name,
          role: desiredRole,
          jobFunction: profile.jobFunction,
          avatarUrl: profile.avatarUrl,
          active: true,
        },
      });

      return user;
    }).then(async (user) => {
      try {
        const creditService = new CreditService(this.db);
        await creditService.createFreeSubscription(user.tenantId);
      } catch (error) {
        this.fastify.log.warn({ tenantId: user.tenantId, err: error }, 'Failed to create free subscription for Supabase-provisioned tenant');
      }

      this.fastify.log.info({ userId: user.id, tenantId: user.tenantId, email }, 'Provisioned local API user from Supabase identity');
      return user;
    });
  }

  private extractSupabaseProfile(identity: SupabaseIdentity) {
    const userMeta = identity.user_metadata ?? {};
    const appMeta = identity.app_metadata ?? {};

    const name = this.readString(userMeta['name'])
      ?? this.readString(userMeta['full_name'])
      ?? this.readString(appMeta['name'])
      ?? emailLocalPart(identity.email);

    return {
      name,
      role: this.readString(userMeta['role']) ?? this.readString(appMeta['role']),
      tenantId: this.readString(userMeta['tenantId']) ?? this.readString(appMeta['tenantId']),
      tenantName: this.readString(userMeta['tenantName']) ?? this.readString(appMeta['tenantName']),
      jobFunction: this.readString(userMeta['jobFunction']) ?? this.readString(appMeta['jobFunction']),
      avatarUrl: this.readString(userMeta['avatar_url']) ?? this.readString(userMeta['avatarUrl']) ?? this.readString(appMeta['avatar_url']),
    };
  }

  private mapSupabaseRole(role?: string | null): AuthSession['role'] {
    const normalized = role?.trim().toUpperCase();

    switch (normalized) {
      case 'SYSTEM_ADMIN':
        return 'SYSTEM_ADMIN';
      case 'TENANT_ADMIN':
      case 'ADMIN':
        return 'TENANT_ADMIN';
      case 'OPERATOR':
        return 'OPERATOR';
      case 'REVIEWER':
        return 'REVIEWER';
      case 'VIEWER':
      case 'END_USER':
      case 'USER':
      default:
        return 'VIEWER';
    }
  }

  private async generateTenantSlug(tx: Prisma.TransactionClient, tenantName: string): Promise<string> {
    const base = slugifyTenantName(tenantName);
    let slug = base;
    let counter = 1;

    while (await tx.tenant.findUnique({ where: { slug } })) {
      counter += 1;
      slug = `${base}-${counter}`;
    }

    return slug;
  }

  private deriveTenantNameFromEmail(email: string): string {
    const domain = email.split('@')[1] ?? 'workspace';
    const company = domain.split('.')[0] ?? 'workspace';
    return company
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}

function slugifyTenantName(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'workspace';
}

function emailLocalPart(email?: string): string {
  const localPart = email?.split('@')[0]?.trim();
  return localPart || 'User';
}
