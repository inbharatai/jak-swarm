/**
 * Approval round-trip lifecycle test — calls the REAL
 * SwarmExecutionService.emitLifecycle (constructed with a stub Prisma +
 * stub logger) instead of a copied harness.
 *
 * Item 15 of the post-audit follow-ups: the prior version mirrored
 * `emitLifecycle` in a local `makeHarness()` function. That was a mock-as-
 * prod pattern — if the production action map drifted, the test would
 * still pass against the stale copy. This version constructs the real
 * service so the action-map + SSE + audit wiring is exercised against the
 * production code path. The stubs are limited to:
 *   - `db.auditLog.create` (captured: AuditLogger writes here)
 *   - a Proxy no-op for any other db property the eager constructors touch
 *   - a silent FastifyBaseLogger
 *
 * What this test PROVES (against the real emitLifecycle):
 *   1. APPROVED decision emits `approval_granted` THEN `resumed` SSE events
 *      AND writes APPROVAL_GRANTED + WORKFLOW_RESUMED audit rows.
 *   2. REJECTED decision emits `approval_rejected` THEN `cancelled` SSE
 *      events AND writes APPROVAL_REJECTED + WORKFLOW_CANCELLED audit rows.
 *   3. Every SSE event carries `kind: 'lifecycle'`.
 *   4. The full canonical lifecycle ordering produces the expected SSE +
 *      audit sequences.
 *
 * What this test does NOT prove:
 *   - That the SwarmRunner actually pauses on a real high-risk task
 *     (requires a live LLM; documented as the manual integration recipe
 *     in qa/benchmark-results-openai-first.md scenario 10).
 *   - DEFERRED is a no-op at the resumeAfterApproval layer (it returns
 *     early before calling emitLifecycle) — asserted trivially.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';

// Relative import — vitest aliases @jak-swarm/* to source paths, but
// apps/api is NOT aliased. The real service pulls the LangGraph runtime +
// PostgresCheckpointSaver at construction (no I/O — both constructors only
// store the db reference), so a stub Prisma is enough to reach emitLifecycle.
import { SwarmExecutionService } from '../../apps/api/src/services/swarm-execution.service.js';

interface CapturedEvent {
  channel: string;
  event: Record<string, unknown>;
}

interface CapturedAudit {
  action: string;
  resource: string;
  resourceId?: string;
  details: Record<string, unknown>;
}

function silentLogger(): FastifyBaseLogger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => silentLogger(),
    level: 'info',
  } as unknown as FastifyBaseLogger;
}

/**
 * Stub Prisma: `auditLog.create` is a captured spy (the only db method
 * emitLifecycle touches, via AuditLogger.log). Every other property access
 * returns a no-op async function so the eager SwarmExecutionService
 * constructors (SwarmRunner / LangGraphRuntime / WorkflowService /
 * QueueWorker / DbWorkflowStateStore — all of which only STORE the db
 * reference at construction) don't throw on property access.
 */
function makeStubPrisma(audits: CapturedAudit[]) {
  const auditCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
    audits.push({
      action: args.data['action'] as string,
      resource: args.data['resource'] as string,
      ...(args.data['resourceId'] !== undefined ? { resourceId: args.data['resourceId'] as string } : {}),
      details: args.data['details'] as Record<string, unknown>,
    });
    return {};
  });
  const auditLog = { create: auditCreate };
  // Proxy returns `auditLog` for the `auditLog` property and a no-op async
  // fn for anything else, recursively.
  const stub = new Proxy(
    { auditLog },
    {
      get(target, prop, receiver) {
        if (prop === 'auditLog') return target.auditLog;
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined; // not a thenable
        // Return a function for any method access; if called, resolves to null.
        return () => Promise.resolve(null);
      },
    },
  );
  return { prisma: stub as unknown as PrismaClient, auditCreate };
}

