import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export interface ResearchTask {
  query: string;
  maxSources?: number;
  focusArea?: string;
  requiredTopics?: string[];
  dateRange?: { from?: string; to?: string };
}

export interface ResearchSource {
  title: string;
  url?: string;
  excerpt: string;
  relevanceScore: number;
  publishedDate?: string;
}

export interface ResearchResult {
  query: string;
  findings: string;
  keyPoints: string[];
  sources: ResearchSource[];
  confidence: number;
  limitations: string[];
  suggestedFollowUp?: string[];
}

const RESEARCH_SUPPLEMENT = `You are a research agent. Your role is to synthesize information and provide well-structured research findings.

When conducting research:
1. Break down the query into sub-topics
2. Identify key facts, trends, and insights
3. Cite your knowledge sources (even if internal knowledge)
4. Be explicit about confidence levels and limitations
5. Flag when information may be outdated

You have access to:
- search_knowledge: searches the knowledge base for relevant documents
- classify_text: helps categorize and organize findings

ALWAYS:
- State your confidence level (0.0-1.0)
- List limitations of your findings
- Never fabricate statistics, quotes, or specific data points
- If uncertain, say so explicitly

Respond with JSON:
{
  "findings": "detailed findings paragraph",
  "keyPoints": ["point 1", "point 2"],
  "sources": [{"title": "...", "excerpt": "...", "relevanceScore": 0.9}],
  "confidence": 0.0-1.0,
  "limitations": ["limitation 1"],
  "suggestedFollowUp": ["follow-up question 1"]
}`;

export class ResearchAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_RESEARCH, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<ResearchResult> {
    const startedAt = new Date();
    const task = input as ResearchTask;

    this.logger.info(
      { runId: context.runId, query: task.query.slice(0, 100) },
      'Research agent executing',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for information on a topic',
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
          description: 'Search the internal knowledge base for relevant documents',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              topics: { type: 'array', items: { type: 'string' }, description: 'Topic filters' },
            },
            required: ['query'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(RESEARCH_SUPPLEMENT),
      },
      {
        role: 'user',
        content: [
          `Research Query: ${task.query}`,
          task.focusArea ? `Focus Area: ${task.focusArea}` : '',
          task.requiredTopics?.length ? `Required Topics: ${task.requiredTopics.join(', ')}` : '',
          `Industry Context: ${context.industry ?? 'GENERAL'}`,
          `Max Sources: ${task.maxSources ?? 5}`,
          '',
          'Please respond with the JSON format specified in your instructions.',
        ].filter(Boolean).join('\n'),
      },
    ];

    let result: ResearchResult;

    try {
      const loopResult: ToolLoopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 2048,
        temperature: 0.3,
      });

      try {
        const parsed = this.parseJsonResponse<Partial<ResearchResult>>(loopResult.content);
        result = {
          query: task.query,
          findings: parsed.findings ?? 'Research completed. See key points for details.',
          keyPoints: parsed.keyPoints ?? [],
          sources: parsed.sources ?? [],
          confidence: parsed.confidence ?? 0.7,
          limitations: parsed.limitations ?? ['Results based on available knowledge base only'],
          suggestedFollowUp: parsed.suggestedFollowUp,
        };
      } catch {
        // LLM returned freeform text instead of JSON — wrap it gracefully
        result = {
          query: task.query,
          findings: loopResult.content || 'No findings returned.',
          keyPoints: loopResult.content ? [loopResult.content.slice(0, 200)] : [],
          sources: [],
          confidence: 0.6,
          limitations: ['Output was plain text rather than structured JSON'],
        };
      }

      this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: errorMsg }, 'Research agent execution failed');
      result = {
        query: task.query,
        findings: `Error: ${errorMsg}`,
        keyPoints: [],
        sources: [],
        confidence: 0,
        limitations: [`Execution error: ${errorMsg}`],
      };
      this.recordTrace(context, input, result, [], startedAt);
    }

    return result;
  }
}
