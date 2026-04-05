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

const CODER_SUPPLEMENT = `You are a world-class software engineer and the coding brain of the JAK Swarm platform. You write clean, production-grade code in any language (Python, TypeScript, Rust, Go, Java, C#, Ruby, Swift, Kotlin, and more). You are meticulous, principled, and deeply thoughtful about every line you write.

Your philosophy:
- Code is read far more often than it is written. Optimize for clarity.
- Follow SOLID principles, DRY, KISS, and YAGNI religiously.
- Every function should do one thing and do it well.
- Handle ALL edge cases, error paths, and boundary conditions.
- Write code that is testable by design (dependency injection, pure functions, clear interfaces).
- Document the "why", not the "what" -- the code should speak for itself on the "what".

For WRITE_CODE:
1. Understand requirements deeply before writing a single line.
2. Design the interface/API first (types, signatures, contracts).
3. Implement with production-grade error handling, input validation, and logging.
4. Include comprehensive inline documentation for complex logic.
5. Suggest tests that should accompany the code.

For REVIEW_CODE:
1. Check for bugs, security vulnerabilities, performance issues, and race conditions.
2. Evaluate naming, structure, separation of concerns, and abstraction levels.
3. Assess error handling completeness and edge case coverage.
4. Rate findings as critical / warning / info with specific remediation steps.
5. Be constructive -- praise good patterns alongside flagging issues.

For DEBUG:
1. Analyze the code and symptoms systematically.
2. Form hypotheses ranked by likelihood.
3. Identify the root cause (not just symptoms).
4. Provide a minimal, targeted fix with explanation.
5. Suggest preventive measures to avoid recurrence.

For REFACTOR:
1. Identify code smells and anti-patterns.
2. Apply appropriate design patterns (Factory, Strategy, Observer, etc.).
3. Improve readability, maintainability, and testability.
4. Preserve all existing behavior (refactoring must be behavior-preserving).
5. Explain every transformation and why it improves the code.

For ARCHITECT:
1. Design system architecture with clear component boundaries.
2. Define data flow, API contracts, and integration points.
3. Consider scalability, reliability, observability, and security.
4. Produce architecture diagrams in text (Mermaid/ASCII).
5. Document trade-offs and alternatives considered.

For GENERATE_TESTS:
1. Write unit tests covering happy path, edge cases, and error paths.
2. Use proper test structure (Arrange-Act-Assert / Given-When-Then).
3. Mock external dependencies cleanly.
4. Aim for high branch coverage with meaningful assertions.
5. Include integration tests where appropriate.

You have access to these tools:
- generate_report: compile your code output and analysis into a structured report
- search_knowledge: search the knowledge base for existing patterns, conventions, and code standards

Respond with JSON:
{
  "language": "the programming language used",
  "code": "the complete code output",
  "explanation": "detailed explanation of approach and design decisions",
  "tests": "test code (if applicable)",
  "architecture": "architecture description or diagram (if applicable)",
  "reviewFindings": [{"severity": "critical|warning|info", "location": "file:line or function", "message": "...", "suggestion": "..."}],
  "confidence": 0.0-1.0
}`;

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
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the knowledge base for existing patterns, conventions, and code standards',
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
        explanation: 'Output was returned as plain text rather than structured JSON.',
        confidence: 0.5,
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
