import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type AnalyticsAction =
  | 'CALCULATE_METRICS'
  | 'TREND_ANALYSIS'
  | 'ANOMALY_DETECTION'
  | 'AB_TEST_ANALYSIS'
  | 'COHORT_ANALYSIS'
  | 'BUILD_DASHBOARD'
  | 'GENERATE_INSIGHT_REPORT';

export interface AnalyticsTask {
  action: AnalyticsAction;
  data?: Record<string, unknown>;
  query?: string;
  metric?: string;
  timeRange?: { start: string; end: string };
  segments?: string[];
  hypothesis?: string;
  confidenceLevel?: number;
  dependencyResults?: Record<string, unknown>;
}

export interface AnalyticsResult {
  action: AnalyticsAction;
  summary: string;
  metrics?: Record<string, number | string>;
  charts?: Array<{ type: string; title: string; data: unknown }>;
  insights?: string[];
  anomalies?: Array<{ metric: string; value: number; expected: number; severity: string }>;
  statisticalResults?: Record<string, unknown>;
  dashboardSpec?: Record<string, unknown>;
  confidence: number;
}

const ANALYTICS_SUPPLEMENT = `You are a Head of Data/Business Intelligence who has built analytics organizations at scale. You are the data analytics brain of the JAK Swarm platform. You combine statistical rigor with business intuition.

Your analytics philosophy:
- Statistical rigor is non-negotiable. Always state sample size, confidence intervals, and p-values for hypothesis tests.
- Correlation is not causation. Avoid spurious correlations and always look for confounding variables.
- NEVER fabricate numbers. All metrics must be derived from provided data or clearly marked as estimates.
- Data without context is noise. Always tie metrics to business outcomes.
- Simplicity wins. The best dashboard is one that everyone understands.

Dashboard Design Principles:
- KPIs at the top (the "so what" numbers)
- Trends in the middle (the "how is it changing" view)
- Details at the bottom (the "let me dig deeper" section)

For CALCULATE_METRICS:
1. Identify the metric definition and formula.
2. Validate input data completeness and quality.
3. Calculate the metric with proper rounding.
4. Provide period-over-period comparison if time data available.
5. Contextualize with benchmarks where possible.

For TREND_ANALYSIS:
1. Compute moving averages (7-day, 30-day) to smooth noise.
2. Identify inflection points and regime changes.
3. Calculate growth rates (absolute and percentage).
4. Decompose into trend, seasonality, and residual components.
5. Project forward with confidence intervals.

For ANOMALY_DETECTION:
1. Establish baseline using historical data.
2. Apply z-score method (flag values > 2 standard deviations from mean).
3. Cross-validate with IQR method (flag values outside 1.5x IQR).
4. Classify anomaly severity: low (2-3 SD), medium (3-4 SD), high (>4 SD).
5. Investigate potential root causes for each anomaly.

For AB_TEST_ANALYSIS:
1. Check minimum sample size requirement (power analysis).
2. Calculate statistical significance (two-tailed t-test, p < 0.05).
3. Calculate practical significance (effect size, Cohen's d).
4. Check for Simpson's paradox across segments.
5. Recommend: ship, iterate, or kill based on results.

For COHORT_ANALYSIS:
1. Define cohort boundaries (acquisition date, first action, etc.).
2. Build retention curves for each cohort.
3. Calculate LTV by acquisition channel/cohort.
4. Identify best and worst performing cohorts.
5. Recommend actions based on cohort patterns.

For BUILD_DASHBOARD:
1. Define KPIs and their data sources.
2. Design layout: KPIs top, trends middle, details bottom.
3. Specify chart types optimal for each metric.
4. Include filters and drill-down capabilities.
5. Output as a structured dashboard specification.

For GENERATE_INSIGHT_REPORT:
1. Identify the top 3-5 insights from the data.
2. Support each insight with specific numbers and trends.
3. Prioritize by business impact.
4. Include "so what" and "now what" for each insight.
5. Summarize in executive-friendly language.

You have access to these tools:
- compute_statistics: Perform statistical calculations (mean, median, stdev, percentiles, t-tests, z-scores)
- parse_spreadsheet: Parse and extract data from spreadsheet files
- code_execute: Execute Python code for pandas/numpy data analysis
- web_search: Search for benchmark data and industry statistics
- memory_store: Persist analytical findings for future reference

Respond with JSON:
{
  "summary": "concise summary of the analysis",
  "metrics": { "metric_name": "value" },
  "charts": [{ "type": "line|bar|pie", "title": "Chart Title", "data": {} }],
  "insights": ["insight 1 backed by data", "insight 2 backed by data"],
  "anomalies": [{ "metric": "name", "value": 123, "expected": 100, "severity": "medium" }],
  "statisticalResults": { ... },
  "dashboardSpec": { ... },
  "confidence": 0.0-1.0
}`;

export class AnalyticsAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_ANALYTICS, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<AnalyticsResult> {
    const startedAt = new Date();
    const task = input as AnalyticsTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Analytics agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'compute_statistics',
          description: 'Perform statistical calculations (mean, median, stdev, percentiles, t-tests, z-scores)',
          parameters: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['descriptive', 'ttest', 'zscore', 'correlation', 'regression', 'percentile'],
                description: 'Statistical operation to perform',
              },
              data: { type: 'array', items: { type: 'number' }, description: 'Data array' },
              dataB: { type: 'array', items: { type: 'number' }, description: 'Second data array for comparisons' },
              alpha: { type: 'number', description: 'Significance level (default 0.05)' },
            },
            required: ['operation', 'data'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'parse_spreadsheet',
          description: 'Parse and extract data from spreadsheet files',
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
          name: 'code_execute',
          description: 'Execute Python code for pandas/numpy data analysis',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Python code to execute' },
              language: { type: 'string', enum: ['python'], description: 'Language' },
            },
            required: ['code'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search for benchmark data and industry statistics',
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
          description: 'Persist analytical findings for future reference',
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
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(ANALYTICS_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          data: task.data,
          query: task.query,
          metric: task.metric,
          timeRange: task.timeRange,
          segments: task.segments,
          hypothesis: task.hypothesis,
          confidenceLevel: task.confidenceLevel,
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
      this.logger.error({ err }, 'Analytics executeWithTools failed');
      const fallback: AnalyticsResult = {
        action: task.action,
        summary: 'The analytics agent encountered an error while processing the request.',
        insights: [],
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: AnalyticsResult;

    try {
      const parsed = this.parseJsonResponse<Partial<AnalyticsResult>>(loopResult.content);
      result = {
        action: task.action,
        summary: parsed.summary ?? '',
        metrics: parsed.metrics,
        charts: parsed.charts,
        insights: parsed.insights ?? [],
        anomalies: parsed.anomalies,
        statisticalResults: parsed.statisticalResults,
        dashboardSpec: parsed.dashboardSpec,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        summary: loopResult.content || '',
        insights: [
          'Manual review required — LLM output was not structured JSON. Do not publish dashboards or act on these metrics without human verification.',
        ],
        confidence: 0.3,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        insightCount: result.insights?.length ?? 0,
        anomalyCount: result.anomalies?.length ?? 0,
        confidence: result.confidence,
      },
      'Analytics agent completed',
    );

    return result;
  }
}
