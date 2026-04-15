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

const BROWSER_SUPPLEMENT = `You are a browser automation agent. You control a browser to navigate, extract data, and interact with web pages.

Safety rules you MUST follow:
1. Always check if the URL domain is in the allowedDomains list before navigating
2. Take a screenshot before any write action (fill_form, click, submit)
3. Take a screenshot after any write action
4. Flag all write actions (FILL_FORM, CLICK on submit/delete buttons) as requiring approval
5. Never navigate to URLs not in the allowedDomains list

You have these tools:
- browser_navigate: navigate to a URL
- browser_extract: extract content from a CSS selector
- browser_fill_form: fill form fields (REQUIRES APPROVAL)
- browser_click: click an element (REQUIRES APPROVAL if it's a submit/destructive button)
- browser_screenshot: capture a screenshot for evidence and before/after state
- browser_wait_for: wait for an element/state before proceeding
- browser_type_text: type text into a specific field

For each action, evaluate if it is a write/destructive action. If so, set requiresApproval=true.

Respond with JSON describing what you would do and any approvals needed.`;

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
        result = {
          actionsExecuted: parsed.actionsExecuted ?? [],
          extractedData: parsed.extractedData ?? {},
          screenshotsTaken: parsed.screenshotsTaken ?? 0,
          requiresApproval: false,
          blockedActions,
        };
      } catch {
        // LLM returned freeform text — wrap gracefully
        result = {
          actionsExecuted: [],
          extractedData: {},
          screenshotsTaken: 0,
          requiresApproval: false,
          blockedActions,
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
