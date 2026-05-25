import { describe, expect, it } from 'vitest';
import type { WorkflowCreateResponse } from '@/types';
import {
  getWorkflowIdFromCreateResponse,
  isWorkflowFollowupResponse,
} from './api-client';

describe('workflow create contract helpers', () => {
  it('treats followup_executed payloads as follow-up responses', () => {
    const payload = {
      kind: 'followup_executed',
      workflowId: 'wf_followup_1',
      description: 'Continuing the workflow',
      command: { kind: 'continue' },
    } as WorkflowCreateResponse;

    expect(isWorkflowFollowupResponse(payload)).toBe(true);
    expect(getWorkflowIdFromCreateResponse(payload)).toBe('wf_followup_1');
  });

  it('returns id for workflow_created responses', () => {
    const payload = {
      kind: 'workflow_created',
      workflowId: 'wf_created_1',
      id: 'wf_created_1',
      tenantId: 'tenant_1',
      createdBy: 'user_1',
      goal: 'Create a launch plan',
      industry: null,
      status: 'PENDING',
      result: null,
      finalOutput: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    } as WorkflowCreateResponse;

    expect(isWorkflowFollowupResponse(payload)).toBe(false);
    expect(getWorkflowIdFromCreateResponse(payload)).toBe('wf_created_1');
  });

  it('falls back to workflow.id for legacy create payloads without kind', () => {
    const payload = {
      id: 'wf_legacy_1',
      tenantId: 'tenant_1',
      createdBy: 'user_1',
      goal: 'Legacy payload',
      industry: null,
      status: 'PENDING',
      result: null,
      finalOutput: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    } as WorkflowCreateResponse;

    expect(isWorkflowFollowupResponse(payload)).toBe(false);
    expect(getWorkflowIdFromCreateResponse(payload)).toBe('wf_legacy_1');
  });

  it('returns null for malformed create payloads without id fields', () => {
    const payload = {
      kind: 'workflow_created',
      goal: 'Broken payload',
    } as unknown as WorkflowCreateResponse;

    expect(isWorkflowFollowupResponse(payload)).toBe(false);
    expect(getWorkflowIdFromCreateResponse(payload)).toBeNull();
  });
});
