// ─── Usage & Analytics Types ─────────────────────────────────────────────────

export interface TokenUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CostBreakdown {
  totalUsd: number;
  byProvider: Record<string, number>;
  byAgentRole: Record<string, number>;
  byModel: Record<string, { tokens: number; costUsd: number; calls: number }>;
}

export interface WorkflowUsageReport {
  workflowId: string;
  tenantId: string;
  tokens: TokenUsageSummary;
  cost: CostBreakdown;
  duration: { totalMs: number; byNode: Record<string, number> };
  timestamp: string;
}

export interface UsageTimeSeries {
  /** ISO date string — '2024-01-15' or '2024-01-15T14:00' */
  period: string;
  tokens: number;
  costUsd: number;
  workflowCount: number;
}

export interface TenantUsageSummary {
  tenantId: string;
  period: { from: string; to: string };
  totals: { tokens: number; costUsd: number; workflows: number };
  timeSeries: UsageTimeSeries[];
  topWorkflows: Array<{ id: string; goal: string; costUsd: number; tokens: number }>;
  costByProvider: Record<string, number>;
  costByAgent: Record<string, number>;
}
