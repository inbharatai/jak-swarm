import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { PromptBuilder } from '../../../packages/agents/src/base/prompt-builder.service.js';

const system = (content: string): OpenAI.ChatCompletionMessageParam => ({ role: 'system', content });
const user = (content: string): OpenAI.ChatCompletionMessageParam => ({ role: 'user', content });

describe('Company Brain task context injection', () => {
  it('adds approved profile and task-specific evidence context without replacing the primary system prompt', async () => {
    const getContextPackage = vi.fn(async () => ({
      contextText: 'Task-specific Company Brain context for WORKER_RESEARCH:\n- Evidence E-1',
    }));
    const provider = {
      getApprovedProfile: vi.fn(async () => ({
        name: 'InBharat', industry: 'AI', description: 'Agent systems',
        productsServices: [], targetCustomers: null, brandVoice: null,
        competitors: [], pricing: null, websiteUrl: null, goals: 'Build JAK',
        constraints: null, preferredChannels: [],
      })),
      getContextPackage,
    };
    const builder = new PromptBuilder('WORKER_RESEARCH' as never, () => null, () => provider);
    const original = [system('PRIMARY'), user('Review Project Alpha renewal risk')];
    const result = await builder.injectCompanyContext(original, { tenantId: 'tenant-1' } as never);

    expect(result.messages[0]).toEqual(original[0]);
    expect(result.messages.some((message) => typeof message.content === 'string' && message.content.includes('<company_context>'))).toBe(true);
    expect(result.messages.some((message) => typeof message.content === 'string' && message.content.includes('<company_brain>'))).toBe(true);
    expect(getContextPackage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      task: 'Review Project Alpha renewal risk',
      agentRole: 'WORKER_RESEARCH',
    }));
  });

  it('does not duplicate existing company blocks', async () => {
    const provider = {
      getApprovedProfile: vi.fn(async () => null),
      getContextPackage: vi.fn(async () => ({ contextText: 'new context' })),
    };
    const builder = new PromptBuilder('WORKER_RESEARCH' as never, () => null, () => provider);
    const messages = [
      system('PRIMARY'),
      system('<company_brain>existing</company_brain>'),
      user('Task'),
    ];
    const result = await builder.injectCompanyContext(messages, { tenantId: 'tenant-1' } as never);
    expect(result.messages.filter((message) => typeof message.content === 'string' && message.content.includes('<company_brain>'))).toHaveLength(1);
    expect(provider.getContextPackage).not.toHaveBeenCalled();
  });
});
