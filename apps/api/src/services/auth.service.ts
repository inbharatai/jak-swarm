import bcrypt from 'bcryptjs';
import { type PrismaClient, type Prisma } from '@jak-swarm/db';
import type { FastifyInstance } from 'fastify';
import type { AuthSession } from '../types.js';
import { config } from '../config.js';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors.js';

const BCRYPT_ROUNDS = 12;

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
}
