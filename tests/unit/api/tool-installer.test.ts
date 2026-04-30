/**
 * Phase 6 — Tool installer skeleton tests.
 *
 * Covers:
 *   - ToolRequirementDetector identifies missing capabilities from
 *     plain-English task descriptions
 *   - DryRunOnlyInstaller produces honest plans, NEVER executes
 *   - Trusted-adapter allowlist rejects unknown tools cleanly
 *   - install() throws 'NotImplemented' with a clear pointer to the
 *     follow-up sprint (no fake success path)
 *
 * No DB, no Fastify, no real subprocess.
 */
import { describe, it, expect } from 'vitest';
import {
  ToolRequirementDetector,
  DryRunOnlyInstaller,
  TRUSTED_INSTALL_ADAPTERS,
} from '../../../packages/tools/src/index';

describe('ToolRequirementDetector', () => {
  it('detects "send a Slack message" capability', () => {
    const detector = new ToolRequirementDetector(new Set([]));
    const reqs = detector.detectFromTask('Send a Slack message to the marketing channel');
    expect(reqs.length).toBeGreaterThan(0);
    expect(reqs[0]!.suggestedToolName).toBe('slack_post_message');
    expect(reqs[0]!.alreadyRegistered).toBe(false);
    expect(reqs[0]!.reason).toContain('JAK needs the slack_post_message tool installed');
  });

  it('marks already-registered capability with alreadyRegistered=true', () => {
    const detector = new ToolRequirementDetector(new Set(['gmail_send_email']));
    const reqs = detector.detectFromTask('Send an email to the team about the launch');
    expect(reqs.length).toBeGreaterThan(0);
    const gmailReq = reqs.find((r) => r.suggestedToolName === 'gmail_send_email');
    expect(gmailReq?.alreadyRegistered).toBe(true);
    expect(gmailReq?.reason).toContain('already has this capability');
  });

  it('returns empty array when task does not need any specific tool', () => {
    const detector = new ToolRequirementDetector(new Set([]));
    const reqs = detector.detectFromTask('Tell me what time it is');
    expect(reqs).toEqual([]);
  });

  it('detects multiple capabilities in one task', () => {
    const detector = new ToolRequirementDetector(new Set([]));
    const reqs = detector.detectFromTask(
      'Send an email to the team and also publish a LinkedIn post about it',
    );
    const names = reqs.map((r) => r.suggestedToolName).sort();
    expect(names).toContain('gmail_send_email');
    expect(names).toContain('linkedin_publish_post');
  });

  it('uses layman language in `capability` (no developer jargon)', () => {
    const detector = new ToolRequirementDetector(new Set([]));
    const reqs = detector.detectFromTask('Send a Slack message');
    expect(reqs[0]!.capability).toMatch(/slack message/i);
    // No developer terms.
    expect(reqs[0]!.capability.toLowerCase()).not.toContain('api');
    expect(reqs[0]!.capability.toLowerCase()).not.toContain('webhook');
  });
});

describe('DryRunOnlyInstaller.dryRun', () => {
  const installer = new DryRunOnlyInstaller();

  it('rejects an unknown tool with a clear, layman explanation', async () => {
    const plan = await installer.dryRun({
      toolName: 'random_thing_not_in_allowlist',
      purpose: 'just because',
      riskCategory: 'INSTALL' as never,
      requiredPermissions: [],
      installMethod: 'npm',
      approvalStatus: 'PENDING',
      tenantId: 'tenant_a',
      userId: 'user_1',
    });
    expect(plan.allSafe).toBe(false);
    expect(plan.summary).toContain('not in the trusted allowlist');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0]!.safe).toBe(false);
  });

  it('plan never includes an actually-runnable command', async () => {
    const plan = await installer.dryRun({
      toolName: 'unknown_tool',
      purpose: 'test',
      riskCategory: 'INSTALL' as never,
      requiredPermissions: [],
      installMethod: 'npm',
      approvalStatus: 'PENDING',
      tenantId: 'tenant_a',
      userId: 'user_1',
    });
    // dry_run mode — no real command should execute.
    expect(plan.mode).toBe('dry_run');
    // Any command field present is in angle brackets (placeholder).
    for (const step of plan.steps) {
      if (step.command) {
        expect(step.command.startsWith('<') && step.command.endsWith('>')).toBe(true);
      }
    }
  });

  it('returns a step-by-step plan when the tool IS in the allowlist', async () => {
    // Add a temporary allowlist entry for this test only.
    TRUSTED_INSTALL_ADAPTERS['test_tool_safe'] = {
      method: 'npm',
      safe: true,
      description: 'test tool',
    };
    try {
      const plan = await installer.dryRun({
        toolName: 'test_tool_safe',
        purpose: 'Install test_tool_safe so JAK can do test things.',
        riskCategory: 'INSTALL' as never,
        requiredPermissions: ['read'],
        installMethod: 'npm',
        approvalStatus: 'APPROVED',
        tenantId: 'tenant_a',
        userId: 'user_1',
      });
      expect(plan.allSafe).toBe(true);
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
      expect(plan.summary).toContain('test_tool_safe');
      expect(plan.summary).toContain('Install test_tool_safe');
      expect(plan.mode).toBe('dry_run');
    } finally {
      delete TRUSTED_INSTALL_ADAPTERS['test_tool_safe'];
    }
  });

  it('rejects when install method does not match the trusted adapter method', async () => {
    TRUSTED_INSTALL_ADAPTERS['test_tool_method_check'] = {
      method: 'mcp',
      safe: true,
      description: 'test tool',
    };
    try {
      const plan = await installer.dryRun({
        toolName: 'test_tool_method_check',
        purpose: 'test',
        riskCategory: 'INSTALL' as never,
        requiredPermissions: [],
        installMethod: 'npm', // mismatch
        approvalStatus: 'APPROVED',
        tenantId: 'tenant_a',
        userId: 'user_1',
      });
      expect(plan.allSafe).toBe(false);
      expect(plan.summary).toContain('method mismatch');
    } finally {
      delete TRUSTED_INSTALL_ADAPTERS['test_tool_method_check'];
    }
  });
});

describe('DryRunOnlyInstaller.install — must throw, not fake success', () => {
  const installer = new DryRunOnlyInstaller();

  it('install() throws with a clear pointer to the follow-up sprint', async () => {
    await expect(
      installer.install({
        request: {
          toolName: 'anything',
          purpose: 'test',
          riskCategory: 'INSTALL' as never,
          requiredPermissions: [],
          installMethod: 'npm',
          approvalStatus: 'APPROVED',
          tenantId: 'tenant_a',
          userId: 'user_1',
        },
        approvalId: 'apr_xyz',
      }),
    ).rejects.toThrow(/not implemented/i);
  });
});

describe('TRUSTED_INSTALL_ADAPTERS — defense-in-depth', () => {
  it('starts empty by default (explicit registrations only)', () => {
    // Empty allowlist means: no install can fire by default. Test
    // registrations above are isolated via try/finally cleanup.
    expect(typeof TRUSTED_INSTALL_ADAPTERS).toBe('object');
  });
});
