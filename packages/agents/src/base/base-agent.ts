import OpenAI from 'openai';
import type { AgentRole, AgentTrace, ToolCall } from '@jak-swarm/shared';
import {
  generateId,
  createLogger,
} from '@jak-swarm/shared';
import type { Logger } from '@jak-swarm/shared';
import type { AgentContext } from './agent-context.js';
import type { LLMProvider } from './llm-provider.js';
import {
  ProviderRouter,
  getProviderForTier,
  getTierForAgent,
} from './provider-router.js';
import { getRuntime, type LLMRuntime } from '../runtime/index.js';
import { getReflectionMode } from '../role-manifest.js';

import { LLMCallService, type OnLLMCallComplete } from './llm-call.service.js';
import { ToolExecutionService } from './tool-execution.service.js';
import { PromptBuilder } from './prompt-builder.service.js';

/** Memory provider interface — injected by the API layer at boot */
export interface MemoryProvider {
  getMemories(tenantId: string, limit?: number): Promise<Array<{
    key: string;
    value: unknown;
    memoryType: string;
    updatedAt: Date;
  }>>;
}

/**
 * Company context provider — injected by the API layer at boot.
 * Returns the tenant's APPROVED CompanyProfile (status='user_approved'
 * or status='manual'). Returns null when no approved profile exists,
 * which is the honest signal to the agent that it lacks brand voice /
 * audience / etc. Migration 16.
 */
export interface CompanyContextProvider {
  getApprovedProfile(tenantId: string): Promise<{
    name: string | null;
    industry: string | null;
    description: string | null;
    productsServices: unknown;
    targetCustomers: string | null;
    brandVoice: string | null;
    competitors: unknown;
    pricing: string | null;
    websiteUrl: string | null;
    goals: string | null;
    constraints: string | null;
    preferredChannels: unknown;
  } | null>;
}

/**
 * Extract the first balanced JSON object or array blob from a string.
 *
 * Handles LLMs that wrap JSON in prose. Respects string escapes — `"\"}"`
 * inside a quoted value does NOT close the outer brace. Returns `null` if
 * no balanced blob is found. This is the fallback path used by
 * `parseJsonResponse` when direct `JSON.parse` fails.
 */
export function extractFirstJsonBlob(text: string): string | null {
  const len = text.length;
  let start = -1;
  let opener = '';
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      start = i;
      opener = ch;
      break;
    }
  }
  if (start < 0) return null;

  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < len; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Unbalanced — no matching closer found.
  return null;
}

/** Result of a multi-turn tool execution loop */
export interface ToolLoopResult {
  /** Final text content from the LLM after all tool calls complete */
  content: string;
  /** All tool calls executed during the loop */
  toolCalls: ToolCall[];
  /** Total tokens used across all LLM calls */
  totalTokens: { prompt: number; completion: number; total: number };
  /** Total estimated cost in USD across all LLM calls */
  totalCostUsd: number;
}

/** Strictness mode for self-reflection.
 *  - 'strict': corrects both objective errors and subjective quality gaps (for factual/grounded roles)
 *  - 'lenient': corrects only objective errors like hallucinations and format violations (for creative/subjective roles)
 */
export type ReflectionMode = 'strict' | 'lenient';

/** Options for the reflectAndCorrect method. */
export interface ReflectAndCorrectOptions {
  maxTokens?: number;
  /** Maximum reflect-then-correct passes. Default: 2. Acts as a hard convergence safety net. */
  maxReflectionPasses?: number;
  /** Reflection strictness. Default: determined by agent role (strict for factual roles, lenient for creative roles). */
  mode?: ReflectionMode;
}

export abstract class BaseAgent {
  protected readonly role: AgentRole;
  protected readonly logger: Logger;
  protected readonly openai: OpenAI;
  protected readonly provider?: LLMProvider;
  protected readonly llmCallService: LLMCallService;
  protected readonly promptBuilder: PromptBuilder;
  protected readonly toolExecutionService: ToolExecutionService;

