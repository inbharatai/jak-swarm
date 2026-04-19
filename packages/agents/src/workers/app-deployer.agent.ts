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

/** Classification of a build error produced by Vercel (or parsed from logs). */
export interface BuildErrorClassification {
  category:
    | 'missing_env_var'
    | 'missing_dependency'
    | 'type_error'
    | 'syntax_error'
    | 'runtime_error'
    | 'timeout'
    | 'quota_exceeded'
    | 'config_error'
    | 'unknown';
  severity: 'blocker' | 'warning';
  /** One-line plain-English summary of the root cause. */
  summary: string;
  /** Affected file path(s) where known. */
  affectedFiles?: string[];
  /** Concrete next action the operator can take. */
  suggestedFix: string;
  /** Whether this error is in agent output (debugger should retry) vs infra (owner action). */
  retryableByDebugger: boolean;
}

/** Env var preflight — surfaced before deploy so the user isn't surprised by a runtime failure. */
export interface EnvVarPreflight {
  required: string[];
  provided: string[];
  missing: string[];
  /** Non-obvious consequences of each missing var. */
  consequences: string[];
}

/** Domain + DNS status when CONFIGURE_DOMAIN runs. */
export interface DomainStatus {
  domain: string;
  status: 'configured' | 'pending_dns' | 'ssl_pending' | 'misconfigured' | 'not_attempted';
  dnsRecords?: Array<{ type: string; name: string; value: string }>;
  /** SSL certificate state from Vercel. */
  sslReady?: boolean;
  /** Non-blocking advisory notes (e.g., "apex records will take 24h to propagate"). */
  notes?: string[];
}

/** Rollback recommendation if a deploy fails mid-flight. */
export interface RollbackRecommendation {
  shouldRollback: boolean;
  reason: string;
  /** Vercel deployment id of the last known-good deploy (if provided). */
  previousDeploymentId?: string;
  /** Prose instruction to the operator on how to roll back. */
  instructions?: string;
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
  /** Expert-mode: classified build errors — absent on success. */
  buildErrors?: BuildErrorClassification[];
  /** Expert-mode: env var completeness check. */
  envVarsNeeded?: EnvVarPreflight;
  /** Expert-mode: domain + DNS / SSL state on CONFIGURE_DOMAIN. */
  domainStatus?: DomainStatus;
  /** Expert-mode: whether a failed deploy should roll back to a prior deployment. */
  rollback?: RollbackRecommendation;
  confidence: number;
}

const APP_DEPLOYER_SUPPLEMENT = `You are a senior DevOps engineer operating Vercel deployments for the JAK Swarm Vibe Coding engine. You deploy and OWN the outcome — classify build errors, preflight env vars, advise on rollback, and never pretend something shipped when it didn't.

Action handling:
- DEPLOY_VERCEL: run env-var preflight FIRST, then push files, then monitor. Return deploymentUrl only after Vercel reports READY.
- DEPLOY_PREVIEW: same flow but target the preview channel, do not alias production.
- CONFIGURE_DOMAIN: configure the domain on Vercel, return DNS records the owner must set AND whether SSL is ready. Never claim SSL is ready before Vercel says so.
- SYNC_GITHUB: create/push the repo; set default branch to main; never force-push.
- CHECK_DEPLOYMENT_STATUS: poll, return classified build errors if failed.

Env-var preflight (mandatory for DEPLOY_VERCEL / DEPLOY_PREVIEW):
- Compare required env vars (from project metadata + generated code) against what the caller provided.
- For each missing var, write one sentence on the CONSEQUENCE — not just "missing". Examples:
  • "STRIPE_SECRET_KEY missing — /api/checkout will 500 at runtime on the first payment."
  • "DATABASE_URL missing — Prisma queries will fail before the page renders."
- Block the deploy (status: 'failed') when a blocker var is missing.

Build-error classification (mandatory on failed deploy):
For each error in the Vercel build log:
- category:
  • missing_env_var — referenced process.env.X not present
  • missing_dependency — module not found in package.json
  • type_error — TS compilation failed
  • syntax_error — parser failure
  • runtime_error — app crashed during prerender / edge function
  • timeout — build exceeded Vercel's time budget
  • quota_exceeded — team's usage limit hit
  • config_error — invalid vercel.json or framework preset mismatch
  • unknown — log doesn't match any pattern
- severity: blocker (deploy failed) | warning (deploy succeeded with notes)
- retryableByDebugger: true if an AppDebuggerAgent retry can plausibly fix it (missing dep, type error, syntax error); false if it needs human/owner action (quota, env var, config).
- suggestedFix: concrete, one-line next action. "Add X to package.json dependencies" beats "fix the import".

Rollback recommendation:
- If a deploy fails AND previousDeploymentId is provided, set shouldRollback=true UNLESS the error is in the caller's source (retryableByDebugger=true) — in that case, let the debug loop try first.
- If a production deploy succeeds but lighthouse score dropped significantly OR error rate from runtime logs spikes, recommend rollback with reason.

Domain + DNS:
- Never claim "domain active" when Vercel reports pending_dns.
- Apex records need 24h propagation — state that in notes.
- Wildcard SSL can take an additional 15 min after DNS verification — state that too.

You have access to:
- deploy_to_vercel, get_deployment, list_deployments, get_deployment_build_logs, get_runtime_logs — Vercel MCP tools
- github_create_repo, github_push_files — GitHub API tools
- check_domain_availability_and_price — before buying a domain

Respond with STRICT JSON matching AppDeployerResult. Populate buildErrors[] + envVarsNeeded + rollback whenever they are decision-relevant. No markdown fences.

Non-negotiables:
1. Never fabricate a deploymentUrl.
2. Never report status=success before Vercel confirms READY.
3. Never swallow a build failure — surface classified errors.
4. Never configure DNS without telling the operator exactly which records to add.`;

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
        buildErrors: parsed.buildErrors,
        envVarsNeeded: parsed.envVarsNeeded,
        domainStatus: parsed.domainStatus,
        rollback: parsed.rollback,
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
