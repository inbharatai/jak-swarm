import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import type { WorkflowTask, ToolCall } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export interface VerificationResult {
  passed: boolean;
  issues: string[];
  confidence: number;
  needsRetry: boolean;
  retryReason?: string;
}

export interface VerifierInput {
  task: WorkflowTask;
  agentOutput: unknown;
  expectedOutputSchema?: Record<string, unknown>;
  /** Optional trace of actual tool calls made by the worker agent */
  toolCallsTrace?: ToolCall[];
}

const VERIFIER_SUPPLEMENT = `You are a meticulous quality verifier. Your role is to evaluate agent outputs for:
1. Completeness — does the output address the full task description?
2. Format conformity — does the output match the expected schema/format?
3. Hallucination detection — are there invented facts, impossible dates, made-up names or entities?
4. Policy conformity — does the output violate any explicit constraints?

You must respond with JSON:
{
  "passed": <boolean>,
  "issues": ["list of specific issues found, empty if passed"],
  "confidence": <0.0-1.0>,
  "needsRetry": <boolean>,
  "retryReason": "<why retry is needed, null if not needed>"
}

Be strict about hallucinations. Common hallucination patterns:
- Future dates presented as historical facts
- Specific statistics without sources that seem too round or convenient
- Names of specific people, companies, or records that weren't in the input
- Contradictions within the output itself
- Claims of tool execution without tool call evidence`;

// Patterns that suggest hallucination
const HALLUCINATION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\b(as of|according to|data shows|research indicates|studies show)\b.*\b\d+%\b/i,
    description: 'Unsourced statistical claim',
  },
  {
    pattern: /\b(confirmed|verified|processed|completed|sent)\b.*\b(successfully|automatically)\b/i,
    description: 'Unverified action completion claim',
  },
  {
    pattern:
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(20[3-9]\d|2[1-9]\d\d)\b/i,
    description: 'Far future date reference',
  },
  {
    pattern: /\b(I have already|I already|I've already|I just|I went ahead and)\b/i,
    description: 'Agent claiming to have taken action without tool calls',
  },
];

export class VerifierAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.VERIFIER, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<VerificationResult> {
    const startedAt = new Date();
    const { task, agentOutput, expectedOutputSchema, toolCallsTrace } = input as VerifierInput;

    this.logger.info(
      { runId: context.runId, taskId: task.id },
      'Verifier checking agent output',
    );

    // 1. Run heuristic checks first (fast, no LLM)
    const heuristicIssues = this.runHeuristicChecks(agentOutput, task, toolCallsTrace);

    // 2. Check for null/undefined output
    if (agentOutput === null || agentOutput === undefined) {
      const result: VerificationResult = {
        passed: false,
        issues: ['Agent produced no output'],
        confidence: 1.0,
        needsRetry: task.retryable,
        retryReason: 'No output produced',
      };
      this.recordTrace(context, input, result, [], startedAt);
      return result;
    }

    // 3. LLM-based semantic verification
    const outputStr =
      typeof agentOutput === 'string' ? agentOutput : JSON.stringify(agentOutput, null, 2);

