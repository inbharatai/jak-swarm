import { describe, expect, it } from 'vitest';
import { ProviderRouter } from '../../../packages/agents/src/base/provider-router.js';
import type { LLMProvider, LLMResponse } from '../../../packages/agents/src/base/llm-provider.js';

class MockProvider implements LLMProvider {
  readonly name: string;
  private readonly handler: () => Promise<LLMResponse>;

  constructor(name: string, handler: () => Promise<LLMResponse>) {
    this.name = name;
    this.handler = handler;
  }

  chatCompletion(): Promise<LLMResponse> {
    return this.handler();
  }
}

function okResponse(content = 'ok'): LLMResponse {
  return {
    content,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  };
}

describe('ProviderRouter failover behavior', () => {
  it('fails over when primary returns 404 model error', async () => {
    const primary = new MockProvider('primary', async () => {
      const err = new Error('HTTP 404 model not found') as Error & { status?: number };
      err.status = 404;
      throw err;
    });
    const fallback = new MockProvider('fallback', async () => okResponse('fallback-used'));

    const router = new ProviderRouter(primary, [fallback]);
    const result = await router.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] });

    expect(result.content).toBe('fallback-used');
  });

  it('fails over when primary returns auth-scoped error', async () => {
    const primary = new MockProvider('primary', async () => {
      throw new Error('401 unauthorized for this provider key');
    });
    const fallback = new MockProvider('fallback', async () => okResponse('auth-fallback'));

    const router = new ProviderRouter(primary, [fallback]);
    const result = await router.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] });

    expect(result.content).toBe('auth-fallback');
  });

  it('does not fail over on non-retryable 400 validation errors', async () => {
    const primary = new MockProvider('primary', async () => {
      const err = new Error('HTTP 400 bad request') as Error & { status?: number };
      err.status = 400;
      throw err;
    });
    const fallback = new MockProvider('fallback', async () => okResponse('should-not-run'));

    const router = new ProviderRouter(primary, [fallback]);

    await expect(
      router.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow('HTTP 400 bad request');
  });
});
