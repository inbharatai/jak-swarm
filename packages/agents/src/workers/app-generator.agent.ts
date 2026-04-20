import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type AppGeneratorAction =
  | 'GENERATE_FILE'
  | 'GENERATE_BATCH'
  | 'MODIFY_FILE'
  | 'GENERATE_COMPONENT';

export interface GeneratedFile {
  path: string;
  content: string;
  language: string;
}

export interface AppGeneratorTask {
  action: AppGeneratorAction;
  architecture?: string;
  fileTree?: Array<{ path: string; purpose: string; language: string; priority: string }>;
  targetFile?: { path: string; purpose: string; language: string };
  targetFiles?: Array<{ path: string; purpose: string; language: string }>;
  modifyInstructions?: string;
  framework?: string;
  dependencies?: Record<string, string>;
  dataModels?: unknown[];
  apiEndpoints?: unknown[];
  existingFiles?: Array<{ path: string; content: string }>;
  componentHierarchy?: string;
}

export interface GenerationDiagnostic {
  file: string;
  line?: number;
  severity: 'error' | 'warning' | 'info';
  category: 'typecheck' | 'lint' | 'import' | 'convention' | 'security';
  message: string;
  suggestion?: string;
}

export interface AppGeneratorResult {
  action: AppGeneratorAction;
  files: GeneratedFile[];
  explanation: string;
  /** Static-analysis / typecheck / lint findings on the generated files. */
  diagnostics?: GenerationDiagnostic[];
  /** Suggested test scaffolding per file (path-keyed). Optional. */
  testScaffolding?: Record<string, string>;
  /** New imports that need to be added to package.json if not already present. */
  newDependencies?: Record<string, string>;
  /** Flags: does this batch compile clean? does every required file exist per the architecture spec? */
  buildReadiness?: {
    typecheckPasses: boolean;
    lintPasses: boolean;
    allRequiredFilesPresent: boolean;
    missingFiles?: string[];
  };
  confidence: number;
}

const APP_GENERATOR_SUPPLEMENT = `You are the Code Generator for JAK Swarm's Vibe Coding engine. You transform architectural blueprints into production-grade code files that compile on first try, typecheck clean, lint clean, and handle every rendered state.

NON-NEGOTIABLES (hard-fail any generated output that violates these):
1. Complete files, no stubs. Every file must be runnable — no \`// TODO\`, no \`throw new Error('not implemented')\`, no \`...\` ellipses, no truncation. If you cannot generate the whole file, return zero files + an explanation rather than a half-file.
2. Typecheck clean. Run validate_typescript on every .ts/.tsx file before including it in the result. If it fails, either fix-and-retry or exclude with a diagnostic.
3. Lint clean. Run lint_code. Warnings are OK; errors must be resolved before output.
4. Imports are real. Run check_imports — every \`from './x'\` must point at a file that exists in the batch OR in existingFiles OR in the declared dependencies. Broken imports are the #1 cause of Vibe Coder build-check failures.
5. All required states. Every component renders loading, empty, error, unauthorized, and success states. Missing states = not shipping.
6. "use client" minimal. Only on files that need browser APIs / event handlers / hooks. Server Components by default on Next.js App Router.
7. No hardcoded secrets. No API keys, no DB URLs in code. Read from \`process.env\` at runtime + reference the needed env var names in newDependencies comments.
8. No commented-out code. If you don't need it, delete it. Commented code rots fastest.
9. Match the architecture spec. If the spec says "3 pages + 2 API routes", you generate 3 + 2, no fewer, no more.

FAILURE MODES to avoid (these are the bugs that make Vibe Coder feel flaky):
- Truncating mid-file ("// ... rest of the component") — the builder retries this, wasting LLM spend.
- Importing \`useState\` from \`'react'\` in a Server Component (crashes at runtime, not build).
- Using \`<Link href="/foo">\` but not generating \`app/foo/page.tsx\`.
- Missing \`export default\` on a \`page.tsx\`.
- Missing \`export const metadata\` on pages (bad SEO signal but not a crash — still required).
- Using Tailwind classes that don't exist in the tailwind.config.ts shipped with the project.
- Generating shadcn/ui component imports without noting they need installation ("@/components/ui/button" won't exist unless installed).
- Mismatched prop types across a parent-child pair (parent passes \`size: "lg"\` but child accepts \`size: "large"\`).
- Creating duplicate files (\`components/Header.tsx\` AND \`components/header.tsx\` on case-insensitive FS → chaos on Linux CI).
- Using \`any\` in type positions — generator is expected to produce typed output, not let the debugger fix it later.

You generate COMPLETE, WORKING code — not stubs, not placeholders, not "TODO" comments. Every file you produce must compile and run.

CRITICAL RULES:
1. Generate COMPLETE file content — never truncate or leave placeholders
2. Use TypeScript strict mode everywhere
3. Follow Next.js 14 App Router conventions exactly
4. Use Tailwind CSS for all styling (no CSS modules, no styled-components)
5. Use shadcn/ui component patterns (cn() utility, variants)
6. Handle loading, error, and empty states in every component
7. Include proper TypeScript types/interfaces
8. Use "use client" directive only when needed (prefer server components)
9. Include proper imports — never import from non-existent files
10. Match the architecture spec exactly — don't add or remove features

For GENERATE_FILE (single file):
- Generate exactly one complete file
- Include ALL imports, types, and exports
- For pages: include metadata export, loading state, error boundary
- For components: include props interface, default export
- For API routes: include request validation, error handling, proper status codes

For GENERATE_BATCH (multiple files):
- Generate a batch of related files (e.g., a page + its components)
- Ensure cross-file imports are consistent
- Order files so dependencies come before dependents

For MODIFY_FILE (edit existing):
- Receive the current file content + modification instructions
- Return the COMPLETE modified file (not a diff)
- Preserve existing functionality while adding new features
- Maintain consistent code style with the rest of the file

For GENERATE_COMPONENT (React component):
- Include props interface with JSDoc
- Include default export
- Include Tailwind classes for responsive design
- Handle all interactive states (hover, focus, disabled, loading)

File conventions:
- Pages: src/app/{route}/page.tsx (default export, metadata)
- Layouts: src/app/{route}/layout.tsx (children prop)
- API: src/app/api/{route}/route.ts (GET, POST, etc.)
- Components: src/components/{name}.tsx (PascalCase)
- Hooks: src/hooks/use{Name}.ts (camelCase)
- Utils: src/lib/{name}.ts
- Types: src/types/{name}.ts
- Config: next.config.mjs, tailwind.config.ts, tsconfig.json

Respond with JSON:
{
  "files": [{"path": "src/app/page.tsx", "content": "full file content", "language": "tsx"}],
  "explanation": "what was generated and why",
  "confidence": 0.0-1.0
}`;

