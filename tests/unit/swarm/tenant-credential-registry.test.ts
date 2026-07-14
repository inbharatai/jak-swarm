/**
 * Unit tests for the per-tenant connector-credential side-channel registry
 * (packages/swarm/src/supervisor/tenant-credential-registry.ts).
 *
 * This registry is the secure transport for decrypted connector creds
 * (Gmail app-password, Salesforce access token): they CANNOT travel through
 * SwarmState (serialized to the stateJson DB checkpoint — that would leak
 * secrets), so they live in this process-local, workflowId-keyed map for the
 * duration of a workflow. Worker nodes look them up by `state.workflowId`
 * when building the AgentContext (mirroring the established llm-key-registry).
 *
 * These tests assert the registry's own contract (register/get/clear + merge
 * + tenant isolation by workflowId) in isolation. The full registry →
 * AgentContext → ToolExecutionContext → resolver path is exercised by the
 * forwarding-seam test in tests/unit/agents/tenant-credential-forwarding.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerTenantCredentials,
  getTenantCredentials,
  clearTenantCredentials,
} from '../../../packages/swarm/src/supervisor/tenant-credential-registry.js';

describe('tenant-credential-registry', () => {
  const usedWorkflowIds: string[] = [];

  function wf(id: string): string {
    usedWorkflowIds.push(id);
    return id;
  }

  beforeEach(() => {
    usedWorkflowIds.length = 0;
  });

  afterEach(() => {
    // Never leak credentials across tests — clear everything we registered.
    for (const id of usedWorkflowIds) clearTenantCredentials(id);
  });

  it('returns undefined when no bundle is registered for the workflow', () => {
    expect(getTenantCredentials(wf('wf-none'))).toBeUndefined();
  });

  it('round-trips email + calendar + crm credentials registered for one workflow', () => {
    const id = wf('wf-1');
    registerTenantCredentials(id, {
      emailCredentials: { email: 'owner@acme.io', appPassword: 'pw-1' },
      calendarCredentials: { email: 'owner@acme.io', appPassword: 'pw-1' },
      crmCredentials: { salesforce: { accessToken: 'sf-tok', instanceUrl: 'https://acme.my.salesforce.com' } },
    });

    const bundle = getTenantCredentials(id);
    expect(bundle).toBeDefined();
    expect(bundle?.emailCredentials).toEqual({ email: 'owner@acme.io', appPassword: 'pw-1' });
    expect(bundle?.calendarCredentials).toEqual({ email: 'owner@acme.io', appPassword: 'pw-1' });
    expect(bundle?.crmCredentials?.salesforce).toEqual({
      accessToken: 'sf-tok',
      instanceUrl: 'https://acme.my.salesforce.com',
    });
  });

  it('clear removes the bundle so subsequent lookups return undefined', () => {
    const id = wf('wf-clear');
    registerTenantCredentials(id, { emailCredentials: { email: 'a@b.io', appPassword: 'p' } });
    expect(getTenantCredentials(id)).toBeDefined();
    clearTenantCredentials(id);
    expect(getTenantCredentials(id)).toBeUndefined();
  });

  it('is keyed by workflowId — two workflows never see each other credentials (tenant isolation)', () => {
    const a = wf('wf-tenant-a');
    const b = wf('wf-tenant-b');
    registerTenantCredentials(a, { emailCredentials: { email: 'a@acme.io', appPassword: 'a-pw' } });
    registerTenantCredentials(b, { emailCredentials: { email: 'b@other.io', appPassword: 'b-pw' } });

    expect(getTenantCredentials(a)?.emailCredentials?.email).toBe('a@acme.io');
    expect(getTenantCredentials(b)?.emailCredentials?.email).toBe('b@other.io');
    // No cross-bleed:
    expect(getTenantCredentials(a)?.emailCredentials?.appPassword).toBe('a-pw');
    expect(getTenantCredentials(b)?.emailCredentials?.appPassword).toBe('b-pw');
  });

  it('merges partial re-registrations without dropping fields a prior registration set', () => {
    // swarm-runner registers email+calendar+crm in one call today, but the
    // merge semantics protect against a future partial re-registration
    // (e.g. a re-resolve after an OAuth refresh) dropping fields.
    const id = wf('wf-merge');
    registerTenantCredentials(id, {
      emailCredentials: { email: 'a@b.io', appPassword: 'p1' },
      crmCredentials: { salesforce: { accessToken: 'sf', instanceUrl: 'https://x' } },
    });
    // Re-register only calendar — email + crm must survive.
    registerTenantCredentials(id, { calendarCredentials: { email: 'a@b.io', appPassword: 'p1' } });

    const bundle = getTenantCredentials(id);
    expect(bundle?.emailCredentials).toEqual({ email: 'a@b.io', appPassword: 'p1' });
    expect(bundle?.calendarCredentials).toEqual({ email: 'a@b.io', appPassword: 'p1' });
    expect(bundle?.crmCredentials?.salesforce?.accessToken).toBe('sf');
  });

  it('does not bleed env or process-global state — registry is purely in-memory keyed by workflowId', () => {
    // Sanity: a workflow with no registration gets nothing even when another
    // workflow has a full bundle registered.
    const populated = wf('wf-populated');
    registerTenantCredentials(populated, {
      emailCredentials: { email: 'p@q.io', appPassword: 'pp' },
    });
    expect(getTenantCredentials(wf('wf-empty'))).toBeUndefined();
  });
});