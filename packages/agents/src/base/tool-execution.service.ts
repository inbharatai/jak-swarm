import OpenAI from 'openai';
import type { AgentRole, ToolCall, ToolExecutionContext } from '@jak-swarm/shared';
import { calculateCost } from '@jak-swarm/shared';
import type { Logger } from '@jak-swarm/shared';
import type { AgentContext } from './agent-context.js';
import type { LLMCallService } from './llm-call.service.js';
import type { PromptBuilder } from './prompt-builder.service.js';
import type { LLMRuntime } from '../runtime/index.js';
import type { ToolLoopResult } from './base-agent.js';

/** Loop detection: fingerprint → count */
type ToolCallFingerprints = Map<string, number>;

const LOOP_DETECTION_THRESHOLD = 3;

export class ToolExecutionService {
  constructor(
    private readonly llmCallService: LLMCallService,
    private readonly promptBuilder: PromptBuilder,
    private readonly logger: Logger,
    private readonly role: AgentRole,
    private readonly runtimeGetter: () => LLMRuntime | undefined,
  ) {}

  /**
   * Multi-turn tool execution loop.
   *
   * 1. Sends messages + tools to the LLM
   * 2. If the LLM returns tool_calls, executes each via ToolRegistry
   * 3. Appends tool results as `role: 'tool'` messages
   * 4. Calls the LLM again with the extended conversation
   * 5. Repeats until the LLM responds with text (no more tool_calls) or maxIterations
   *
   * Returns the final text content and all tool call records for tracing.
   */
  async executeWithTools(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[],
    context: AgentContext,
    options?: { maxTokens?: number; temperature?: number; maxIterations?: number },
  ): Promise<ToolLoopResult> {
    const maxIterations = options?.maxIterations ?? 10;
    const allToolCalls: ToolCall[] = [];
    const totalTokens = { prompt: 0, completion: 0, total: 0 };
    let totalCostUsd = 0;
    // Migration 16 — inject approved CompanyProfile into the system prompt
    // so every tool-using agent grounds in the user's company context.
    // Best-effort: failure or absence of provider returns messages unchanged.
    // The company_context_loaded lifecycle event is emitted at the workflow
    // level (swarm-execution.persistIntentAndContext); agent-level emit
    // is intentionally omitted to avoid double-counting.
    const grounded = await this.promptBuilder.injectCompanyContext(messages, context);
    // Item A (OpenClaw-inspired Phase 1) — inject bundled skills BEFORE the
    // tool loop starts so the system prompt the LLM sees is the same on
    // every iteration. Skills fire only when at least one declared tool
    // overlaps with the pack's `allowed-tools`, so non-matching agents
    // pay no token overhead.
    const declaredToolNamesForSkills = new Set(tools.map((t) => t.function.name));
    const enriched = await this.promptBuilder.injectBundledSkills(grounded.messages, declaredToolNamesForSkills);
    const conversation = [...enriched];
    const toolCallFingerprints: ToolCallFingerprints = new Map();

    // P0-D fix — scan user-role messages for prompt injection BEFORE the
    // first LLM call. Catches the documented attack patterns
    // (ignore-previous-instructions, role-override, fake-system-message,
    // chat-template-injection, prompt-extraction, data-exfiltration,
    // DAN/jailbreak). High-confidence HIGH-risk hits abort the run with
    // a structured error; low-risk hits are logged but allowed through
    // so legitimate requests like "ignore the failing test for now" are
    // not blocked. Off-switch via JAK_INJECTION_GUARD_DISABLED=1 for
    // operators who need raw passthrough during incident debugging.
    // JAK Shield — defensive-only boundary. Detects offensive-cyber
    // requests (malware / exploits / credential-theft / unauthorized
    // scanning / phishing) BEFORE the LLM sees them. Defensive
    // requests (audit my repo, find vulnerable deps, harden auth)
    // are explicitly NOT blocked — defensive markers down-weight the
    // confidence score. See
    //   packages/security/src/guardrails/offensive-cyber-detector.ts
    // Off-switch: JAK_SHIELD_OFFENSIVE_GUARD_DISABLED=1
    const offensiveGuardEnabled = process.env['JAK_SHIELD_OFFENSIVE_GUARD_DISABLED'] !== '1';
    const injectionGuardEnabled = process.env['JAK_INJECTION_GUARD_DISABLED'] !== '1';
    if (offensiveGuardEnabled || injectionGuardEnabled) {
      const { getShieldGateway } = await import('@jak-swarm/security');
      const shieldGateway = getShieldGateway();
      for (const msg of conversation) {
        if (msg.role !== 'user' || typeof msg.content !== 'string') continue;
        const scan = await shieldGateway.scanInput(msg.content, {
          tenantId: context.tenantId,
          userId: context.userId,
          workflowId: context.workflowId,
          runId: context.runId,
          source: 'agent_user_message',
        });

        const offensive = scan.offensiveCyber;
        if (offensiveGuardEnabled && offensive.detected && offensive.confidence >= 0.7) {
          throw new Error(
            `Input blocked by JAK Shield: this looks like a request to ${offensive.reason} ` +
            `(category: ${offensive.category}). JAK Shield is built for defensive ` +
            `security and safe automation; offensive cyber work is out of scope. ` +
            `If this is a legitimate defensive task, rephrase to make the scope ` +
            `explicit (e.g. "audit my repo for vulnerable dependencies").`,
          );
        }

        const injection = scan.injection;
        if (
          injectionGuardEnabled &&
          injection.detected &&
          injection.risk === 'HIGH' &&
          injection.confidence >= 0.7
        ) {
          throw new Error(
            `Input blocked for safety: prompt-injection patterns detected ` +
            `(${injection.patterns.slice(0, 3).join('; ')}). If this was a ` +
            `legitimate request, rephrase without instruction-override ` +
            `language.`,
          );
        }
      }
    }

    // Sprint 2.4 / Item G + P0-B fix — PII auto-redaction in LLM prompts.
    // One redactor per executeWithTools call. Disabled via env when
    // operators want raw passthrough for debugging.
    // The redactor lives on the LLM boundary: messages are redacted just
    // before they cross to the model, the assistant response is restored
    // before tool execution. Tools see ORIGINAL values; the LLM sees
    // PLACEHOLDER values. Originals are NOT preserved into the persisted
    // trace — `WorkflowService.saveTrace` runs `redactJsonForPersistence`
    // on every JSON column at the DB-write boundary so raw PII never
    // reaches the AgentTrace table even if restoration ran upstream.
    const redactor = process.env['JAK_PII_REDACTION_DISABLED'] === '1'
      ? null
      : new (await import('@jak-swarm/security')).RuntimePIIRedactor();

    // Lazy-import tool registries to avoid circular dep at module load time
    const { getTenantToolRegistry } = await import('@jak-swarm/tools');

    const declaredToolNames = new Set(tools.map((t) => t.function.name));
    const tenantToolRegistry = getTenantToolRegistry(
      context.tenantId ?? '',
      context.connectedProviders,
      {
        browserAutomationEnabled: context.browserAutomationEnabled,
        restrictedCategories: context.restrictedCategories,
        disabledToolNames: context.disabledToolNames,
        // Item C (OpenClaw-inspired Phase 1) — when a StandingOrder
        // restricts the run to a specific tool whitelist, the registry
        // refuses anything not in the list. Empty array = no whitelist.
        allowedToolNames: context.allowedToolNames,
      },
    );

    const toolExecContext: ToolExecutionContext = {
      tenantId: context.tenantId ?? '',
      userId: context.userId ?? '',
      workflowId: context.workflowId ?? '',
      runId: context.runId,
      approvalId: context.approvalId,
      idempotencyKey: context.idempotencyKey,
      allowedDomains: context.allowedDomains,
      subscriptionTier: context.subscriptionTier,
    };

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Sprint 2.4 / Item G — redact PII in messages JUST before sending
      // to LLM. We pass the redacted view to callLLM, but conversation[]
      // (the running array) keeps the originals so the trace store + the
      // worker-step persistence sees real values.
      const llmInput = redactor ? redactor.redactMessages(conversation) : conversation;
      const completion = await this.llmCallService.callLLM(
        llmInput,
        tools.length > 0 ? tools : undefined,
        { maxTokens: options?.maxTokens, temperature: options?.temperature },
      );

      // Accumulate token usage and cost
      if (completion.usage) {
        const iterPrompt = completion.usage.prompt_tokens ?? 0;
        const iterCompletion = completion.usage.completion_tokens ?? 0;
        totalTokens.prompt += iterPrompt;
        totalTokens.completion += iterCompletion;
        totalTokens.total += completion.usage.total_tokens ?? 0;

        const iterModel = completion.model || this.llmCallService.providerName || 'gpt-5.4';
        // Sprint 2.2 / Item I — read OpenAI prompt-cache + reasoning
        // token breakdown that OpenAIRuntime preserves on the completion
        // via the JakAdaptedChatCompletion extension fields. LegacyRuntime
        // never sets these so iterCached/iterReasoning remain 0 there.
        const adapted = completion as unknown as {
          _jakCachedInputTokens?: number;
          _jakReasoningTokens?: number;
        };
        const iterCached = typeof adapted._jakCachedInputTokens === 'number'
          ? adapted._jakCachedInputTokens
          : 0;
        const iterReasoning = typeof adapted._jakReasoningTokens === 'number'
          ? adapted._jakReasoningTokens
          : 0;
        const iterCost = calculateCost(iterModel, iterPrompt, iterCompletion, iterCached);
        totalCostUsd += iterCost;

        // Stage 2.3 + hardening pass: complete cost telemetry — runtime
        // name, model, token breakdown, run + step ids. The cockpit can
        // reconstruct per-step spend after the fact.
        const runtimeName = this.runtimeGetter()?.name ?? 'legacy';
        // Sprint 2.4 / Item G — surface PII redaction stats on the cost
        // event when redactor caught something this iteration. Only emit
        // the field when there was redaction; absent field signals
        // "nothing was found" (which is also valid info, but we don't
        // bloat events with empty objects).
        const piiStats = redactor?.getStats();
        const hasPii = piiStats && piiStats.totalMatches > 0;

        context.emitActivity({
          type: 'cost_updated',
          agentRole: this.role,
          runtime: runtimeName,
          model: iterModel,
          promptTokens: iterPrompt,
          completionTokens: iterCompletion,
          totalTokens: iterPrompt + iterCompletion,
          ...(iterCached > 0 ? { cachedReadTokens: iterCached } : {}),
          ...(iterReasoning > 0 ? { reasoningTokens: iterReasoning } : {}),
          ...(hasPii && piiStats
            ? {
                piiRedacted: {
                  byType: piiStats.byType as Record<string, number>,
                  totalMatches: piiStats.totalMatches,
                  uniquePlaceholders: piiStats.uniquePlaceholders,
                },
              }
            : {}),
          costUsd: iterCost,
          runId: context.runId,
          // The "step id" inside a workflow is the agent role for now;
          // when WorkflowRuntime adds a per-task step id we'll use that.
          stepId: this.role,
          timestamp: new Date().toISOString(),
        });
      }

      const choice = completion.choices[0];
      if (!choice) break;

      // Sprint 2.4 / Item G — restore PII placeholders in the assistant
      // response BEFORE we use it (tool execution, trace persistence, or
      // final return). Tools must operate on real values; the trace must
      // show real values. Only the LLM ever saw placeholders.
      let assistantMsg = choice.message;
      if (redactor && redactor.hasRedactions()) {
        const restoredContent = typeof assistantMsg.content === 'string'
          ? redactor.restoreInResponse(assistantMsg.content)
          : assistantMsg.content;
        const restoredToolCalls = assistantMsg.tool_calls
          ? redactor.restoreInToolCalls(assistantMsg.tool_calls)
          : undefined;
        assistantMsg = {
          ...assistantMsg,
          content: restoredContent,
          ...(restoredToolCalls ? { tool_calls: restoredToolCalls } : {}),
        };
      }

      // If the LLM returned content without tool calls, we're done
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        return {
          content: assistantMsg.content ?? '',
          toolCalls: allToolCalls,
          totalTokens,
          totalCostUsd,
        };
      }

