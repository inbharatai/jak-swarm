/**
 * Item 10 — tool-execution.service throws ToolApprovalRequiredError when
 * the tenant registry returns outcome:'approval_required'.
 *
 * This is the ORIGIN of the structured stop signal that the worker-node
 * test (worker-node-approval-gate.test.ts) proves is caught and turned
 * into AWAITING_APPROVAL. Together the two files close the loop:
 *
 *   registry → outcome:approval_required  (existing base-agent-approval-glue test)
 *   → tool-execution.service throws        (THIS file)
 *   → worker-node catches → AWAITING_APPROVAL (worker-node-approval-gate test)
 *
 * Stubs: LLMCallService (returns one completion with a tool_call for a
 * sensitive tool), PromptBuilder (passthrough), silent logger, no runtime.
 * The real ToolRegistry is used with a registered sensitive UTILITY tool so
 * the gate fires through the real TenantToolRegistry path. The PII redactor
 * + JAK Shield guards are disabled via env so the test exercises only the
 * approval-gate branch.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type OpenAI from 'openai';
import {
  ToolRegistry,
} from '../../../packages/tools/src/index';
import {
  AgentRole,
  ToolCategory,
  ToolRiskClass,
  type ToolMetadata,
} from '@jak-swarm/shared';
import { AgentContext } from '../../../packages/agents/src/base/agent-context.js';
import { ToolApprovalRequiredError } from '../../../packages/agents/src/base/tool-approval-error.js';
import type { ToolExecutionService } from '../../../packages/agents/src/base/tool-execution.service.js';

const TOOL_NAME = `approval_gate_test_tool_${Math.random().toString(36).slice(2, 8)}`;
const TENANT = 'tnt_approval_gate_test';

function sensitiveToolMeta(): ToolMetadata {
  return {
    name: TOOL_NAME,
    description: 'sensitive test tool that requires approval',
    category: ToolCategory.UTILITY,
    riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
    requiresApproval: true,
    inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
    outputSchema: { type: 'object' },
    version: '1.0.0',
    sideEffectLevel: 'external',
  };
}

function toolCallCompletion(toolName: string, args: Record<string, unknown>): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'chatcmpl-test-1',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'stub-model',
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        logprobs: null,
        message: {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: 'call_test_1',
              type: 'function',
              function: {
                name: toolName,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      } as unknown as OpenAI.Chat.Completions.ChatCompletion.Choice,
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

/** Silent structural logger — Proxy returns no-op fns for any method. */
function silentLogger(): unknown {
  return new Proxy(
    { level: 'silent' },
    {
      get(_t, prop) {
        if (prop === 'level') return 'silent';
        return () => undefined;
      },
    },
  );
}

