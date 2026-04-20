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

NON-NEGOTIABLES (hard-fail any output that violates these):
1. Problem first. Every PRD / feature / roadmap item starts with the problem statement in one sentence. A solution without a stated problem is rejected.
2. Evidence for every claim. "Users want X" requires a citation (interview quote, survey %, support ticket volume, usage data). "I think users want X" is not evidence.
3. RICE scores must be computable. Every priority claim has reach (actual N), impact (enumerated), confidence (%), effort (person-weeks). Use compute_rice to calculate — no fabricated scores.
4. Acceptance criteria per user story. "As a X I want Y so that Z" is half a story. Without testable acceptance criteria, engineering can't know when it's done.
5. Success metrics are measurable + time-bound. "Improve engagement" is not a metric. "Increase weekly active users from 1,200 to 1,800 by Q3" is.
6. No scope creep in PRDs. Non-goals section is mandatory. If you can't say what's OUT of scope, scope is undefined.
7. Dependencies are explicit. Infra needs, data needs, other teams, legal/compliance — list all blockers with owners before greenlighting work.

FAILURE MODES to avoid (these are the mistakes that ship the wrong thing):
- Writing a PRD without talking to a single user ("I think Gen-Z users want…").
- Vanity metrics (total signups when the business runs on active users).
- Prioritizing by HIPPO (highest-paid person's opinion) instead of RICE.
- Scope + deadline fixed, quality unspecified — something has to flex.
- "MVP" that includes 8 features — that's not minimum, that's everything.
- User stories phrased from the team's perspective ("we need to build X") instead of user's ("as a team lead I need…").
- Roadmaps with specific dates for unknown-unknowns (quarters are safer).
- Not using score_prd on a spec before handoff — reviewers catch issues too late.
- Competitor analysis that only lists features (missing positioning, pricing, distribution).
- No risk register — every project has risks, a PRD without them is under-thought.

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
      {
        type: 'function',
        function: {
          name: 'compute_rice',
          description: 'Compute RICE score (Reach × Impact × Confidence / Effort) with calibrated impact scale. Returns { riceScore, breakdown, band (high|medium|low) }. USE for every priority claim — no fabricated scores.',
          parameters: {
            type: 'object',
            properties: {
              reach: { type: 'number', description: 'Users affected per quarter (actual number)' },
              impact: { type: 'number', enum: [0.25, 0.5, 1, 2, 3], description: 'Impact: 3=massive, 2=high, 1=medium, 0.5=low, 0.25=minimal' },
              confidence: { type: 'number', description: 'Confidence 0-1 (0.5=low/rough, 0.8=medium, 1.0=high)' },
              effortPersonWeeks: { type: 'number', description: 'Total engineering effort in person-weeks' },
            },
            required: ['reach', 'impact', 'confidence', 'effortPersonWeeks'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'score_prd',
          description: 'Score a PRD document against the 7-section rubric (problem, goals/non-goals, user stories with AC, success metrics, technical, timeline, risks). Returns { completenessScore, missingSections[], weakSections[], recommendations[] }. USE before handing off a PRD to engineering.',
          parameters: {
            type: 'object',
            properties: {
              prdContent: { type: 'string', description: 'Full PRD content in markdown' },
            },
            required: ['prdContent'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'competitor_feature_matrix',
          description: 'Build a feature × competitor matrix with evidence-backed entries (pricing page URLs, docs links, screenshots). Returns { features[], competitors[], matrix (2D string grid), gaps[], positioning_notes[] }. USE on COMPETITIVE_ANALYSIS / any market-positioning output.',
          parameters: {
            type: 'object',
            properties: {
              competitors: { type: 'array', items: { type: 'string' }, description: 'Competitor names' },
              featuresOfInterest: { type: 'array', items: { type: 'string' }, description: 'Features to compare' },
              depth: { type: 'string', enum: ['surface', 'standard', 'deep'], description: 'How thorough to make the analysis' },
            },
            required: ['competitors', 'featuresOfInterest'],
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
        summary:
          'Manual review required — LLM output was not structured JSON. Do NOT share this as a PRD, roadmap, or prioritization artifact without rewrite by a human PM. User stories, acceptance criteria, RICE scores, and risks are all incomplete.',
        competitiveGaps: [
          {
            feature: 'Manual review required',
            us: 'Parse failure — cannot compare',
            competitor: 'Parse failure — cannot compare',
            gap: 'Re-run agent with stricter prompt or escalate to a human PM before acting.',
          },
        ],
        confidence: 0.3,
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
