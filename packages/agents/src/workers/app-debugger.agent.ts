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

const APP_DEBUGGER_SUPPLEMENT = `You are the Self-Debugging Agent for JAK Swarm's Vibe Coding engine. You diagnose and fix build errors, type errors, and runtime errors in generated applications. You are SURGICAL — surgical means fix the one broken thing, not rewrite adjacent working code.

NON-NEGOTIABLES (hard-fail any fix that violates these):
1. Root cause, then fix. Every output has rootCause stated FIRST. A fix without an explicit root cause is a guess. If you can't state the root cause, set requiresUserInput=true.
2. Fix the smallest surface area. If the error is one line in one file, the fix is one line in one file. Do not reformat the file, do not rename imports, do not "improve" nearby code — surgical means surgical.
3. Never add \`as any\` / \`@ts-ignore\` / \`// eslint-disable-next-line\`. Those are accumulating technical debt, not fixes. Flag and refuse.
4. Preserve existing behavior. Fix the error without changing the component's visible semantics (props, exports, return shape). If the fix requires a behavioral change, surface it in preventionAdvice so the reviewer knows.
5. Track previous fixes. If previousFixes contains an attempt that looks similar to what you're about to try, DON'T repeat it. Either pick a different approach or requiresUserInput=true.
6. Three strikes → escalate. After 3 failed attempts, set requiresUserInput=true with a detailed diagnostic of what each attempt tried and why it failed. Don't loop indefinitely.
7. Never touch user data. If the fix would require modifying DB migrations, seed data, or env vars, that's outside your scope — surface it to the user instead of silently changing it.

FAILURE MODES to avoid (these are the bugs that make self-debug loops waste LLM spend):
- Fixing the SYMPTOM (the error line) without understanding WHY (the root cause). The error recurs in a different form next build.
- Fix A conflicts with fix B in the same round. If multiple files need changes, the set must be internally consistent — apply all together.
- Re-generating an entire file when one line was broken (wastes tokens, introduces new bugs).
- Silencing errors with type assertions (\`x as unknown as Foo\`, \`!.\`, \`// @ts-expect-error\`) instead of fixing types.
- Assuming the error log is complete — Next.js often prints the SECONDARY error first. Look for "Failed to compile" / "Module not found" / "Type error:" markers and trace back.
- Fixing a build error by commenting out the failing code. That's not a fix, that's avoidance.
- Proposing a dependency install (\`npm i X\`) without confirming the tenant's package.json supports it.
- Infinite retry loop: trying the same fix with minor variations across attempts 1, 2, 3. If attempt N didn't work, don't tweak it — reason about WHY it didn't.

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

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'run_typecheck',
          description: 'Re-run the TypeScript compiler against the current set of files (including any proposed fix) and return { ok, errors[{file, line, code, message}] }. USE to verify a proposed fix actually resolves the compile error before returning it.',
          parameters: {
            type: 'object',
            properties: {
              files: {
                type: 'array',
                items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
                description: 'Full file tree to check (including proposed fixes substituted in)',
              },
              strict: { type: 'boolean', description: 'Use strict mode (default true)' },
            },
            required: ['files'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_stacktrace',
          description: 'Parse a stack trace (Next.js build, Vite, Node runtime), identify the root frame, and surface the minimal relevant source context for debugging. Returns { rootFrame: {file, line, function}, precedingContext, hypothesis, confidence }. USE on every DIAGNOSE_BUILD_ERROR / FIX_RUNTIME_ERROR as first step.',
          parameters: {
            type: 'object',
            properties: {
              trace: { type: 'string', description: 'Raw stack trace / error log text' },
              errorType: { type: 'string', enum: ['build', 'runtime', 'type', 'lint', 'hydration'] },
            },
            required: ['trace'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'apply_patch',
          description: 'Validate that a proposed minimal patch (not a full file) applies cleanly to the original content. Prevents the "regenerate the whole file and introduce new bugs" failure mode. Returns { applied: bool, resultContent?, conflictLines? }. USE when the fix is small and surgical (1-5 lines).',
          parameters: {
            type: 'object',
            properties: {
              originalContent: { type: 'string' },
              patch: { type: 'string', description: 'Unified diff or described minimal change' },
              mode: { type: 'string', enum: ['diff', 'described-minimal'] },
            },
            required: ['originalContent', 'patch'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the knowledge base for known error patterns, previous fixes, and debugging strategies',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query for error patterns or fix strategies' },
              category: { type: 'string', description: 'Category: errors, fixes, patterns, dependencies' },
            },
            required: ['query'],
          },
        },
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
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
        diagnosis:
          'Manual review required — LLM output was not structured JSON. No fixes delivered. DO NOT retry the build with the current files, and DO NOT loop the debugger again — escalate to a human engineer with the error log.\n\n' +
          (loopResult.content || ''),
        rootCause: 'parse-failure',
        fixes: [],
        requiresUserInput: true,
        userQuestion:
          'The debugger could not produce a structured fix for this error. The previous build error is unchanged. Please review the error log manually and either fix directly or re-trigger with more context.',
        confidence: 0.1,
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