      // LLM wants to call tools — add assistant message to conversation
      conversation.push(assistantMsg);

      // ── Loop Detection (DeerFlow LoopDetectionMiddleware pattern) ──────
      // Track tool-call fingerprints to detect infinite loops.
      // If the same tool+args is called 3+ times, inject a hard-stop message.
      let loopDetected = false;
      for (const tc of assistantMsg.tool_calls) {
        const fp = `${tc.function.name}:${tc.function.arguments}`;
        const count = (toolCallFingerprints.get(fp) ?? 0) + 1;
        toolCallFingerprints.set(fp, count);
        if (count >= LOOP_DETECTION_THRESHOLD) {
          loopDetected = true;
        }
      }

      if (loopDetected) {
        this.logger.warn(
          { iteration, fingerprints: toolCallFingerprints.size },
          'Loop detected — same tool call repeated 3+ times, forcing stop',
        );
        // Clear tool_calls and force a text response
        conversation.push({
          role: 'system' as const,
          content: 'STOP: You are repeating the same tool call in a loop. This wastes resources. Summarize what you have so far and provide your best answer with the information available. Do NOT call any more tools.',
        });
        // Still need to provide tool results for the pending calls
        for (const tc of assistantMsg.tool_calls) {
          conversation.push({
            role: 'tool' as const,
            tool_call_id: tc.id,
            content: JSON.stringify({ _loopDetected: true, message: 'Tool call skipped — loop detected. Provide your best answer now.' }),
          });
        }
        // Do one more LLM call to get the summary, then exit
        try {
          const finalCompletion = await this.llmCallService.callLLM(conversation, undefined, { maxTokens: options?.maxTokens, temperature: options?.temperature });
          const finalContent = finalCompletion.choices[0]?.message?.content ?? 'Agent stopped due to tool call loop.';
          return { content: finalContent, toolCalls: allToolCalls, totalTokens, totalCostUsd };
        } catch {
          return { content: 'Agent stopped due to tool call loop.', toolCalls: allToolCalls, totalTokens, totalCostUsd };
        }
      }

