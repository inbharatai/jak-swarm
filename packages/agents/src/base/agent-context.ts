import type { AgentTrace } from '@jak-swarm/shared';
import { generateId, generateTraceId } from '@jak-swarm/shared';
import type { ToolCategory } from '@jak-swarm/shared';

export interface AgentContextParams {
  traceId?: string;
  runId?: string;
  tenantId: string;
  userId: string;
  workflowId: string;
  industry?: string;
  approvalId?: string;
  idempotencyKey?: string;
  connectedProviders?: string[];
  browserAutomationEnabled?: boolean;
  allowedDomains?: string[];
  restrictedCategories?: ToolCategory[];
  disabledToolNames?: string[];
}

export class AgentContext {
  readonly traceId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workflowId: string;
  readonly industry: string | undefined;
  readonly approvalId: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly connectedProviders: string[];
  readonly browserAutomationEnabled: boolean;
  readonly allowedDomains: string[];
  readonly restrictedCategories: ToolCategory[];
  readonly disabledToolNames: string[];
  private steps: AgentTrace[] = [];

  constructor(params: AgentContextParams) {
    this.traceId = params.traceId ?? generateTraceId();
    this.runId = params.runId ?? generateId('run_');
    this.tenantId = params.tenantId;
    this.userId = params.userId;
    this.workflowId = params.workflowId;
    this.industry = params.industry;
    this.approvalId = params.approvalId;
    this.idempotencyKey = params.idempotencyKey;
    this.connectedProviders = params.connectedProviders ?? [];
    this.browserAutomationEnabled = params.browserAutomationEnabled ?? false;
    this.allowedDomains = params.allowedDomains ?? [];
    this.restrictedCategories = params.restrictedCategories ?? [];
    this.disabledToolNames = params.disabledToolNames ?? [];
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
      approvalId: this.approvalId,
      idempotencyKey: this.idempotencyKey,
      connectedProviders: this.connectedProviders,
      browserAutomationEnabled: this.browserAutomationEnabled,
      allowedDomains: this.allowedDomains,
      restrictedCategories: this.restrictedCategories,
      disabledToolNames: this.disabledToolNames,
      ...overrides,
    });
  }
}
