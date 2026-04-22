import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type FinanceAction =
  | 'FINANCIAL_MODEL'
  | 'BUDGET_ANALYSIS'
  | 'REVENUE_FORECAST'
  | 'COST_OPTIMIZATION'
  | 'UNIT_ECONOMICS'
  | 'VALUATION'
  | 'RISK_ASSESSMENT'
  | 'CASH_FLOW_ANALYSIS'
  | 'TRACK_BUDGET'
  | 'PARSE_STATEMENTS';

export interface FinanceTask {
  action: FinanceAction;
  description?: string;
  financialData?: Record<string, unknown>;
  timeHorizon?: string;
  currency?: string;
  industry?: string;
  companyStage?: 'pre-seed' | 'seed' | 'series-a' | 'series-b' | 'growth' | 'public';
  constraints?: string[];
}

export interface ScenarioProjection {
  label: string;
  revenue: number;
  costs: number;
  profit: number;
  margin: number;
  assumptions: string[];
}

export interface FinanceResult {
  action: FinanceAction;
  analysis: string;
  metrics: Record<string, number>;
  assumptions: string[];
  projections?: string;
  scenarios?: { best: ScenarioProjection; likely: ScenarioProjection; worst: ScenarioProjection };
  recommendations: string[];
  risks: string[];
  confidence: number;
}

const FINANCE_SUPPLEMENT = `You are an elite CFO and financial analyst -- the financial brain of the JAK Swarm platform. You have the analytical precision of a Goldman Sachs analyst, the strategic thinking of a PE operating partner, and the practical wisdom of a seasoned CFO who has steered companies through IPOs, downturns, and hyper-growth. Every number you produce has a source or is clearly marked as an estimate.

Your financial philosophy:
- Cash is king, but cash flow is emperor. A profitable company can die from poor cash management.
- Every assumption must be stated explicitly. Hidden assumptions are the enemy of good financial analysis.
- Build models that are wrong precisely rather than vaguely right. Quantify uncertainty with ranges.
- Unit economics must work at scale, not just in a pitch deck. Stress-test every model.
- Three scenarios are the minimum: best case, likely case, worst case. Decision-makers need the range.
- Financial projections without sensitivity analysis are fiction. Always show what moves the needle.

For FINANCIAL_MODEL:
1. Define the model structure (P&L, balance sheet, cash flow, or custom).
2. State ALL assumptions explicitly with sources or basis for estimates.
3. Build the model with formulas and relationships clearly documented.
4. Include sensitivity analysis on 3-5 key variables.
5. Show monthly granularity for year 1, quarterly for years 2-3, annual for years 4-5.
6. Include unit economics (CAC, LTV, payback period, gross margin).

For BUDGET_ANALYSIS:
1. Compare actual vs budgeted with variance analysis (dollar and percentage).
2. Identify trends and patterns in spending.
3. Flag line items with concerning variances (>10% over or unusual patterns).
4. Analyze spend efficiency (ROI per dollar by category).
5. Recommend reallocation to optimize for stated goals.

For REVENUE_FORECAST:
1. Analyze historical revenue patterns (growth rate, seasonality, trends).
2. Build a bottom-up model (customers x ARPU x retention) alongside top-down.
3. Identify revenue drivers and leading indicators.
4. Model three scenarios with clearly different assumptions.
5. Include cohort analysis for recurring revenue (MRR/ARR, churn, expansion).

For COST_OPTIMIZATION:
1. Categorize costs as fixed vs variable, essential vs discretionary.
2. Benchmark against industry standards (as % of revenue).
3. Identify quick wins (30-day savings) and structural improvements (90+ days).
4. Model the impact of each optimization on P&L and cash flow.
5. Assess risks of cost cuts (e.g., cutting too deep in R&D or customer success).

For UNIT_ECONOMICS:
1. Calculate all key metrics: CAC, LTV, LTV/CAC ratio, payback period, gross margin, contribution margin.
2. Break down by segment, channel, and cohort.
3. Model how unit economics change with scale.
4. Identify the levers that most impact profitability.
5. Compare against benchmarks for company stage and industry.

For VALUATION:
1. Apply multiple methodologies: DCF, comparable company analysis, precedent transactions.
2. Build DCF with explicit WACC calculation (cost of equity + cost of debt).
3. Select appropriate comparables with justification.
4. Apply appropriate multiples (EV/Revenue, EV/EBITDA, P/E) based on stage.
5. Present a valuation range (not a single number) with key drivers identified.

For RISK_ASSESSMENT:
1. Identify financial risks (market, credit, liquidity, operational, regulatory).
2. Quantify probability and impact for each risk (expected loss = P x I).
3. Map risk correlations (which risks amplify each other).
4. Design mitigation strategies with cost-benefit analysis.
5. Build a risk-adjusted financial model with Monte Carlo-style scenarios.

For CASH_FLOW_ANALYSIS:
1. Build a detailed cash flow statement (operating, investing, financing activities).
2. Analyze cash conversion cycle (DSO, DPO, DIO).
3. Model runway under different burn scenarios.
4. Identify cash flow timing mismatches and working capital needs.
5. Recommend cash management strategies (reserves, credit facilities, payment terms).

You have access to these tools:
- find_document: Look up a spreadsheet, statement, or financial doc the user uploaded (balance_sheet.xlsx, invoice.pdf, P&L.csv). Returns metadata + best-matching content snippet. Use this FIRST when the user references a specific file by name or describes its contents — do not ask them to paste the file until you've tried this.
- compute_statistics: compute statistical calculations, aggregations, and financial formulas
- parse_spreadsheet: extract and parse data from spreadsheet inputs
- search_knowledge: search the internal knowledge base for financial benchmarks and historical data
- generate_report: compile your financial analysis into a structured report

Respond with JSON:
{
  "analysis": "comprehensive financial analysis narrative",
  "metrics": {"metricName": numericValue, ...},
  "assumptions": ["assumption 1 with basis", "assumption 2 with basis"],
  "projections": "detailed projection narrative or table",
  "scenarios": {"best": {...}, "likely": {...}, "worst": {...}},
  "recommendations": ["recommendation 1", "recommendation 2"],
  "risks": ["financial risk 1", "financial risk 2"],
  "confidence": 0.0-1.0
}`;

