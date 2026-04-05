import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
// ToolCall type used internally by executeWithTools()
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type VoiceAction =
  | 'TRANSCRIBE'
  | 'SUMMARIZE_CALL'
  | 'EXTRACT_ACTION_ITEMS'
  | 'SYNTHESIZE';

export interface ActionItem {
  description: string;
  assignee?: string;
  dueDate?: string;
  priority?: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'done';
}

export interface VoiceTask {
  action: VoiceAction;
  transcript?: string;
  audioReference?: string;
  callMetadata?: {
    participants?: string[];
    date?: string;
    duration?: number;
    callType?: string;
  };
  focusTopics?: string[];
}

export interface VoiceResult {
  action: VoiceAction;
  transcript?: string;
  summary?: string;
  actionItems: ActionItem[];
  keyTopics: string[];
  sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed';
}

const VOICE_SUPPLEMENT = `You are a voice and audio processing worker agent. You handle transcription analysis, call summarization, and action item extraction.

For TRANSCRIBE: process audio references or clean up raw transcripts (disfluency removal, speaker labeling).
For SUMMARIZE_CALL: produce a concise, structured summary of a call or meeting.
For EXTRACT_ACTION_ITEMS: identify actionable commitments from a transcript with assignees and deadlines.
For SYNTHESIZE: combine insights from multiple calls or transcripts into a unified brief.

Meeting summary best practices:
- Lead with the key decisions made during the call
- List action items with clear owners and deadlines
- Note any unresolved questions or parking lot items
- Capture the overall sentiment and engagement level
- Use bullet points for readability
- Keep summaries under 300 words for standard calls
- For EXTRACT_ACTION_ITEMS, err on the side of inclusion — it is better to capture a possible action item than to miss one
- Attribute action items to specific speakers when identifiable

Sentiment analysis:
- positive: constructive, agreements, enthusiasm
- neutral: informational, routine updates
- negative: frustration, disagreements, escalations
- mixed: combination of positive and negative signals

You have access to these tools:
- classify_text: classifies transcript segments by topic, sentiment, or intent
- search_knowledge: searches for relevant context from previous calls or knowledge base

Respond with JSON:
{
  "transcript": "...",
  "summary": "...",
  "actionItems": [{"description": "...", "assignee": "...", "priority": "high", "status": "open"}],
  "keyTopics": ["topic1", "topic2"],
  "sentiment": "positive"
}`;

export class VoiceAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_VOICE, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<VoiceResult> {
    const startedAt = new Date();
    const task = input as VoiceTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Voice agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'classify_text',
          description: 'Classify transcript segments by topic, sentiment, or speaker intent',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text segment to classify' },
              categories: {
                type: 'array',
                items: { type: 'string' },
                description: 'Classification categories',
              },
              classifyBy: {
                type: 'string',
                enum: ['topic', 'sentiment', 'intent'],
                description: 'What dimension to classify on',
              },
            },
            required: ['text'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search knowledge base for context from previous calls or related documents',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              category: { type: 'string' },
              limit: { type: 'number' },
            },
            required: ['query'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(VOICE_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          transcript: task.transcript?.slice(0, 8000), // Cap to avoid token overflow
          audioReference: task.audioReference,
          callMetadata: task.callMetadata,
          focusTopics: task.focusTopics,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 2048,
        temperature: 0.3,
        maxIterations: 3,
      });
    } catch (err) {
      this.logger.error({ err }, 'Voice executeWithTools failed');
      const fallback: VoiceResult = {
        action: task.action,
        actionItems: [],
        keyTopics: [],
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: VoiceResult;

    try {
      const parsed = this.parseJsonResponse<Partial<VoiceResult>>(loopResult.content);
      result = {
        action: task.action,
        transcript: parsed.transcript,
        summary: parsed.summary,
        actionItems: (parsed.actionItems ?? []).map((item) => ({
          description: item.description ?? '',
          assignee: item.assignee,
          dueDate: item.dueDate,
          priority: item.priority,
          status: item.status ?? 'open',
        })),
        keyTopics: parsed.keyTopics ?? [],
        sentiment: parsed.sentiment,
      };
    } catch {
      // Freeform text — treat as a summary
      result = {
        action: task.action,
        summary: loopResult.content || undefined,
        actionItems: [],
        keyTopics: [],
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        actionItemCount: result.actionItems.length,
        topicCount: result.keyTopics.length,
        sentiment: result.sentiment,
      },
      'Voice agent completed',
    );

    return result;
  }
}