  constructor(role: AgentRole, apiKey?: string, provider?: LLMProvider) {
    this.role = role;
    this.logger = createLogger(`agent:${role.toLowerCase()}`, { role });

    // Auto-initialize the OpenAI-only provider route whenever OpenAI is configured.
    if (provider) {
      this.provider = provider;
    } else {
      const hasProviderCredentials = Boolean(apiKey ?? process.env['OPENAI_API_KEY']);

      // OpenAI available - use the tier-aware OpenAI provider route.
      if (hasProviderCredentials) {
      try {
        // Role-aware routing: pick a tier-aligned primary provider first,
        // then wrap it for consistent telemetry/error classification.
        const tier = getTierForAgent(this.role);
        const primary = getProviderForTier(tier);
        this.provider = new ProviderRouter(primary);
      } catch {
        // ProviderRouter not available - fall through to direct OpenAI.
      }
      }
    }

    const resolvedKey = apiKey ?? process.env['OPENAI_API_KEY'];
    if (!resolvedKey && !this.provider) {
      this.logger.error(
        { role },
        '[BaseAgent] No OPENAI_API_KEY set - LLM calls will fail. Set OPENAI_API_KEY in your environment.',
      );
    }

    this.openai = new OpenAI({ apiKey: resolvedKey });

    // Initialize composable services before runtime, because runtime
    // delegates back to BaseAgent's protected callLLM/executeWithTools.
    this.llmCallService = new LLMCallService(
      this.role,
      this.openai,
      this.provider,
      this.logger,
      () => BaseAgent.onLLMCallComplete,
    );
    this.promptBuilder = new PromptBuilder(
      this.role,
      () => BaseAgent.memoryProvider,
      () => BaseAgent.companyContextProvider,
    );
    this.toolExecutionService = new ToolExecutionService(
      this.llmCallService,
      this.promptBuilder,
      this.logger,
      this.role,
      () => this.runtime,
    );

    // Phase 2: every agent gets an LLMRuntime. In Phase 2 this is always
    // LegacyRuntime that delegates back to BaseAgent's existing protected
    // callLLM/executeWithTools. Future phases (4, 7) start returning
    // OpenAIRuntime instead, agent-by-agent. Callers that want the new
    // surface use `this.runtime.respond(...)` / `this.runtime.callTools(...)`
    // — existing `this.callLLM(...)` and `this.executeWithTools(...)` calls
    // continue to work unchanged.
    this.runtime = getRuntime(role, {
      callLLMPublic: (m, t, o) => this.callLLM(m, t, o),
      executeWithToolsPublic: (m, t, c, o) => this.executeWithTools(m, t, c, o),
    });

    this.defaultReflectionMode = getReflectionMode(role);
  }

  /** Phase 2 — JAK-owned LLM runtime (LegacyRuntime by default). */
  protected readonly runtime!: LLMRuntime;

  /** Default reflection mode based on this agent's role. */
  protected readonly defaultReflectionMode: ReflectionMode;

  /**
   * Per-tenant context override — when set by setContextOverride(),
   * callLLM() and executeWithTools() route through the override
   * provider/call-service instead of the constructor-resolved defaults.
   * This enables per-tenant LLM provider selection (OpenAI vs Gemini)
   * without changing the constructor or breaking existing call sites.
   */
  private contextOverride: {
    callService: LLMCallService;
    runtime: LLMRuntime;
    provider: LLMProvider;
  } | null = null;

  /**
   * Global hook called after every LLM call with cost information.
   * Set by the API layer to track per-call credit usage.
   * When not set, cost is still logged but not deducted from credits.
   */
  static onLLMCallComplete: OnLLMCallComplete = null;

  /**
   * Memory provider — injected at application boot.
   * When set, all agents automatically receive relevant tenant memories
   * in their system prompt via <memory> tags.
   */
  static memoryProvider: MemoryProvider | null = null;

  /**
   * Company context provider — injected at application boot. When set,
   * BaseAgent loads the tenant's APPROVED CompanyProfile and prepends
   * a `<company_context>` block to every agent's system prompt, so the
   * agent grounds in brand voice / audience / competitors / etc. without
   * needing to do its own lookup. Migration 16.
   */
  static companyContextProvider: CompanyContextProvider | null = null;

  /**
   * Execute the agent's core logic. Subclasses implement this.
   * The base class wraps each call with setContextOverride/clearContextOverride
   * so per-tenant LLM provider preferences are automatically applied.
   */
  abstract _executeImpl(input: unknown, context: AgentContext): Promise<unknown>;