      // Execute each tool call with error normalization
      for (const tc of assistantMsg.tool_calls) {
        const toolStartedAt = new Date();
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          parsedArgs = { _raw: tc.function.arguments };
        }

        const toolName = tc.function.name;
        let resultStr: string;
        let toolError: string | undefined;
        // Hardening pass: capture the registry's honest outcome so the
        // tool_completed event carries it through to the cockpit.
        let toolOutcome: import('@jak-swarm/shared').ToolOutcome | undefined;

        // Stage 2.2: emit tool_called BEFORE execution so the client
        // cockpit renders a live "running" row. inputSummary is capped
        // at 500 chars to keep SSE payloads small.
        const inputSummary = JSON.stringify(parsedArgs).slice(0, 500);
        context.emitActivity({
          type: 'tool_called',
          agentRole: this.role,
          toolName,
          inputSummary,
          timestamp: toolStartedAt.toISOString(),
        });

        try {
          if (!declaredToolNames.has(toolName)) {
            resultStr = JSON.stringify({
              error: `Tool '${toolName}' is not allowed for this agent run. Allowed tools: ${[...declaredToolNames].join(', ')}`,
              _toolNotAllowed: true,
            });
            toolError = `Tool '${toolName}' is outside agent allowlist`;
          } else if (tenantToolRegistry.has(toolName)) {
            // Execute through tenant-scoped registry with provider/category/browser gates
            const result = await tenantToolRegistry.execute(toolName, parsedArgs, toolExecContext);
            // Capture the honest tool outcome — registry sets it via inferOutcome.
            // Used below to stamp the tool_completed SSE event so the cockpit
            // can render a real/draft/mock/not_configured badge instead of
            // guessing from substring matches.
            toolOutcome = result.outcome;

            // Phase 4 follow-up — Centralized ApprovalPolicy gate. The
            // tool registry returns outcome:'approval_required' when a
            // sensitive tool was called without an approvalId in
            // context. The executor was NOT invoked — we surface a
            // structured stop signal to the LLM AND emit a
            // tool_approval_required activity event so the worker-node
            // / API layer can create an ApprovalRequest row + pause
            // the workflow. This closes the "registry returns the
            // outcome but nothing pauses" gap.
            if (!result.success && result.outcome === 'approval_required') {
              const data = (result.data ?? {}) as Record<string, unknown>;
              const category = (data['category'] as string | undefined) ?? 'WRITE';
              const reason = result.error ?? 'Approval required.';
              context.emitActivity({
                type: 'tool_approval_required',
                agentRole: this.role,
                toolName,
                category,
                reason,
                inputSummary,
                timestamp: toolStartedAt.toISOString(),
              });
              resultStr = JSON.stringify({
                _approvalRequired: true,
                toolName,
                category,
                reason,
                message:
                  `Tool '${toolName}' requires user approval before it can run. ` +
                  `An approval request has been created — wait for the user to decide. ` +
                  `Do not retry this tool without an approvalId.`,
              });
              // Mark this iteration as paused-by-approval. The agent
              // sees the result and should NOT keep calling the same
              // tool — the loop-detection guard will also catch a
              // pathological retry.
              toolError = `approval_required: ${reason}`;
              // Skip the regular success/failure branches below by
              // jumping past the response-handling block.
            } else if (result.success) {
              const data = result.data as Record<string, unknown> | string | undefined;
              // Detect mock/demo data — inform the agent honestly
              if (data && typeof data === 'object' && (data as Record<string, unknown>)._mock) {
                const notice = (data as Record<string, unknown>)._notice ?? 'This is demo data — real integration not connected.';
                resultStr = JSON.stringify({ ...data as Record<string, unknown>, _warning: notice });
              } else {
                resultStr = typeof data === 'string'
                  ? data
                  : JSON.stringify(data ?? { success: true });
              }
            } else {
              resultStr = JSON.stringify({ error: result.error, _toolFailed: true, message: `Tool '${toolName}' failed: ${result.error}. Try a different approach or use an alternative tool.` });
              toolError = result.error;
            }
          } else {
            // Tool not available for tenant policy/integrations — return helpful error
            resultStr = JSON.stringify({
              error: `Tool '${toolName}' is not available for this tenant or current policy constraints. Allowed tools: ${[...declaredToolNames].join(', ')}.`,
              _toolNotFound: true,
            });
            toolError = `Tool '${toolName}' not available for tenant`;
          }
        } catch (toolExecErr) {
          // ── Tool Error Normalization (DeerFlow ToolErrorHandlingMiddleware) ──
          // Convert exceptions to recoverable error messages instead of crashing.
          // The agent can decide to retry, use an alternative tool, or give up.
          const errMsg = toolExecErr instanceof Error ? toolExecErr.message : String(toolExecErr);
          resultStr = JSON.stringify({
            error: errMsg,
            _toolCrashed: true,
            message: `Tool '${toolName}' threw an exception: ${errMsg}. Try a different approach or use an alternative tool.`,
          });
          toolError = errMsg;
          this.logger.warn({ toolName, error: errMsg }, 'Tool execution crashed — normalized to error message');
        }

