import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type CoderAction =
  | 'WRITE_CODE'
  | 'REVIEW_CODE'
  | 'DEBUG'
  | 'REFACTOR'
  | 'ARCHITECT'
  | 'GENERATE_TESTS';

export interface CoderTask {
  action: CoderAction;
  language?: string;
  description?: string;
  code?: string;
  requirements?: string[];
  constraints?: string[];
  existingArchitecture?: string;
  testFramework?: string;
}

export interface ReviewFinding {
  severity: 'critical' | 'warning' | 'info';
  location: string;
  message: string;
  suggestion?: string;
}

export interface CoderResult {
  action: CoderAction;
  language: string;
  code: string;
  explanation: string;
  tests?: string;
  architecture?: string;
  reviewFindings?: ReviewFinding[];
  confidence: number;
}

const CODER_SUPPLEMENT = `You are a staff-level software engineer who has shipped production code in TypeScript, Python, Rust, Go, Java, C#, Ruby, Swift, and Kotlin, and who has been the last reviewer on thousands of PRs. You reason from correctness, runtime behavior, error paths, and team-readability — not from "looks clean" vibes.

NON-NEGOTIABLES (hard-fail any output that violates these):
1. Types + signatures first. For any non-trivial change, the public surface (types / interfaces / function signatures) is written BEFORE the body. Untyped or \`any\`-heavy output is rejected.
2. Error paths are not optional. Every external call (network, disk, DB, LLM) has a concrete error handling strategy — not \`catch { /* TODO */ }\`, not swallow-and-continue. State what happens when each failure path fires.
3. Concurrency + idempotency. If the code is invoked multiple times, does it produce the same result? Retries must be safe. Flag any non-idempotent write path (POST without dedupe key, DB write without unique constraint, file append without lock).
4. Secrets never in code. Never hardcode an API key, token, password, or private URL. Always read from env or a secret store. If the input includes a secret-like string, flag it and refuse to inline it.
5. Tests are a deliverable, not an extra. WRITE_CODE always produces a test sketch. GENERATE_TESTS must cover happy path + at least two edge cases + at least one error path.
6. Refactor preserves behavior. A REFACTOR output that subtly changes semantics (different error codes, different return shape, different ordering) is rejected. Explicitly list behavior-preserving diffs when uncertain.
7. Security is not optional. Every WRITE_CODE / REVIEW_CODE output screens for: injection (SQL/shell/prompt), path traversal, SSRF, XSS, insecure deserialization, race-condition windows, secret exposure in logs. Call out each concretely when found.

FAILURE MODES to avoid (these are the mistakes that get bugs into production):
- Writing an "example" implementation with \`// TODO: handle error\` / \`// FIXME\` / \`throw new Error('not implemented')\` and claiming it's complete.
- Silently catching and logging an error without either re-throwing, retrying with backoff, or surfacing a typed failure to the caller.
- Adding a try/catch that also catches programmer errors (ReferenceError, TypeError) and treats them like user errors.
- Introducing a new dependency without justifying it (pulling \`lodash\` for \`_.isEmpty\`).
- Proposing a "simpler" abstraction that removes a real edge-case handler the original had (premature DRY).
- Writing a "fixed" version of a bug without first explaining the root cause — a fix without a hypothesis is a coincidence.
- Using string concatenation for SQL / shell / file paths. Always parameterize.
- Using \`Date.now()\` or \`new Date()\` in logic that needs to be deterministic / replayable — inject a clock.
- Mixing business logic with I/O in a way that makes the whole thing unmockable.
- Returning booleans for states that should be enums (true/false for a 3-state field is a future bug).

Action handling:

WRITE_CODE:
- State the contract (types, signatures, invariants) BEFORE the body.
- Implement with explicit error handling per external call.
- Use run_linter on the emitted code. Use run_typecheck for typed languages. Use run_tests on the test sketch.
- Include tests in the output. Tests cover happy path, edge cases (empty, boundary, overflow), and error paths.

REVIEW_CODE:
- Critical ≥ warning ≥ info. Severity is based on blast radius + likelihood, not subjective preference.
- Every finding has: location (file:line), what is wrong, why it matters, exact fix. "This could be cleaner" is not a finding; "off-by-one: should be i <= len, not i < len, breaks when input.length === 1" is.
- Security screen is always first. Bugs that let users execute other users' code / read other users' data / escalate privileges / bypass billing ALWAYS rate critical.
- Run static_analysis on the input to surface the obvious stuff before reasoning.

DEBUG:
- Hypothesize root causes ranked by likelihood. State the evidence supporting each.
- For each hypothesis, what single command / log / query would confirm or rule it out?
- Fix proposal comes WITH the root-cause evidence, not before it. "It works on my machine" is not a fix.
- Use read_stacktrace and run_linter to narrow the search space.

REFACTOR:
- List behavior invariants first. Every refactor step preserves them.
- Prefer many small behavior-preserving commits to one big "improved" drop.
- Do not introduce a pattern the codebase doesn't already use without a specific reason.
- Use run_tests after each step.

ARCHITECT:
- Component boundaries, data flow, API contracts, failure modes, observability hooks, rollout plan.
- Document tradeoffs explicitly (alternatives considered + why rejected).
- Mermaid or ASCII diagrams, not vague prose.

GENERATE_TESTS:
- Arrange-Act-Assert structure, one logical assertion per test.
- Mock at the boundary (external services), not internal functions.
- Property tests where behavior is invariant over a space (idempotency, ordering).
- Use run_tests to validate the test file runs.

Tools you have:
- run_linter(code, language) — run linter over code; returns findings. USE BEFORE shipping WRITE_CODE / REFACTOR output.
- run_typecheck(code, language) — for TS/Go/Rust/Java etc., verify types resolve. USE for every typed-language output.
- run_tests(testCode, sourceCode, framework?) — run the test sketch and report pass/fail.
- static_analysis(code, language) — surface security + quality findings. USE first on REVIEW_CODE.
- read_stacktrace(trace) — parse a stack trace, locate root frame, surface relevant source context. USE on DEBUG.
- search_knowledge, generate_report.

Respond with STRICT JSON matching CoderResult. No markdown fences.`;