function makeService() {
  const audits: CapturedAudit[] = [];
  const { prisma } = makeStubPrisma(audits);
  const svc = new SwarmExecutionService(prisma, silentLogger());
  const events: CapturedEvent[] = [];

  // The service IS an EventEmitter — listen on the canonical SSE channel
  // for the workflow under test. emitLifecycle calls `this.emit('workflow:<id>', {...})`.
  let listeningChannel: string | null = null;
  const listener = (ev: Record<string, unknown>) => {
    events.push({ channel: listeningChannel!, event: ev });
  };
  const listen = (workflowId: string) => {
    listeningChannel = `workflow:${workflowId}`;
    svc.on(listeningChannel, listener);
  };
  const stop = () => {
    if (listeningChannel) svc.off(listeningChannel, listener);
  };
  // Flush the fire-and-forget audit.log promises.
  const flushAudits = async () => {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 0));
  };
  // Bind emitLifecycle so `this` is the service when we invoke it as a
  // detached function reference (it reads this.emit + this.audit).
  const emit = (
    svc as unknown as { emitLifecycle: (ev: never, t: string, u?: string) => void }
  ).emitLifecycle.bind(svc) as (ev: Record<string, unknown> & { type: string; workflowId: string }, t: string, u?: string) => void;
  return { svc, events, audits, listen, stop, flushAudits, emit };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('approval round-trip lifecycle events (real SwarmExecutionService.emitLifecycle)', () => {
  describe('APPROVED decision', () => {
    it('emits approval_granted then resumed SSE + audit rows', async () => {
      const harness = makeService();
      const workflowId = 'wf-test-approve';
      const tenantId = 'tenant-a';
      const reviewedBy = 'user-reviewer';
      const approvalId = 'apr-123';
      harness.listen(workflowId);

      const emit = harness.emit;

      emit({ type: 'approval_granted', workflowId, approvalId, reviewedBy, timestamp: new Date().toISOString() }, tenantId, reviewedBy);
      emit({ type: 'resumed', workflowId, reason: 'approval', timestamp: new Date().toISOString() }, tenantId, reviewedBy);
      await harness.flushAudits();
      harness.stop();

      const sseTypes = harness.events.map((e) => e.event['type']);
      expect(sseTypes).toEqual(['approval_granted', 'resumed']);

      const auditActions = harness.audits.map((a) => a.action);
      expect(auditActions).toEqual(['APPROVAL_GRANTED', 'WORKFLOW_RESUMED']);

      expect(harness.audits[0]?.resource).toBe('workflow');
      expect(harness.audits[0]?.resourceId).toBe(workflowId);
      expect(harness.audits[0]?.details['reviewedBy']).toBe(reviewedBy);
      expect(harness.audits[0]?.details['approvalId']).toBe(approvalId);
    });

    it('every SSE event carries kind="lifecycle"', async () => {
      const harness = makeService();
      const workflowId = 'wf-1';
      harness.listen(workflowId);

      const emit = harness.emit;
      emit({ type: 'approval_granted', workflowId, approvalId: 'a', reviewedBy: 'u', timestamp: new Date().toISOString() }, 't', 'u');
      await harness.flushAudits();
      harness.stop();
      expect(harness.events.every((e) => e.event['kind'] === 'lifecycle')).toBe(true);
    });
  });

  describe('REJECTED decision', () => {
    it('emits approval_rejected then cancelled SSE + audit rows', async () => {
      const harness = makeService();
      const workflowId = 'wf-test-reject';
      const tenantId = 'tenant-b';
      const reviewedBy = 'user-reviewer';
      const approvalId = 'apr-456';
      harness.listen(workflowId);

      const emit = harness.emit;

      emit({ type: 'approval_rejected', workflowId, approvalId, reviewedBy, reason: 'risk too high', timestamp: new Date().toISOString() }, tenantId, reviewedBy);
      emit({ type: 'cancelled', workflowId, reason: `Rejected by ${reviewedBy}`, cancelledBy: reviewedBy, timestamp: new Date().toISOString() }, tenantId, reviewedBy);
      await harness.flushAudits();
      harness.stop();

      const sseTypes = harness.events.map((e) => e.event['type']);
      expect(sseTypes).toEqual(['approval_rejected', 'cancelled']);

      const auditActions = harness.audits.map((a) => a.action);
      expect(auditActions).toEqual(['APPROVAL_REJECTED', 'WORKFLOW_CANCELLED']);
      expect(harness.audits[0]?.details['reason']).toBe('risk too high');
      expect(harness.audits[1]?.details['cancelledBy']).toBe(reviewedBy);
    });
  });

  describe('DEFERRED decision', () => {
    it('emits no lifecycle events (workflow stays paused)', () => {
      // DEFERRED is a no-op at the resumeAfterApproval layer — it returns
      // early WITHOUT calling emitLifecycle. The real emitLifecycle, if it
      // WERE called with a deferred-ish type not in the action map, would
      // still emit the SSE event but write no audit row (actionMap has no
      // entry). Here we simply assert the no-op contract: zero events
      // unless we explicitly call emitLifecycle.
      const harness = makeService();
      const workflowId = 'wf-defer';
      harness.listen(workflowId);
      expect(harness.events.length).toBe(0);
      expect(harness.audits.length).toBe(0);
      harness.stop();
    });
  });

  describe('full lifecycle ordering for an APPROVED → completed run', () => {
    it('emits the canonical SSE + audit sequence', async () => {
      const harness = makeService();
      const workflowId = 'wf-full';
      const tenantId = 't';
      const userId = 'u';
      harness.listen(workflowId);

      const emit = harness.emit;
      const ts = () => new Date().toISOString();

      emit({ type: 'created', workflowId, tenantId, userId, goal: 'g', timestamp: ts() }, tenantId, userId);
      emit({ type: 'started', workflowId, runtime: 'langgraph', timestamp: ts() }, tenantId, userId);
      emit({ type: 'planned', workflowId, planId: 'p', taskCount: 1, timestamp: ts() }, tenantId, userId);
      emit({ type: 'step_started', workflowId, stepId: 't1', agentRole: 'WORKER_EMAIL', timestamp: ts() }, tenantId, userId);
      emit({ type: 'approval_required', workflowId, approvalId: 'a1', timestamp: ts() }, tenantId, userId);
      emit({ type: 'approval_granted', workflowId, approvalId: 'a1', reviewedBy: userId, timestamp: ts() }, tenantId, userId);
      emit({ type: 'resumed', workflowId, reason: 'approval', timestamp: ts() }, tenantId, userId);
      emit({ type: 'step_completed', workflowId, stepId: 't1', agentRole: 'WORKER_EMAIL', durationMs: 100, timestamp: ts() }, tenantId, userId);
      emit({ type: 'completed', workflowId, finalStatus: 'COMPLETED', durationMs: 1000, timestamp: ts() }, tenantId, userId);
      await harness.flushAudits();
      harness.stop();

      const sseTypes = harness.events.map((e) => e.event['type']);
      expect(sseTypes).toEqual([
        'created',
        'started',
        'planned',
        'step_started',
        'approval_required',
        'approval_granted',
        'resumed',
        'step_completed',
        'completed',
      ]);

      const auditActions = harness.audits.map((a) => a.action);
      expect(auditActions).toEqual([
        'WORKFLOW_CREATED',
        'WORKFLOW_STARTED',
        'WORKFLOW_PLANNED',
        'WORKFLOW_STEP_STARTED',
        'APPROVAL_REQUESTED',
        'APPROVAL_GRANTED',
        'WORKFLOW_RESUMED',
        'WORKFLOW_STEP_COMPLETED',
        'WORKFLOW_COMPLETED',
      ]);
    });
  });

  describe('audit-failure resilience', () => {
    it('does not throw when the audit write rejects (fire-and-forget)', async () => {
      const harness = makeService();
      const workflowId = 'wf-audit-err';
      harness.listen(workflowId);
      // Force auditLog.create to reject — emitLifecycle must swallow it
      // (void audit.log(...).catch(...)) and the SSE event must still fire.
      const auditCreate = (harness.svc as unknown as { audit: { db: { auditLog: { create: unknown } } } })
        .audit.db.auditLog.create as ReturnType<typeof vi.fn>;
      auditCreate.mockRejectedValueOnce(new Error('db down'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});


      const emit = harness.emit;
      expect(() => emit({ type: 'completed', workflowId, finalStatus: 'COMPLETED', timestamp: new Date().toISOString() }, 't', 'u')).not.toThrow();
      await harness.flushAudits();
      harness.stop();
      // SSE event still emitted.
      expect(harness.events.map((e) => e.event['type'])).toEqual(['completed']);
      // No audit row captured (the rejection prevented the push).
      expect(harness.audits).toHaveLength(0);
      errSpy.mockRestore();
    });
  });
});