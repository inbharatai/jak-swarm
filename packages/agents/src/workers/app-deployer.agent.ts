import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type AppDeployerAction =
  | 'DEPLOY_VERCEL'
  | 'DEPLOY_PREVIEW'
  | 'CONFIGURE_DOMAIN'
  | 'SYNC_GITHUB'
  | 'CHECK_DEPLOYMENT_STATUS';

export interface AppDeployerTask {
  action: AppDeployerAction;
  projectId?: string;
  projectName?: string;
  framework?: string;
  files?: Array<{ path: string; content: string }>;
  envVars?: Record<string, string>;
  domain?: string;
  githubRepo?: string;
  githubBranch?: string;
  deploymentId?: string;
}

export interface AppDeployerResult {
  action: AppDeployerAction;
  deploymentUrl?: string;
  deploymentId?: string;
  previewUrl?: string;
  githubUrl?: string;
  status: 'success' | 'failed' | 'pending';
  logs?: string;
  error?: string;
  confidence: number;
}

const APP_DEPLOYER_SUPPLEMENT = `You are the Deployment Agent for JAK Swarm's Vibe Coding engine. You deploy generated applications to production platforms.

For DEPLOY_VERCEL:
- Prepare project files for Vercel deployment
- Configure framework preset (Next.js, React, etc.)
- Set environment variables
- Monitor deployment status
- Return the live URL

For DEPLOY_PREVIEW:
- Create a preview deployment (non-production)
- Useful for testing before going live

For CONFIGURE_DOMAIN:
- Configure custom domain on Vercel
- Return DNS configuration instructions

For SYNC_GITHUB:
- Create/update a GitHub repository
- Push project files to the repo
- Set up branch protection if needed

For CHECK_DEPLOYMENT_STATUS:
- Poll deployment status
- Return build logs on failure

You have access to Vercel and GitHub tools. Use them to execute deployments.

Respond with JSON:
{
  "deploymentUrl": "https://my-app.vercel.app",
  "deploymentId": "dpl_...",
  "previewUrl": "https://preview-...",
  "githubUrl": "https://github.com/...",
  "status": "success|failed|pending",
  "logs": "deployment logs",
  "error": "error message if failed",
  "confidence": 0.0-1.0
}`;

export class AppDeployerAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_APP_DEPLOYER, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<AppDeployerResult> {
    const startedAt = new Date();
    const task = input as AppDeployerTask;

    this.logger.info(
      { runId: context.runId, action: task.action, framework: task.framework },
      'App Deployer agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'deploy_to_vercel',
          description: 'Deploy project files to Vercel',
          parameters: {
            type: 'object',
            properties: {
              projectName: { type: 'string', description: 'Vercel project name' },
              framework: { type: 'string', description: 'Framework preset' },
              envVars: { type: 'object', description: 'Environment variables' },
            },
            required: ['projectName'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'github_create_repo',
          description: 'Create a new GitHub repository',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Repository name' },
              description: { type: 'string', description: 'Repository description' },
              isPrivate: { type: 'boolean', description: 'Whether the repo is private' },
            },
            required: ['name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'github_push_files',
          description: 'Push files to a GitHub repository',
          parameters: {
            type: 'object',
            properties: {
              repo: { type: 'string', description: 'Repository (owner/name)' },
              branch: { type: 'string', description: 'Branch name' },
              message: { type: 'string', description: 'Commit message' },
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                  },
                },
                description: 'Files to push',
              },
            },
            required: ['repo', 'branch', 'message', 'files'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(APP_DEPLOYER_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          projectName: task.projectName,
          framework: task.framework ?? 'nextjs',
          envVars: task.envVars,
          domain: task.domain,
          githubRepo: task.githubRepo,
          githubBranch: task.githubBranch ?? 'main',
          deploymentId: task.deploymentId,
          fileCount: task.files?.length ?? 0,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 2048,
        temperature: 0.1,
        maxIterations: 5,
      });
    } catch (err) {
      this.logger.error({ err }, 'App Deployer executeWithTools failed');
      const fallback: AppDeployerResult = {
        action: task.action,
        status: 'failed',
        error: 'Deployment agent encountered an internal error.',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: AppDeployerResult;
    try {
      const parsed = this.parseJsonResponse<Partial<AppDeployerResult>>(loopResult.content);
      result = {
        action: task.action,
        deploymentUrl: parsed.deploymentUrl,
        deploymentId: parsed.deploymentId,
        previewUrl: parsed.previewUrl,
        githubUrl: parsed.githubUrl,
        status: parsed.status ?? 'pending',
        logs: parsed.logs,
        error: parsed.error,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        status: 'failed',
        error: 'Could not parse deployer output.',
        confidence: 0.2,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        status: result.status,
        deploymentUrl: result.deploymentUrl,
        confidence: result.confidence,
      },
      'App Deployer agent completed',
    );

    return result;
  }
}
