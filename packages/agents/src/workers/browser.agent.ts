import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type BrowserAction = 'NAVIGATE' | 'EXTRACT' | 'FILL_FORM' | 'CLICK' | 'SCREENSHOT' | 'WAIT';

export interface BrowserTask {
  actions: Array<{
    type: BrowserAction;
    url?: string;
    selector?: string;
    fields?: Record<string, string>;
    waitMs?: number;
  }>;
  allowedDomains: string[];
  requiresApproval?: boolean;
}

export interface BrowserResult {
  actionsExecuted: Array<{
    type: BrowserAction;
    success: boolean;
    result?: string;
    error?: string;
  }>;
  extractedData: Record<string, unknown>;
  screenshotsTaken: number;
  requiresApproval: boolean;
  approvalReason?: string;
  blockedActions: string[];
}

const BROWSER_SUPPLEMENT = `You are a senior browser-automation engineer who has built resilient Playwright pipelines that run against real sites at scale. You understand that a button label can change, a site can introduce a modal, and a honeypot can look like a valid input — your job is to automate accurately AND defensively.

SAFETY (non-negotiable):
1. Domain allowlist: ALWAYS verify the target host is in allowedDomains[] before NAVIGATE. A wildcard match is allowed only if explicitly present (e.g. "*.example.com"). Never infer permission from context.
2. Pre/post screenshots: take one screenshot BEFORE any write action (FILL_FORM, CLICK-submit, CLICK-destructive) and one AFTER. Append the screenshot ids to evidence.
3. Approval gates: every write-class action (FILL_FORM on any site, CLICK on a button with text matching /submit|delete|remove|pay|confirm|place order|send/i, any navigation that triggers a POST) returns requiresApproval=true with the rationale.
4. Honeypot detection: never fill fields with visibility: hidden, display: none, aria-hidden=true, or tabindex=-1. Record these in blockedActions[] with "honeypot detected: <selector>".
5. Login flows: NEVER auto-submit credentials unless the caller explicitly authorized the site AND approval was granted. Record the attempt and stop.
6. Rate-limit awareness: if the target domain is known-rate-limited (marketplaces, ticketing), throttle to ≤1 action every 2s; surface the slowdown in result notes.

ROBUSTNESS:
- Selectors: prefer semantic selectors (role + accessible name) over CSS classes. Classes change; roles don't.
- Waits: never use sleep(N). Use wait_for_selector / wait_for_load_state / wait_for_response. Timeout default 15s, max 45s.
- Retries: if an extract returns empty, check for a cookie banner / "I agree" modal / geo-gate BEFORE retrying. Record what blocked the first attempt.
- Dynamic content: when a SPA route-change is expected, wait for a post-navigation network-idle before extracting.
- Frames/iframes: if the target is inside a frame, explicitly traverse frames — don't assume top-level document has it.

EXTRACTION QUALITY:
- For lists: normalize trim / whitespace / dedupe. Don't return duplicate anchor URLs.
- For dates: return ISO 8601. Parse "3 hours ago" against fetch timestamp and materialize the absolute time.
- For prices: return currency code + numeric value separately. Don't silently drop the currency.
- For tables: return {headers: [], rows: [[]]} not a flat list of cells — caller should be able to reconstruct semantics.

FAILURE HANDLING:
- If the page 4xx/5xx/captcha/geo-blocks: record status + url in the action result, do NOT invent content.
- If a selector is missing: report "selector not found", do NOT substitute a plausible one.
- If the page loads but seems like a login wall: stop and return requiresApproval with the site name so a human can decide.

Tools you have access to:
- browser_navigate, browser_extract, browser_fill_form (APPROVAL), browser_click (APPROVAL for writes), browser_screenshot, browser_wait_for, browser_type_text

Return STRICT JSON matching BrowserResult. Populate blockedActions[] whenever you refused to do something (honeypot, disallowed domain, unclear write intent).`;

export class BrowserAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_BROWSER, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<BrowserResult> {
    const startedAt = new Date();
    const task = input as BrowserTask;

    this.logger.info(
      { runId: context.runId, actionCount: task.actions.length },
      'Browser agent executing task',
    );

