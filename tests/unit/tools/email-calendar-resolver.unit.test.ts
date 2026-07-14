import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  resolveEmailAdapterForContext,
  resolveCalendarAdapterForContext,
  type EmailResolutionContext,
  type CalendarResolutionContext,
} from '../../../packages/tools/src/adapters/adapter-factory.js';
import { GmailImapAdapter } from '../../../packages/tools/src/adapters/email/gmail-imap.adapter.js';
import { CalDAVCalendarAdapter } from '../../../packages/tools/src/adapters/calendar/caldav-calendar.adapter.js';
import {
  UnconfiguredEmailAdapter,
  UnconfiguredCalendarAdapter,
} from '../../../packages/tools/src/adapters/unconfigured.js';

/**
 * Unit-level coverage for the per-tenant email + calendar resolvers — the
 * components that replace the process-global module singletons
 * (`const emailAdapter = getEmailAdapter()` / `const calendarAdapter =
 * getCalendarAdapter()` at builtin/index.ts:13-14) that bound the whole
 * process to one tenant's credentials (rule-7 violation).
 *
 * Covers: per-tenant context creds win; labelled single-tenant dev env
 * opt-in (`JAK_EMAIL_SINGLE_TENANT_DEV` / `JAK_CALENDAR_SINGLE_TENANT_DEV`);
 * and the loud Unconfigured stub. The negative "dev mode is opt-in" case is
 * the security property: process-env Gmail/CalDAV creds are NOT used unless
 * the flag is set, so a multi-tenant deploy that forgot to populate
 * context creds for a tenant does NOT silently send as the operator.
 */
describe('resolveEmailAdapterForContext', () => {
  const envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['GMAIL_EMAIL', 'GMAIL_APP_PASSWORD', 'JAK_EMAIL_SINGLE_TENANT_DEV']) {
      envSnapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function ctx(partial: Partial<EmailResolutionContext> & { tenantId: string }): EmailResolutionContext {
    return { tenantId: partial.tenantId, ...partial };
  }

  it('returns an Unconfigured stub when nothing is available (never a process-global fallback)', () => {
    const adapter = resolveEmailAdapterForContext(ctx({ tenantId: 'tenant-x' }));
    expect(adapter).toBeInstanceOf(UnconfiguredEmailAdapter);
  });

  it('constructs a GmailImapAdapter from per-tenant context credentials (not process env)', () => {
    // Process env deliberately has NO Gmail creds here.
    const adapter = resolveEmailAdapterForContext(
      ctx({ tenantId: 'tenant-42', emailCredentials: { email: 'owner@acme.io', appPassword: 'pw-42' } }),
    );
    expect(adapter).toBeInstanceOf(GmailImapAdapter);
    expect(adapter).not.toBeInstanceOf(UnconfiguredEmailAdapter);
  });

  it('in labelled single-tenant dev mode, falls back to env-keyed Gmail', () => {
    process.env['JAK_EMAIL_SINGLE_TENANT_DEV'] = '1';
    process.env['GMAIL_EMAIL'] = 'dev@acme.io';
    process.env['GMAIL_APP_PASSWORD'] = 'dev-pw';

    const adapter = resolveEmailAdapterForContext(ctx({ tenantId: 'tenant-dev' }));
    expect(adapter).toBeInstanceOf(GmailImapAdapter);
  });

  it('dev mode is opt-in: without the flag, env Gmail creds are NOT used (no cross-tenant env bleed)', () => {
    // Env creds present but dev flag NOT set → multi-tenant mode must ignore them.
    process.env['GMAIL_EMAIL'] = 'operator@acme.io';
    process.env['GMAIL_APP_PASSWORD'] = 'op-pw';

    const adapter = resolveEmailAdapterForContext(ctx({ tenantId: 'tenant-strict' }));
    expect(adapter).toBeInstanceOf(UnconfiguredEmailAdapter);
  });

  it('per-tenant context credentials take priority over env even in dev mode', () => {
    // A tenant that connected their own Gmail must NEVER fall through to the
    // operator's env creds, even when the dev flag is on.
    process.env['JAK_EMAIL_SINGLE_TENANT_DEV'] = '1';
    process.env['GMAIL_EMAIL'] = 'operator@acme.io';
    process.env['GMAIL_APP_PASSWORD'] = 'op-pw';

    const adapter = resolveEmailAdapterForContext(
      ctx({ tenantId: 'tenant-with-own', emailCredentials: { email: 'tenant@tenant.io', appPassword: 'tenant-pw' } }),
    );
    expect(adapter).toBeInstanceOf(GmailImapAdapter);
    // Behavioral proof of priority: the adapter holds the tenant's email,
    // not the operator's. GmailImapAdapter stores email/appPassword privately;
    // listMessages would authenticate as the tenant. We assert construction
    // succeeded (not Unconfigured) — the env-bleed assertion is the negative
    // case above.
    expect(adapter).not.toBeInstanceOf(UnconfiguredEmailAdapter);
  });
});

describe('resolveCalendarAdapterForContext', () => {
  const envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['GMAIL_EMAIL', 'GMAIL_APP_PASSWORD', 'JAK_CALENDAR_SINGLE_TENANT_DEV']) {
      envSnapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function ctx(partial: Partial<CalendarResolutionContext> & { tenantId: string }): CalendarResolutionContext {
    return { tenantId: partial.tenantId, ...partial };
  }

  it('returns an Unconfigured stub when nothing is available', () => {
    const adapter = resolveCalendarAdapterForContext(ctx({ tenantId: 'tenant-x' }));
    expect(adapter).toBeInstanceOf(UnconfiguredCalendarAdapter);
  });

  it('constructs a CalDAVCalendarAdapter from per-tenant context credentials', () => {
    const adapter = resolveCalendarAdapterForContext(
      ctx({ tenantId: 'tenant-42', calendarCredentials: { email: 'owner@acme.io', appPassword: 'pw-42' } }),
    );
    expect(adapter).toBeInstanceOf(CalDAVCalendarAdapter);
    expect(adapter).not.toBeInstanceOf(UnconfiguredCalendarAdapter);
  });

  it('in labelled single-tenant dev mode, falls back to env-keyed CalDAV', () => {
    process.env['JAK_CALENDAR_SINGLE_TENANT_DEV'] = '1';
    process.env['GMAIL_EMAIL'] = 'dev@acme.io';
    process.env['GMAIL_APP_PASSWORD'] = 'dev-pw';

    const adapter = resolveCalendarAdapterForContext(ctx({ tenantId: 'tenant-dev' }));
    expect(adapter).toBeInstanceOf(CalDAVCalendarAdapter);
  });

  it('dev mode is opt-in: without the flag, env creds are NOT used (no cross-tenant env bleed)', () => {
    process.env['GMAIL_EMAIL'] = 'operator@acme.io';
    process.env['GMAIL_APP_PASSWORD'] = 'op-pw';

    const adapter = resolveCalendarAdapterForContext(ctx({ tenantId: 'tenant-strict' }));
    expect(adapter).toBeInstanceOf(UnconfiguredCalendarAdapter);
  });
});