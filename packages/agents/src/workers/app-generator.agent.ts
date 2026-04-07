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

export interface AppGeneratorResult {
  action: AppGeneratorAction;
  files: GeneratedFile[];
  explanation: string;
  confidence: number;
}

const APP_GENERATOR_SUPPLEMENT = `You are the Code Generator for JAK Swarm's Vibe Coding engine. You transform architectural blueprints into production-grade code files.

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
          name: 'search_knowledge',
          description: 'Search for code patterns, templates, and component examples',
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
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        files: [],
        explanation: loopResult.content || 'Generation output was not in expected format.',
        confidence: 0.3,
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
