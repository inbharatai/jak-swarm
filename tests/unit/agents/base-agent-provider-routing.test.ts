import { afterEach, describe, expect, it } from 'vitest';
import { AgentRole } from '../../../packages/shared/src/types/agent.js';
import { BaseAgent } from '../../../packages/agents/src/base/base-agent.js';
import { AgentContext } from '../../../packages/agents/src/base/agent-context.js';

class TestAgent extends BaseAgent {
  constructor(role: AgentRole) {
    super(role);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(_input: unknown, _context: AgentContext): Promise<unknown> {
    return null;
  }

  providerName(): string | null {
    return this.provider?.name ?? null;
  }
}

const ORIGINAL_ENV = {
  OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
  ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
  GEMINI_API_KEY: process.env['GEMINI_API_KEY'],
  DEEPSEEK_API_KEY: process.env['DEEPSEEK_API_KEY'],
  OPENROUTER_API_KEY: process.env['OPENROUTER_API_KEY'],
  OLLAMA_URL: process.env['OLLAMA_URL'],
  OLLAMA_MODEL: process.env['OLLAMA_MODEL'],
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('BaseAgent role-aware provider routing', () => {
  it('uses the OpenAI tier-3 primary for COMMANDER even when old provider keys are present', () => {
    process.env['OPENAI_API_KEY'] = 'test-openai';
    process.env['ANTHROPIC_API_KEY'] = 'test-anthropic';
    process.env['GEMINI_API_KEY'] = 'test-gemini';
    delete process.env['DEEPSEEK_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['OLLAMA_URL'];
    delete process.env['OLLAMA_MODEL'];

    const agent = new TestAgent(AgentRole.COMMANDER);
    const providerName = agent.providerName();

    expect(providerName).toBeTruthy();
    expect(providerName).toContain('router(');
    expect(providerName).toContain('openai');
    expect(providerName).not.toContain('anthropic');
    expect(providerName).not.toContain('gemini');
  });

  it('uses the OpenAI tier-1 primary path for WORKER_EMAIL and ignores Gemini', () => {
    process.env['OPENAI_API_KEY'] = 'test-openai';
    process.env['GEMINI_API_KEY'] = 'test-gemini';
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['DEEPSEEK_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['OLLAMA_URL'];
    delete process.env['OLLAMA_MODEL'];

    const agent = new TestAgent(AgentRole.WORKER_EMAIL);
    const providerName = agent.providerName();

    expect(providerName).toBeTruthy();
    expect(providerName).toContain('router(');
    expect(providerName).toContain('openai');
    expect(providerName).not.toContain('gemini');
  });
});