    const schemaContext = expectedOutputSchema
      ? `\n\nExpected output schema:\n${JSON.stringify(expectedOutputSchema, null, 2)}`
      : '';

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(VERIFIER_SUPPLEMENT),
      },
      {
        role: 'user',
        content: `Task definition:
Name: ${task.name}
Description: ${task.description}
Agent Role: ${task.agentRole}
Tools Required: ${task.toolsRequired.join(', ')}
Risk Level: ${task.riskLevel}
${schemaContext}

Agent output to verify:
${outputStr}

Additional heuristic issues already detected: ${heuristicIssues.length > 0 ? heuristicIssues.join('; ') : 'none'}

Verify the output and respond with JSON.`,
      },
    ];

    let llmResult: VerificationResult;
    try {
      const completion = await this.callLLM(messages, undefined, {
        maxTokens: 512,
        temperature: 0.1,
      });

      const rawContent = completion.choices[0]?.message?.content ?? '{}';
      const parsed = this.parseJsonResponse<{
        passed?: boolean;
        issues?: string[];
        confidence?: number;
        needsRetry?: boolean;
        retryReason?: string;
      }>(rawContent);

      const allIssues = [...heuristicIssues, ...(parsed.issues ?? [])];

      // Trust the LLM's verdict — it already received the heuristic issues in the prompt
      // and can weigh them appropriately. Heuristics are advisory, not auto-fail.
      // Fall back to heuristic-only result only when LLM didn't return a clear verdict.
      const passed = parsed.passed ?? (heuristicIssues.length === 0);

      llmResult = {
        passed,
        issues: allIssues,
        confidence: parsed.confidence ?? (passed ? 0.85 : 0.4),
        needsRetry: (parsed.needsRetry ?? !passed) && task.retryable,
        retryReason: parsed.retryReason,
      };
    } catch (err) {
      this.logger.warn({ err }, 'Verifier LLM call failed, using heuristic result');
      const passed = heuristicIssues.length === 0;
      llmResult = {
        passed,
        issues: heuristicIssues,
        confidence: 0.6,
        needsRetry: !passed && task.retryable,
        retryReason: heuristicIssues.length > 0 ? heuristicIssues[0] : undefined,
      };
    }

    this.recordTrace(context, input, llmResult, [], startedAt);

    this.logger.info(
      {
        taskId: task.id,
        passed: llmResult.passed,
        confidence: llmResult.confidence,
        issueCount: llmResult.issues.length,
      },
      'Verifier completed check',
    );

    return llmResult;
  }

  private runHeuristicChecks(
    output: unknown,
    task: WorkflowTask,
    toolCallsTrace?: ToolCall[],
  ): string[] {
    const issues: string[] = [];
    const outputStr = typeof output === 'string' ? output : JSON.stringify(output ?? '');

    // Build a set of tool names that were actually called successfully
    const executedToolNames = new Set<string>();
    if (toolCallsTrace) {
      for (const tc of toolCallsTrace) {
        if (!tc.error) {
          executedToolNames.add(tc.toolName);
        }
      }
    }

    // Hallucination pattern checks
    for (const { pattern, description } of HALLUCINATION_PATTERNS) {
      if (pattern.test(outputStr)) {
        // If the agent claims to have completed an action AND we have tool call evidence
        // that a matching tool was actually executed, suppress this heuristic issue.
        if (
          description === 'Unverified action completion claim' &&
          toolCallsTrace &&
          toolCallsTrace.length > 0 &&
          this.hasMatchingToolExecution(outputStr, executedToolNames)
        ) {
          continue;
        }
        if (
          description === 'Agent claiming to have taken action without tool calls' &&
          toolCallsTrace &&
          toolCallsTrace.length > 0
        ) {
          continue;
        }
        issues.push(`Potential hallucination detected: ${description}`);
      }
    }

    // Check for empty or trivially short output on complex tasks
    if (task.toolsRequired.length > 1 && outputStr.length < 20) {
      issues.push('Output appears too short for a multi-tool task');
    }

    // Check for error strings masquerading as success
    if (/\b(error|exception|failed|undefined|null)\b/i.test(outputStr) && outputStr.length < 100) {
      issues.push('Output may contain unhandled error');
    }

    // Check for Lorem ipsum / placeholder text
    if (/lorem ipsum/i.test(outputStr)) {
      issues.push('Output contains placeholder text (Lorem ipsum)');
    }

    return issues;
  }

  /**
   * Check if the output text references actions that match actually executed tools.
   * For example, if the output says "email sent" and `send_email` was in the tool calls,
   * we consider the action claim legitimate.
   */
  private hasMatchingToolExecution(outputStr: string, executedTools: Set<string>): boolean {
    const actionToolMap: Record<string, string[]> = {
      sent: ['send_email', 'send_webhook'],
      confirmed: ['update_crm_record', 'create_calendar_event'],
      verified: ['lookup_crm_contact', 'search_knowledge'],
      processed: ['extract_document_data', 'parse_spreadsheet', 'compute_statistics'],
      completed: ['generate_report', 'draft_email', 'create_calendar_event'],
    };

    const lowerOutput = outputStr.toLowerCase();
    for (const [keyword, tools] of Object.entries(actionToolMap)) {
      if (lowerOutput.includes(keyword)) {
        for (const tool of tools) {
          if (executedTools.has(tool)) return true;
        }
      }
    }

    return false;
  }
}