  /**
   * Public execute entry point — wraps the subclass implementation with
   * per-tenant LLM provider override. Every external caller (worker-node,
   * commander-node, planner-node, etc.) should call `agent.execute()`,
   * which routes through this wrapper automatically.
   */
  async execute(input: unknown, context: AgentContext): Promise<unknown> {
    this.setContextOverride(context);
    try {
      return await this._executeImpl(input, context);
    } finally {
      this.clearContextOverride();
    }
  }

  // ─── DELEGATES TO COMPOSABLE SERVICES ──────────────────────────────────────

  protected async callLLM(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools?: OpenAI.ChatCompletionTool[],
    options?: { maxTokens?: number; temperature?: number; jsonMode?: boolean },
  ): Promise<OpenAI.ChatCompletion> {
    const service = this.contextOverride?.callService ?? this.llmCallService;
    return service.callLLM(messages, tools, options);
  }

  protected async executeWithTools(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[],
    context: AgentContext,
    options?: { maxTokens?: number; temperature?: number; maxIterations?: number },
  ): Promise<ToolLoopResult> {
    if (this.contextOverride) {
      const overrideToolService = new ToolExecutionService(
        this.contextOverride.callService,
        this.promptBuilder,
        this.logger,
        this.role,
        () => this.contextOverride!.runtime,
      );
      return overrideToolService.executeWithTools(messages, tools, context, options);
    }
    return this.toolExecutionService.executeWithTools(messages, tools, context, options);
  }

  /**
   * Set per-tenant LLM provider override from AgentContext.
   * Call at the start of execute() — if context carries a different
   * llmProvider than the constructor default, this builds fresh
   * provider/call-service/runtime for the preferred provider.
   * No-op when context has no llmProvider or when it matches the default.
   */
  protected setContextOverride(context: AgentContext): void {
    if (!context.llmProvider) return;

    // Determine what provider the constructor resolved
    const currentProviderName = this.provider?.name ?? '';
    const wantsOpenAI = context.llmProvider === 'openai';
    const wantsGemini = context.llmProvider === 'gemini';

    // Check if already on the right provider
    if (wantsOpenAI && currentProviderName === 'openai') return;
    if (wantsGemini && currentProviderName === 'google') return;

    // Build override provider + runtime
    const tier = getTierForAgent(this.role);
    const hints: { provider: 'openai' | 'gemini'; apiKey?: string; grounding?: { googleSearchEnabled?: boolean; vertexAISearchDatastore?: string } } = {
      provider: context.llmProvider,
      ...(context.llmApiKey ? { apiKey: context.llmApiKey } : {}),
      ...(context.llmProvider === 'gemini' ? {
        grounding: {
          ...(context.googleSearchGrounding !== undefined ? { googleSearchEnabled: context.googleSearchGrounding } : {}),
          ...(context.vertexAISearchDatastore ? { vertexAISearchDatastore: context.vertexAISearchDatastore } : {}),
        },
      } : {}),
    };

    const overrideProvider = getProviderForTier(tier, hints);
    const overrideRuntime = getRuntime(this.role, {
      callLLMPublic: (m, t, o) => this.callLLM(m, t, o),
      executeWithToolsPublic: (m, t, c, o) => this.executeWithTools(m, t, c, o),
    }, hints);

    const overrideOpenai = wantsOpenAI
      ? new OpenAI({ apiKey: context.llmApiKey ?? process.env['OPENAI_API_KEY'] })
      : this.openai;

    const overrideCallService = new LLMCallService(
      this.role,
      overrideOpenai,
      new ProviderRouter(overrideProvider),
      this.logger,
      () => BaseAgent.onLLMCallComplete,
    );

    this.contextOverride = {
      callService: overrideCallService,
      runtime: overrideRuntime,
      provider: overrideProvider,
    };
  }

  /**
   * Clear per-tenant LLM provider override. Call in finally block
   * after execute() returns so we don't leak override state.
   */
  protected clearContextOverride(): void {
    this.contextOverride = null;
  }

  protected async injectCompanyContext(
    messages: OpenAI.ChatCompletionMessageParam[],
    context: AgentContext,
  ): Promise<{ messages: OpenAI.ChatCompletionMessageParam[]; fieldsUsed: string[] }> {
    return this.promptBuilder.injectCompanyContext(messages, context);
  }

