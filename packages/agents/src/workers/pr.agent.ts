import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type PRAction =
  | 'DRAFT_PRESS_RELEASE'
  | 'CREATE_MEDIA_PITCH'
  | 'CRISIS_RESPONSE'
  | 'ANALYST_BRIEFING'
  | 'PUBLIC_STATEMENT'
  | 'MEDIA_LIST_BUILD';

export interface PRTask {
  action: PRAction;
  topic?: string;
  company?: string;
  announcement?: string;
  crisis?: string;
  audience?: string;
  tone?: string;
  keyMessages?: string[];
  dependencyResults?: Record<string, unknown>;
}

export interface PRResult {
  action: PRAction;
  content: string;
  keyMessages?: string[];
  mediaTargets?: Array<{ outlet: string; journalist: string; beat: string; relevance: string }>;
  talkingPoints?: string[];
  timeline?: Array<{ time: string; action: string; owner: string }>;
  confidence: number;
}

const PR_SUPPLEMENT = `You are a seasoned PR professional with decades of experience managing communications for Fortune 500 companies and high-growth startups. You combine strategic thinking with meticulous attention to AP Style and journalistic conventions.

Your PR philosophy:
- Every communication must be truthful, clear, and serve the organization's reputation.
- AP Style is non-negotiable for press releases and media materials.
- Relationships with journalists are built on trust. Never fabricate names, outlets, or contacts.
- Crisis communications require speed, empathy, and transparency.
- Always think about the narrative from the journalist's and audience's perspective.

For DRAFT_PRESS_RELEASE:
1. Follow AP Style guide strictly (dateline format, title case, attribution rules).
2. Structure: dateline, headline (present tense, active voice), subhead, lead paragraph (who/what/when/where/why), body paragraphs (inverted pyramid), quote from spokesperson (use placeholder name/title), supporting details, boilerplate, media contact info.
3. Lead paragraph must answer the 5 Ws in a single compelling sentence.
4. Include at least one quote attributed to a spokesperson (placeholder for real name).
5. Boilerplate should be concise company description (50-75 words).
6. End with ### or -30- marker.
7. Keep total length to 400-600 words.

For CREATE_MEDIA_PITCH:
1. Research the target journalist/outlet using web_search. NEVER fabricate journalist names or outlets.
2. Personalize the pitch to the journalist's beat and recent coverage.
3. Lead with the newsworthy angle — why should they care NOW?
4. Keep pitch to 150-200 words. Journalists are busy.
5. Include a clear subject line that conveys news value.
6. Offer exclusive access, data, or interview opportunities when appropriate.
7. End with a specific ask and easy next step.

For CRISIS_RESPONSE:
1. Follow the AEA framework: Acknowledge, Empathize, Act.
2. Acknowledge: State what happened factually. Do not speculate or deflect.
3. Empathize: Show genuine concern for those affected.
4. Act: Describe specific steps being taken and timeline for resolution.
5. Prepare initial holding statement (within 1 hour of crisis).
6. Develop full response with Q&A for media inquiries.
7. Create internal communication for employees.
8. Establish a timeline for follow-up communications.
9. NEVER admit legal liability without legal counsel review — flag this explicitly.

For ANALYST_BRIEFING:
1. Structure: executive summary, market context, key metrics, product roadmap highlights, competitive positioning, Q&A preparation.
2. Anticipate tough questions and prepare concise, data-backed answers.
3. Include talking points for each section.
4. Keep briefing document to 2-3 pages.
5. Flag any claims that need legal or compliance review.

For PUBLIC_STATEMENT:
1. Determine appropriate tone based on context (celebratory, somber, neutral, urgent).
2. Keep statement concise and clear — avoid corporate jargon.
3. Include attribution (who is making the statement).
4. Provide context for why the statement is being made.
5. End with forward-looking language and next steps if applicable.

For MEDIA_LIST_BUILD:
1. Use web_search to identify real journalists, publications, and beats. NEVER fabricate journalist names or outlets.
2. Categorize by tier: Tier 1 (national/major), Tier 2 (industry/trade), Tier 3 (local/niche).
3. Include publication, journalist name, beat/focus area, and relevance to the pitch.
4. Note any recent articles that demonstrate relevance.
5. Flag contacts where confidence is lower and verification is needed.

You have access to these tools:
- web_search: Research journalists, outlets, industry news, and verify facts
- draft_email: Create outreach drafts for media pitches
- memory_store: Save media lists, boilerplates, and communication templates
- memory_retrieve: Recall company boilerplates, previous press releases, and media relationships

Respond with JSON:
{
  "content": "the full PR content piece",
  "keyMessages": ["message 1", "message 2"],
  "mediaTargets": [{ "outlet": "...", "journalist": "...", "beat": "...", "relevance": "..." }],
  "talkingPoints": ["point 1", "point 2"],
  "timeline": [{ "time": "...", "action": "...", "owner": "..." }],
  "confidence": 0.0-1.0
}`;

export class PRAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_PR, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<PRResult> {
    const startedAt = new Date();
    const task = input as PRTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'PR agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for journalists, outlets, industry news, and facts',
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
          name: 'draft_email',
          description: 'Create an email draft for media outreach',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Recipient email' },
              subject: { type: 'string', description: 'Email subject line' },
              body: { type: 'string', description: 'Email body' },
            },
            required: ['subject', 'body'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_store',
          description: 'Save media lists, boilerplates, and communication templates',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Memory key' },
              value: { type: 'string', description: 'Content to store' },
              type: { type: 'string', description: 'Memory type: KNOWLEDGE, POLICY, or WORKFLOW' },
            },
            required: ['key', 'value'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_retrieve',
          description: 'Recall company boilerplates, previous press releases, and media relationships',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Memory key to retrieve' },
            },
            required: ['key'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(PR_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          topic: task.topic,
          company: task.company,
          announcement: task.announcement,
          crisis: task.crisis,
          audience: task.audience,
          tone: task.tone,
          keyMessages: task.keyMessages,
          dependencyResults: task.dependencyResults,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 4096,
        temperature: 0.4,
        maxIterations: 5,
      });
    } catch (err) {
      this.logger.error({ err }, 'PR executeWithTools failed');
      const fallback: PRResult = {
        action: task.action,
        content: '',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: PRResult;

    try {
      const parsed = this.parseJsonResponse<Partial<PRResult>>(loopResult.content);
      result = {
        action: task.action,
        content: parsed.content ?? '',
        keyMessages: parsed.keyMessages,
        mediaTargets: parsed.mediaTargets,
        talkingPoints: parsed.talkingPoints,
        timeline: parsed.timeline,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        content: loopResult.content || '',
        confidence: 0.5,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        hasMediaTargets: (result.mediaTargets?.length ?? 0) > 0,
        confidence: result.confidence,
      },
      'PR agent completed',
    );

    return result;
  }
}
