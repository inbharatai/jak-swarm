import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type ProjectAction =
  | 'ESTIMATE_TIMELINE'
  | 'ALLOCATE_RESOURCES'
  | 'STATUS_REPORT'
  | 'RISK_REGISTER'
  | 'MILESTONE_PLAN'
  | 'DEPENDENCY_MAP'
  | 'RETROSPECTIVE';

export interface ProjectTask {
  action: ProjectAction;
  projectName?: string;
  tasks?: Array<{ name: string; optimistic?: number; mostLikely?: number; pessimistic?: number; dependencies?: string[] }>;
  resources?: Array<{ name: string; role: string; capacity?: number; skills?: string[] }>;
  currentStatus?: Record<string, unknown>;
  risks?: Array<{ description: string; probability?: number; impact?: number; mitigation?: string }>;
  milestones?: Array<{ name: string; targetDate?: string; status?: string }>;
  sprintData?: Record<string, unknown>;
  dependencyResults?: Record<string, unknown>;
}

export interface ProjectResult {
  action: ProjectAction;
  summary: string;
  timeline?: Array<{ task: string; estimated: number; start?: string; end?: string; criticalPath?: boolean }>;
  resourcePlan?: Array<{ resource: string; allocation: number; tasks: string[] }>;
  statusReport?: { rag: string; percentComplete: number; blockers: string[]; nextActions: string[] };
  risks?: Array<{ description: string; probability: number; impact: number; score: number; mitigation: string; owner?: string }>;
  milestones?: Array<{ name: string; targetDate: string; status: string; dependencies: string[] }>;
  dependencies?: Array<{ from: string; to: string; type: string }>;
  retrospectiveInsights?: { wentWell: string[]; didNotGoWell: string[]; actionItems: string[] };
  confidence: number;
}

const PROJECT_SUPPLEMENT = `You are a PMP-certified Project Manager who has delivered $100M+ programs on time and on budget. You are the project management brain of the JAK Swarm platform. You bring structure, predictability, and transparency to every project.

Your project management philosophy:
- Plans are worthless, but planning is everything. Continuously re-plan based on reality.
- Risks not tracked are risks not managed. Maintain a living risk register.
- Communication is 90% of project management. Status should never be a surprise.
- Resource utilization targets should be 70-80%. 100% utilization means zero slack for unknowns.
- Every estimate is wrong. Use ranges and probabilistic methods to be less wrong.

PERT Estimation:
- Expected = (Optimistic + 4 x Most Likely + Pessimistic) / 6
- Standard Deviation = (Pessimistic - Optimistic) / 6
- Always provide three-point estimates, never single-point.

Critical Path Analysis:
- Identify the longest path through the project network.
- Tasks on the critical path have zero float — any delay delays the project.
- Focus management attention on critical path tasks.

Risk Management (5x5 Matrix):
- Probability: 1=Rare, 2=Unlikely, 3=Possible, 4=Likely, 5=Almost Certain
- Impact: 1=Negligible, 2=Minor, 3=Moderate, 4=Major, 5=Critical
- Risk Score = Probability x Impact
- High (15-25): Immediate action required
- Medium (8-14): Active monitoring and contingency planning
- Low (1-7): Accept and monitor

RACI Framework:
- Responsible: Does the work
- Accountable: Owns the outcome (one person only)
- Consulted: Provides input (two-way communication)
- Informed: Kept in the loop (one-way communication)

Status Reports (RAG):
- RED: Behind schedule, over budget, or critical blocker. Needs executive intervention.
- AMBER: At risk. Mitigation in progress but needs attention.
- GREEN: On track. No significant issues.
- Always include: % complete, blockers, next actions, key decisions needed.

For ESTIMATE_TIMELINE:
1. Gather three-point estimates for each task.
2. Calculate PERT expected duration and standard deviation.
3. Identify dependencies and build network diagram.
4. Find critical path and total project duration.
5. Add risk buffer (typically 10-20% of critical path duration).

For ALLOCATE_RESOURCES:
1. Map required skills to available resources.
2. Calculate capacity (available hours minus meetings, PTO, overhead).
3. Target 70-80% utilization to allow for unknowns.
4. Identify bottlenecks and single points of failure.
5. Recommend hiring or outsourcing if capacity gap exists.

For STATUS_REPORT:
1. Calculate overall % complete (weighted by effort).
2. Determine RAG status based on schedule, budget, scope.
3. List top blockers with owners and resolution dates.
4. Define next 1-2 week actions.
5. Flag any decisions needed from stakeholders.

For RISK_REGISTER:
1. Identify risks across categories: technical, resource, schedule, scope, external.
2. Score each risk using 5x5 probability/impact matrix.
3. Define mitigation strategy for each high/medium risk.
4. Assign risk owners.
5. Set review cadence.

For MILESTONE_PLAN:
1. Define key milestones with clear completion criteria.
2. Map dependencies between milestones.
3. Set target dates with confidence levels.
4. Identify gate reviews and approval checkpoints.
5. Build Gantt-style timeline.

For DEPENDENCY_MAP:
1. Identify all task-to-task dependencies (FS, FF, SS, SF).
2. Map external dependencies (other teams, vendors, approvals).
3. Highlight critical dependencies on the critical path.
4. Identify dependency risks and mitigation.
5. Visualize as a structured dependency graph.

For RETROSPECTIVE:
1. Gather input: What went well? What did not go well? What should change?
2. Categorize themes and frequency.
3. Prioritize action items by impact.
4. Assign owners and deadlines to each action item.
5. Format: What went well, What did not go well, Action items.

You have access to these tools:
- compute_statistics: Perform PERT calculations and estimation math
- parse_spreadsheet: Parse resource plans and task lists from spreadsheets
- memory_store: Persist project state and decisions
- memory_retrieve: Recall project history and previous decisions

Respond with JSON:
{
  "summary": "concise project management summary",
  "timeline": [{ "task": "...", "estimated": 10, "start": "2024-01-01", "end": "2024-01-11", "criticalPath": true }],
  "resourcePlan": [{ "resource": "...", "allocation": 0.8, "tasks": ["..."] }],
  "statusReport": { "rag": "GREEN|AMBER|RED", "percentComplete": 65, "blockers": ["..."], "nextActions": ["..."] },
  "risks": [{ "description": "...", "probability": 3, "impact": 4, "score": 12, "mitigation": "...", "owner": "..." }],
  "milestones": [{ "name": "...", "targetDate": "...", "status": "...", "dependencies": ["..."] }],
  "dependencies": [{ "from": "Task A", "to": "Task B", "type": "FS" }],
  "retrospectiveInsights": { "wentWell": ["..."], "didNotGoWell": ["..."], "actionItems": ["..."] },
  "confidence": 0.0-1.0
}`;

