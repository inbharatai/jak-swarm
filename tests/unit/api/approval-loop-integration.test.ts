/**
 * Phase 2 (full-fledged JAK) — Approval-loop persistence integration.
 *
 * Locks the contract that swarm-execution.service.ts's onAgentActivity
 * handler must:
 *   1. Recognize `tool_approval_required` activity events
 *   2. Persist a real ApprovalRequest row via WorkflowService
 *   3. Emit the canonical 'approval_required' lifecycle event so the
 *      cockpit + audit log pick it up
 *
 * This is a SOURCE-LEVEL contract test (greps the implementation file)
 * — true behavioral coverage requires Postgres testcontainers + the
 * full swarm graph, which exists in `tests/integration/postgres-*.test.ts`.
 *
 * Why source-level lock matters: this is the gate the previous report
 * named at 7/10. A silent regression that drops the handler would be a
 * production safety bug. The grep test catches a regression at CI time
 * without needing a Postgres container in every test run.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SVC = readFileSync(
  resolve(__dirname, '../../../apps/api/src/services/swarm-execution.service.ts'),
  'utf8',
);

describe('swarm-execution.service.ts — tool_approval_required handler', () => {
  it('handles the tool_approval_required event type in onAgentActivity', () => {
    expect(SVC).toMatch(/t === 'tool_approval_required'/);
  });

  it('calls workflowService.createApprovalRequest with the right shape', () => {
    expect(SVC).toContain('this.workflowService');
    expect(SVC).toContain('createApprovalRequest');
    // The action prefix must mark this as a per-tool approval (not a
    // task-level one) so the audit log distinguishes the two paths.
    expect(SVC).toMatch(/action:\s*`tool:\$\{toolName\}`/);
  });

  it('emits the canonical approval_required lifecycle after persist', () => {
    // The grep is for the lifecycle emission BLOCK inside the handler.
    expect(SVC).toMatch(/type: 'approval_required'[\s\S]{0,200}approvalId: approval\.id/);
  });

  it('classifies risk level from action category (DESTRUCTIVE → CRITICAL)', () => {
    expect(SVC).toMatch(/category === 'DESTRUCTIVE'[\s\S]{0,40}'CRITICAL'/);
    expect(SVC).toMatch(/category === 'EXTERNAL_POST'[\s\S]{0,80}'HIGH'/);
  });

  it('does NOT crash the workflow on persistence failure (best-effort)', () => {
    // The handler must catch the .createApprovalRequest rejection so a
    // briefly-unavailable DB doesn't abort the whole workflow.
    // The handler block is ~30 lines so we allow a generous span.
    expect(SVC).toMatch(/createApprovalRequest[\s\S]{0,2000}\.catch\(/);
    expect(SVC).toMatch(/Failed to persist tool_approval_required/);
  });

  it('preserves payload-binding hash via proposedDataJson', () => {
    // workflowService.createApprovalRequest computes proposedDataHash
    // internally; the handler must pass proposedDataJson with the
    // structured payload so the hash binds to the user-visible data.
    expect(SVC).toMatch(/proposedDataJson:\s*\{\s*toolName,\s*category,\s*inputSummary\s*\}/);
  });
});

describe('swarm-execution.service.ts — handler does not bypass tenant isolation', () => {
  it('passes tenantId from the workflow run context, not from the event payload', () => {
    // The handler reads `tenantId` from the closure (the outer
    // workflow run scope), NOT from `ev` (the activity event payload).
    // This prevents a malicious worker from forging cross-tenant
    // approvals. We assert the handler does NOT read tenantId from ev.
    const handlerMatch = SVC.match(/t === 'tool_approval_required'[\s\S]{0,2500}/);
    expect(handlerMatch, 'handler block must exist').toBeTruthy();
    const block = handlerMatch![0];
    // Negative assertion: must not pull tenantId from the event.
    expect(block).not.toMatch(/ev\['tenantId'\]/);
    expect(block).not.toMatch(/event\.tenantId/);
    // Positive: tenantId is referenced (as the closure variable).
    expect(block).toContain('tenantId');
  });
});
