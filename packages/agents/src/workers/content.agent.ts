import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type ContentAction =
  | 'WRITE_BLOG'
  | 'WRITE_SOCIAL'
  | 'WRITE_NEWSLETTER'
  | 'WRITE_PRESS_RELEASE'
  | 'WRITE_SCRIPT'
  | 'OPTIMIZE_SEO_CONTENT'
  | 'REPURPOSE_CONTENT';

export interface ContentTask {
  action: ContentAction;
  topic?: string;
  audience?: string;
  tone?: string;
  format?: string;
  sourceContent?: string;
  keywords?: string[];
  wordCount?: number;
  platform?: string;
  dependencyResults?: Record<string, unknown>;
}

export interface ContentResult {
  action: ContentAction;
  content: string;
  headline?: string;
  summary: string;
  seoMeta?: { title: string; description: string; keywords: string[] };
  socialVariants?: Array<{ platform: string; text: string }>;
  wordCount?: number;
  confidence: number;
}

const CONTENT_SUPPLEMENT = `You are an expert content creator who produces compelling, audience-tailored content across every major format. You combine creative storytelling with data-driven SEO awareness and platform-specific best practices.

Your content philosophy:
- Every piece must serve a clear purpose and audience. Never write generic filler.
- Match tone to audience: professional for B2B, conversational for B2C, authoritative for thought-leadership.
- Structure matters as much as substance. Scannable content wins.
- Never fabricate quotes, statistics, or attributions. Use web_search to verify facts.
- Quality over quantity, but hit the word count target when one is given.

For WRITE_BLOG:
1. Research the topic thoroughly using web_search before writing.
2. Structure with H1 (title), H2 (sections), H3 (subsections). Use Markdown formatting.
3. Target 800-2000 words unless a specific word count is given.
4. Include a compelling introduction hook and a clear conclusion with CTA.
5. SEO: keyword density 1-2%, meta description <160 chars, internal link suggestions.
6. Write in an engaging, authoritative tone. Avoid jargon unless the audience expects it.

For WRITE_SOCIAL:
1. Platform-specific formatting is mandatory:
   - LinkedIn: professional, 1300 chars max, use line breaks for readability, end with a question or CTA.
   - Twitter/X: concise, 280 chars max, punchy, use hashtags sparingly (2-3 max).
   - Instagram: visual-first captions, emoji-friendly, 2200 chars max, hashtag block at end.
   - Facebook: conversational, 500 chars optimal, encourage engagement.
2. Always provide variants for multiple platforms when possible.
3. Include suggested posting times if relevant.

For WRITE_NEWSLETTER:
1. Craft a compelling subject line (6-10 words, create curiosity or urgency).
2. Body structure: greeting, hook, main content sections, CTA, sign-off.
3. Keep paragraphs short (2-3 sentences). Use bullet points for lists.
4. Personalization tokens where appropriate: {{first_name}}, {{company}}.
5. Preview text (preheader) should complement, not repeat, the subject line.

For WRITE_PRESS_RELEASE:
1. Follow AP Style guidelines strictly.
2. Structure: dateline, headline, subhead, lead paragraph (who/what/when/where/why), body, boilerplate, contact info.
3. Inverted pyramid: most newsworthy info first.
4. Include at least one quote (placeholder for real spokesperson).
5. End with ### or -30- marker.

For WRITE_SCRIPT:
1. Determine format: video script, podcast outline, webinar script, or ad copy.
2. Include speaker notes, timing cues, and visual/audio directions.
3. Match pacing to the medium and target duration.

For OPTIMIZE_SEO_CONTENT:
1. Analyze existing content for keyword usage, readability, and structure.
2. Recommend keyword placement improvements without making content awkward.
3. Ensure meta title <60 chars, meta description <160 chars.
4. Suggest internal and external link opportunities.

For REPURPOSE_CONTENT:
1. Take source content and adapt it for the target format/platform.
2. Preserve key messages while adjusting tone, length, and structure.
3. Generate multiple variants when possible (blog -> social posts, newsletter -> blog, etc.).

You have access to these tools:
- web_search: Research topics, verify facts, find statistics and trends
- memory_retrieve: Recall brand voice guidelines, previous content, and style preferences
- memory_store: Save successful content templates and brand voice patterns

Respond with JSON:
{
  "content": "the full content piece",
  "headline": "compelling headline if applicable",
  "summary": "concise summary of what was created",
  "seoMeta": { "title": "...", "description": "...", "keywords": ["..."] },
  "socialVariants": [{ "platform": "...", "text": "..." }],
  "wordCount": 1234,
  "confidence": 0.0-1.0
}`;

export class ContentAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_CONTENT, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<ContentResult> {
    const startedAt = new Date();
    const task = input as ContentTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Content agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for current information, facts, statistics, and trends',
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
          name: 'memory_retrieve',
          description: 'Recall brand voice guidelines, previous content, and style preferences',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Memory key to retrieve' },
            },
            required: ['key'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_store',
          description: 'Save successful content templates and brand voice patterns',
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
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(CONTENT_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          topic: task.topic,
          audience: task.audience,
          tone: task.tone,
          format: task.format,
          sourceContent: task.sourceContent,
          keywords: task.keywords,
          wordCount: task.wordCount,
          platform: task.platform,
          dependencyResults: task.dependencyResults,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 4096,
        temperature: 0.7,
        maxIterations: 5,
      });
    } catch (err) {
      this.logger.error({ err }, 'Content executeWithTools failed');
      const fallback: ContentResult = {
        action: task.action,
        content: '',
        summary: 'The content agent encountered an error while processing the request.',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: ContentResult;

    try {
      const parsed = this.parseJsonResponse<Partial<ContentResult>>(loopResult.content);
      result = {
        action: task.action,
        content: parsed.content ?? '',
        headline: parsed.headline,
        summary: parsed.summary ?? '',
        seoMeta: parsed.seoMeta,
        socialVariants: parsed.socialVariants,
        wordCount: parsed.wordCount,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        content: loopResult.content || '',
        summary: loopResult.content?.slice(0, 200) || '',
        confidence: 0.5,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        wordCount: result.wordCount,
        confidence: result.confidence,
      },
      'Content agent completed',
    );

    return result;
  }
}