export class FinanceAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_FINANCE, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<FinanceResult> {
    const startedAt = new Date();
    const task = input as FinanceTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Finance agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'find_document',
          description: 'Look up a spreadsheet, statement, invoice, or financial doc the user uploaded via the Files tab. Returns metadata + best-matching content snippet. Use this FIRST when the user asks about a named or described file — do not ask them to paste contents until you have tried this.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'File name or content description. Examples: "Q2 balance sheet", "vendor_invoice_march.pdf", "2026 budget".',
              },
              limit: { type: 'number', description: 'Max documents to return (default 5, max 20).' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filter.' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'compute_statistics',
          description: 'Compute statistical calculations, aggregations, and financial formulas',
          parameters: {
            type: 'object',
            properties: {
              operation: { type: 'string', description: 'The calculation to perform (e.g., "dcf", "irr", "npv", "cagr", "mean", "percentile")' },
              data: { type: 'object', description: 'Input data for the calculation' },
              parameters: { type: 'object', description: 'Additional parameters for the calculation' },
            },
            required: ['operation', 'data'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'parse_spreadsheet',
          description: 'Extract and parse data from spreadsheet inputs',
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Spreadsheet identifier or path' },
              sheet: { type: 'string', description: 'Sheet name to parse' },
              range: { type: 'string', description: 'Cell range to extract (e.g., "A1:F50")' },
            },
            required: ['source'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the internal knowledge base for financial benchmarks and historical data',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              category: { type: 'string', description: 'Category filter (e.g., "benchmarks", "financials", "industry")' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_report',
          description: 'Compile financial analysis into a structured report',
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
      { type: 'function' as const, function: { name: 'parse_financial_csv', description: 'Parse CSV financial data into structured format', parameters: { type: 'object', properties: { csvContent: { type: 'string' }, type: { type: 'string' } }, required: ['csvContent'] } } },
      { type: 'function' as const, function: { name: 'track_budget', description: 'Track budget vs actuals in persistent memory', parameters: { type: 'object', properties: { action: { type: 'string' }, category: { type: 'string' }, amount: { type: 'number' }, period: { type: 'string' } }, required: ['action'] } } },
      { type: 'function' as const, function: { name: 'forecast_cashflow', description: 'Forecast cashflow based on historical data', parameters: { type: 'object', properties: { historicalData: { type: 'array', items: { type: 'number' } }, periods: { type: 'number' } }, required: ['historicalData', 'periods'] } } },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(FINANCE_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          description: task.description,
          financialData: task.financialData,
          timeHorizon: task.timeHorizon,
          currency: task.currency ?? 'USD',
          industry: task.industry ?? context.industry,
          companyStage: task.companyStage,
          constraints: task.constraints,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 4096,
        temperature: 0.2,
        maxIterations: 5,
      });
    } catch (err) {
      this.logger.error({ err }, 'Finance executeWithTools failed');
      const fallback: FinanceResult = {
        action: task.action,
        analysis: 'The finance agent encountered an error while processing the request.',
        metrics: {},
        assumptions: [],
        recommendations: [],
        risks: [],
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: FinanceResult;

    try {
      const parsed = this.parseJsonResponse<Partial<FinanceResult>>(loopResult.content);
      result = {
        action: task.action,
        analysis: parsed.analysis ?? '',
        metrics: parsed.metrics ?? {},
        assumptions: parsed.assumptions ?? [],
        projections: parsed.projections,
        scenarios: parsed.scenarios,
        recommendations: parsed.recommendations ?? [],
        risks: parsed.risks ?? [],
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        analysis: loopResult.content || '',
        metrics: {},
        assumptions: [
          'Manual review required — LLM output was not structured JSON. Assumptions, projections, and scenarios may be missing.',
        ],
        recommendations: [
          'Do not execute any financial decision based on this output without finance-team verification and CFO sign-off where applicable.',
        ],
        risks: [
          'Parse-failure output — all risk analysis is incomplete. Re-run or escalate to a human analyst.',
        ],
        confidence: 0.3,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        metricCount: Object.keys(result.metrics).length,
        confidence: result.confidence,
      },
      'Finance agent completed',
    );

    return result;
  }
}
