import { describe, it, expect } from 'vitest';
import { buildWorkflowResponse } from '../../../apps/api/src/services/workflow-recovery.service.js';
import type { Workflow, AgentTrace, ApprovalRequest } from '../../../apps/api/src/types.js';

/**
 * Tests for `buildWorkflowResponse` — the pure recovery function that
 * surfaces real content from trace history when the swarm graph returns a
 * stub `finalOutput` ("Agents completed their work but did not produce…"
 * / "No output produced"). No I/O, no mocks — the function is a pure
 * transformation of (workflow, traces, approvals) → response body.
 *
 * Recovery levels covered:
 *   0. No-recovery pass-through (real finalOutput already present).
 *   1. Commander.directAnswer (trivial inputs).
 *   1b. Commander clarification question.
 *   2. Worker trace content extraction (single + multi-section, JSON-string unwrap).
 *   3. Diagnostic error surfacing (model 404 / auth / rate-limit hints).
 *   3'. Top-level error with NO traces (pre-trace crash).
 *   4. Nothing recoverable → honest "no final response generated" fallback.
 */

const baseWorkflow = (overrides: Partial<Workflow> = {}): Workflow => ({
  id: 'wf-1',
  tenantId: 't-1',
  createdBy: 'u-1',
  goal: 'Do something useful',
  industry: null,
  status: 'FAILED',
  result: null,
  finalOutput: 'Agents completed their work but did not produce a user-facing response.',
  error: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const trace = (agentRole: string, overrides: Partial<AgentTrace> = {}): AgentTrace => ({
  id: `tr-${agentRole}`,
  workflowId: 'wf-1',
  tenantId: 't-1',
  agentRole,
  status: 'COMPLETED',
  steps: [],
  startedAt: new Date('2026-01-01T00:00:00Z'),
  completedAt: new Date('2026-01-01T00:00:01Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const NO_APPROVALS: ApprovalRequest[] = [];

describe('buildWorkflowResponse', () => {
  describe('level 0 — no recovery (real finalOutput present)', () => {
    it('passes the workflow through unchanged when finalOutput is substantive', () => {
      const wf = baseWorkflow({
        finalOutput: 'Here is a real, substantive answer to your question.',
        status: 'COMPLETED',
      });
      const out = buildWorkflowResponse(wf, [], NO_APPROVALS);
      expect(out['finalOutput']).toBe('Here is a real, substantive answer to your question.');
      expect(out['status']).toBe('COMPLETED');
      expect(out['recoveredFromCommanderTrace']).toBeUndefined();
      expect(out['recoveredFromWorkerTraces']).toBeUndefined();
      expect(out['recoveryFallback']).toBeUndefined();
    });

    it('still echoes traces + approvals on the response body', () => {
      const wf = baseWorkflow({ finalOutput: 'A real answer that is long enough.', status: 'COMPLETED' });
      const traces: AgentTrace[] = [trace('COMMANDER')];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['traces']).toBe(traces);
      expect(out['approvals']).toBe(NO_APPROVALS);
    });
  });

  describe('level 1 — Commander.directAnswer recovery', () => {
    it('surfaces Commander.directAnswer as the final output for trivial inputs', () => {
      const wf = baseWorkflow(); // stub finalOutput
      const traces: AgentTrace[] = [
        trace('COMMANDER', { output: { directAnswer: 'Paris is the capital of France.' } }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['finalOutput']).toBe('Paris is the capital of France.');
      expect(out['status']).toBe('COMPLETED');
      expect(out['error']).toBeNull();
      expect(out['recoveredFromCommanderTrace']).toBe(true);
    });

    it('ignores whitespace-only directAnswer and falls through', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('COMMANDER', { output: { directAnswer: '   ' } }),
        // Provide a worker trace so we land in recovery #2, not #3.
        trace('WORKER_RESEARCH', { output: { content: 'A substantive worker finding that is long enough to count.' } }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['recoveredFromCommanderTrace']).toBeUndefined();
      expect(out['recoveredFromWorkerTraces']).toBe(true);
    });
  });

  describe('level 1b — Commander clarification question', () => {
    it('surfaces the clarification question when clarificationNeeded is true', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('COMMANDER', {
          output: { clarificationNeeded: true, clarificationQuestion: 'Did you mean option A or option B?' },
        }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['finalOutput']).toBe('Did you mean option A or option B?');
      expect(out['status']).toBe('COMPLETED');
      expect(out['error']).toBeNull();
      expect(out['recoveredAsClarification']).toBe(true);
    });

    it('does not treat clarificationNeeded without a question as a recovery', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('COMMANDER', { output: { clarificationNeeded: true } }),
        trace('WORKER_RESEARCH', { output: { content: 'A substantive worker finding that is long enough to count.' } }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['recoveredAsClarification']).toBeUndefined();
      expect(out['recoveredFromWorkerTraces']).toBe(true);
    });
  });

  describe('level 2 — worker trace content extraction', () => {
    it('extracts content from a single worker and surfaces it directly', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', { output: { content: 'A substantive research finding that is long enough to count.' } }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['finalOutput']).toBe('A substantive research finding that is long enough to count.');
      expect(out['status']).toBe('COMPLETED');
      expect(out['error']).toBeNull();
      expect(out['recoveredFromWorkerTraces']).toBe(true);
    });

    it('joins multiple worker sections with role headings + dividers', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', { output: { content: 'Research finding content that is long enough to count.' } }),
        trace('WORKER_DRAFTING', { output: { content: 'Drafting finding content that is long enough to count too.' } }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      const fo = out['finalOutput'] as string;
      expect(fo).toContain('## RESEARCH');
      expect(fo).toContain('## DRAFTING');
      expect(fo).toContain('Research finding content that is long enough to count.');
      expect(fo).toContain('Drafting finding content that is long enough to count too.');
      expect(fo).toContain('\n\n---\n\n');
      expect(out['recoveredFromWorkerTraces']).toBe(true);
    });

    it('skips orchestration roles (PLANNER, ROUTER, VERIFIER, etc.)', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('PLANNER', { output: { content: 'A planner output that is long enough to count, but should be skipped.' } }),
        trace('WORKER_RESEARCH', { output: { content: 'The worker output that is long enough to count and should win.' } }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['finalOutput']).toBe('The worker output that is long enough to count and should win.');
      expect(out['recoveredFromWorkerTraces']).toBe(true);
    });

    it('unwraps JSON-stringified worker payloads', () => {
      const wf = baseWorkflow();
      const payload = JSON.stringify({ result: { content: 'Content nested inside a JSON-stringified worker output field.' } });
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', { output: { serialized: payload } }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['finalOutput']).toBe('Content nested inside a JSON-stringified worker output field.');
      expect(out['recoveredFromWorkerTraces']).toBe(true);
    });

    it('picks the longest substantive string across known + arbitrary fields', () => {
      const wf = baseWorkflow();
      const short = 'short';
      const long = 'A much longer substantive answer that exceeds the minimum content length threshold easily.';
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', { output: { content: short, analysis: long } }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['finalOutput']).toBe(long);
    });

    it('ignores worker content shorter than the MIN_CONTENT_LEN (30 chars)', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', { output: { content: 'too short' } }),
      ];
      // No worker content ≥ 30 chars and no trace errors → honest fallback.
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['recoveredFromWorkerTraces']).toBeUndefined();
      expect(out['recoveryFallback']).toBe(true);
      expect((out['finalOutput'] as string)).toContain('no final response was generated');
    });
  });

  describe('level 3 — diagnostic error surfacing', () => {
    it('surfaces the first trace error with a model-404 hint', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', {
          error: 'OpenAI request failed (model: gpt-5.4): 404 status code (no body)',
          output: null,
        }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      const fo = out['finalOutput'] as string;
      expect(fo).toContain('Workflow couldn\'t complete.');
      expect(fo).toContain('model returned 404');
      expect(fo).toContain('Failed at **WORKER_RESEARCH** node.');
      expect(fo).toContain('404 status code (no body)');
      expect(out['recoveryFallback']).toBe(true);
      expect(out['recoveredErrorFromTrace']).toBe(true);
    });

    it('surfaces an auth-error hint for 401 / invalid key', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', { error: '401 Unauthorized: invalid API key', output: null }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect((out['finalOutput'] as string)).toContain('rejected the API key');
      expect(out['recoveredErrorFromTrace']).toBe(true);
    });

    it('surfaces a rate-limit hint for 429', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', { error: '429 rate limit exceeded', output: null }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect((out['finalOutput'] as string)).toContain('rate-limited');
      expect(out['recoveredErrorFromTrace']).toBe(true);
    });

    it('surfaces an object-shaped trace error via .message', () => {
      const wf = baseWorkflow();
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', { error: { message: 'Connection refused during tool call.' } as unknown as string, output: null }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect((out['finalOutput'] as string)).toContain('Connection refused during tool call.');
      expect(out['recoveredErrorFromTrace']).toBe(true);
    });

    it('falls back to the workflow-level error string when no trace has an error', () => {
      const wf = baseWorkflow({ error: 'A top-level workflow error message that is descriptive.' });
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', { output: { content: 'too short' } }), // below threshold, no error
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect((out['finalOutput'] as string)).toContain('A top-level workflow error message that is descriptive.');
      expect(out['recoveredErrorFromTrace']).toBe(true);
    });
  });

  describe('level 3\' — top-level error with NO traces (pre-trace crash)', () => {
    it('surfaces a model-404 hint when the planner crashed before recording any trace', () => {
      const wf = baseWorkflow({ error: 'model gpt-5.4 not found (404)' });
      const out = buildWorkflowResponse(wf, [], NO_APPROVALS);
      const fo = out['finalOutput'] as string;
      expect(fo).toContain('Workflow couldn\'t complete.');
      expect(fo).toContain('model returned 404');
      expect(fo).toContain('model gpt-5.4 not found (404)');
      expect(out['recoveryFallback']).toBe(true);
      expect(out['recoveredErrorPreTrace']).toBe(true);
    });

    it('unwraps an object-shaped top-level error via .message', () => {
      const wf = baseWorkflow({ error: { message: 'Planner crashed hard.' } as unknown as string });
      const out = buildWorkflowResponse(wf, [], NO_APPROVALS);
      expect((out['finalOutput'] as string)).toContain('Planner crashed hard.');
      expect(out['recoveredErrorPreTrace']).toBe(true);
    });
  });

  describe('level 4 — nothing recoverable', () => {
    it('returns the honest "no final response generated" fallback', () => {
      const wf = baseWorkflow(); // stub, no error
      const traces: AgentTrace[] = [
        trace('WORKER_RESEARCH', { output: { content: 'too short' } }), // below threshold
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['recoveryFallback']).toBe(true);
      expect(out['recoveredErrorFromTrace']).toBeUndefined();
      expect(out['recoveredFromWorkerTraces']).toBeUndefined();
      expect((out['finalOutput'] as string)).toContain('no final response was generated');
      expect((out['finalOutput'] as string)).toContain('Run Inspector');
    });
  });

  describe('stub detection', () => {
    it('treats "No output produced" as a stub', () => {
      const wf = baseWorkflow({ finalOutput: 'No output produced.' });
      const traces: AgentTrace[] = [
        trace('COMMANDER', { output: { directAnswer: 'A recovered direct answer that is long enough.' } }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['recoveredFromCommanderTrace']).toBe(true);
      expect(out['finalOutput']).toBe('A recovered direct answer that is long enough.');
    });

    it('treats an empty/whitespace finalOutput as a stub', () => {
      const wf = baseWorkflow({ finalOutput: '   ' });
      const traces: AgentTrace[] = [
        trace('COMMANDER', { output: { directAnswer: 'A recovered direct answer that is long enough.' } }),
      ];
      const out = buildWorkflowResponse(wf, traces, NO_APPROVALS);
      expect(out['recoveredFromCommanderTrace']).toBe(true);
    });
  });
});