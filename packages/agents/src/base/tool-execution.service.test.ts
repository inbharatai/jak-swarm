import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type OpenAI from 'openai';
import type { LLMCallService } from './llm-call.service.js';
import { PromptBuilder } from './prompt-builder.service.js';
import { ToolExecutionService } from './tool-execution.service.js';
import { AgentContext, type AgentActivityEvent } from './agent-context.js';
import { AgentRole, createLogger } from '@jak-swarm/shared';
import { clearTenantToolRegistries } from '@jak-swarm/tools';

/**
 * Behavior tests for ToolExecutionService's tenant-gating logic (Phase
 * 2.3 / 2.4 / 2.5):
 *   - the tool manifest offered to the LLM is filtered to what the tenant
 *     can actually run (Phase 2.3)
 *   - when tools are removed, the LLM is told up front, once (Phase 2.4)
 *   - when the LLM calls a tool that was declared by the agent but is
 *     blocked by tenant policy, the tool_completed event is stamped
 *     `outcome: 'disabled_by_policy'` — NOT a generic 'failed' (Phase 2.5)
 *
 * What is REAL here:
 *   - ToolExecutionService.executeWithTools runs unmodified — the filtering,
 *     the three-way gate, the outcome stamping, the SSE activity emits are
 *     all the production code path.
 *   - The tenant tool registry is the real TenantToolRegistry over the real
 *     global toolRegistry, so the gating decision (browser disabled,
 *     provider not connected, built-in allowed) is the real isAllowed()
 *     logic. compute_statistics is a real pure built-in executor (no
 *     network, no LLM) so its success path is exercised end-to-end.
 *
 * What is faked (a collaborator that cannot be instantiated in a unit test):
 *   - LLMCallService — there is no OpenAI key and a real call would be
 *     flaky. The fake returns canned ChatCompletion objects (tool_calls
 *     then text) and records the exact `tools` + `messages` arrays passed
 *     to each call so the test can assert the filtered manifest + the
 *     removed-tools notice.
 *   - PromptBuilder is real, constructed with null memory + null
 *     company-context providers so it returns messages unchanged (no DB).
 */
