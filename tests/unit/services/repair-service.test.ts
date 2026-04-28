/**
 * RepairService unit tests — Final hardening / Gap B.
 *
 * Verifies error classification + repair-decision policy + lifecycle
 * event emission. Pure-function tests (no I/O, no DB).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyError,
  decideRepair,
  RepairService,
} from '../../../apps/api/src/services/repair.service.js';

// ─── Pure: classifyError ──────────────────────────────────────────────────

describe('classifyError', () => {
  it('classifies HTTP 429 as transient_api', () => {
    expect(classifyError('OpenAI returned 429 rate limit')).toBe('transient_api');
  });

  it('classifies network timeout as transient_api', () => {
    expect(classifyError('connect ETIMEDOUT 1.2.3.4:443')).toBe('transient_api');
    expect(classifyError('Request timed out after 30s')).toBe('transient_api');
  });

  it('classifies JSON parse failures as invalid_structured_output', () => {
    expect(classifyError('JSON parse failed: unexpected token <')).toBe('invalid_structured_output');
    expect(classifyError('zod schema validation failed')).toBe('invalid_structured_output');
  });

  it('classifies missing-input failures', () => {
    expect(classifyError('missing required field: documentId')).toBe('missing_input');
    expect(classifyError('Cannot read properties of undefined (taskResults)')).toBe('missing_input');
  });

  it('classifies document parsing errors', () => {
    expect(classifyError('mammoth: malformed DOCX')).toBe('document_parse_failure');
    expect(classifyError('tesseract.js failed to OCR')).toBe('document_parse_failure');
  });

  it('classifies tool-unavailable + 401 errors', () => {
    expect(classifyError('Tool send_email is not available for this tenant')).toBe('tool_unavailable');
    expect(classifyError('401 Authentication required')).toBe('tool_unavailable');
    expect(classifyError('Circuit breaker open for worker:WORKER_EMAIL')).toBe('tool_unavailable');
  });

  it('classifies permission blocks (NEVER auto-retried)', () => {
    expect(classifyError('403 Forbidden')).toBe('permission_block');
    expect(classifyError('Guardrail policy blocked this action')).toBe('permission_block');
    expect(classifyError('Access denied to tenant resource')).toBe('permission_block');
  });

  it('classifies destructive actions when isDestructive flag set', () => {
    expect(classifyError('Tool failed', { isDestructive: true })).toBe('destructive_action');
  });

  it('detects destructive verbs in the error text itself', () => {
    expect(classifyError('Failed to send email: SMTP error')).toBe('destructive_action');
  });

  it('returns unknown for unclassifiable errors (default escalate)', () => {
    expect(classifyError('Something unexpected went wrong')).toBe('unknown');
    expect(classifyError('')).toBe('unknown');
  });
});

// ─── Pure: decideRepair ──────────────────────────────────────────────────

describe('decideRepair', () => {
  it('NEVER auto-retries destructive actions', () => {
    const d = decideRepair('destructive_action');
    expect(d.action).toBe('escalate_to_human');
    if (d.action === 'escalate_to_human') {
      expect(d.requiresApproval).toBe(true);
    }
  });

  it('NEVER auto-retries when isDestructive flag set even if class is transient', () => {
    const d = decideRepair('transient_api', { isDestructive: true });
    expect(d.action).toBe('escalate_to_human');
  });

  it('NEVER auto-retries permission_block', () => {
    expect(decideRepair('permission_block').action).toBe('escalate_to_human');
  });

  it('NEVER auto-retries approval_timeout', () => {
    expect(decideRepair('approval_timeout').action).toBe('escalate_to_human');
  });

  it('NEVER auto-retries unknown errors (defensive)', () => {
    expect(decideRepair('unknown').action).toBe('escalate_to_human');
  });

  it('retries transient_api up to 3 attempts with progressive backoff', () => {
    const d1 = decideRepair('transient_api', { priorAttempts: 0 });
    expect(d1.action).toBe('retry');
    if (d1.action === 'retry') {
      expect(d1.strategy).toBe('backoff_500ms');
      expect(d1.attempt).toBe(1);
    }
    const d2 = decideRepair('transient_api', { priorAttempts: 1 });
    if (d2.action === 'retry') expect(d2.strategy).toBe('backoff_2s');
    const d3 = decideRepair('transient_api', { priorAttempts: 2 });
    if (d3.action === 'retry') expect(d3.strategy).toBe('backoff_2s');
    const d4 = decideRepair('transient_api', { priorAttempts: 3 });
    expect(d4.action).toBe('give_up');
  });

  it('retries invalid_structured_output immediately', () => {
    const d = decideRepair('invalid_structured_output', { priorAttempts: 0 });
    if (d.action === 'retry') expect(d.strategy).toBe('immediate');
  });

  it('retries missing_input only once before escalating', () => {
    const d1 = decideRepair('missing_input', { priorAttempts: 0 });
    expect(d1.action).toBe('retry');
    const d2 = decideRepair('missing_input', { priorAttempts: 1 });
    expect(d2.action).toBe('give_up');
  });

  it('retries document_parse_failure only once', () => {
    expect(decideRepair('document_parse_failure', { priorAttempts: 0 }).action).toBe('retry');
    expect(decideRepair('document_parse_failure', { priorAttempts: 1 }).action).toBe('give_up');
  });

  it('respects custom maxRetries cap', () => {
    const d = decideRepair('transient_api', { priorAttempts: 0, maxRetries: 1 });
    expect(d.action).toBe('retry');
    const d2 = decideRepair('transient_api', { priorAttempts: 1, maxRetries: 1 });
    expect(d2.action).toBe('give_up');
  });
});

// ─── Service: emits the right events ──────────────────────────────────────

describe('RepairService.evaluate', () => {
  interface Event { type: string; [k: string]: unknown }

  function captureEvents(): { events: Event[]; emit: (e: Event) => void } {
    const events: Event[] = [];
    return { events, emit: (e) => events.push(e) };
  }

  it('emits repair_needed + repair_attempt_started for retryable error', () => {
    const { events, emit } = captureEvents();
    const svc = new RepairService();
    const result = svc.evaluate({
      workflowId: 'wf_1',
      stepId: 'task_1',
      tenantId: 'tenant_a',
      errorMessage: 'OpenAI returned 429 rate limit',
      onLifecycle: emit as never,
    });
    expect(result.errorClass).toBe('transient_api');
    expect(result.decision.action).toBe('retry');
    const types = events.map((e) => e.type);
    expect(types).toContain('repair_needed');
    expect(types).toContain('repair_attempt_started');
  });

  it('emits repair_escalated_to_human for destructive failure', () => {
    const { events, emit } = captureEvents();
    const svc = new RepairService();
    svc.evaluate({
      workflowId: 'wf_1',
      tenantId: 'tenant_a',
      errorMessage: 'Send email failed',
      onLifecycle: emit as never,
    });
    expect(events.find((e) => e.type === 'repair_escalated_to_human')).toBeDefined();
  });

  it('emits repair_limit_reached when retries exhausted', () => {
    const { events, emit } = captureEvents();
    const svc = new RepairService();
    svc.evaluate({
      workflowId: 'wf_1',
      tenantId: 'tenant_a',
      errorMessage: 'Rate limit 429',
      priorAttempts: 5,
      onLifecycle: emit as never,
    });
    expect(events.find((e) => e.type === 'repair_limit_reached')).toBeDefined();
  });

  it('records attempt result with succeeded/failed events', () => {
    const { events, emit } = captureEvents();
    const svc = new RepairService();
    svc.recordAttemptResult({ workflowId: 'wf_1', stepId: 't', onLifecycle: emit as never }, 1, true);
    expect(events.find((e) => e.type === 'repair_attempt_completed')).toBeDefined();
    svc.recordAttemptResult({ workflowId: 'wf_1', stepId: 't', onLifecycle: emit as never }, 2, false, 'Network down');
    expect(events.filter((e) => e.type === 'repair_attempt_completed')).toHaveLength(2);
    expect(events.find((e) => e.type === 'repair_attempt_failed')).toBeDefined();
  });

  it('telemetry failures NEVER throw (defensive)', () => {
    const svc = new RepairService();
    expect(() =>
      svc.evaluate({
        workflowId: 'wf_1',
        tenantId: 'tenant_a',
        errorMessage: 'fail',
        onLifecycle: (() => { throw new Error('emit broken'); }) as never,
      }),
    ).not.toThrow();
  });
});

describe('RepairService.applyBackoff', () => {
  it('immediate returns near-zero', async () => {
    const svc = new RepairService();
    const start = Date.now();
    await svc.applyBackoff('immediate');
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('backoff_500ms waits at least ~400ms', async () => {
    const svc = new RepairService();
    const start = Date.now();
    await svc.applyBackoff('backoff_500ms');
    expect(Date.now() - start).toBeGreaterThanOrEqual(400);
  });
});