export class AppGeneratorAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_APP_GENERATOR, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<AppGeneratorResult> {
    const startedAt = new Date();
    const task = input as AppGeneratorTask;

    this.logger.info(
      { runId: context.runId, action: task.action, framework: task.framework },
      'App Generator agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'validate_typescript',
          description: 'Type-check a TypeScript/TSX file against strict mode + the generated file tree. Returns { ok, errors[{file, line, code, message}] }. USE on every generated file before including it in the result. Broken types = Vibe Coder build-check will fail later.',
          parameters: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Relative path of the file being checked' },
              content: { type: 'string', description: 'File content' },
              projectContext: {
                type: 'object',
                description: 'Known existing files + their exports (for cross-file type resolution)',
              },
            },
            required: ['filePath', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'lint_code',
          description: 'Run ESLint (Next.js strict + react-hooks + a11y rules). Returns findings[{line, rule, severity, message, fix?}]. USE on every .tsx/.ts output before shipping.',
          parameters: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              content: { type: 'string' },
              rulesetVariant: { type: 'string', enum: ['nextjs', 'react', 'node'] },
            },
            required: ['filePath', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'check_imports',
          description: 'Validate that every import in a file resolves to (a) a file in the generated batch, (b) an existing file, or (c) a declared dependency. Returns { ok, unresolvedImports[{importPath, line}], suggestedDeps[] }. USE on every file — broken imports are the #1 cause of build-check failures.',
          parameters: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              content: { type: 'string' },
              generatedFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Paths of all files in the current generation batch',
              },
              existingFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Paths of files already present in the project',
              },
              knownDependencies: {
                type: 'object',
                description: 'package.json dependencies map',
              },
            },
            required: ['filePath', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search for code patterns, templates, and component examples specific to this codebase.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query for code patterns' },
              category: { type: 'string', description: 'Category: components, hooks, api-routes, styles' },
            },
            required: ['query'],
          },
        },
      },
    ];

    const userContent: Record<string, unknown> = {
      action: task.action,
      framework: task.framework ?? 'nextjs',
      architecture: task.architecture,
      componentHierarchy: task.componentHierarchy,
      dependencies: task.dependencies,
      dataModels: task.dataModels,
      apiEndpoints: task.apiEndpoints,
    };

    if (task.action === 'GENERATE_FILE' && task.targetFile) {
      userContent.targetFile = task.targetFile;
    }

    if (task.action === 'GENERATE_BATCH' && task.targetFiles) {
      userContent.targetFiles = task.targetFiles;
    }

    if (task.action === 'MODIFY_FILE') {
      userContent.modifyInstructions = task.modifyInstructions;
      userContent.existingFiles = task.existingFiles;
    }

    // Include relevant existing files for context (limited to save tokens)
    if (task.existingFiles && task.action !== 'MODIFY_FILE') {
      userContent.existingFilesList = task.existingFiles.map(f => f.path);
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(APP_GENERATOR_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify(userContent),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 8192,
        temperature: 0.2,
        maxIterations: 3,
      });
    } catch (err) {
      this.logger.error({ err }, 'App Generator executeWithTools failed');
      const fallback: AppGeneratorResult = {
        action: task.action,
        files: [],
        explanation: 'Code generation failed due to an internal error.',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: AppGeneratorResult;
    try {
      const parsed = this.parseJsonResponse<Partial<AppGeneratorResult>>(loopResult.content);
      result = {
        action: task.action,
        files: parsed.files ?? [],
        explanation: parsed.explanation ?? 'Files generated.',
        diagnostics: parsed.diagnostics,
        testScaffolding: parsed.testScaffolding,
        newDependencies: parsed.newDependencies,
        buildReadiness: parsed.buildReadiness,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        files: [],
        explanation:
          'Manual review required — LLM output was not structured JSON. No files were generated. Do NOT proceed to the debugger or deployer — re-run the architect or generator with a stricter prompt, or escalate to a human engineer.',
        diagnostics: [
          {
            file: 'app-generator/parse-failure',
            severity: 'error' as const,
            category: 'convention' as const,
            message: 'Agent output could not be parsed into AppGeneratorResult — no files delivered.',
            suggestion: 'Re-run with a stricter prompt, or escalate to a human engineer.',
          },
        ],
        buildReadiness: {
          typecheckPasses: false,
          lintPasses: false,
          allRequiredFilesPresent: false,
          missingFiles: ['(all files missing due to parse failure)'],
        },
        confidence: 0.1,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        filesGenerated: result.files.length,
        confidence: result.confidence,
      },
      'App Generator agent completed',
    );

    return result;
  }
}
