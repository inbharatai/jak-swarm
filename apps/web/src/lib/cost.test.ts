import { describe, it, expect } from 'vitest';
import { calculateCost } from '@jak-swarm/shared';
import { deriveCostFromTokenUsage, formatCostUsd } from './cost';

// D.2 — the web's deriveCostFromTokenUsage MUST match the backend
// calculateCost (the same formula used for UsageLedger.usdCost and
// workflow-timeline.service.ts) so the Inspector + traces page show the
// same USD figure the API persists. Honest: null when no model (cost not
// computable), never a fabricated $0.

describe('deriveCostFromTokenUsage', () => {
  it('matches calculateCost for the runtime blob shape (inputTokens/outputTokens/model)', () => {
    const blob = { inputTokens: 1500, outputTokens: 800, model: 'gpt-5.4-mini', provider: 'openai' };
    expect(deriveCostFromTokenUsage(blob)).toBe(calculateCost('gpt-5.4-mini', 1500, 800));
    // gpt-5.4-mini: 0.50/M in, 2.00/M out → 1500*0.5/1e6 + 800*2/1e6 = 0.00075 + 0.0016 = 0.00235
    expect(deriveCostFromTokenUsage(blob)).toBeCloseTo(0.00235, 6);
  });

  it('matches calculateCost for the seed blob shape (promptTokens/completionTokens + model)', () => {
    const blob = { promptTokens: 2000, completionTokens: 1000, totalTokens: 3000, model: 'gpt-5.5' };
    expect(deriveCostFromTokenUsage(blob)).toBe(calculateCost('gpt-5.5', 2000, 1000));
  });

  it('returns null when no model is present (honest N/A, never a fake $0)', () => {
    expect(deriveCostFromTokenUsage({ inputTokens: 100, outputTokens: 50 })).toBeNull();
    expect(deriveCostFromTokenUsage({ promptTokens: 100, completionTokens: 50, totalTokens: 150 })).toBeNull();
    expect(deriveCostFromTokenUsage({ model: '' })).toBeNull();
  });

  it('returns null for absent / non-object blobs', () => {
    expect(deriveCostFromTokenUsage(null)).toBeNull();
    expect(deriveCostFromTokenUsage(undefined)).toBeNull();
    expect(deriveCostFromTokenUsage('not-a-blob')).toBeNull();
    expect(deriveCostFromTokenUsage(123)).toBeNull();
  });

  it('treats missing token counts as 0 (model present but no token fields)', () => {
    // gpt-5.4 with 0 tokens → $0 (a real computed value, distinct from null).
    expect(deriveCostFromTokenUsage({ model: 'gpt-5.4' })).toBe(0);
  });
});

describe('formatCostUsd', () => {
  it('renders N/A for null/undefined (cost not computable)', () => {
    expect(formatCostUsd(null)).toBe('N/A');
    expect(formatCostUsd(undefined)).toBe('N/A');
  });

  it('renders 4-decimal cents for sub-dollar costs and 2-decimal for >= $1', () => {
    expect(formatCostUsd(0.00235)).toBe('$0.0024');
    expect(formatCostUsd(1.23)).toBe('$1.23');
    expect(formatCostUsd(0)).toBe('$0.0000');
  });
});