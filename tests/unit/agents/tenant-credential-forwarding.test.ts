/**
 * Forwarding-seam test for the per-tenant connector-credential pipe (PR 2).
 *
 * Proves the reachable real code path that carries decrypted connector
 * credentials from the side-channel registry to the tool resolver, WITHOUT
 * network (no IMAP/CalDAV/Salesforce calls):
 *
 *   registry.registerTenantCredentials(wfId, bundle)
 *     → getTenantCredentials(wfId)                 [the exact worker-node lookup]
 *     → new AgentContext({ ...(bundle) })          [the exact worker-node spread]
 *     → context.emailCredentials / calendarCredentials / crmCredentials  [real AgentContext fields]
 *     → context.clone() preserves them             [the clone() forwarding PR 2 added]
 *     → resolveEmailAdapterForContext(ctx) → GmailImapAdapter            [real resolver, from PR 1]
 *
 * What is NOT asserted here (and is intentionally not faked):
 *   - The AgentContext → ToolExecutionContext forwarding at
 *     tool-execution.service.ts:~200. That 3-line spread is structurally
 *     identical to the production-proven llmApiKey forwarding (already
 *     exercised by packages/agents/src/base/tool-execution.service.test.ts
 *     running the real executeWithTools). We assert the AgentContext side of
 *     that seam here; the ToolExecutionContext side is the same pattern.
 *   - Live IMAP/CalDAV/Salesforce responses — that's the named stop (F3 /
 *     PR 14), gated on owner production credentials (rule 10). We prove the
 *     resolver returns a REAL GmailImapAdapter instance, not that Gmail
 *     answered.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentContext } from '../../../packages/agents/src/base/agent-context.js';
import {
  registerTenantCredentials,
  getTenantCredentials,
  clearTenantCredentials,
} from '../../../packages/swarm/src/supervisor/tenant-credential-registry.js';
import { resolveEmailAdapterForContext } from '../../../packages/tools/src/adapters/adapter-factory.js';
import { GmailImapAdapter } from '../../../packages/tools/src/adapters/email/gmail-imap.adapter.js';
import { resolveCalendarAdapterForContext } from '../../../packages/tools/src/adapters/adapter-factory.js';
import { CalDAVCalendarAdapter } from '../../../packages/tools/src/adapters/calendar/caldav-calendar.adapter.js';
import {
  UnconfiguredEmailAdapter,
  UnconfiguredCalendarAdapter,
} from '../../../packages/tools/src/adapters/unconfigured.js';

describe('tenant-credential forwarding seam (registry → AgentContext → resolver)', () => {
  const envSnapshot: Record<string, string | undefined> = {};
  const usedWfs: string[] = [];

  beforeEach(() => {
    for (const k of ['GMAIL_EMAIL', 'GMAIL_APP_PASSWORD', 'JAK_EMAIL_SINGLE_TENANT_DEV', 'JAK_CALENDAR_SINGLE_TENANT_DEV']) {
      envSnapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const id of usedWfs) clearTenantCredentials(id);
    usedWfs.length = 0;
  });

  function wf(id: string): string {
    usedWfs.push(id);
    return id;
  }

  /** Build an AgentContext the EXACT way worker-node.ts does: spread the
   * registry bundle into the AgentContext constructor. */
  function buildWorkerAgentContext(workflowId: string, tenantId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = getTenantCredentials(workflowId) ?? {};
    return new AgentContext({
      tenantId,
      userId: 'user-test',
      workflowId,
      // Spread the side-channel bundle — the worker-node pattern:
      ...(bundle as any),
    });
  }

  it('registers creds, looks them up by workflowId, and they land on the AgentContext', () => {
    const id = wf('wf-fwd-1');
    registerTenantCredentials(id, {
      emailCredentials: { email: 'owner@acme.io', appPassword: 'pw-fwd' },
      calendarCredentials: { email: 'owner@acme.io', appPassword: 'pw-fwd' },
      crmCredentials: { salesforce: { accessToken: 'sf-tok', instanceUrl: 'https://acme.my.salesforce.com' } },
    });

    const ctx = buildWorkerAgentContext(id, 'tenant-fwd');

    expect(ctx.emailCredentials).toEqual({ email: 'owner@acme.io', appPassword: 'pw-fwd' });
    expect(ctx.calendarCredentials).toEqual({ email: 'owner@acme.io', appPassword: 'pw-fwd' });
    expect(ctx.crmCredentials?.salesforce).toEqual({
      accessToken: 'sf-tok',
      instanceUrl: 'https://acme.my.salesforce.com',
    });
  });

  it('an AgentContext built with no registered bundle has undefined credential fields', () => {
    const ctx = buildWorkerAgentContext(wf('wf-fwd-empty'), 'tenant-none');
    expect(ctx.emailCredentials).toBeUndefined();
    expect(ctx.calendarCredentials).toBeUndefined();
    expect(ctx.crmCredentials).toBeUndefined();
  });

  it('clone() preserves the per-tenant credentials (a cloned agent keeps the tenant creds)', () => {
    const id = wf('wf-fwd-clone');
    registerTenantCredentials(id, {
      emailCredentials: { email: 'clone@acme.io', appPassword: 'pw-clone' },
      crmCredentials: { salesforce: { accessToken: 'sf-clone', instanceUrl: 'https://c.my.salesforce.com' } },
    });
    const original = buildWorkerAgentContext(id, 'tenant-clone');

    const cloned = original.clone({ agentRole: 'WORKER_ENGINEER' });

    expect(cloned.emailCredentials).toEqual({ email: 'clone@acme.io', appPassword: 'pw-clone' });
    expect(cloned.crmCredentials?.salesforce?.accessToken).toBe('sf-clone');
  });

  it('the email resolver returns a real GmailImapAdapter when creds are forwarded (not Unconfigured)', () => {
    const id = wf('wf-fwd-resolve');
    registerTenantCredentials(id, {
      emailCredentials: { email: 'resolver@acme.io', appPassword: 'pw-resolve' },
    });
    const ctx = buildWorkerAgentContext(id, 'tenant-resolve');

    // The ToolExecutionContext the resolver reads is structurally satisfied by
    // the AgentContext's emailCredentials — this is the exact field
    // tool-execution.service.ts forwards at toolExecContext construction.
    const adapter = resolveEmailAdapterForContext({
      tenantId: ctx.tenantId,
      emailCredentials: ctx.emailCredentials,
    });
    expect(adapter).toBeInstanceOf(GmailImapAdapter);
    expect(adapter).not.toBeInstanceOf(UnconfiguredEmailAdapter);
  });

  it('the calendar resolver returns a real CalDAVCalendarAdapter when creds are forwarded', () => {
    const id = wf('wf-fwd-cal');
    registerTenantCredentials(id, {
      calendarCredentials: { email: 'cal@acme.io', appPassword: 'pw-cal' },
    });
    const ctx = buildWorkerAgentContext(id, 'tenant-cal');

    const adapter = resolveCalendarAdapterForContext({
      tenantId: ctx.tenantId,
      calendarCredentials: ctx.calendarCredentials,
    });
    expect(adapter).toBeInstanceOf(CalDAVCalendarAdapter);
    expect(adapter).not.toBeInstanceOf(UnconfiguredCalendarAdapter);
  });

  it('without forwarded creds, the resolver returns Unconfigured (no cross-tenant fallthrough)', () => {
    // The security property: a workflow with no registered bundle gets
    // Unconfigured, even though ANOTHER workflow's bundle is in the registry.
    const populated = wf('wf-fwd-populated');
    registerTenantCredentials(populated, {
      emailCredentials: { email: 'other@acme.io', appPassword: 'other-pw' },
    });
    const ctxEmpty = buildWorkerAgentContext(wf('wf-fwd-isolated'), 'tenant-isolated');

    const adapter = resolveEmailAdapterForContext({
      tenantId: ctxEmpty.tenantId,
      emailCredentials: ctxEmpty.emailCredentials, // undefined
    });
    expect(adapter).toBeInstanceOf(UnconfiguredEmailAdapter);
  });
});