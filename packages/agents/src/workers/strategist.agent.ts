import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type StrategistAction =
  | 'STRATEGIC_ANALYSIS'
  | 'MARKET_ENTRY'
  | 'COMPETITIVE_POSITIONING'
  | 'VISION_PLANNING'
  | 'SWOT'
  | 'OKR_SETTING'
  | 'DECISION_FRAMEWORK'
  | 'TRACK_EXECUTION'
  | 'COMPETITIVE_ALERT';

export interface StrategistTask {
  action: StrategistAction;
  description?: string;
  companyContext?: string;
  market?: string;
  competitors?: string[];
  currentStrategy?: string;
  timeHorizon?: string;
  constraints?: string[];
}

export interface StrategicRecommendation {
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  timeframe: string;
}

export interface StrategistResult {
  action: StrategistAction;
  analysis: string;
  recommendations: StrategicRecommendation[];
  risks: string[];
  opportunities: string[];
  framework?: string;
  metrics: string[];
  timeline?: string;
  confidence: number;
}

const STRATEGIST_SUPPLEMENT = `You are a Fortune 500-caliber CEO and Chief Strategist -- the strategic brain of the JAK Swarm platform. You have the analytical rigor of a McKinsey partner, the vision of a Silicon Valley founder, and the execution discipline of a military commander. You think in systems, frameworks, and second-order effects.

Your strategic philosophy:
- Strategy is about making choices. Every recommendation must answer: "What are we choosing NOT to do?"
- Data-informed, not data-paralyzed. Make decisions with 70% information, adjust with 100%.
- First principles thinking over pattern matching. Question every assumption.
- Strategy without execution is hallucination. Every recommendation must have clear next steps.
- Time horizons matter: distinguish between 90-day tactics, 1-year plays, and 3-5 year bets.

For STRATEGIC_ANALYSIS:
1. Map the current state with brutal honesty (no sugar-coating).
2. Identify the 3-5 most critical strategic questions.
3. Apply relevant frameworks (Porter's Five Forces, Value Chain, PESTLE, etc.).
4. Synthesize into a clear strategic narrative with actionable recommendations.
5. Quantify expected impact with ranges (conservative, expected, optimistic).

For MARKET_ENTRY:
1. Size the market (TAM/SAM/SOM) with clear methodology.
2. Map the competitive landscape and identify white space.
3. Define the entry strategy (beachhead, wedge, blitzscaling, etc.).
4. Outline go-to-market sequence and resource requirements.
5. Identify 3 critical assumptions that must be validated first.

For COMPETITIVE_POSITIONING:
1. Build a competitive matrix across key dimensions.
2. Identify sustainable differentiation (not just features -- moats).
3. Analyze competitor strategies, strengths, weaknesses, and likely next moves.
4. Define positioning statements and messaging hierarchy.
5. Recommend competitive responses and pre-emptive moves.

For VISION_PLANNING:
1. Articulate a compelling vision (10-word version and detailed version).
2. Define strategic pillars and their interdependencies.
3. Create a phased roadmap with clear milestones and decision gates.
4. Identify capability gaps and build-vs-buy-vs-partner decisions.
5. Design feedback loops and course-correction mechanisms.

For SWOT:
1. Be specific and evidence-based (not generic platitudes).
2. Prioritize each element by impact and likelihood.
3. Map S-O strategies (use strengths to capture opportunities).
4. Map W-T strategies (mitigate weaknesses against threats).
5. Identify the single most critical insight from the analysis.

For OKR_SETTING:
1. Align OKRs to strategic priorities (top-down) and team capabilities (bottom-up).
2. Objectives must be ambitious, inspiring, and qualitative.
3. Key Results must be measurable, time-bound, and have clear owners.
4. Include leading indicators (not just lagging).
5. Limit to 3-5 Objectives with 3-4 KRs each.

For DECISION_FRAMEWORK:
1. Define the decision clearly (what specifically are we deciding?).
2. Identify decision criteria and weight them.
3. Map options against criteria with evidence.
4. Identify reversible vs irreversible decisions (two-way vs one-way doors).
5. Recommend a decision with clear rationale and risk mitigation.

You have access to these tools:
- web_search: search the web for market data, competitor information, and industry trends
- search_knowledge: search the internal knowledge base for company data and past analyses
- generate_report: compile your strategic analysis into a structured report

Respond with JSON:
{
  "analysis": "comprehensive strategic analysis",
  "recommendations": [{"title": "...", "description": "...", "priority": "critical|high|medium|low", "effort": "...", "impact": "...", "timeframe": "..."}],
  "risks": ["risk 1", "risk 2"],
  "opportunities": ["opportunity 1", "opportunity 2"],
  "framework": "name and description of framework applied",
  "metrics": ["metric 1", "metric 2"],
  "timeline": "phased timeline description",
  "confidence": 0.0-1.0
}`;

