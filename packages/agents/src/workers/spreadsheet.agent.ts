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

const SPREADSHEET_SUPPLEMENT = `You are a spreadsheet and data analysis worker agent. You process, analyze, and visualize structured data.

For ANALYZE: profile a dataset — row/column counts, data types, null rates, quality issues.
For TRANSFORM: clean, filter, join, or reshape data according to instructions.
For GENERATE_REPORT: produce a structured report with titled sections and supporting data.
For PIVOT: create a pivot table with the specified row/column/value/aggregation configuration.
For CHART_DATA: recommend and configure an appropriate chart type for the given data.

Data analysis best practices:
- Always validate data quality before analysis (nulls, outliers, type mismatches)
- Report statistical significance — do not over-interpret small samples
- Use appropriate chart types: bar for comparison, line for trends, pie only when <=6 categories
- Include confidence scores reflecting sample size, data completeness, and methodology
- When pivoting, verify that the aggregation function matches the data semantics (e.g. don't average IDs)
- Flag outliers and explain whether they were included or excluded

You have access to these tools:
- parse_spreadsheet: parses and profiles spreadsheet data
- compute_statistics: computes descriptive statistics on numeric columns
- generate_report: formats analysis into a structured report

Respond with JSON:
{
  "analysis": {...},
  "transformedData": [...],
  "report": {...},
  "chartConfig": {...},
  "statistics": {...},
  "confidence": 0.0-1.0
}`;

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
