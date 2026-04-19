import {
  AppArchitectAgent,
  AppGeneratorAgent,
  AppDebuggerAgent,
  AppDeployerAgent,
  AgentContext,
  type AppArchitectResult,
  type AppGeneratorResult,
  type AppDebuggerResult,
  type AppDeployerResult,
  type GeneratedFile,
} from '@jak-swarm/agents';
import type { SubscriptionTier } from '@jak-swarm/shared';
import { createLogger } from '@jak-swarm/shared';

/**
 * Vibe Coder end-to-end workflow.
 *
 * Chains the 4 app-* agents into a real pipeline that the existing builder UI
 * can drive via a single call:
 *
 *   Architect → Generator → build check → ok? → Deployer
 *                                 |
 *                                 no → Debugger (≤ N retries) → Generator/Debugger loop
 *
 * The workflow is ordinary async code — it doesn't go through SwarmGraph
 * because SwarmGraph is a DAG and the debug-retry loop is cyclic. Queue
 * durability comes from being called INSIDE `SwarmExecutionService`'s
 * processor (dispatched by `ExecuteAsyncParams.workflowKind === 'vibe-coder'`).
 *
 * Fails gracefully:
 *   - LLM errors inside each agent return structured fallback results (agents
 *     already handle this internally) — the chain continues with what it got
 *   - Build check failures → Debugger attempts a fix
 *   - Max retries exhausted → workflow completes with status='failed' + error
 *   - Debugger returns `requiresUserInput` → workflow completes with
 *     status='needs_user_input' + userQuestion (caller pauses for approval)
 */

const logger = createLogger('vibe-coder-workflow');

export type VibeCoderEventType =
  | 'architect:start'
  | 'architect:ok'
  | 'architect:failed'
  | 'generator:start'
  | 'generator:ok'
  | 'generator:failed'
  | 'build_check:start'
  | 'build_check:ok'
  | 'build_check:failed'
  | 'debugger:start'
  | 'debugger:ok'
  | 'debugger:failed'
  | 'debugger:requires_user_input'
  | 'deployer:start'
  | 'deployer:ok'
  | 'deployer:failed'
  | 'completed'
  | 'failed';

export interface VibeCoderEvent {
  type: VibeCoderEventType;
  workflowId: string;
  data?: unknown;
  timestamp: string;
}

export interface BuildResult {
  ok: boolean;
  errorLog?: string;
  affectedFiles?: string[];
  /** Checker skipped (e.g., Docker unavailable). Callers can treat as "unverified"
   *  rather than "verified pass" when composing. Defaults to false when omitted. */
  skipped?: boolean;
  /** Optional reason for the skip (or short annotation). Surfaced in build logs. */
  skipReason?: string;
  /** Wall-clock duration of the check, for benchmark reporting. */
  durationMs?: number;
}

export interface BuildChecker {
  check(files: GeneratedFile[]): Promise<BuildResult>;
}

/**
 * Default heuristic build checker — catches the most common Generator failure
 * modes (truncated output, placeholder stubs) without running a real build.
 *
 * Production deployments can inject a Docker/E2B-backed checker that runs
 * `tsc --noEmit` or `next build`. See `packages/tools/src/adapters/sandbox/`.
 */
