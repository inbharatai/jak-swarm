import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
// ToolCall type used internally by executeWithTools()
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type SpreadsheetAction =
  | 'ANALYZE'
  | 'TRANSFORM'
  | 'GENERATE_REPORT'
  | 'PIVOT'
  | 'CHART_DATA';

export interface SpreadsheetAnalysis {
  rowCount: number;
  columnCount: number;
  columns: Array<{ name: string; type: string; nullCount: number }>;
  summary: string;
  dataQualityIssues?: string[];
}

export interface SpreadsheetStatistics {
  mean?: Record<string, number>;
  median?: Record<string, number>;
  stddev?: Record<string, number>;
  min?: Record<string, number>;
  max?: Record<string, number>;
  correlations?: Record<string, number>;
}

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'histogram' | 'heatmap';
  title: string;
  xAxis?: string;
  yAxis?: string;
  series: Array<{ name: string; dataKey: string }>;
  options?: Record<string, unknown>;
}

export interface SpreadsheetReport {
  title: string;
  sections: Array<{
    heading: string;
    content: string;
    data?: Record<string, unknown>[];
  }>;
  generatedAt: string;
}

export interface SpreadsheetTask {
  action: SpreadsheetAction;
  spreadsheetId?: string;
  data?: Record<string, unknown>[];
  columns?: string[];
  query?: string;
  pivotConfig?: {
    rows: string[];
    columns: string[];
    values: string[];
    aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
  };
  chartType?: ChartConfig['type'];
  reportTitle?: string;
}

export interface SpreadsheetResult {
  action: SpreadsheetAction;
  analysis?: SpreadsheetAnalysis;
  transformedData?: Record<string, unknown>[];
  report?: SpreadsheetReport;
  chartConfig?: ChartConfig;
  statistics?: SpreadsheetStatistics;
  confidence: number;
}

const SPREADSHEET_SUPPLEMENT = `You are a senior data analyst. You treat spreadsheet analysis as forensic statistics work, not ballpark summarization. Every claim you make is either traceable to the data or labeled as an estimate with a confidence bound.

Action handling:

ANALYZE:
- Dataset profile — rowCount, colCount, per-column: name, inferredType (string|number|boolean|date|mixed), nullRatePct, uniqueCount, sampleValues (max 3).
- Quality issues — flag explicitly: wrong-type cells, out-of-range values, duplicate primary keys, leading/trailing whitespace, inconsistent date formats, encoding issues.
- Distribution — for numeric columns, report five-number summary (min, Q1, median, Q3, max) AND mean + stddev. For categorical, top-5 with counts.
- Outliers — use 1.5×IQR rule for numeric. Report both count and whether you excluded them (default: include but flag).

TRANSFORM:
- Describe the transformation as a sequence of named steps: filter → project → dedupe → join → pivot → aggregate.
- Preserve row count semantics: if the output row count differs from input, state why (filter removed N, aggregation collapsed N→M).
- Never silently coerce types — if you convert "3.14" (string) → 3.14 (number), log it.

GENERATE_REPORT:
- Structure: TL;DR (2-3 sentences), methodology (what you computed + what you excluded), key findings (3-7 bullets), supporting statistics (the actual numbers), limitations, recommendations.
- Every finding must reference specific numbers from the data. "Revenue grew significantly" is wrong; "Revenue grew from $2.4M to $3.8M (+58%, n=12 months)" is right.

PIVOT:
- Verify the aggregation function MATCHES column semantics:
  • IDs, codes, booleans, categorical: count | countDistinct
  • Currency, quantities, durations: sum | avg
  • Ratings, scores, prices: avg | median
  • NEVER average IDs, order numbers, or boolean flags.
- If the aggregation is semantically wrong, refuse and explain.

CHART_DATA (honest chart-type selection):
- Bar: comparison across <=20 distinct categories
- Horizontal bar: comparison when category labels are long
- Line: continuous metric over time (monotonic x-axis)
- Area: same as line when showing cumulative or stacked totals
- Scatter: correlation between two continuous numeric vars
- Histogram: distribution of a single numeric column
- Box plot: distribution comparison across groups
- Pie: proportion of a whole, ONLY when ≤6 categories AND no category <5%. Otherwise use bar.
- Heatmap: correlation matrix or category × category density
- Never pie chart >6 categories. Never 3D charts. Never dual-axis unless explicitly requested.

Statistical rigor (all actions):
- Small-sample discipline: n<30 → report non-parametric summary (median, IQR), not mean ± stddev. Flag confidence accordingly.
- Significance: never call a difference "significant" without a test. p-value must come from a real computation, not asserted.
- Correlation ≠ causation. State correlation, never assert cause unless domain knowledge supports it.
- Missing data: report nullRatePct. If a column is >30% null, note that aggregations may be biased.
- Time series: check for seasonality + stationarity before trend claims. A 2-month uptick in a seasonal series is not a trend.

Confidence scoring:
- 0.9+: >1000 rows, no quality issues, clean computations
- 0.7-0.89: reasonable sample, minor quality issues documented
- 0.5-0.69: small sample or significant null rates
- <0.5: very small sample or heavy data quality issues — say so

Refuse to fabricate:
- If the data doesn't contain a column needed for the request, say so. Don't estimate from ambient knowledge.
- Never invent row counts, dollar values, percentages, or summary statistics not computed from the input.

Tools available:
- parse_spreadsheet: CSV/structured data parsing + column profiling
- compute_statistics: real statistical computations
- generate_report: structured output formatting
- forecast_cashflow: time-series forecasting (linear regression / moving average)

Return STRICT JSON matching SpreadsheetResult. Populate the statistics field with the actual five-number summary when numeric columns exist. No markdown fences.`;

