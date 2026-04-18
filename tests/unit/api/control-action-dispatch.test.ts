import { describe, expect, it, vi } from 'vitest';

/**
 * Behavioral test for the queue-worker processor dispatch logic that lives in
 * apps/api/src/services/swarm-execution.service.ts (the inline QueueWorker callback).
 *
 * The dispatch shape is reproduced here so we can exercise it without booting a
 * PrismaClient. If the processor in swarm-execution.service.ts diverges from
 * this shape, the test won't catch drift — full e2e coverage is the Phase 7
 * Postgres+Redis integration suite.
 *
 * Invariants this test pins:
 *   - payload.action='resume'  -> resumeAfterApproval(...)
 *   - payload.action='cancel'  -> cancelWorkflow(...)
 *   - payload.action missing   -> executeAsync(...)      (back-compat)
 *   - payload.action='execute' -> executeAsync(...)
 *   - payload.action=<unknown> -> executeAsync(...)      (safe default)
 *   - resume passes decision+reviewedBy+comment through unchanged
 */

interface JobRow {
  id: string;
  workflowId: string;
  tenantId: string;
  userId: string;
  payloadJson: Record<string, unknown>;
}

type ServiceMocks = {
  resumeAfterApproval: ReturnType<typeof vi.fn>;
  cancelWorkflow: ReturnType<typeof vi.fn>;
  executeAsync: ReturnType<typeof vi.fn>;
};

function makeServiceMocks(): ServiceMocks {
  return {
    resumeAfterApproval: vi.fn<(params: Record<string, unknown>) => Promise<void>>(async () => {}),
    cancelWorkflow: vi.fn<(params: Record<string, unknown>) => Promise<void>>(async () => {}),
    executeAsync: vi.fn<(params: Record<string, unknown>) => Promise<void>>(async () => {}),
  };
}

async function dispatch(service: ServiceMocks, job: JobRow): Promise<void> {
  const payload = (job.payloadJson ?? {}) as Record<string, unknown> & { action?: string };
  const action = typeof payload.action === 'string' ? payload.action : 'execute';
  if (action === 'resume') {
    await service.resumeAfterApproval({
      workflowId: job.workflowId,
      tenantId: job.tenantId,
      decision: payload['decision'],
      reviewedBy: String(payload['reviewedBy'] ?? job.userId),
      comment: typeof payload['comment'] === 'string' ? payload['comment'] : undefined,
    });
  } else if (action === 'cancel') {
    await service.cancelWorkflow({ workflowId: job.workflowId });
  } else {
    await service.executeAsync(payload);
  }
}

function jobFor(payload: Record<string, unknown>): JobRow {
  return {
    id: 'job-1',
    workflowId: 'wf-1',
    tenantId: 'tnt-1',
    userId: 'usr-1',
    payloadJson: payload,
  };
}

describe('queue-worker control-action dispatch (Phase 1b behavioral)', () => {
  it("action='resume' calls resumeAfterApproval with decision/reviewedBy/comment", async () => {
    const svc = makeServiceMocks();
    await dispatch(
      svc,
      jobFor({
        action: 'resume',
        decision: 'APPROVED',
        reviewedBy: 'reviewer-42',
        comment: 'LGTM',
      }),
    );

    expect(svc.resumeAfterApproval).toHaveBeenCalledTimes(1);
    expect(svc.cancelWorkflow).not.toHaveBeenCalled();
    expect(svc.executeAsync).not.toHaveBeenCalled();

    expect(svc.resumeAfterApproval).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      tenantId: 'tnt-1',
      decision: 'APPROVED',
      reviewedBy: 'reviewer-42',
      comment: 'LGTM',
    });
  });

  it("action='resume' without explicit reviewedBy falls back to job.userId", async () => {
    const svc = makeServiceMocks();
    await dispatch(
      svc,
      jobFor({ action: 'resume', decision: 'REJECTED' }),
    );

    expect(svc.resumeAfterApproval).toHaveBeenCalledWith(
      expect.objectContaining({ reviewedBy: 'usr-1', decision: 'REJECTED' }),
    );
  });

  it("action='cancel' calls cancelWorkflow with just the workflowId", async () => {
    const svc = makeServiceMocks();
    await dispatch(svc, jobFor({ action: 'cancel' }));

    expect(svc.cancelWorkflow).toHaveBeenCalledTimes(1);
    expect(svc.cancelWorkflow).toHaveBeenCalledWith({ workflowId: 'wf-1' });
    expect(svc.resumeAfterApproval).not.toHaveBeenCalled();
    expect(svc.executeAsync).not.toHaveBeenCalled();
  });

  it('missing action falls back to executeAsync (backwards compat for pre-P1b job rows)', async () => {
    const svc = makeServiceMocks();
    await dispatch(svc, jobFor({ goal: 'do the thing', industry: 'SaaS' }));

    expect(svc.executeAsync).toHaveBeenCalledTimes(1);
    expect(svc.resumeAfterApproval).not.toHaveBeenCalled();
    expect(svc.cancelWorkflow).not.toHaveBeenCalled();
    expect(svc.executeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ goal: 'do the thing', industry: 'SaaS' }),
    );
  });

  it("action='execute' routes to executeAsync", async () => {
    const svc = makeServiceMocks();
    await dispatch(svc, jobFor({ action: 'execute', goal: 'hi' }));
    expect(svc.executeAsync).toHaveBeenCalledTimes(1);
  });

  it('unknown action safely defaults to executeAsync (does not crash the worker)', async () => {
    const svc = makeServiceMocks();
    await dispatch(svc, jobFor({ action: 'unicorn' }));
    expect(svc.executeAsync).toHaveBeenCalledTimes(1);
    expect(svc.resumeAfterApproval).not.toHaveBeenCalled();
    expect(svc.cancelWorkflow).not.toHaveBeenCalled();
  });
});