describe('ToolExecutionService tenant gating', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearTenantToolRegistries();
    // Isolate the gating logic from orthogonal shields/redactors that are
    // not under test here. These env knobs exist expressly for "raw
    // passthrough" in non-production contexts.
    process.env['JAK_PII_REDACTION_DISABLED'] = '1';
    process.env['JAK_INJECTION_GUARD_DISABLED'] = '1';
    process.env['JAK_SHIELD_OFFENSIVE_GUARD_DISABLED'] = '1';
    process.env['LOG_LEVEL'] = 'silent';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  /** Minimal ChatCompletion with one assistant message carrying tool_calls. */
  function makeToolCallCompletion(
    model: string,
    calls: Array<{ id: string; name: string; arguments: string }>,
  ): OpenAI.ChatCompletion {
    return {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 0,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: c.arguments },
            })),
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    } as unknown as OpenAI.ChatCompletion;
  }

  /** Minimal ChatCompletion with a plain text assistant response (ends the loop). */
  function makeTextCompletion(model: string, content: string): OpenAI.ChatCompletion {
    return {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 0,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    } as unknown as OpenAI.ChatCompletion;
  }

  /** A recording fake LLMCallService — returns canned completions in order. */
  function makeFakeLLM(completions: OpenAI.ChatCompletion[]) {
    const calls: Array<{ tools: OpenAI.ChatCompletionTool[] | undefined; messages: OpenAI.ChatCompletionMessageParam[] }> = [];
    let i = 0;
    const svc = {
      providerName: 'openai-test',
      async callLLM(
        messages: OpenAI.ChatCompletionMessageParam[],
        tools?: OpenAI.ChatCompletionTool[],
      ): Promise<OpenAI.ChatCompletion> {
        calls.push({ tools, messages: [...messages] });
        const c = completions[i] ?? completions[completions.length - 1]!;
        i++;
        return c;
      },
    };
    return { svc: svc as unknown as LLMCallService, calls };
  }

  /** Build a minimal OpenAI function-tool definition for the given name. */
  function toolDef(name: string): OpenAI.ChatCompletionTool {
    return {
      type: 'function',
      function: { name, description: `test tool ${name}`, parameters: { type: 'object', properties: {} } },
    };
  }

  function buildService(completions: OpenAI.ChatCompletion[]) {
    const role = AgentRole.WORKER_RESEARCH;
    const logger = createLogger('test');
    const promptBuilder = new PromptBuilder(role, () => null, () => null);
    const { svc, calls } = makeFakeLLM(completions);
    const runtimeGetter = (): undefined => undefined;
    const service = new ToolExecutionService(svc, promptBuilder, logger, role, runtimeGetter);
    return { service, calls };
  }

  function buildContext(
    tenantId: string,
    events: AgentActivityEvent[],
    options: { disabledToolNames?: string[] } = {},
  ) {
    return new AgentContext({
      tenantId,
      userId: 'user_test',
      workflowId: 'wf_test',
      runId: 'run_test',
      // No providers connected, browser automation off → browser_* tools are
      // tenant-blocked by category; built-in no-provider tools (e.g.
      // compute_statistics, web_search) remain available unless an explicit
      // admin disable is applied via disabledToolNames.
      connectedProviders: [],
      browserAutomationEnabled: false,
      disabledToolNames: options.disabledToolNames,
      onActivity: (e) => events.push(e),
    });
  }

  /** Pull the tool_completed events for a given tool name. */
  function completionsFor(events: AgentActivityEvent[], toolName: string) {
    return events.filter(
      (e): e is Extract<AgentActivityEvent, { type: 'tool_completed' }> =>
        e.type === 'tool_completed' && e.toolName === toolName,
    );
  }

  it('filters the manifest offered to the LLM down to tenant-available tools (Phase 2.3)', async () => {
    const { service, calls } = buildService([makeTextCompletion('gpt-4o-mini', 'done')]);
    const events: AgentActivityEvent[] = [];
    const ctx = buildContext('tenant-filter-manifest', events, { disabledToolNames: ['web_search'] });

    // Agent declares: one available built-in (compute_statistics), one
    // browser tool (blocked — browser category, browser disabled), one
    // built-in disabled by the tenant admin (web_search).
    const tools = [toolDef('compute_statistics'), toolDef('browser_navigate'), toolDef('web_search')];

    await service.executeWithTools(
      [{ role: 'user', content: 'Compute statistics on my dataset.' }],
      tools,
      ctx,
    );

    expect(calls.length).toBe(1);
    const offered = calls[0]!.tools?.map((t) => t.function.name) ?? [];
    // Only the available built-in survives the tenant filter.
    expect(offered).toEqual(['compute_statistics']);
    expect(offered).not.toContain('browser_navigate');
    expect(offered).not.toContain('web_search');
  });

  it('tells the LLM up front which tools were removed and which remain (Phase 2.4)', async () => {
    const { service, calls } = buildService([makeTextCompletion('gpt-4o-mini', 'done')]);
    const events: AgentActivityEvent[] = [];
    const ctx = buildContext('tenant-filter-notice', events, { disabledToolNames: ['web_search'] });

    const tools = [toolDef('compute_statistics'), toolDef('browser_navigate'), toolDef('web_search')];

    await service.executeWithTools(
      [{ role: 'user', content: 'Do some work.' }],
      tools,
      ctx,
    );

    const messages = calls[0]!.messages;
    const notice = messages.find(
      (m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('removed from your tool list'),
    );
    expect(notice).toBeDefined();
    const content = (notice as { content: string }).content;
    // Names the removed tools and the survivor. Does NOT hardcode a
    // web_fetch/browser_* example that could be false for this tenant.
    expect(content).toContain('browser_navigate');
    expect(content).toContain('web_search');
    expect(content).toContain('compute_statistics');
    expect(content).toMatch(/available to you/);
    // Only one such notice is pushed (not one per iteration / per tool).
    const noticeCount = messages.filter(
      (m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('removed from your tool list'),
    ).length;
    expect(noticeCount).toBe(1);
  });

  it('does not push a removed-tools notice when nothing was filtered', async () => {
    const { service, calls } = buildService([makeTextCompletion('gpt-4o-mini', 'done')]);
    const events: AgentActivityEvent[] = [];
    const ctx = buildContext('tenant-no-filter', events);

    const tools = [toolDef('compute_statistics')];
    await service.executeWithTools([{ role: 'user', content: 'Do some work.' }], tools, ctx);

    const notice = calls[0]!.messages.find(
      (m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('removed from your tool list'),
    );
    expect(notice).toBeUndefined();
  });

  it("stamps disabled_by_policy when the LLM calls a declared-but-tenant-blocked tool (Phase 2.5)", async () => {
    // Iter 1: LLM requests browser_navigate — a tool the agent declared but
    // the tenant gate removed (browser disabled). It is NOT in the offered
    // manifest; this simulates the model re-requesting a removed tool.
    // Iter 2: plain text, ends the loop.
    const { service } = buildService([
      makeToolCallCompletion('gpt-4o-mini', [
        { id: 'call_1', name: 'browser_navigate', arguments: '{"url":"https://example.com"}' },
      ]),
      makeTextCompletion('gpt-4o-mini', 'I cannot browse, so here is my answer from what I have.'),
    ]);
    const events: AgentActivityEvent[] = [];
    const ctx = buildContext('tenant-disabled-by-policy', events);

    const tools = [toolDef('compute_statistics'), toolDef('browser_navigate')];
    const result = await service.executeWithTools(
      [{ role: 'user', content: 'Inspect example.com in a browser.' }],
      tools,
      ctx,
    );

    const browserCompleted = completionsFor(events, 'browser_navigate');
    expect(browserCompleted.length).toBe(1);
    // The honest outcome: tenant policy blocked it. NOT a generic 'failed'.
    expect(browserCompleted[0]!.outcome).toBe('disabled_by_policy');
    expect(browserCompleted[0]!.success).toBe(false);
    expect(browserCompleted[0]!.outputSummary).toContain('_toolNotFound');
    // The loop terminated with text, not an exception.
    expect(result.content).toContain('cannot browse');
  });

  it('executes a genuinely available tool and stamps real_success', async () => {
    const { service } = buildService([
      makeToolCallCompletion('gpt-4o-mini', [
        { id: 'call_1', name: 'compute_statistics', arguments: '{"values":[1,2,3,4]}' },
      ]),
      makeTextCompletion('gpt-4o-mini', 'Mean is 2.5.'),
    ]);
    const events: AgentActivityEvent[] = [];
    const ctx = buildContext('tenant-available-tool', events);

    const tools = [toolDef('compute_statistics')];
    const result = await service.executeWithTools(
      [{ role: 'user', content: 'Compute statistics on [1,2,3,4].' }],
      tools,
      ctx,
    );

    const done = completionsFor(events, 'compute_statistics');
    expect(done.length).toBe(1);
    expect(done[0]!.success).toBe(true);
    expect(done[0]!.outcome).toBe('real_success');
    expect(result.content).toContain('2.5');
  });

  it("rejects a tool the agent never declared as _toolNotAllowed (NOT disabled_by_policy)", async () => {
    // Guards the three-way gate: a hallucinated tool name that was never
    // declared by this agent must hit the agent-allowlist branch
    // (_toolNotAllowed → outcome 'failed'), NOT the tenant-policy branch
    // (disabled_by_policy). If declaredToolNames were ever narrowed to the
    // tenant-available subset, this distinction would collapse and
    // tenant-blocked tools would be mislabeled 'failed'.
    const { service } = buildService([
      makeToolCallCompletion('gpt-4o-mini', [
        { id: 'call_1', name: 'totally_made_up_tool', arguments: '{}' },
      ]),
      makeTextCompletion('gpt-4o-mini', 'That tool does not exist; here is my answer.'),
    ]);
    const events: AgentActivityEvent[] = [];
    const ctx = buildContext('tenant-hallucinated', events);

    const tools = [toolDef('compute_statistics')];
    await service.executeWithTools([{ role: 'user', content: 'Do something.' }], tools, ctx);

    const done = completionsFor(events, 'totally_made_up_tool');
    expect(done.length).toBe(1);
    expect(done[0]!.success).toBe(false);
    expect(done[0]!.outcome).toBe('failed');
    expect(done[0]!.outputSummary).toContain('_toolNotAllowed');
    expect(done[0]!.outcome).not.toBe('disabled_by_policy');
  });
});