describe('tool-execution.service — approval gate throws (Item 10)', () => {
  let originalOffensive: string | undefined;
  let originalInjection: string | undefined;
  let originalPii: string | undefined;

  beforeEach(() => {
    originalOffensive = process.env['JAK_SHIELD_OFFENSIVE_GUARD_DISABLED'];
    originalInjection = process.env['JAK_INJECTION_GUARD_DISABLED'];
    originalPii = process.env['JAK_PII_REDACTION_DISABLED'];
    process.env['JAK_SHIELD_OFFENSIVE_GUARD_DISABLED'] = '1';
    process.env['JAK_INJECTION_GUARD_DISABLED'] = '1';
    process.env['JAK_PII_REDACTION_DISABLED'] = '1';
    // Register a sensitive tool that the tenant registry will include
    // (UTILITY category — no connected-provider requirement).
    ToolRegistry.getInstance().register(sensitiveToolMeta(), async () => ({ ok: true }), { allowOverride: true });
  });

  afterAll(() => {
    if (originalOffensive === undefined) delete process.env['JAK_SHIELD_OFFENSIVE_GUARD_DISABLED'];
    else process.env['JAK_SHIELD_OFFENSIVE_GUARD_DISABLED'] = originalOffensive;
    if (originalInjection === undefined) delete process.env['JAK_INJECTION_GUARD_DISABLED'];
    else process.env['JAK_INJECTION_GUARD_DISABLED'] = originalInjection;
    if (originalPii === undefined) delete process.env['JAK_PII_REDACTION_DISABLED'];
    else process.env['JAK_PII_REDACTION_DISABLED'] = originalPii;
  });

  it('throws ToolApprovalRequiredError when the registry returns outcome:approval_required', async () => {
    const events: unknown[] = [];
    const context = new AgentContext({
      tenantId: TENANT,
      userId: 'usr_test',
      workflowId: 'wf_test',
      onActivity: (e) => events.push(e),
    });

    // Minimal structural stubs — the service only calls callLLM + reads
    // providerName, and calls injectCompanyContext / injectBundledSkills.
    const stubLlmCallService = {
      providerName: 'stub',
      callLLM: async () => toolCallCompletion(TOOL_NAME, { message: 'fire the gate' }),
    };
    const stubPromptBuilder = {
      injectCompanyContext: async (msgs: unknown) => ({ messages: msgs }),
      injectBundledSkills: async (msgs: unknown) => msgs,
    };

    const { ToolExecutionService: Svc } = await import(
      '../../../packages/agents/src/base/tool-execution.service.js'
    );
    const service = new Svc(
      stubLlmCallService as unknown as ConstructorParameters<typeof ToolExecutionService>[0],
      stubPromptBuilder as unknown as ConstructorParameters<typeof ToolExecutionService>[1],
      silentLogger() as ConstructorParameters<typeof ToolExecutionService>[2],
      AgentRole.WORKER_RESEARCH,
      () => undefined,
    );

    const tool: OpenAI.ChatCompletionTool = {
      type: 'function',
      function: {
        name: TOOL_NAME,
        description: 'sensitive test tool',
        parameters: { type: 'object', properties: { message: { type: 'string' } } },
      },
    };

    await expect(
      service.executeWithTools(
        [{ role: 'user', content: 'Please run the sensitive tool.' }],
        [tool],
        context,
        { maxIterations: 3 },
      ),
    ).rejects.toBeInstanceOf(ToolApprovalRequiredError);

    // The structured stop signal was preceded by the canonical
    // tool_approval_required + tool_completed(outcome:approval_required)
    // activity events so the cockpit inbox + trace surface the gate.
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('tool_called');
    expect(types).toContain('tool_approval_required');
    const completed = events.find(
      (e) => (e as { type: string }).type === 'tool_completed',
    ) as Record<string, unknown> | undefined;
    expect(completed).toBeDefined();
    expect(completed?.['success']).toBe(false);
    expect(completed?.['outcome']).toBe('approval_required');
  });

  it('the thrown error carries the tool name + category + reason from the registry result', async () => {
    const events: unknown[] = [];
    const context = new AgentContext({
      tenantId: TENANT,
      userId: 'usr_test',
      workflowId: 'wf_test_2',
      onActivity: (e) => events.push(e),
    });
    const stubLlmCallService = {
      providerName: 'stub',
      callLLM: async () => toolCallCompletion(TOOL_NAME, { message: 'fire again' }),
    };
    const stubPromptBuilder = {
      injectCompanyContext: async (msgs: unknown) => ({ messages: msgs }),
      injectBundledSkills: async (msgs: unknown) => msgs,
    };
    const { ToolExecutionService: Svc } = await import(
      '../../../packages/agents/src/base/tool-execution.service.js'
    );
    const service = new Svc(
      stubLlmCallService as unknown as ConstructorParameters<typeof ToolExecutionService>[0],
      stubPromptBuilder as unknown as ConstructorParameters<typeof ToolExecutionService>[1],
      silentLogger() as ConstructorParameters<typeof ToolExecutionService>[2],
      AgentRole.WORKER_RESEARCH,
      () => undefined,
    );
    const tool: OpenAI.ChatCompletionTool = {
      type: 'function',
      function: {
        name: TOOL_NAME,
        description: 'sensitive test tool',
        parameters: { type: 'object', properties: { message: { type: 'string' } } },
      },
    };

    let caught: ToolApprovalRequiredError | undefined;
    try {
      await service.executeWithTools(
        [{ role: 'user', content: 'run it' }],
        [tool],
        context,
        { maxIterations: 3 },
      );
    } catch (err) {
      caught = err as ToolApprovalRequiredError;
    }
    expect(caught).toBeDefined();
    expect(caught?.toolName).toBe(TOOL_NAME);
    expect(typeof caught?.category).toBe('string');
    expect(typeof caught?.reason).toBe('string');
    expect(caught?.inputSummary).toBeTruthy();
  });
});