  protected async injectBundledSkills(
    messages: OpenAI.ChatCompletionMessageParam[],
    declaredToolNames: Set<string>,
  ): Promise<OpenAI.ChatCompletionMessageParam[]> {
    return this.promptBuilder.injectBundledSkills(messages, declaredToolNames);
  }

  protected async injectMemories(
    messages: OpenAI.ChatCompletionMessageParam[],
    context: AgentContext,
  ): Promise<OpenAI.ChatCompletionMessageParam[]> {
    return this.promptBuilder.injectMemories(messages, context);
  }

  protected buildSystemMessage(supplement?: string): string {
    return this.promptBuilder.buildSystemMessage(supplement);
  }

  protected async buildRAGContext(query: string, tenantId: string, topK = 3): Promise<string> {
    return this.promptBuilder.buildRAGContext(query, tenantId, topK);
  }

  protected buildChainOfThoughtPrompt(
    taskDescription: string,
    constraints: string[],
  ): string {
    return this.promptBuilder.buildChainOfThoughtPrompt(taskDescription, constraints);
  }

  // ─── AUTONOMOUS COWORK CAPABILITIES ────────────────────────────────────────

  /** Strict-mode reflection prompt — checks objective errors + completeness. */
  private static readonly STRICT_REFLECTION_PROMPT = `You are a critical reviewer. Analyze the following output for errors, hallucinations, or format violations. Think step by step.

Respond with JSON:
{
  "hasIssues": <boolean>,
  "issues": ["specific issue 1", "specific issue 2"],
  "severity": "none" | "minor" | "major" | "critical",
  "suggestion": "brief description of what needs fixing"
}

Check for:
- Factual accuracy and logical consistency
- Completeness relative to the task description
- Format compliance (proper JSON, required fields present)
- Hallucinated data (made-up statistics, names, dates)

Only flag issues where the output is objectively incorrect or violates explicit requirements. Do not flag stylistic preferences or subjective quality concerns.`;

  /** Lenient-mode reflection prompt — checks objective errors ONLY. */
  private static readonly LENIENT_REFLECTION_PROMPT = `You are a critical reviewer. Analyze the following output for objective errors ONLY. Think step by step.

Respond with JSON:
{
  "hasIssues": <boolean>,
  "issues": ["specific issue 1", "specific issue 2"],
  "severity": "none" | "minor" | "major" | "critical",
  "suggestion": "brief description of what needs fixing"
}

IMPORTANT: Set hasIssues to true ONLY for objective, verifiable errors. Subjective quality concerns must NOT set hasIssues to true.

Check ONLY for:
- Factual inaccuracies and logical contradictions
- Format violations (invalid JSON, missing required fields that the task explicitly requires)
- Hallucinated data (made-up statistics, names, dates, fabricated sources)

Do NOT flag as issues:
- Vague or non-actionable recommendations (inherent to strategic/creative content)
- "Could be more detailed" or "could be more specific" (preferences, not errors)
- Style, tone, or wording preferences
- Completeness beyond what the task explicitly required

If you find only subjective concerns, set hasIssues to false and severity to "none".`;

  /**
   * Self-reflection and correction loop with convergence guarantee.
   *
   * After the agent produces an initial result, this method:
   * 1. Asks the LLM to critique its own output (chain-of-thought reflection)
   * 2. If the critique finds issues that warrant correction, asks the LLM to produce a corrected version
   * 3. Re-reflects on the corrected output (up to maxReflectionPasses)
   * 4. Returns the corrected output (or original if no issues found or passes exhausted)
   *
   * Mode-aware: 'lenient' mode (for creative/subjective roles) only corrects objective
   * errors and accepts minor severity. 'strict' mode corrects both objective and
   * quality issues including minor severity.
   *
   * This gives every agent the ability to self-correct without human intervention,
   * while guaranteeing convergence via the maxReflectionPasses cap.
   */
  async reflectAndCorrect(
    originalOutput: string,
    taskDescription: string,
    options?: ReflectAndCorrectOptions,
  ): Promise<{ corrected: string; wasChanged: boolean; reflection: string }> {
    const mode = options?.mode ?? this.defaultReflectionMode;
    const maxPasses = options?.maxReflectionPasses ?? 2;
    let currentOutput = originalOutput;
    let wasChanged = false;
    let lastReflection = '';

    for (let pass = 0; pass < maxPasses; pass++) {
      const systemPrompt = mode === 'lenient'
        ? BaseAgent.LENIENT_REFLECTION_PROMPT
        : BaseAgent.STRICT_REFLECTION_PROMPT;

      const reflectionMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `TASK: ${taskDescription}\n\nOUTPUT TO REVIEW:\n${currentOutput}` },
      ];

