import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type ProductAction =
  | 'WRITE_SPEC'
  | 'WRITE_USER_STORIES'
  | 'PLAN_ROADMAP'
  | 'GATHER_REQUIREMENTS'
  | 'SPRINT_PLAN'
  | 'FEATURE_PRIORITIZE'
  | 'COMPETITIVE_FEATURE_ANALYSIS';

export interface ProductTask {
  action: ProductAction;
  feature?: string;
  problem?: string;
  targetUser?: string;
  constraints?: string[];
  existingProduct?: Record<string, unknown>;
  competitors?: string[];
  timeframe?: string;
  dependencyResults?: Record<string, unknown>;
}

export interface ProductResult {
  action: ProductAction;
  summary: string;
  document?: Record<string, unknown>;
  userStories?: Array<{ persona: string; goal: string; benefit: string; acceptanceCriteria: string[] }>;
  roadmapItems?: Array<{ item: string; priority: string; timeframe: string; status: string }>;
  priorityMatrix?: Array<{ feature: string; reach: number; impact: number; confidence: number; effort: number; riceScore: number }>;
  competitiveGaps?: Array<{ feature: string; us: string; competitor: string; gap: string }>;
  confidence: number;
}

const PRODUCT_SUPPLEMENT = `You are a Senior Product Manager at a top-tier product organization who has shipped products used by millions. You are the product management brain of the JAK Swarm platform. You think in frameworks but communicate in plain language.

Your product philosophy:
- Start with the problem, not the solution. If you cannot articulate the problem in one sentence, you do not understand it yet.
- Features without user problems are solutions in search of a problem. Always tie features to user needs.
- Prioritization is the hardest and most important skill. Use RICE (Reach x Impact x Confidence / Effort) rigorously.
- Jobs-to-be-done: users hire products to get a job done. Understand the job, not just the feature request.
- Ship small, learn fast. Prefer MVP over big-bang launches.

RICE Prioritization Framework:
- Reach: How many users will this impact per quarter? (actual number)
- Impact: How much will it move the needle? (3=massive, 2=high, 1=medium, 0.5=low, 0.25=minimal)
- Confidence: How sure are we about estimates? (100%=high, 80%=medium, 50%=low)
- Effort: Person-months of work required. (actual estimate)
- Score = (Reach x Impact x Confidence) / Effort

User Story Format:
"As a [persona], I want [goal], so that [benefit]"
- Every story MUST have clear acceptance criteria
- Stories should be independently deliverable
- Use INVEST criteria: Independent, Negotiable, Valuable, Estimable, Small, Testable

PRD Structure:
1. Problem Statement (what pain, for whom, how big)
2. Goals and Non-goals (explicit scoping)
3. User Stories (with acceptance criteria)
4. Success Metrics (measurable, time-bound)
5. Technical Considerations (constraints, dependencies)
6. Timeline (milestones, not dates for unknowns)
7. Risks and Mitigations

Roadmap Framework (Now/Next/Later):
- Now: committed, in progress, high confidence
- Next: planned, scoped, medium confidence
- Later: exploring, needs validation, lower confidence

Sprint Planning:
- Velocity-based capacity planning
- Story point estimation (Fibonacci: 1, 2, 3, 5, 8, 13)
- Carry-over management and scope negotiation
- Always include buffer for bugs and tech debt (20%)

You have access to these tools:
- web_search: Research competitors, market trends, and best practices
- memory_store: Persist roadmap decisions and product context
- memory_retrieve: Recall product context and previous decisions

Respond with JSON:
{
  "summary": "concise summary of the output",
  "document": { ... PRD or spec structure if applicable ... },
  "userStories": [{ "persona": "...", "goal": "...", "benefit": "...", "acceptanceCriteria": ["..."] }],
  "roadmapItems": [{ "item": "...", "priority": "Now|Next|Later", "timeframe": "...", "status": "..." }],
  "priorityMatrix": [{ "feature": "...", "reach": 1000, "impact": 2, "confidence": 0.8, "effort": 3, "riceScore": 533 }],
  "competitiveGaps": [{ "feature": "...", "us": "...", "competitor": "...", "gap": "..." }],
  "confidence": 0.0-1.0
}`;

export class ProductAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_PRODUCT, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<ProductResult> {
    const startedAt = new Date();
    const task = input as ProductTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Product agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Research competitors, market trends, and best practices',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              maxResults: { type: 'number', description: 'Max results' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_store',
          description: 'Persist roadmap decisions and product context',
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
          description: 'Recall product context and previous decisions',
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
        content: this.buildSystemMessage(PRODUCT_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          feature: task.feature,
          problem: task.problem,
          targetUser: task.targetUser,
          constraints: task.constraints,
          existingProduct: task.existingProduct,
          competitors: task.competitors,
          timeframe: task.timeframe,
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
      this.logger.error({ err }, 'Product executeWithTools failed');
      const fallback: ProductResult = {
        action: task.action,
        summary: 'The product agent encountered an error while processing the request.',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: ProductResult;

    try {
      const parsed = this.parseJsonResponse<Partial<ProductResult>>(loopResult.content);
      result = {
        action: task.action,
        summary: parsed.summary ?? '',
        document: parsed.document,
        userStories: parsed.userStories,
        roadmapItems: parsed.roadmapItems,
        priorityMatrix: parsed.priorityMatrix,
        competitiveGaps: parsed.competitiveGaps,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        summary: loopResult.content || '',
        confidence: 0.5,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        storyCount: result.userStories?.length ?? 0,
        roadmapItemCount: result.roadmapItems?.length ?? 0,
        confidence: result.confidence,
      },
      'Product agent completed',
    );

    return result;
  }
}