export const heuristicBuildChecker: BuildChecker = {
  async check(files) {
    const errors: string[] = [];
    const affected: string[] = [];
    if (files.length === 0) {
      return { ok: false, errorLog: 'Generator returned zero files', affectedFiles: [] };
    }
    for (const f of files) {
      const c = f.content ?? '';
      if (c.trim().length === 0) {
        errors.push(`${f.path}: empty file`);
        affected.push(f.path);
        continue;
      }
      // Truncation / placeholder detection.
      if (/\/\/\s*TODO(?:\s|:)/.test(c) || /\/\*\s*TODO\b/.test(c)) {
        errors.push(`${f.path}: contains TODO placeholder — incomplete generation`);
        affected.push(f.path);
      }
      if (/\bthrow\s+new\s+Error\(\s*['"`]Not implemented['"`]/i.test(c)) {
        errors.push(`${f.path}: contains "Not implemented" stub`);
        affected.push(f.path);
      }
      // Unbalanced braces (rough check; only triggers on large delta).
      const openBraces = (c.match(/\{/g) ?? []).length;
      const closeBraces = (c.match(/\}/g) ?? []).length;
      if (Math.abs(openBraces - closeBraces) > 2) {
        errors.push(`${f.path}: unbalanced braces (${openBraces} open, ${closeBraces} close) — likely truncated`);
        affected.push(f.path);
      }
    }
    if (errors.length > 0) {
      return {
        ok: false,
        errorLog: errors.join('\n'),
        affectedFiles: [...new Set(affected)],
      };
    }
    return { ok: true };
  },
};

/** Always-ok checker. Useful when the caller trusts the Generator and wants
 * to rely on the real deployer (e.g., Vercel build) to catch errors. */
export const passThroughBuildChecker: BuildChecker = {
  async check() {
    return { ok: true };
  },
};

export interface VibeCoderParams {
  workflowId: string;
  tenantId: string;
  userId: string;
  /** Natural-language description of the app the user wants to build. */
  description: string;
  framework?: string;
  features?: string[];
  existingFiles?: GeneratedFile[];
  projectName?: string;
  subscriptionTier?: SubscriptionTier;
  industry?: string;
  /** Max debug-retry iterations before failing the workflow. Default 3. */
  maxDebugRetries?: number;
  /** If false, stops after build check. Default true. */
  deployAfterBuild?: boolean;
  envVars?: Record<string, string>;
  buildChecker?: BuildChecker;
  /** Progress callback — called on every state transition. Also emits on SupervisorBus. */
  onProgress?: (event: VibeCoderEvent) => void;
  /**
   * Optional checkpoint hook — called AFTER the workflow has persisted the
   * files at a stage boundary, so the caller can snapshot them to durable
   * storage (e.g. ProjectVersion). Stages emitted:
   *   - 'generator' after the first Generator pass succeeds
   *   - 'debugger'  after each successful debug-retry iteration (Nth retry)
   *   - 'deployer'  after Deployer returns (success or soft-fail)
   *
   * The callback MUST NOT mutate `files`. It should be non-fatal — the
   * workflow continues even if checkpointing throws (logged, not raised).
   */
  onCheckpoint?: (stage: 'generator' | 'debugger' | 'deployer', context: {
    files: readonly GeneratedFile[];
    attempt?: number;
    workflowId: string;
  }) => Promise<void>;
  /** Agent injection points for tests. Undefined = use real agents. */
  agents?: {
    architect?: AppArchitectAgent;
    generator?: AppGeneratorAgent;
    debugger?: AppDebuggerAgent;
    deployer?: AppDeployerAgent;
  };
}

export interface VibeCoderResult {
  workflowId: string;
  status: 'completed' | 'failed' | 'needs_user_input';
  architecture?: AppArchitectResult;
  files: GeneratedFile[];
  deployment?: AppDeployerResult;
  buildLogs: string[];
  debugAttempts: number;
  userQuestion?: string;
  error?: string;
  durationMs: number;
}

function emit(
  event: VibeCoderEventType,
  params: VibeCoderParams,
  data?: unknown,
): void {
  const evt: VibeCoderEvent = {
    type: event,
    workflowId: params.workflowId,
    data,
    timestamp: new Date().toISOString(),
  };
  try {
    params.onProgress?.(evt);
  } catch (err) {
    logger.warn({ err }, 'onProgress handler threw — continuing');
  }
  // Intentionally NOT publishing to SupervisorBus yet — the existing event
  // map is workflow-scoped and adding vibe-coder events there is a follow-up.
  // For now, callers drive trace UI via their own onProgress handler (wired
  // to SSE in the API layer).
}

/**
 * Merge debugger fixes into the working file set. Files matching a fix's path
 * are REPLACED by the fixed content; new files are appended. Returns a fresh
 * array (no mutation).
 */
function applyFixes(files: GeneratedFile[], fixes: Array<{ path: string; content: string }>): GeneratedFile[] {
  const map = new Map(files.map((f) => [f.path, f] as const));
  for (const fix of fixes) {
    const existing = map.get(fix.path);
    map.set(fix.path, {
      path: fix.path,
      content: fix.content,
      language: existing?.language ?? inferLanguage(fix.path),
    });
  }
  return [...map.values()];
}

/**
 * Invoke the optional onCheckpoint callback, swallowing any error so the
 * workflow is never killed by a checkpoint-storage hiccup. Checkpoints
 * are a nicety — missing one is logged, not raised.
 */
async function safeCheckpoint(
  params: VibeCoderParams,
  stage: 'generator' | 'debugger' | 'deployer',
  context: { files: readonly GeneratedFile[]; attempt?: number },
): Promise<void> {
  if (!params.onCheckpoint) return;
  try {
    await params.onCheckpoint(stage, {
      files: context.files,
      attempt: context.attempt,
      workflowId: params.workflowId,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), stage, workflowId: params.workflowId },
      'onCheckpoint threw — continuing workflow',
    );
  }
}

function inferLanguage(path: string): string {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.prisma')) return 'prisma';
  return 'text';
}

export async function runVibeCoderWorkflow(params: VibeCoderParams): Promise<VibeCoderResult> {
  const started = Date.now();
  const maxDebugRetries = params.maxDebugRetries ?? 3;
  const checker = params.buildChecker ?? heuristicBuildChecker;
  const deployAfterBuild = params.deployAfterBuild ?? true;
  const buildLogs: string[] = [];

  const architect = params.agents?.architect ?? new AppArchitectAgent();
  const generator = params.agents?.generator ?? new AppGeneratorAgent();
  const debug = params.agents?.debugger ?? new AppDebuggerAgent();
  const deployer = params.agents?.deployer ?? new AppDeployerAgent();

  const agentContext = new AgentContext({
    tenantId: params.tenantId,
    userId: params.userId,
    workflowId: params.workflowId,
    industry: params.industry,
    subscriptionTier: params.subscriptionTier,
  });

  // ─── 1. Architect ────────────────────────────────────────────────────────
  emit('architect:start', params);
  let architecture: AppArchitectResult;
  try {
    architecture = await architect.execute(
      {
        action: 'ARCHITECT_APP',
        description: params.description,
        framework: params.framework ?? 'nextjs',
        features: params.features,
        existingFiles: params.existingFiles,
      },
      agentContext,
    );
  } catch (err) {
    emit('architect:failed', params, { error: err instanceof Error ? err.message : String(err) });
    emit('failed', params, { stage: 'architect', error: err instanceof Error ? err.message : String(err) });
    return {
      workflowId: params.workflowId,
      status: 'failed',
      files: params.existingFiles ?? [],
      buildLogs,
      debugAttempts: 0,
      error: `Architect failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - started,
    };
  }
  emit('architect:ok', params, {
    fileCount: architecture.fileTree.length,
    confidence: architecture.confidence,
  });

  // ─── 2/3/4. Generate → Build-check → Debug loop ──────────────────────────
  let files: GeneratedFile[] = params.existingFiles ?? [];
  const previousFixes: Array<{ attempt: number; fix: string; result: string }> = [];
  let debugAttempts = 0;
  let firstGenDone = false;

  while (debugAttempts <= maxDebugRetries) {
    // Generator only runs the FIRST pass. Subsequent iterations use Debugger fixes
    // directly (Generator isn't re-invoked — that would waste tokens regenerating
    // files that are already close to working).
    if (!firstGenDone) {
      emit('generator:start', params, { action: 'GENERATE_BATCH' });
      let generated: AppGeneratorResult;
      try {
        generated = await generator.execute(
          {
            action: 'GENERATE_BATCH',
            architecture: architecture.architecture,
            fileTree: architecture.fileTree,
            dependencies: architecture.dependencies,
            dataModels: architecture.dataModels,
            apiEndpoints: architecture.apiEndpoints,
            componentHierarchy: architecture.componentHierarchy,
            framework: params.framework ?? 'nextjs',
            existingFiles: params.existingFiles,
          },
          agentContext,
        );
      } catch (err) {
        emit('generator:failed', params, { error: err instanceof Error ? err.message : String(err) });
        emit('failed', params, { stage: 'generator', error: err instanceof Error ? err.message : String(err) });
        return {
          workflowId: params.workflowId,
          status: 'failed',
          architecture,
          files,
          buildLogs,
          debugAttempts,
          error: `Generator failed: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - started,
        };
      }
      files = applyFixes(files, generated.files);
      firstGenDone = true;
      emit('generator:ok', params, {
        fileCount: generated.files.length,
        confidence: generated.confidence,
      });
      await safeCheckpoint(params, 'generator', { files });
    }

    // Build check
    emit('build_check:start', params);
    const buildResult = await checker.check(files);
    if (buildResult.errorLog) buildLogs.push(buildResult.errorLog);

    if (buildResult.ok) {
      emit('build_check:ok', params, { fileCount: files.length });
      break;
    }

    emit('build_check:failed', params, {
      errorLog: buildResult.errorLog,
      affectedFiles: buildResult.affectedFiles,
    });

    // Max retries reached?
    if (debugAttempts >= maxDebugRetries) {
      emit('failed', params, {
        stage: 'build_check_max_retries',
        error: `Build still failing after ${maxDebugRetries} debug attempts`,
        lastError: buildResult.errorLog,
      });
      return {
        workflowId: params.workflowId,
        status: 'failed',
        architecture,
        files,
        buildLogs,
        debugAttempts,
        error: `Build still failing after ${maxDebugRetries} debug attempts. Last error: ${buildResult.errorLog ?? 'unknown'}`,
        durationMs: Date.now() - started,
      };
    }

    // Debug
    debugAttempts += 1;
    emit('debugger:start', params, { attempt: debugAttempts });
    let debugResult: AppDebuggerResult;
    try {
      debugResult = await debug.execute(
        {
          action: 'SELF_DEBUG_LOOP',
          errorLog: buildResult.errorLog,
          errorType: 'build',
          affectedFiles: buildResult.affectedFiles,
          projectFiles: files,
          previousFixes,
        },
        agentContext,
      );
    } catch (err) {
      emit('debugger:failed', params, { error: err instanceof Error ? err.message : String(err) });
      return {
        workflowId: params.workflowId,
        status: 'failed',
        architecture,
        files,
        buildLogs,
        debugAttempts,
        error: `Debugger threw: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - started,
      };
    }

    if (debugResult.requiresUserInput) {
      emit('debugger:requires_user_input', params, { question: debugResult.userQuestion });
      return {
        workflowId: params.workflowId,
        status: 'needs_user_input',
        architecture,
        files,
        buildLogs,
        debugAttempts,
        userQuestion: debugResult.userQuestion,
        durationMs: Date.now() - started,
      };
    }

    previousFixes.push({
      attempt: debugAttempts,
      fix: debugResult.diagnosis,
      result: debugResult.rootCause,
    });
    files = applyFixes(files, debugResult.fixes);
    emit('debugger:ok', params, {
      fixCount: debugResult.fixes.length,
      confidence: debugResult.confidence,
      diagnosis: debugResult.diagnosis,
    });
    await safeCheckpoint(params, 'debugger', { files, attempt: debugAttempts });
  }

  // ─── 5. Deploy ───────────────────────────────────────────────────────────
  let deployment: AppDeployerResult | undefined;
  if (deployAfterBuild) {
    emit('deployer:start', params);
    try {
      deployment = await deployer.execute(
        {
          action: 'DEPLOY_VERCEL',
          projectName: params.projectName ?? `jak-${params.workflowId.slice(-8)}`,
          framework: params.framework ?? 'nextjs',
          files,
          envVars: params.envVars,
        },
        agentContext,
      );
      if (deployment.status === 'success') {
        emit('deployer:ok', params, {
          deploymentUrl: deployment.deploymentUrl,
          deploymentId: deployment.deploymentId,
        });
      } else {
        emit('deployer:failed', params, {
          status: deployment.status,
          error: deployment.error,
        });
      }
    } catch (err) {
      emit('deployer:failed', params, { error: err instanceof Error ? err.message : String(err) });
      // Deployment failure is a soft failure — files are still usable.
      deployment = {
        action: 'DEPLOY_VERCEL',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        confidence: 0,
      };
    }
    await safeCheckpoint(params, 'deployer', { files });
  }

  emit('completed', params, {
    fileCount: files.length,
    debugAttempts,
    deploymentUrl: deployment?.deploymentUrl,
  });

  return {
    workflowId: params.workflowId,
    status: 'completed',
    architecture,
    files,
    deployment,
    buildLogs,
    debugAttempts,
    durationMs: Date.now() - started,
  };
}