        const toolCompletedAt = new Date();

        // Record for tracing
        allToolCalls.push({
          toolName,
          input: parsedArgs,
          output: toolError ? { error: toolError } : resultStr,
          startedAt: toolStartedAt,
          completedAt: toolCompletedAt,
          durationMs: toolCompletedAt.getTime() - toolStartedAt.getTime(),
          error: toolError,
        });

        // Stage 2.2: emit tool_completed AFTER execution so the cockpit
        // flips the row from running → success/failure. outputSummary
        // is capped at 500 chars; if the tool returned an `_mock` /
        // `_warning` / `_notice` flag we surface it honestly so the UI
        // can render the "draft only" / "mock data" state correctly.
        context.emitActivity({
          type: 'tool_completed',
          agentRole: this.role,
          toolName,
          success: !toolError,
          // Honest outcome from the tool registry — 'real_success',
          // 'draft_created', 'mock_provider', 'not_configured', etc.
          // The cockpit reads this directly instead of guessing from
          // substrings in outputSummary. Falls back to 'failed' when
          // the tool errored without classification.
          outcome: toolOutcome ?? (toolError ? 'failed' : 'real_success'),
          durationMs: toolCompletedAt.getTime() - toolStartedAt.getTime(),
          outputSummary: resultStr.slice(0, 500),
          ...(toolError ? { error: toolError } : {}),
          timestamp: toolCompletedAt.toISOString(),
        });