export class ProjectAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_PROJECT, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<ProjectResult> {
    const startedAt = new Date();
    const task = input as ProjectTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Project agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'compute_statistics',
          description: 'Perform PERT calculations and estimation math',
          parameters: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['pert', 'descriptive', 'percentile'],
                description: 'Statistical operation to perform',
              },
              optimistic: { type: 'number', description: 'Optimistic estimate' },
              mostLikely: { type: 'number', description: 'Most likely estimate' },
              pessimistic: { type: 'number', description: 'Pessimistic estimate' },
              data: { type: 'array', items: { type: 'number' }, description: 'Data array' },
            },
            required: ['operation'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'parse_spreadsheet',
          description: 'Parse resource plans and task lists from spreadsheets',
          parameters: {
            type: 'object',
            properties: {
              fileUrl: { type: 'string', description: 'URL or path to spreadsheet' },
              sheet: { type: 'string', description: 'Sheet name' },
              range: { type: 'string', description: 'Cell range (e.g., A1:D100)' },
            },
            required: ['fileUrl'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_store',
          description: 'Persist project state and decisions',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Storage key' },
              value: { type: 'object', description: 'Data to store' },
              type: { type: 'string', enum: ['KNOWLEDGE', 'POLICY', 'WORKFLOW'] },
            },
            required: ['key', 'value'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_retrieve',
          description: 'Recall project history and previous decisions',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Key to retrieve' },
            },
            required: ['key'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(PROJECT_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          projectName: task.projectName,
          tasks: task.tasks,
          resources: task.resources,
          currentStatus: task.currentStatus,
          risks: task.risks,
          milestones: task.milestones,
          sprintData: task.sprintData,
          industryContext: context.industry,
          dependencyResults: task.dependencyResults,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 4096,
        temperature: 0.3,
        maxIterations: 5,
      });
    } catch (err) {
      this.logger.error({ err }, 'Project executeWithTools failed');
      const fallback: ProjectResult = {
        action: task.action,
        summary: 'The project agent encountered an error while processing the request.',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: ProjectResult;

    try {
      const parsed = this.parseJsonResponse<Partial<ProjectResult>>(loopResult.content);
      result = {
        action: task.action,
        summary: parsed.summary ?? '',
        timeline: parsed.timeline,
        resourcePlan: parsed.resourcePlan,
        statusReport: parsed.statusReport,
        risks: parsed.risks,
        milestones: parsed.milestones,
        dependencies: parsed.dependencies,
        retrospectiveInsights: parsed.retrospectiveInsights,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        summary: loopResult.content || '',
        risks: [
          {
            description: 'Manual review required — LLM output was not structured JSON; risks, timeline, and blockers are incomplete.',
            probability: 1.0,
            impact: 1.0,
            score: 1.0,
            mitigation: 'Re-run the agent or escalate to a human PM before sharing this status.',
            owner: 'Project manager',
          },
        ],
        confidence: 0.3,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        riskCount: result.risks?.length ?? 0,
        milestoneCount: result.milestones?.length ?? 0,
        confidence: result.confidence,
      },
      'Project agent completed',
    );

    return result;
  }
}
