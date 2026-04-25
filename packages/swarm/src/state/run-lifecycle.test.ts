/**
 * Tests for the run-lifecycle state machine.
 *
 * Coverage:
 *   - Legal transitions pass in default and strict mode.
 *   - Idempotent re-write of same state always passes.
 *   - Illegal transitions log-only by default.
 *   - Illegal transitions throw IllegalTransitionError under
 *     JAK_STRICT_WORKFLOW_STATE=true.
 *   - Terminal states have no legal next.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowStatus } from '@jak-swarm/shared';
import {
  isLegalTransition,
  isTerminalStatus,
  assertTransition,
  IllegalTransitionError,
} from './run-lifecycle.js';

const noopLogger = { warn: vi.fn(), info: vi.fn() };

beforeEach(() => {
  noopLogger.warn.mockClear();
  noopLogger.info.mockClear();
  delete process.env['JAK_STRICT_WORKFLOW_STATE'];
});

afterEach(() => {
  delete process.env['JAK_STRICT_WORKFLOW_STATE'];
});

describe('isLegalTransition', () => {
  it('allows PENDING → PLANNING', () => {
    expect(isLegalTransition(WorkflowStatus.PENDING, WorkflowStatus.PLANNING)).toBe(true);
  });

  it('allows PLANNING → EXECUTING', () => {
    expect(isLegalTransition(WorkflowStatus.PLANNING, WorkflowStatus.EXECUTING)).toBe(true);
  });

  it('allows EXECUTING → AWAITING_APPROVAL', () => {
    expect(isLegalTransition(WorkflowStatus.EXECUTING, WorkflowStatus.AWAITING_APPROVAL)).toBe(true);
  });

  it('allows AWAITING_APPROVAL → EXECUTING (resume)', () => {
    expect(isLegalTransition(WorkflowStatus.AWAITING_APPROVAL, WorkflowStatus.EXECUTING)).toBe(true);
  });

  it('allows VERIFYING → EXECUTING (verifier retry)', () => {
    expect(isLegalTransition(WorkflowStatus.VERIFYING, WorkflowStatus.EXECUTING)).toBe(true);
  });

  it('allows COMPLETED → COMPLETED (idempotent re-write)', () => {
    expect(isLegalTransition(WorkflowStatus.COMPLETED, WorkflowStatus.COMPLETED)).toBe(true);
  });

  it('forbids COMPLETED → EXECUTING (zombie reanimation)', () => {
    expect(isLegalTransition(WorkflowStatus.COMPLETED, WorkflowStatus.EXECUTING)).toBe(false);
  });

  it('forbids COMPLETED → FAILED', () => {
    expect(isLegalTransition(WorkflowStatus.COMPLETED, WorkflowStatus.FAILED)).toBe(false);
  });

  it('forbids CANCELLED → anything', () => {
    expect(isLegalTransition(WorkflowStatus.CANCELLED, WorkflowStatus.EXECUTING)).toBe(false);
    expect(isLegalTransition(WorkflowStatus.CANCELLED, WorkflowStatus.PLANNING)).toBe(false);
    expect(isLegalTransition(WorkflowStatus.CANCELLED, WorkflowStatus.COMPLETED)).toBe(false);
  });

  it('forbids PENDING → VERIFYING (skipping execution)', () => {
    expect(isLegalTransition(WorkflowStatus.PENDING, WorkflowStatus.VERIFYING)).toBe(false);
  });

  it('allows FAILED → ROLLED_BACK (compensation flow)', () => {
    expect(isLegalTransition(WorkflowStatus.FAILED, WorkflowStatus.ROLLED_BACK)).toBe(true);
  });
});

describe('isTerminalStatus', () => {
  it.each([
    WorkflowStatus.COMPLETED,
    WorkflowStatus.FAILED,
    WorkflowStatus.CANCELLED,
    WorkflowStatus.ROLLED_BACK,
  ])('marks %s as terminal', (status) => {
    expect(isTerminalStatus(status)).toBe(true);
  });

  it.each([
    WorkflowStatus.PENDING,
    WorkflowStatus.PLANNING,
    WorkflowStatus.ROUTING,
    WorkflowStatus.EXECUTING,
    WorkflowStatus.AWAITING_APPROVAL,
    WorkflowStatus.VERIFYING,
  ])('marks %s as non-terminal', (status) => {
    expect(isTerminalStatus(status)).toBe(false);
  });
});

describe('assertTransition (default / log-only mode)', () => {
  it('does not throw on legal transitions', () => {
    expect(() => assertTransition(
      WorkflowStatus.PENDING,
      WorkflowStatus.PLANNING,
      { workflowId: 'wf-1', logger: noopLogger },
    )).not.toThrow();
    expect(noopLogger.warn).not.toHaveBeenCalled();
  });

  it('does not throw on illegal transitions but logs a warning', () => {
    expect(() => assertTransition(
      WorkflowStatus.COMPLETED,
      WorkflowStatus.EXECUTING,
      { workflowId: 'wf-2', logger: noopLogger, reason: 'test bad transition' },
    )).not.toThrow();
    expect(noopLogger.warn).toHaveBeenCalledTimes(1);
    const [info, msg] = noopLogger.warn.mock.calls[0]!;
    expect(msg).toContain('illegal transition');
    expect(info.workflowId).toBe('wf-2');
    expect(info.from).toBe(WorkflowStatus.COMPLETED);
    expect(info.to).toBe(WorkflowStatus.EXECUTING);
    expect(info.legalNext).toEqual([]);
    expect(info.strict).toBe(false);
  });

  it('does not throw on idempotent same-state writes', () => {
    expect(() => assertTransition(
      WorkflowStatus.COMPLETED,
      WorkflowStatus.COMPLETED,
      { workflowId: 'wf-3', logger: noopLogger },
    )).not.toThrow();
    expect(noopLogger.warn).not.toHaveBeenCalled();
  });
});

describe('assertTransition (strict mode via JAK_STRICT_WORKFLOW_STATE)', () => {
  beforeEach(() => {
    process.env['JAK_STRICT_WORKFLOW_STATE'] = 'true';
  });

  it('still passes on legal transitions', () => {
    expect(() => assertTransition(
      WorkflowStatus.EXECUTING,
      WorkflowStatus.VERIFYING,
      { workflowId: 'wf-4', logger: noopLogger },
    )).not.toThrow();
  });

  it('throws IllegalTransitionError on illegal transitions', () => {
    expect(() => assertTransition(
      WorkflowStatus.COMPLETED,
      WorkflowStatus.EXECUTING,
      { workflowId: 'wf-5', logger: noopLogger, reason: 'zombie attempt' },
    )).toThrow(IllegalTransitionError);
  });

  it('error carries useful context for post-mortem', () => {
    try {
      assertTransition(
        WorkflowStatus.COMPLETED,
        WorkflowStatus.PLANNING,
        { workflowId: 'wf-6', logger: noopLogger },
      );
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError);
      const e = err as IllegalTransitionError;
      expect(e.workflowId).toBe('wf-6');
      expect(e.from).toBe(WorkflowStatus.COMPLETED);
      expect(e.to).toBe(WorkflowStatus.PLANNING);
      expect(e.legalNext).toEqual([]);
      expect(e.message).toContain('illegal transition');
    }
  });

  it('still logs the warning before throwing (so telemetry catches it)', () => {
    expect(() => assertTransition(
      WorkflowStatus.CANCELLED,
      WorkflowStatus.EXECUTING,
      { workflowId: 'wf-7', logger: noopLogger },
    )).toThrow(IllegalTransitionError);
    expect(noopLogger.warn).toHaveBeenCalledTimes(1);
    const [info] = noopLogger.warn.mock.calls[0]!;
    expect(info.strict).toBe(true);
  });

  it.each(['false', '0', '', undefined as unknown as string])(
    'falsy strict flag (%s) keeps log-only behavior',
    (val) => {
      if (val === undefined) {
        delete process.env['JAK_STRICT_WORKFLOW_STATE'];
      } else {
        process.env['JAK_STRICT_WORKFLOW_STATE'] = val;
      }
      expect(() => assertTransition(
        WorkflowStatus.COMPLETED,
        WorkflowStatus.EXECUTING,
        { workflowId: 'wf-8', logger: noopLogger },
      )).not.toThrow();
    },
  );
});