export class SpreadsheetAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_SPREADSHEET, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<SpreadsheetResult> {
    const startedAt = new Date();
    const task = input as SpreadsheetTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Spreadsheet agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'parse_spreadsheet',
          description: 'Parse and profile spreadsheet data, returning column metadata and summary statistics',
          parameters: {
            type: 'object',
            properties: {
              spreadsheetId: { type: 'string', description: 'ID of the spreadsheet to parse' },
              data: {
                type: 'array',
                items: { type: 'object' },
                description: 'Inline data rows if no spreadsheetId',
              },
              columns: {
                type: 'array',
                items: { type: 'string' },
                description: 'Subset of columns to analyze',
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'compute_statistics',
          description: 'Compute descriptive statistics (mean, median, stddev, min, max, correlations) on numeric columns',
          parameters: {
            type: 'object',
            properties: {
              data: { type: 'array', items: { type: 'object' } },
              columns: { type: 'array', items: { type: 'string' } },
              includeCorrelations: { type: 'boolean' },
            },
            required: ['data', 'columns'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_report',
          description: 'Generate a structured report from analysis results',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              analysisResults: { type: 'object' },
              format: { type: 'string', enum: ['summary', 'detailed', 'executive'] },
            },
            required: ['title', 'analysisResults'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(SPREADSHEET_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          spreadsheetId: task.spreadsheetId,
          data: task.data?.slice(0, 100), // Cap inline data to avoid token overflow
          columns: task.columns,
          query: task.query,
          pivotConfig: task.pivotConfig,
          chartType: task.chartType,
          reportTitle: task.reportTitle,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 2048,
        temperature: 0.2,
        maxIterations: 4,
      });
    } catch (err) {
      this.logger.error({ err }, 'Spreadsheet executeWithTools failed');
      const fallback: SpreadsheetResult = {
        action: task.action,
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: SpreadsheetResult;

    try {
      const parsed = this.parseJsonResponse<Partial<SpreadsheetResult>>(loopResult.content);
      result = {
        action: task.action,
        analysis: parsed.analysis,
        transformedData: parsed.transformedData,
        report: parsed.report,
        chartConfig: parsed.chartConfig,
        statistics: parsed.statistics,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      // LLM returned prose — wrap as a report section
      result = {
        action: task.action,
        confidence: 0.5,
        report: loopResult.content
          ? {
              title: task.reportTitle ?? 'Analysis Result',
              sections: [{ heading: 'Summary', content: loopResult.content }],
              generatedAt: new Date().toISOString(),
            }
          : undefined,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        confidence: result.confidence,
        hasChart: !!result.chartConfig,
      },
      'Spreadsheet agent completed',
    );

    return result;
  }
}
