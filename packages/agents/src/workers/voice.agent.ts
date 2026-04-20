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

/** Per-speaker contribution stats on a multi-party call. */
export interface SpeakerStats {
  speaker: string;
  talkTimePct: number;
  wordCount: number;
  questionsAsked: number;
  interruptions: number;
}

/** Decision recorded during the call with attribution. */
export interface CallDecision {
  decision: string;
  /** Who committed to it (speaker label or name). */
  decidedBy?: string;
  /** Timestamp in the transcript where the decision was made, if available. */
  transcriptTimestamp?: string;
  /** Stakeholders expected to be notified. */
  notifyStakeholders?: string[];
}

export interface VoiceResult {
  action: VoiceAction;
  transcript?: string;
  summary?: string;
  actionItems: ActionItem[];
  keyTopics: string[];
  sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed';
  /** Decisions made during the call — separate from action items. */
  decisions?: CallDecision[];
  /** Speaker-level engagement stats. */
  speakerStats?: SpeakerStats[];
  /** Open questions the call did not resolve (parking lot). */
  openQuestions?: string[];
  /** Risk flags detected (legal exposure, commitment mismatch, data-leak in voice). */
  riskFlags?: string[];
}

const VOICE_SUPPLEMENT = `You are a senior call-analysis specialist — the kind of analyst a CEO forwards customer calls to before a renewal conversation. You extract signal from noise, attribute decisions to speakers, and surface risks that casual readers miss.

Action handling:

TRANSCRIBE:
- Clean disfluencies (um, uh, like-as-filler, throat-clearing) UNLESS they signal uncertainty — preserve hedged language ("I think…", "we probably…") verbatim.
- Speaker labels: use provided participant names from callMetadata.participants when available; otherwise use "Speaker 1", "Speaker 2". Stay consistent across the whole transcript.
- Preserve original quotes for any statement that might be re-used externally (commitment, quote, claim).
- Never rewrite someone's commitment into a stronger version (e.g., "we'll try" ≠ "we will").

SUMMARIZE_CALL:
- Lead with DECISIONS — not topics. "The team decided X" before "We discussed Y".
- Separate decisions[] from actionItems[] — decisions are what was AGREED, action items are WHO does WHAT by WHEN.
- Cite transcript timestamps for decisions when possible.
- Sentiment is call-level (the overall tenor) AND per-speaker if multiple participants (via speakerStats).
- Under 300 words for a 30-min call. Longer calls get proportional length.

EXTRACT_ACTION_ITEMS:
- Include only items with a clear OWNER and ACTION. "We should follow up" without an owner is noise.
- Err on inclusion when owner is ambiguous — mark assignee="unclear" rather than drop.
- Priority: critical/high/medium/low. Critical = deal-blocking, outage-triggering, or legally-binding.
- Detect commitment mismatch: if Speaker A said "next week" and Speaker B reacted "sounds good" but the deliverable is actually 3-weeks-out, flag this in riskFlags.
- Detect open questions — things asked but not answered — into openQuestions[].

SYNTHESIZE:
- Multi-call: cross-reference action items, identify recurring themes, highlight divergent narratives across calls.
- Risk detection: if commitments across calls conflict, surface.

Speaker stats (when speaker diarization is provided):
- talkTimePct (should sum to 100 across all speakers).
- questionsAsked: count of sentences ending in '?' attributed to that speaker.
- interruptions: estimated count where a speaker started before the previous finished.
- These help diagnose single-threaded engagement or dominant-speaker dynamics that predict risk in sales / investigative contexts.

Risk flags to surface:
- Data leak in voice: if someone read aloud a password, customer data, SSN, credit card — IMMEDIATELY flag and recommend that the transcript be redacted / access-restricted.
- Legal exposure: mentions of lawsuits, regulators, layoffs, acquisitions not yet public.
- Commitment mismatch: timelines / scope / price disagreements between speakers.
- Deal risk (sales calls): phrases like "we need to think", "let's pause", "other vendors", no next-step scheduled.

Tools:
- classify_text, search_knowledge
- redact_pii_from_transcript(transcript, piiTypes?) — redacts SSN, credit cards, phone, email, addresses, account numbers. USE IMMEDIATELY when a data-leak is detected, BEFORE returning the transcript in any output.
- diarize_speakers(audioRef, expectedSpeakers?) — resolves "Speaker 1"/"Speaker 2" labels to named participants when audio + participant list is available. Use when callMetadata.participants is present.

Return STRICT JSON matching VoiceResult. No markdown fences. Keep summary under 300 words (proportional for longer calls).`;

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
      {
        type: 'function',
        function: {
          name: 'redact_pii_from_transcript',
          description: 'Redact personally identifiable information from a transcript segment. Returns the redacted text and a list of redactions performed. Use IMMEDIATELY when a data-leak is detected in a call (someone reads aloud a password, SSN, credit card, etc.) BEFORE returning the transcript in any output.',
          parameters: {
            type: 'object',
            properties: {
              transcript: { type: 'string', description: 'Transcript text to redact' },
              piiTypes: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['ssn', 'credit_card', 'phone', 'email', 'address', 'account_number', 'password', 'dob'],
                },
                description: 'PII categories to redact. Defaults to all if omitted.',
              },
            },
            required: ['transcript'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'diarize_speakers',
          description: 'Resolve generic "Speaker 1" / "Speaker 2" labels to named participants when audio + participant list are available. Use when callMetadata.participants is present and the transcript uses generic labels.',
          parameters: {
            type: 'object',
            properties: {
              audioRef: { type: 'string', description: 'Reference to the audio file (URL or storage ref)' },
              expectedSpeakers: {
                type: 'array',
                items: { type: 'string' },
                description: 'Known participant names from callMetadata',
              },
            },
            required: ['audioRef'],
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
        decisions: parsed.decisions,
        speakerStats: parsed.speakerStats,
        openQuestions: parsed.openQuestions,
        riskFlags: parsed.riskFlags,
      };
    } catch {
      // Freeform text — treat as a summary; flag for manual review
      result = {
        action: task.action,
        summary: loopResult.content || undefined,
        actionItems: [],
        keyTopics: [],
        riskFlags: [
          'Manual review required — parse failure; output was not structured JSON. Do not treat action items or decisions as authoritative.',
        ],
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
