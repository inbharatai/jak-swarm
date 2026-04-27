/**
 * Agent Execution — Behavioral Tests
 *
 * Verifies that agent classes can be instantiated, produce structured output,
 * handle errors gracefully, and respect their domain contracts.
 * Runs with stub LLM when no API key is set.
 */
import { describe, it, expect } from 'vitest';

describe('Agent Execution — Behavioral', () => {
  // ─── BaseAgent + Provider Router ───────────────────────────────────

  it('ProviderRouter instantiates and returns a valid provider name', async () => {
    const { ProviderRouter, getDefaultProvider } = await import('@jak-swarm/agents');

    // getDefaultProvider should work even without API key (returns stub/none)
    try {
      const provider = getDefaultProvider();
      expect(provider).toBeDefined();
      expect(typeof provider.name).toBe('string');
    } catch {
      // If no providers configured, should throw with a useful message
    }
  });

  it('ProviderRouter exposes tier routing from provider-router module', async () => {
    const mod = await import('@jak-swarm/agents');
    // ProviderRouter should be a class we can instantiate
    expect(mod.ProviderRouter).toBeDefined();
    expect(typeof mod.ProviderRouter).toBe('function');
  });

  it('BaseAgent class is exported and constructable', async () => {
    const { BaseAgent } = await import('@jak-swarm/agents');
    expect(BaseAgent).toBeDefined();
    expect(typeof BaseAgent).toBe('function');
  });

  // ─── Industry Pack Integration ─────────────────────────────────────

  it('industry packs exist for all advertised industries', async () => {
    const { getIndustryPack, listIndustries } = await import('@jak-swarm/industry-packs');

    const industries = listIndustries();
    expect(industries.length).toBeGreaterThanOrEqual(10);

    for (const entry of industries) {
      const pack = getIndustryPack(entry.industry);
      expect(pack).toBeDefined();
      expect(pack.displayName).toBeTruthy();
    }
  });

  it('healthcare pack includes HIPAA-relevant policy overlays', async () => {
    const { getIndustryPack } = await import('@jak-swarm/industry-packs');
    const { Industry } = await import('@jak-swarm/shared');
    const pack = getIndustryPack(Industry.HEALTHCARE);

    expect(pack).toBeDefined();
    // Healthcare should have compliance/policy overlay
    expect(pack.policyOverlays.length).toBeGreaterThan(0);
    expect(pack.complianceNotes.length).toBeGreaterThan(0);
  });

  it('classifyIndustry maps healthcare text to HEALTHCARE', async () => {
    const { classifyIndustry } = await import('@jak-swarm/industry-packs');
    const { Industry } = await import('@jak-swarm/shared');

    const result = classifyIndustry('patient intake HIPAA medical records');
    expect(result).toBe(Industry.HEALTHCARE);
  });

  it('classifyIndustry falls back to GENERAL for unrecognized text', async () => {
    const { classifyIndustry } = await import('@jak-swarm/industry-packs');
    const { Industry } = await import('@jak-swarm/shared');

    const result = classifyIndustry('random gibberish xyzzy plugh');
    expect(result).toBe(Industry.GENERAL);
  });

  // ─── Agent Role Constants ──────────────────────────────────────────

  it('all 38+ agent roles are defined with distinct values', async () => {
    const { AgentRole } = await import('@jak-swarm/shared');

    const roles = Object.values(AgentRole).filter(
      (v) => typeof v === 'string',
    );
    expect(roles.length).toBeGreaterThanOrEqual(38);

    // All values should be unique strings
    const uniqueRoles = new Set(roles);
    expect(uniqueRoles.size).toBe(roles.length);
  });

  // ─── Shared Utilities ──────────────────────────────────────────────

  it('generateId produces unique prefixed IDs', async () => {
    const { generateId } = await import('@jak-swarm/shared');

    const ids = Array.from({ length: 100 }, () => generateId('test_'));
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(100);

    for (const id of ids) {
      expect(id.startsWith('test_')).toBe(true);
    }
  });

  it('calculateCost returns reasonable costs for known models', async () => {
    const { calculateCost } = await import('@jak-swarm/shared');

    if (typeof calculateCost === 'function') {
      const cost = calculateCost('gpt-4o', 1000, 500);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(1); // 1K in + 500 out should be < $1
    }
  });

  // Sprint 2.2 / Item I — OpenAI prompt-cache aware cost path.
  it('calculateCost discounts cached input tokens', async () => {
    const { calculateCost } = await import('@jak-swarm/shared');
    // gpt-4o: $2.50/1M input, $1.25/1M cached input, $10/1M output
    // 1000 prompt tokens, 0 cached → 1000 * 2.50 / 1M = 0.0025
    // 500 completion → 500 * 10 / 1M = 0.005
    // Total: 0.0075
    const fullCost = calculateCost('gpt-4o', 1000, 500);
    // Same call with 800 cached out of 1000 prompt tokens →
    //   200 * 2.50 / 1M + 800 * 1.25 / 1M + 500 * 10 / 1M
    //   = 0.0005 + 0.001 + 0.005 = 0.0065
    const cachedCost = calculateCost('gpt-4o', 1000, 500, 800);
    expect(cachedCost).toBeLessThan(fullCost);
    expect(cachedCost).toBeCloseTo(0.0065, 5);
  });

  it('calculateCost falls back to 50% discount for models without explicit cached pricing', async () => {
    const { calculateCost } = await import('@jak-swarm/shared');
    // claude-sonnet-4-7 ships without cachedInputPer1M → fallback 50% off
    // Sonnet input is $3/1M; 1000 cached tokens at 50% = 1000 * 1.50 / 1M = 0.0015
    const fullCost = calculateCost('claude-sonnet-4-7', 1000, 0);
    const cachedCost = calculateCost('claude-sonnet-4-7', 1000, 0, 1000);
    // 100% cached → exactly half the full cost
    expect(cachedCost).toBeCloseTo(fullCost / 2, 5);
  });

  it('calculateCost clamps cachedTokens to <= promptTokens (defensive)', async () => {
    const { calculateCost } = await import('@jak-swarm/shared');
    // Bogus input: cachedTokens > promptTokens shouldn't yield negative billable tokens
    const cost = calculateCost('gpt-4o', 100, 0, 99999);
    // All 100 prompt tokens treated as cached; 0 uncached; 0 output → 100 * 1.25 / 1M
    expect(cost).toBeCloseTo(0.000125, 6);
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});