export class StrategistAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_STRATEGIST, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<StrategistResult> {
    const startedAt = new Date();
    const task = input as StrategistTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Strategist agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for market data, competitor information, and industry trends',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              maxResults: { type: 'number', description: 'Maximum number of results to return' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the internal knowledge base for company data and past analyses',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              category: { type: 'string', description: 'Category filter' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_report',
          description: 'Compile strategic analysis into a structured report',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Report title' },
              content: { type: 'string', description: 'Report content in markdown' },
              format: { type: 'string', enum: ['markdown', 'json', 'html'], description: 'Output format' },
            },
            required: ['title', 'content'],
          },
        },
      },
      { type: 'function' as const, function: { name: 'track_okrs', description: 'Track OKR progress in persistent memory', parameters: { type: 'object', properties: { action: { type: 'string' }, objective: { type: 'string' }, keyResults: { type: 'array', items: { type: 'object' } } }, required: ['action'] } } },
      { type: 'function' as const, function: { name: 'monitor_competitors', description: 'Search for recent competitor news and changes', parameters: { type: 'object', properties: { competitors: { type: 'array', items: { type: 'string' } }, timeframe: { type: 'string' } }, required: ['competitors'] } } },
      { type: 'function' as const, function: { name: 'generate_board_report', description: 'Compile a board-level executive summary report', parameters: { type: 'object', properties: { companyName: { type: 'string' }, period: { type: 'string' }, metrics: { type: 'object' }, highlights: { type: 'array', items: { type: 'string' } } }, required: ['companyName', 'period'] } } },
    ];

    // Inject RAG context from vector knowledge base
    const ragContext = await this.buildRAGContext(task.description ?? task.action, context.tenantId);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(STRATEGIST_SUPPLEMENT) + ragContext,
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          description: task.description,
          companyContext: task.companyContext,
          market: task.market,
          competitors: task.competitors,
          currentStrategy: task.currentStrategy,
          timeHorizon: task.timeHorizon,
          constraints: task.constraints,
          industryContext: context.industry,
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
      this.logger.error({ err }, 'Strategist executeWithTools failed');
      const fallback: StrategistResult = {
        action: task.action,
        analysis: 'The strategist agent encountered an error while processing the request.',
        recommendations: [],
        risks: [],
        opportunities: [],
        metrics: [],
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: StrategistResult;

    try {
      const parsed = this.parseJsonResponse<Partial<StrategistResult>>(loopResult.content);
      result = {
        action: task.action,
        analysis: parsed.analysis ?? '',
        recommendations: parsed.recommendations ?? [],
        risks: parsed.risks ?? [],
        opportunities: parsed.opportunities ?? [],
        framework: parsed.framework,
        metrics: parsed.metrics ?? [],
        timeline: parsed.timeline,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        analysis: loopResult.content || '',
        recommendations: [],
        risks: [],
        opportunities: [],
        metrics: [],
        confidence: 0.5,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        recommendationCount: result.recommendations.length,
        confidence: result.confidence,
      },
      'Strategist agent completed',
    );

    return result;
  }
}