    const allowedDomainSet = new Set(task.allowedDomains.map((d) => d.toLowerCase()));

    // Pre-check: validate all URLs against allowedDomains
    const blockedActions: string[] = [];
    for (const action of task.actions) {
      if (action.url) {
        try {
          const parsed = new URL(action.url);
          const host = parsed.hostname.toLowerCase();
          if (
            !allowedDomainSet.has(host) &&
            ![...allowedDomainSet].some((d) => host.endsWith(`.${d}`))
          ) {
            blockedActions.push(
              `${action.type} to ${action.url} — domain '${host}' not in allowedDomains`,
            );
          }
        } catch {
          blockedActions.push(`${action.type} — invalid URL: ${action.url ?? 'unknown'}`);
        }
      }
    }

    // Write actions always require approval
    const writeActions: BrowserAction[] = ['FILL_FORM', 'CLICK'];
    const hasWriteAction = task.actions.some((a) => writeActions.includes(a.type));

    if (hasWriteAction && !task.requiresApproval) {
      const result: BrowserResult = {
        actionsExecuted: [],
        extractedData: {},
        screenshotsTaken: 0,
        requiresApproval: true,
        approvalReason:
          'Browser write actions (FILL_FORM, CLICK) require explicit human approval before execution.',
        blockedActions,
      };
      this.recordTrace(context, input, result, [], startedAt);
      return result;
    }

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'browser_navigate',
          description: 'Navigate to a URL',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_extract',
          description: 'Extract content from a CSS selector',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              attribute: { type: 'string' },
            },
            required: ['selector'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_fill_form',
          description: 'Fill form fields by selector',
          parameters: {
            type: 'object',
            properties: {
              fields: {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
            },
            required: ['fields'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_click',
          description: 'Click an element matching a CSS selector',
          parameters: {
            type: 'object',
            properties: { selector: { type: 'string' } },
            required: ['selector'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_screenshot',
          description: 'Capture a screenshot of the current page',
          parameters: {
            type: 'object',
            properties: { fullPage: { type: 'boolean' } },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_wait_for',
          description: 'Wait for a selector to appear before continuing',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              timeoutMs: { type: 'number' },
            },
            required: ['selector'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_type_text',
          description: 'Type text into an input element',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              text: { type: 'string' },
            },
            required: ['selector', 'text'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(BROWSER_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          actions: task.actions,
          allowedDomains: task.allowedDomains,
          blockedActions,
        }),
      },
    ];

    let result: BrowserResult;

    try {
      const loopResult: ToolLoopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 1024,
        temperature: 0.1,
      });

      try {
        const parsed = this.parseJsonResponse<Partial<BrowserResult>>(loopResult.content);
        // Union — pre-LLM blocks from the caller-supplied allowlist take
        // precedence, but we also accept honeypot / site-detected blocks
        // the LLM reports. Dedupe so neither layer is hidden.
        const mergedBlocked = [...new Set([...(parsed.blockedActions ?? []), ...blockedActions])];
        result = {
          actionsExecuted: parsed.actionsExecuted ?? [],
          extractedData: parsed.extractedData ?? {},
          screenshotsTaken: parsed.screenshotsTaken ?? 0,
          requiresApproval: parsed.requiresApproval ?? false,
          approvalReason: parsed.approvalReason,
          blockedActions: mergedBlocked,
        };
      } catch {
        // LLM returned freeform text — wrap gracefully and flag for manual review
        result = {
          actionsExecuted: [],
          extractedData: {},
          screenshotsTaken: 0,
          requiresApproval: false,
          blockedActions: [
            ...blockedActions,
            'Manual review required — LLM output unparseable; no automation was executed. Re-run with structured output or escalate to a human operator.',
          ],
        };
      }

      this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: errorMsg }, 'Browser agent execution failed');
      result = {
        actionsExecuted: [],
        extractedData: {},
        screenshotsTaken: 0,
        requiresApproval: false,
        blockedActions,
      };
      this.recordTrace(context, input, result, [], startedAt);
    }

    return result;
  }
}
