import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type AppDebuggerAction =
  | 'DIAGNOSE_BUILD_ERROR'
  | 'FIX_RUNTIME_ERROR'
  | 'FIX_TYPE_ERROR'
  | 'SELF_DEBUG_LOOP';

export interface AppDebuggerTask {
  action: AppDebuggerAction;
  errorLog?: string;
  errorType?: 'build' | 'runtime' | 'type' | 'lint';
  affectedFiles?: string[];
  projectFiles?: Array<{ path: string; content: string }>;
  buildCommand?: string;
  previousFixes?: Array<{ attempt: number; fix: string; result: string }>;
}

export interface DebugFix {
  path: string;
  content: string;
  explanation: string;
}

export interface AppDebuggerResult {
  action: AppDebuggerAction;
  diagnosis: string;
  rootCause: string;
  fixes: DebugFix[];
  preventionAdvice?: string;
  confidence: number;
  requiresUserInput?: boolean;
  userQuestion?: string;
}

const APP_DEBUGGER_SUPPLEMENT = `You are the Self-Debugging Agent for JAK Swarm's Vibe Coding engine. You diagnose and fix build errors, type errors, and runtime errors in generated applications.

You are SURGICAL and EFFICIENT. You fix exactly what's broken, nothing more. Every token counts — you run on the cheapest LLM tier because you need to iterate fast.

CRITICAL RULES:
1. Read the ENTIRE error log carefully before diagnosing
2. Identify the ROOT CAUSE, not symptoms
3. Fix ONLY the broken files — never rewrite files that work
4. Return COMPLETE file content (not diffs) for every fixed file
5. If the error is ambiguous, ask for clarification (set requiresUserInput)
6. Track previous fix attempts to avoid repeating failed approaches
7. Max 3 fix attempts — if it's still broken after 3 tries, escalate to the user

For DIAGNOSE_BUILD_ERROR:
- Parse Next.js / TypeScript / ESLint build errors
- Common issues: missing imports, type mismatches, incorrect file structure, missing dependencies
- Cross-reference error locations with provided file content
- Consider the FULL error chain (root cause vs cascading errors)

For FIX_TYPE_ERROR:
- TypeScript strict mode errors: missing types, implicit any, null checks
- Fix type definitions, add proper generics, ensure exhaustive checks
- Don't use "as any" — fix the actual type issue

For FIX_RUNTIME_ERROR:
- Analyze stack traces to pinpoint failing code
- Common: null reference, missing env vars, hydration mismatch, missing "use client"
- Consider server vs client component boundaries

For SELF_DEBUG_LOOP:
- This is a meta-action: you receive the build log and ALL files
- You diagnose, fix, and the system will rebuild and call you again if it still fails
- Check previous fixes to avoid cycles
- After 3 failed attempts, provide a detailed diagnostic report for the user

Error parsing priorities:
1. TypeScript compilation errors (TS2xxx codes)
2. Module not found / import errors
3. ESLint errors (if blocking build)
4. Runtime errors (hydration, server/client mismatch)
5. Configuration errors (next.config, tsconfig)

Respond with JSON:
{
  "diagnosis": "what went wrong and why",
  "rootCause": "the actual root cause",
  "fixes": [{"path": "src/app/page.tsx", "content": "complete fixed file content", "explanation": "what was changed"}],
  "preventionAdvice": "how to prevent this in future",
  "confidence": 0.0-1.0,
  "requiresUserInput": false,
  "userQuestion": null
}`;

export class AppDebuggerAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_APP_DEBUGGER, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<AppDebuggerResult> {
    const startedAt = new Date();
    const task = input as AppDebuggerTask;

    this.logger.info(
      { runId: context.runId, action: task.action, errorType: task.errorType },
      'App Debugger agent executing task',
    );

    // Only include affected files in context to minimize tokens
    const relevantFiles = task.projectFiles?.filter(f =>
      task.affectedFiles?.some(af => f.path.includes(af)) ?? true,
    ) ?? [];

    const userContent: Record<string, unknown> = {
      action: task.action,
      errorLog: task.errorLog,
      errorType: task.errorType ?? 'build',
      affectedFiles: task.affectedFiles,
      files: relevantFiles.map(f => ({ path: f.path, content: f.content })),
      previousFixes: task.previousFixes,
    };

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(APP_DEBUGGER_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify(userContent),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, [], context, {
        maxTokens: 4096,
        temperature: 0.1,
        maxIterations: 2,
      });
    } catch (err) {
      this.logger.error({ err }, 'App Debugger executeWithTools failed');
      const fallback: AppDebuggerResult = {
        action: task.action,
        diagnosis: 'Debugger encountered an internal error.',
        rootCause: 'unknown',
        fixes: [],
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: AppDebuggerResult;
    try {
      const parsed = this.parseJsonResponse<Partial<AppDebuggerResult>>(loopResult.content);
      result = {
        action: task.action,
        diagnosis: parsed.diagnosis ?? '',
        rootCause: parsed.rootCause ?? 'unknown',
        fixes: parsed.fixes ?? [],
        preventionAdvice: parsed.preventionAdvice,
        confidence: parsed.confidence ?? 0.5,
        requiresUserInput: parsed.requiresUserInput,
        userQuestion: parsed.userQuestion,
      };
    } catch {
      result = {
        action: task.action,
        diagnosis: loopResult.content || 'Could not parse debugger output.',
        rootCause: 'unknown',
        fixes: [],
        confidence: 0.2,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        fixCount: result.fixes.length,
        confidence: result.confidence,
        requiresUserInput: result.requiresUserInput,
      },
      'App Debugger agent completed',
    );

    return result;
  }
}