      try {
        const reflectionCompletion = await this.callLLM(reflectionMessages, undefined, {
          maxTokens: options?.maxTokens ?? 512,
          temperature: 0.1,
        });

        const reflectionContent = reflectionCompletion.choices[0]?.message?.content ?? '';
        lastReflection = reflectionContent;

        let reflection: { hasIssues?: boolean; issues?: string[]; severity?: string; suggestion?: string };
        try {
          reflection = this.parseJsonResponse(reflectionContent);
        } catch {
          // If we can't parse reflection, trust the current output
          return { corrected: currentOutput, wasChanged, reflection: lastReflection };
        }

        // Gate 1: No issues at all
        if (!reflection.hasIssues || reflection.severity === 'none') {
          this.logger.debug({ role: this.role, pass }, 'Self-reflection: output passed quality check');
          return { corrected: currentOutput, wasChanged, reflection: lastReflection };
        }

        // Gate 2: Lenient mode accepts "minor" severity without correction
        if (mode === 'lenient' && reflection.severity === 'minor') {
          this.logger.debug(
            { role: this.role, pass, severity: 'minor' },
            'Self-reflection: minor issues accepted (lenient mode)',
          );
          return { corrected: currentOutput, wasChanged, reflection: lastReflection };
        }

        // Issues found that warrant correction
        this.logger.info(
          { role: this.role, severity: reflection.severity, issueCount: reflection.issues?.length, pass },
          'Self-reflection: issues found, requesting correction',
        );

        const correctionMessages: OpenAI.ChatCompletionMessageParam[] = [
          {
            role: 'system',
            content: `You are the ${this.role} agent. Your previous output had issues. Fix them and produce a corrected version.\nMaintain the same JSON format. Only fix the identified issues — don't change things that were correct.`,
          },
          {
            role: 'user',
            content: `ORIGINAL TASK: ${taskDescription}\n\nYOUR PREVIOUS OUTPUT:\n${currentOutput}\n\nISSUES FOUND:\n${(reflection.issues ?? []).map((i: string, idx: number) => `${idx + 1}. ${i}`).join('\n')}\n\nSUGGESTION: ${reflection.suggestion ?? 'Fix the issues above'}\n\nProduce a corrected output in the same format.`,
          },
        ];

        const correctionCompletion = await this.callLLM(correctionMessages, undefined, {
          maxTokens: options?.maxTokens ?? 4096,
          temperature: 0.15,
        });

        currentOutput = correctionCompletion.choices[0]?.message?.content ?? currentOutput;
        wasChanged = true;

        // Continue to next pass for re-reflection on the corrected output
      } catch (err) {
        this.logger.warn({ err, pass }, 'Self-reflection failed, using current output');
        return { corrected: currentOutput, wasChanged, reflection: lastReflection || 'Reflection failed' };
      }
    }

    // maxReflectionPasses exhausted — accept whatever we have
    this.logger.info(
      { role: this.role, maxPasses },
      'Self-reflection: max passes reached, accepting current output',
    );
    return { corrected: currentOutput, wasChanged, reflection: lastReflection };
  }

  /**
   * Analyze an image using the configured OpenAI vision-capable LLM.
   * Accepts base64-encoded image data and a text prompt.
   * Returns the LLM's text analysis of the image.
   */
  protected async analyzeImage(
    imageBase64: string,
    prompt: string,
    options?: { detail?: 'low' | 'high' | 'auto'; mimeType?: string },
  ): Promise<string> {
    const mimeType = options?.mimeType ?? 'image/png';
    const detail = options?.detail ?? 'auto';

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'image_url' as const,
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail,
            },
          },
          {
            type: 'text' as const,
            text: prompt,
          },
        ],
      },
    ];

    try {
      const completion = await this.callLLM(messages);
      return completion.choices[0]?.message?.content ?? 'Unable to analyze image.';
    } catch (err) {
      this.logger.warn({ err }, 'Vision analysis failed');
      return `Vision analysis failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * Persist a learning to tenant memory so future runs benefit.
   *
   * Call this when an agent discovers something useful:
   * - A pattern that worked well
   * - A common error to avoid
   * - User preference inferred from approval decisions
   */
  protected async persistLearning(
    context: AgentContext,
    key: string,
    learning: { type: 'KNOWLEDGE' | 'POLICY' | 'WORKFLOW'; value: unknown; source: string },
  ): Promise<void> {
    try {
      const { toolRegistry } = await import('@jak-swarm/tools');
      if (toolRegistry.has('memory_store')) {
        await toolRegistry.execute(
          'memory_store',
          {
            key: `${this.role}:${key}`,
            value: learning.value,
            type: learning.type,
            source: learning.source,
          },
          {
            tenantId: context.tenantId ?? '',
            userId: context.userId ?? '',
            workflowId: context.workflowId ?? '',
            runId: context.runId,
          },
        );
        this.logger.debug({ key, type: learning.type }, 'Persisted learning to memory');
      }
    } catch {
      // Non-critical — don't fail the task for a memory write error
    }
  }

  /**
   * Recall previous learnings from tenant memory to inform current task.
   */
  protected async recallLearnings(
    context: AgentContext,
    queryKeys: string[],
  ): Promise<Record<string, unknown>> {
    const memories: Record<string, unknown> = {};
    try {
      const { toolRegistry } = await import('@jak-swarm/tools');
      if (toolRegistry.has('memory_retrieve')) {
        for (const key of queryKeys) {
          const result = await toolRegistry.execute(
            'memory_retrieve',
            { key: `${this.role}:${key}` },
            {
              tenantId: context.tenantId ?? '',
              userId: context.userId ?? '',
              workflowId: context.workflowId ?? '',
              runId: context.runId,
            },
          );
          if (result.success && result.data) {
            memories[key] = result.data;
          }
        }
      }
    } catch {
      // Non-critical
    }
    return memories;
  }

  protected recordTrace(
    context: AgentContext,
    input: unknown,
    output: unknown,
    toolCalls: ToolCall[],
    startedAt: Date,
    tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number },
    costUsd?: number,
  ): AgentTrace {
    const completedAt = new Date();
    const trace: AgentTrace = {
      traceId: context.traceId,
      runId: context.runId,
      agentRole: this.role,
      stepIndex: context.getTraces().length,
      input,
      output,
      toolCalls,
      handoffs: [],
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      tokenUsage,
      costUsd,
    };
    context.addTrace(trace);
    return trace;
  }

  /**
   * Parse a JSON response from an LLM tolerantly.
   *
   * LLMs sometimes return the JSON we asked for, and sometimes return prose
   * with a JSON blob buried inside ("Looking at the transcript, here's the
   * result: { ... }"). Agents crashing on `Unexpected token 'L'` is an
   * avoidable class of bug — the raw strict parser was the fragile path.
   *
   * Strategy, in order:
   *   1. Fast path — strip markdown fences, try `JSON.parse`.
   *   2. Extract the first balanced `{...}` or `[...]` from the content
   *      (handles LLM prefaces + trailing commentary).
   *   3. Give up with an error that includes a truncated snippet of what
   *      was actually returned, so agent logs are actionable.
   *
   * Never returns `undefined` implicitly — either returns the parsed value
   * or throws a clear Error. Callers wrap this in try/catch and emit their
   * own "Manual review required" fallback.
   */
  protected parseJsonResponse<T>(content: string): T {
    const text = content ?? '';

    // Fast path: fenced or bare JSON.
    const fenceStripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    try {
      return JSON.parse(fenceStripped) as T;
    } catch {
      // fall through to extraction
    }

    // Extraction path: find the first balanced { ... } or [ ... ] blob in
    // the text, honoring string escapes so quoted braces don't throw it off.
    const extracted = extractFirstJsonBlob(text);
    if (extracted !== null) {
      try {
        return JSON.parse(extracted) as T;
      } catch {
        // Unbalanced brace count can still produce invalid JSON (e.g. the
        // LLM wrote `{"a": 1,}` or truncated mid-object). Fall through.
      }
    }

    const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    throw new Error(
      `parseJsonResponse: no valid JSON in LLM output (length=${text.length}). Preview: ${preview}`,
    );
  }

  protected generateId(prefix?: string): string {
    return generateId(prefix);
  }
}
