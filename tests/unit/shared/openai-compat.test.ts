import { describe, expect, it } from 'vitest';
import {
  openAIChatTokenLimitParam,
  openAIModelUsesReasoningControls,
  openAISamplingParams,
  openAISupportsCustomSampling,
} from '@jak-swarm/shared';

describe('OpenAI request compatibility helpers', () => {
  it('omits unsupported sampling controls for GPT-5 family models', () => {
    expect(openAIModelUsesReasoningControls('gpt-5.5')).toBe(true);
    expect(openAISupportsCustomSampling('gpt-5.4')).toBe(false);
    expect(openAISamplingParams('gpt-5.4', { temperature: 0.1 })).toEqual({});
  });

  it('uses max_completion_tokens for GPT-5 chat-completion requests', () => {
    expect(openAIChatTokenLimitParam('gpt-5.5', 123)).toEqual({ max_completion_tokens: 123 });
  });

  it('keeps classic chat parameters for older non-reasoning models', () => {
    expect(openAISamplingParams('gpt-4.1', { temperature: 0.2 })).toEqual({ temperature: 0.2 });
    expect(openAIChatTokenLimitParam('gpt-4.1', 456)).toEqual({ max_tokens: 456 });
  });
});
