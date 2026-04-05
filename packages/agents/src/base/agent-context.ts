import type { AgentTrace } from '@jak-swarm/shared';
import { generateId, generateTraceId } from '@jak-swarm/shared';

export interface AgentContextParams {
  traceId?: string;
  runId?: string;
  tenantId: string;
  userId: string;
  workflowId: string;
  industry?: string;
}

export class AgentContext {
  readonly traceId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workflowId: string;
  readonly industry: string | undefined;
  private steps: AgentTrace[] = [];

  constructor(params: AgentContextParams) {
    this.traceId = params.traceId ?? generateTraceId();
    this.runId = params.runId ?? generateId('run_');
    this.tenantId = params.tenantId;
    this.userId = params.userId;
    this.workflowId = params.workflowId;
    this.industry = params.industry;
  }

  addTrace(trace: AgentTrace): void {
    this.steps.push(trace);
  }

  getTraces(): AgentTrace[] {
    return [...this.steps];
  }

  clone(overrides?: Partial<AgentContextParams>): AgentContext {
    return new AgentContext({
      traceId: this.traceId,
      runId: this.runId,
      tenantId: this.tenantId,
      userId: this.userId,
      workflowId: this.workflowId,
      industry: this.industry,
      ...overrides,
    });
  }
}
