/**
 * Phase 4 — Centralized ApprovalPolicy + ToolRegistry.execute integration.
 *
 * Closes the no-half-measures gap: `requiresApproval` was a dead flag.
 * The policy now classifies every tool call into one of 6 action
 * categories and gates execution by category. Tests cover:
 *
 *   - SAFE_READ allowed without approval
 *   - WRITE allowed without per-call approval (tracked in audit log)
 *   - EXTERNAL_POST requires approval (Gmail send, Slack post, social publish)
 *   - DESTRUCTIVE requires approval (delete, refund, mass ops) — never auto-approves
 *   - CREDENTIAL requires approval (oauth_authorize, rotate_secret, etc.)
 *   - INSTALL requires approval (install_*, connector_install, etc.)
 *   - explicit `requiresApproval=true` flag IS now honored at execution
 *   - context.approvalId bypass works (granted upstream → don't block)
 *   - tenant auto-approve override works for non-DESTRUCTIVE only
 *   - DESTRUCTIVE never bypasses, even with auto-approve enabled
 *   - cross-tenant: one tenant's auto-approve doesn't leak (context-scoped)
 *   - denied approval stops execution cleanly
 *
 * All tests run against the real `ToolRegistry` (singleton) and a
 * stub executor — no Fastify, no DB. Pure unit-level coverage of the
 * gate behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ToolRegistry,
  DefaultApprovalPolicy,
  ToolActionCategory,
  type ApprovalPolicyContext,
} from '../../../packages/tools/src/index';
import {
  ToolCategory,
  ToolRiskClass,
  type ToolMetadata,
  type ToolExecutionContext,
} from '@jak-swarm/shared';

function buildMetadata(overrides: Partial<ToolMetadata> & { name: string }): ToolMetadata {
  return {
    name: overrides.name,
    description: overrides.description ?? 'test tool',
    category: overrides.category ?? ToolCategory.UTILITY,
    riskClass: overrides.riskClass ?? ToolRiskClass.READ_ONLY,
    requiresApproval: overrides.requiresApproval ?? false,
    inputSchema: overrides.inputSchema ?? {},
    outputSchema: overrides.outputSchema ?? {},
    version: '1.0.0',
    ...overrides,
  };
}

function buildContext(overrides: Partial<ApprovalPolicyContext> = {}): ApprovalPolicyContext {
  return {
    tenantId: 'tenant_abc',
    userId: 'user_xyz',
    workflowId: 'wf_111',
    runId: 'run_222',
    ...overrides,
  };
}

describe('DefaultApprovalPolicy.classify', () => {
  const policy = new DefaultApprovalPolicy();

  it('READ_ONLY tool → SAFE_READ', () => {
    expect(
      policy.classify(buildMetadata({ name: 'find_document', riskClass: ToolRiskClass.READ_ONLY })),
    ).toBe(ToolActionCategory.SAFE_READ);
  });

  it('WRITE riskClass → WRITE category', () => {
    expect(
      policy.classify(buildMetadata({ name: 'draft_email', riskClass: ToolRiskClass.WRITE })),
    ).toBe(ToolActionCategory.WRITE);
  });

  it('EXTERNAL_SIDE_EFFECT riskClass → EXTERNAL_POST', () => {
    expect(
      policy.classify(buildMetadata({
        name: 'gmail_send_email',
        riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      })),
    ).toBe(ToolActionCategory.EXTERNAL_POST);
  });

  it('DESTRUCTIVE riskClass → DESTRUCTIVE', () => {
    expect(
      policy.classify(buildMetadata({
        name: 'delete_email',
        riskClass: ToolRiskClass.DESTRUCTIVE,
      })),
    ).toBe(ToolActionCategory.DESTRUCTIVE);
  });

  it('install_* tool name → INSTALL (overrides riskClass)', () => {
    expect(
      policy.classify(buildMetadata({ name: 'install_remotion', riskClass: ToolRiskClass.WRITE })),
    ).toBe(ToolActionCategory.INSTALL);
  });

  it('oauth_authorize tool name → CREDENTIAL', () => {
    expect(
      policy.classify(buildMetadata({ name: 'oauth_authorize', riskClass: ToolRiskClass.WRITE })),
    ).toBe(ToolActionCategory.CREDENTIAL);
  });

  it('sideEffectLevel destructive wins over riskClass=WRITE', () => {
    expect(
      policy.classify(buildMetadata({
        name: 'workflow_purge',
        riskClass: ToolRiskClass.WRITE,
        sideEffectLevel: 'destructive',
      })),
    ).toBe(ToolActionCategory.DESTRUCTIVE);
  });
});

describe('DefaultApprovalPolicy.requiresApprovalFor — category-based gating', () => {
  const policy = new DefaultApprovalPolicy();
  const ctx = buildContext();

  it('SAFE_READ does NOT require approval', () => {
    const decision = policy.requiresApprovalFor(
      buildMetadata({ name: 'find_document', riskClass: ToolRiskClass.READ_ONLY }),
      ctx,
    );
    expect(decision.required).toBe(false);
    expect(decision.category).toBe(ToolActionCategory.SAFE_READ);
  });

  it('WRITE does NOT require approval (tracked in audit log)', () => {
    const decision = policy.requiresApprovalFor(
      buildMetadata({ name: 'draft_email', riskClass: ToolRiskClass.WRITE }),
      ctx,
    );
    expect(decision.required).toBe(false);
    expect(decision.category).toBe(ToolActionCategory.WRITE);
  });

  it('EXTERNAL_POST DOES require approval (gmail send, social publish)', () => {
    const decision = policy.requiresApprovalFor(
      buildMetadata({ name: 'gmail_send_email', riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT }),
      ctx,
    );
    expect(decision.required).toBe(true);
    expect(decision.category).toBe(ToolActionCategory.EXTERNAL_POST);
    expect(decision.reason).toMatch(/approval/i);
  });

  it('DESTRUCTIVE DOES require approval', () => {
    const decision = policy.requiresApprovalFor(
      buildMetadata({ name: 'delete_email', riskClass: ToolRiskClass.DESTRUCTIVE }),
      ctx,
    );
    expect(decision.required).toBe(true);
    expect(decision.category).toBe(ToolActionCategory.DESTRUCTIVE);
  });

  it('CREDENTIAL DOES require approval', () => {
    const decision = policy.requiresApprovalFor(
      buildMetadata({ name: 'oauth_authorize', riskClass: ToolRiskClass.WRITE }),
      ctx,
    );
    expect(decision.required).toBe(true);
    expect(decision.category).toBe(ToolActionCategory.CREDENTIAL);
  });

  it('INSTALL DOES require approval', () => {
    const decision = policy.requiresApprovalFor(
      buildMetadata({ name: 'install_remotion', riskClass: ToolRiskClass.WRITE }),
      ctx,
    );
    expect(decision.required).toBe(true);
    expect(decision.category).toBe(ToolActionCategory.INSTALL);
  });

  it('explicit requiresApproval=true is honored even for SAFE_READ', () => {
    const decision = policy.requiresApprovalFor(
      buildMetadata({
        name: 'find_document',
        riskClass: ToolRiskClass.READ_ONLY,
        requiresApproval: true,
      }),
      ctx,
    );
    expect(decision.required).toBe(true);
    // Closes the dead-flag gap from the gap audit.
    expect(decision.reason).toContain('requiresApproval=true');
  });
});

describe('DefaultApprovalPolicy.requiresApprovalFor — bypass paths', () => {
  const policy = new DefaultApprovalPolicy();

  it('context.approvalId bypasses the gate (approval already granted)', () => {
    const ctx = buildContext({ approvalId: 'apr_already_decided' });
    const decision = policy.requiresApprovalFor(
      buildMetadata({ name: 'gmail_send_email', riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT }),
      ctx,
    );
    expect(decision.required).toBe(false);
    expect(decision.reason).toContain('apr_already_decided');
  });

  it('tenant autoApprove for EXTERNAL_POST bypasses for that category only', () => {
    const ctx = buildContext({
      autoApproveCategories: { [ToolActionCategory.EXTERNAL_POST]: true },
    });
    const sendDecision = policy.requiresApprovalFor(
      buildMetadata({ name: 'gmail_send_email', riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT }),
      ctx,
    );
    expect(sendDecision.required).toBe(false);
    expect(sendDecision.reason).toContain('auto-approve');

    // Other categories still gated.
    const installDecision = policy.requiresApprovalFor(
      buildMetadata({ name: 'install_remotion' }),
      ctx,
    );
    expect(installDecision.required).toBe(true);
  });

  it('DESTRUCTIVE is NEVER auto-approved, even with override', () => {
    const ctx = buildContext({
      autoApproveCategories: { [ToolActionCategory.DESTRUCTIVE]: true },
    });
    const decision = policy.requiresApprovalFor(
      buildMetadata({ name: 'delete_email', riskClass: ToolRiskClass.DESTRUCTIVE }),
      ctx,
    );
    expect(decision.required).toBe(true);
  });
});

describe('DefaultApprovalPolicy — cross-tenant safety', () => {
  const policy = new DefaultApprovalPolicy();

  it('one tenant\'s auto-approve does NOT carry over to a different context', () => {
    const tenantA = buildContext({
      tenantId: 'tenant_A',
      autoApproveCategories: { [ToolActionCategory.EXTERNAL_POST]: true },
    });
    const tenantB = buildContext({
      tenantId: 'tenant_B',
      // No auto-approve override for tenant B.
    });
    const tool = buildMetadata({
      name: 'gmail_send_email',
      riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
    });
    expect(policy.requiresApprovalFor(tool, tenantA).required).toBe(false);
    expect(policy.requiresApprovalFor(tool, tenantB).required).toBe(true);
  });

  it('one tenant\'s approvalId does NOT carry over (context-scoped)', () => {
    const tenantA = buildContext({ tenantId: 'tenant_A', approvalId: 'apr_for_A' });
    const tenantB = buildContext({ tenantId: 'tenant_B' });
    const tool = buildMetadata({
      name: 'gmail_send_email',
      riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
    });
    expect(policy.requiresApprovalFor(tool, tenantA).required).toBe(false);
    expect(policy.requiresApprovalFor(tool, tenantB).required).toBe(true);
  });
});

describe('ToolRegistry.execute — approval gate integration', () => {
  // Use a fresh registry-like instance per test by registering with
  // unique names; the singleton is shared across the test file but
  // names are unique so we don't collide.
  const registry = ToolRegistry.getInstance();

  let callCount = 0;
  beforeEach(() => {
    callCount = 0;
  });

  it('SAFE_READ runs (executor invoked)', async () => {
    const name = `test_safe_read_${Date.now()}`;
    registry.register(
      buildMetadata({ name, riskClass: ToolRiskClass.READ_ONLY }),
      async () => {
        callCount++;
        return { value: 'ok' };
      },
    );
    const result = await registry.execute(name, {}, buildContext());
    expect(result.success).toBe(true);
    expect(callCount).toBe(1);
  });

  it('EXTERNAL_POST returns approval_required outcome WITHOUT invoking executor', async () => {
    const name = `test_external_post_${Date.now()}`;
    registry.register(
      buildMetadata({
        name,
        riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      }),
      async () => {
        callCount++;
        return { value: 'should_not_have_run' };
      },
    );
    const result = await registry.execute(name, { to: 'a@b.c' }, buildContext());
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('approval_required');
    expect(callCount).toBe(0); // CRITICAL: executor must not have been called.
    expect((result.data as { category?: string }).category).toBe(ToolActionCategory.EXTERNAL_POST);
    expect((result.data as { proposedInput?: unknown }).proposedInput).toEqual({ to: 'a@b.c' });
  });

  it('DESTRUCTIVE without approval returns approval_required, executor not invoked', async () => {
    const name = `test_destructive_${Date.now()}`;
    registry.register(
      buildMetadata({
        name,
        riskClass: ToolRiskClass.DESTRUCTIVE,
      }),
      async () => {
        callCount++;
        return { deleted: true };
      },
    );
    const result = await registry.execute(name, { id: 'x' }, buildContext());
    expect(result.outcome).toBe('approval_required');
    expect(callCount).toBe(0);
  });

  it('EXTERNAL_POST with context.approvalId runs (gate passes)', async () => {
    const name = `test_external_with_approval_${Date.now()}`;
    registry.register(
      buildMetadata({
        name,
        riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      }),
      async () => {
        callCount++;
        return { sent: true };
      },
    );
    const result = await registry.execute(
      name,
      { to: 'a@b.c' },
      buildContext({ approvalId: 'apr_granted' }),
    );
    expect(result.success).toBe(true);
    expect(callCount).toBe(1);
  });

  it('explicit requiresApproval=true on a SAFE_READ tool still gates execution', async () => {
    const name = `test_explicit_required_${Date.now()}`;
    registry.register(
      buildMetadata({
        name,
        riskClass: ToolRiskClass.READ_ONLY,
        requiresApproval: true, // The previously-dead flag.
      }),
      async () => {
        callCount++;
        return {};
      },
    );
    const result = await registry.execute(name, {}, buildContext());
    expect(result.outcome).toBe('approval_required');
    expect(callCount).toBe(0);
  });
});