        // Stage 3.2 cost fix: truncate large tool outputs before
        // re-injection into the next LLM call. Tools like web_search +
        // web_fetch commonly return 20-100KB of content, which gets
        // resent in full on EVERY subsequent tool-loop iteration.
        // Truncating at 8KB (~2000 tokens) cuts per-iteration costs by
        // 40-80% on research-heavy workflows while preserving enough
        // context for the LLM to continue. Override via
        // JAK_TOOL_OUTPUT_MAX_CHARS if a caller genuinely needs full
        // context (e.g. VibeCoder reading a specific file).
        const maxChars = Number(process.env['JAK_TOOL_OUTPUT_MAX_CHARS'] ?? '8000');
        const truncatedResultStr =
          resultStr.length > maxChars
            ? resultStr.slice(0, maxChars) +
              `\n\n[… tool output truncated at ${maxChars} chars. Full output in trace; ${resultStr.length} chars original.]`
            : resultStr;

        // Append tool result to conversation so LLM can use it
        conversation.push({
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: truncatedResultStr,
        });
      }

      this.logger.debug(
        { iteration, toolCallCount: assistantMsg.tool_calls.length },
        'Tool loop iteration complete, calling LLM again',
      );
    }

    // Max iterations reached — return whatever content we have
    this.logger.warn(
      { maxIterations },
      'executeWithTools reached max iterations without final response',
    );

    return {
      content: 'Agent reached maximum tool call iterations. Partial results may be available in tool call outputs.',
      toolCalls: allToolCalls,
      totalTokens,
      totalCostUsd,
    };
  }
}
