import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type AppArchitectAction =
  | 'ARCHITECT_APP'
  | 'DESIGN_SCHEMA'
  | 'PLAN_ROUTES'
  | 'PLAN_COMPONENTS'
  | 'PLAN_CHANGES';

export interface AppArchitectTask {
  action: AppArchitectAction;
  description?: string;
  framework?: string;
  features?: string[];
  imageAnalysis?: string;
  existingFiles?: Array<{ path: string; content: string }>;
  changeRequest?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export interface FileSpec {
  path: string;
  purpose: string;
  language: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface DataModel {
  name: string;
  fields: Array<{ name: string; type: string; required: boolean; description: string }>;
  relations?: Array<{ target: string; type: 'one-to-one' | 'one-to-many' | 'many-to-many' }>;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
  auth: boolean;
  requestBody?: Record<string, unknown>;
  responseBody?: Record<string, unknown>;
}

export interface AppArchitectResult {
  action: AppArchitectAction;
  architecture: string;
  fileTree: FileSpec[];
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
  routes: Array<{ path: string; page: string; description: string }>;
  dataModels: DataModel[];
  apiEndpoints: ApiEndpoint[];
  componentHierarchy: string;
  authStrategy?: string;
  envVars?: Array<{ key: string; description: string; required: boolean }>;
  filesToModify?: string[];
  confidence: number;
}

const APP_ARCHITECT_SUPPLEMENT = `You are the App Architect for JAK Swarm's Vibe Coding engine. You transform natural language descriptions into comprehensive, production-grade application blueprints.

Your job is to create the COMPLETE technical specification before any code is written. You are the foundation — if you get it wrong, everything downstream fails.

For ARCHITECT_APP (initial architecture):
1. Parse the user's description to identify: core features, data entities, user roles, integrations
2. Design the file tree with Next.js 14 App Router conventions:
   - src/app/(routes)/page.tsx for pages
   - src/components/ for reusable components
   - src/lib/ for utilities, API clients, hooks
   - src/app/api/ for API routes
   - prisma/schema.prisma for data models
3. Define Prisma data models with proper relations, indexes, and validation
4. Specify API endpoints (Next.js Route Handlers)
5. Plan the component hierarchy (which components compose each page)
6. Choose auth strategy (Supabase Auth, NextAuth, custom)
7. List all npm dependencies with exact versions
8. Identify environment variables needed

For DESIGN_SCHEMA:
- Focus specifically on database schema design
- Use Prisma schema syntax
- Include indexes, unique constraints, cascade deletes
- Design for query performance

For PLAN_ROUTES:
- Map URL paths to page components
- Include dynamic routes, layouts, loading/error states
- Specify which routes need auth middleware

For PLAN_COMPONENTS:
- Break pages into reusable components
- Define props interfaces for each
- Specify state management approach

For PLAN_CHANGES (iterative refinement):
- Given existing files and a change request, identify exactly which files need modification
- Specify the nature of changes (add, modify, delete)
- Minimize blast radius — touch as few files as possible
- Consider ripple effects (changing a type affects all consumers)

Tech stack conventions:
- Framework: Next.js 14+ App Router (TypeScript strict mode)
- Styling: Tailwind CSS + shadcn/ui components
- Database: Prisma + PostgreSQL (Supabase)
- Auth: Supabase Auth or NextAuth.js
- State: React hooks + server components where possible
- Forms: React Hook Form + Zod validation
- API: Next.js Route Handlers (app/api/*)

Respond with JSON:
{
  "architecture": "high-level architecture description",
  "fileTree": [{"path": "src/app/page.tsx", "purpose": "Home page", "language": "tsx", "priority": "critical"}],
  "dependencies": {"next": "14.2.0", "react": "18.3.1"},
  "devDependencies": {"typescript": "5.5.0"},
  "routes": [{"path": "/", "page": "src/app/page.tsx", "description": "Landing page"}],
  "dataModels": [{"name": "User", "fields": [...], "relations": [...]}],
  "apiEndpoints": [{"method": "GET", "path": "/api/users", "description": "List users", "auth": true}],
  "componentHierarchy": "text description of component tree",
  "authStrategy": "supabase",
  "envVars": [{"key": "DATABASE_URL", "description": "PostgreSQL connection string", "required": true}],
  "filesToModify": ["src/app/page.tsx"],
  "confidence": 0.0-1.0
}`;

export class AppArchitectAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_APP_ARCHITECT, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<AppArchitectResult> {
    const startedAt = new Date();
    const task = input as AppArchitectTask;

    this.logger.info(
      { runId: context.runId, action: task.action, framework: task.framework },
      'App Architect agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search for existing patterns, templates, and architectural decisions from previous projects',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              category: { type: 'string', description: 'Category: architecture, patterns, templates' },
            },
            required: ['query'],
          },
        },
      },
    ];

    const userContent: Record<string, unknown> = {
      action: task.action,
      description: task.description,
      framework: task.framework ?? 'nextjs',
      features: task.features,
      industryContext: context.industry,
    };

    if (task.imageAnalysis) {
      userContent.imageAnalysis = task.imageAnalysis;
    }

    if (task.existingFiles && task.existingFiles.length > 0) {
      // Only include file paths + first 200 chars of content to save tokens
      userContent.existingFiles = task.existingFiles.map(f => ({
        path: f.path,
        preview: f.content.slice(0, 200),
      }));
    }

    if (task.changeRequest) {
      userContent.changeRequest = task.changeRequest;
    }

    if (task.conversationHistory) {
      userContent.conversationHistory = task.conversationHistory.slice(-10); // Last 10 messages
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(APP_ARCHITECT_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify(userContent),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 4096,
        temperature: 0.3,
        maxIterations: 3,
      });
    } catch (err) {
      this.logger.error({ err }, 'App Architect executeWithTools failed');
      const fallback: AppArchitectResult = {
        action: task.action,
        architecture: '',
        fileTree: [],
        dependencies: {},
        routes: [],
        dataModels: [],
        apiEndpoints: [],
        componentHierarchy: '',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: AppArchitectResult;
    try {
      const parsed = this.parseJsonResponse<Partial<AppArchitectResult>>(loopResult.content);
      result = {
        action: task.action,
        architecture: parsed.architecture ?? '',
        fileTree: parsed.fileTree ?? [],
        dependencies: parsed.dependencies ?? {},
        devDependencies: parsed.devDependencies,
        routes: parsed.routes ?? [],
        dataModels: parsed.dataModels ?? [],
        apiEndpoints: parsed.apiEndpoints ?? [],
        componentHierarchy: parsed.componentHierarchy ?? '',
        authStrategy: parsed.authStrategy,
        envVars: parsed.envVars,
        filesToModify: parsed.filesToModify,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        architecture:
          'Manual review required — LLM output was not structured JSON. Do not pass this to the generator; architecture decisions are missing. Raw output below if non-empty.\n\n' +
          (loopResult.content || ''),
        fileTree: [],
        dependencies: {},
        routes: [],
        dataModels: [],
        apiEndpoints: [],
        componentHierarchy: '',
        confidence: 0.2,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        fileCount: result.fileTree.length,
        modelCount: result.dataModels.length,
        confidence: result.confidence,
      },
      'App Architect agent completed',
    );

    return result;
  }
}