export class CoderAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_CODER, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<CoderResult> {
    const startedAt = new Date();
    const task = input as CoderTask;

    this.logger.info(
      { runId: context.runId, action: task.action, language: task.language },
      'Coder agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'run_linter',
          description: 'Run a language-appropriate linter (eslint, ruff, clippy, golangci-lint) over the provided source and return findings as { file, line, rule, severity, message }. USE BEFORE shipping WRITE_CODE or REFACTOR output — lint surfaces the obvious correctness + style issues the LLM might miss.',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Source code to lint' },
              language: { type: 'string', description: 'Language: typescript | javascript | python | rust | go | java | ruby | csharp' },
              rulesetOverride: { type: 'string', description: 'Optional ruleset name (e.g. "strict", "recommended")' },
            },
            required: ['code', 'language'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'run_typecheck',
          description: 'Type-check source code for statically-typed languages (TypeScript, Go, Rust, Java, C#, Kotlin, Swift). Returns { ok, errors[{file, line, code, message}] }. USE on every WRITE_CODE output for typed languages.',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Source code to type-check' },
              language: { type: 'string', description: 'Target language' },
              strict: { type: 'boolean', description: 'Run in strict mode (no implicit any for TS, clippy pedantic for Rust)' },
            },
            required: ['code', 'language'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'run_tests',
          description: 'Execute a test file against provided source and report pass/fail + coverage summary. Returns { passed, failed, coverage, failures[{test, message, stack}] }. USE on GENERATE_TESTS and after REFACTOR.',
          parameters: {
            type: 'object',
            properties: {
              testCode: { type: 'string', description: 'Test file content' },
              sourceCode: { type: 'string', description: 'Source code under test' },
              framework: { type: 'string', description: 'Test framework: vitest | jest | pytest | cargo-test | go-test | junit' },
            },
            required: ['testCode', 'sourceCode'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'static_analysis',
          description: 'Run security + quality static analysis (Semgrep, CodeQL-style rules). Surfaces: injection sinks, hardcoded secrets, unsafe regex, race windows, taint flows. Returns findings[{rule, severity, location, message}]. USE FIRST on REVIEW_CODE.',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Code to analyze' },
              language: { type: 'string', description: 'Source language' },
              rulesets: {
                type: 'array',
                items: { type: 'string', enum: ['security', 'quality', 'performance', 'all'] },
                description: 'Which ruleset to apply',
              },
            },
            required: ['code', 'language'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_stacktrace',
          description: 'Parse a stack trace (JS, Python, Java, Go, Rust), locate the root frame, and surface the relevant source context. Returns { rootFrame: {file, line, function}, relevantSource, hypothesis }. USE on DEBUG.',
          parameters: {
            type: 'object',
            properties: {
              trace: { type: 'string', description: 'Raw stack trace text' },
              language: { type: 'string', description: 'Source language inferred from trace format' },
            },
            required: ['trace'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the knowledge base for existing patterns, conventions, and code standards specific to this codebase.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query for patterns or standards' },
              category: { type: 'string', description: 'Category filter (e.g., "coding-standards", "patterns", "architecture")' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_report',
          description: 'Compile code output and analysis into a structured report',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Report title' },
              content: { type: 'string', description: 'Report content in markdown' },
              format: { type: 'string', enum: ['markdown', 'json', 'html'], description: 'Output format' },
            },
            required: ['title', 'content'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(CODER_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          language: task.language,
          description: task.description,
          code: task.code,
          requirements: task.requirements,
          constraints: task.constraints,
          existingArchitecture: task.existingArchitecture,
          testFramework: task.testFramework,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 4096,
        temperature: 0.2,
        maxIterations: 5,
      });
    } catch (err) {
      this.logger.error({ err }, 'Coder executeWithTools failed');
      const fallback: CoderResult = {
        action: task.action,
        language: task.language ?? 'unknown',
        code: '',
        explanation: 'The coding agent encountered an error while processing the request.',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: CoderResult;

    try {
      const parsed = this.parseJsonResponse<Partial<CoderResult>>(loopResult.content);
      result = {
        action: task.action,
        language: parsed.language ?? task.language ?? 'unknown',
        code: parsed.code ?? '',
        explanation: parsed.explanation ?? 'Code generation completed.',
        tests: parsed.tests,
        architecture: parsed.architecture,
        reviewFindings: parsed.reviewFindings,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        language: task.language ?? 'unknown',
        code: loopResult.content || '',
        explanation:
          'Manual review required — LLM output was not structured JSON. Do NOT commit, deploy, or merge this code without human review. Types, tests, and security screens are missing.',
        reviewFindings: [
          {
            severity: 'critical' as const,
            location: 'coder-agent/parse-failure',
            message:
              'Agent output could not be parsed into CoderResult — any code below is raw LLM text, not verified output.',
            suggestion: 'Re-run the agent with a stricter prompt, or escalate to a human engineer.',
          },
        ],
        confidence: 0.2,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        language: result.language,
        confidence: result.confidence,
        findingsCount: result.reviewFindings?.length ?? 0,
      },
      'Coder agent completed',
    );

    return result;
  }
}
