import { describe, expect, it } from 'vitest';
import {
  AgentRole,
  RiskLevel,
  TaskStatus,
  type WorkflowTask,
} from '@jak-swarm/shared';
import { createInitialSwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import { buildTaskInput } from '../../../packages/swarm/src/graph/nodes/worker/task-input-builders.js';

function makeDocumentTask(description: string, dependsOn: string[] = []): WorkflowTask {
  return {
    id: 'task_doc_1',
    name: 'Summarize uploaded note',
    description,
    agentRole: AgentRole.WORKER_DOCUMENT,
    toolsRequired: ['find_document', 'summarize_document'],
    riskLevel: RiskLevel.LOW,
    requiresApproval: false,
    status: TaskStatus.PENDING,
    dependsOn,
    retryable: true,
    maxRetries: 1,
  };
}

describe('buildTaskInput WORKER_DOCUMENT', () => {
  it('passes task description as query hint for document lookup', () => {
    const state = createInitialSwarmState({
      goal: 'Summarize attached file',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workflowId: 'wf-1',
    });

    const task = makeDocumentTask('Please summarize upload-note.txt (documentId: abc123)');
    const input = buildTaskInput(task, state) as { query?: string; action?: string };

    expect(input.action).toBe('SUMMARIZE');
    expect(input.query).toContain('upload-note.txt');
    expect(input.query).toContain('abc123');
  });

  it('keeps dependency-derived documentContent when upstream results include content', () => {
    const state = createInitialSwarmState({
      goal: 'Summarize attached file',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workflowId: 'wf-1',
    });
    state.taskResults['dep_doc'] = {
      content: 'Quarterly report: Revenue up 24% and churn down 3 points.',
    };

    const task = makeDocumentTask('Summarize the quarterly report', ['dep_doc']);
    const input = buildTaskInput(task, state) as { documentContent?: string; query?: string };

    expect(input.documentContent).toContain('Revenue up 24%');
    expect(input.query).toContain('quarterly report');
  });
});
