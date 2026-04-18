import { describe, expect, it } from 'vitest';
import { ProviderRouter } from '../../../packages/agents/src/base/provider-router.js';
import type { LLMProvider, LLMResponse } from '../../../packages/agents/src/base/llm-provider.js';
import type { ProviderErrorKind } from '../../../packages/agents/src/base/provider-router.js';

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

describe('ProviderRouter failover policy', () => {
  it('fails over on 429 rate limit', async () => {
    const primary = new MockProvider('primary', async () => {
      const err = new Error('HTTP 429 rate limit exceeded') as Error & { status?: number };
      err.status = 429;
      throw err;
    });
    const fallback = new MockProvider('fallback', async () => okResponse('rl-fallback'));

    const router = new ProviderRouter(primary, [fallback]);
    const result = await router.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] });

    expect(result.content).toBe('rl-fallback');
  });

  it('fails over on 5xx server error', async () => {
    const primary = new MockProvider('primary', async () => {
      const err = new Error('HTTP 503 service unavailable') as Error & { status?: number };
      err.status = 503;
      throw err;
    });
    const fallback = new MockProvider('fallback', async () => okResponse('5xx-fallback'));

    const router = new ProviderRouter(primary, [fallback]);
    const result = await router.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] });

    expect(result.content).toBe('5xx-fallback');
  });

  it('fails over on timeout', async () => {
    const primary = new MockProvider('primary', async () => {
      throw new Error('Request timed out after 30000ms');
    });
    const fallback = new MockProvider('fallback', async () => okResponse('to-fallback'));

    const router = new ProviderRouter(primary, [fallback]);
    const result = await router.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] });

    expect(result.content).toBe('to-fallback');
  });

  it('does NOT fail over on 401 auth error', async () => {
    const primary = new MockProvider('primary', async () => {
      const err = new Error('HTTP 401 unauthorized — invalid api key') as Error & {
        status?: number;
        providerErrorKind?: ProviderErrorKind;
      };
      err.status = 401;
      throw err;
    });
    const fallback = new MockProvider('fallback', async () => okResponse('should-not-run'));

    const router = new ProviderRouter(primary, [fallback]);

    await expect(
      router.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toMatchObject({ status: 401, providerErrorKind: 'auth_error' });
  });

  it('does NOT fail over on 404 model-not-found', async () => {
    const primary = new MockProvider('primary', async () => {
      const err = new Error('HTTP 404 model not found: gpt-9000') as Error & {
        status?: number;
        providerErrorKind?: ProviderErrorKind;
      };
      err.status = 404;
      throw err;
    });
    const fallback = new MockProvider('fallback', async () => okResponse('should-not-run'));

    const router = new ProviderRouter(primary, [fallback]);

    await expect(
      router.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toMatchObject({ providerErrorKind: 'model_not_found' });
  });

  it('does NOT fail over on 400 bad request', async () => {
    const primary = new MockProvider('primary', async () => {
      const err = new Error('HTTP 400 bad request') as Error & {
        status?: number;
        providerErrorKind?: ProviderErrorKind;
      };
      err.status = 400;
      throw err;
    });
    const fallback = new MockProvider('fallback', async () => okResponse('should-not-run'));

    const router = new ProviderRouter(primary, [fallback]);

    await expect(
      router.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toMatchObject({ status: 400, providerErrorKind: 'bad_request' });
  });

  it('surfaces classified kind on the thrown error', async () => {
    const primary = new MockProvider('primary', async () => {
      throw new Error('invalid_api_key: authentication failed');
    });

    const router = new ProviderRouter(primary, []);

    try {
      await router.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] });
      throw new Error('expected router to throw');
    } catch (err) {
      const e = err as Error & { providerErrorKind?: ProviderErrorKind };
      expect(e.providerErrorKind).toBe('auth_error');
    }
  });
});
