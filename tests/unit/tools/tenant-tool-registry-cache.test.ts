import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTenantToolRegistry,
  clearTenantToolRegistries,
  type TenantToolRegistryOptions,
} from '@jak-swarm/tools';
import { ToolCategory } from '@jak-swarm/shared';

/**
 * Locks the composite-key cache contract on `getTenantToolRegistry`.
 *
 * The prior implementation keyed the cache by `tenantId` alone and MUTATED
 * the cached instance on every hit (`updateProviders`/`updateOptions`).
 * Under concurrency or interleaved callers (e.g. the ADK bridge passing
 * `connectedProviders: []` while a LangGraph workflow passed the real
 * provider list for the same tenant), the second caller overwrote the
 * first caller's provider set on the SHARED instance — a clobber bug.
 *
 * Composite-key caching keys by (tenantId + connectedProviders + options)
 * so each (tenant, config) pair gets its own immutable instance. These
 * tests prove: (a) same config → same instance, (b) different providers →
 * different instances that do NOT clobber each other, (c) different
 * options → different instances, (d) provider case-insensitivity +
 * ordering normalization in the cache key.
 */

const TENANT = 't-registry-cache';

describe('TenantToolRegistry composite-key cache', () => {
  beforeEach(() => {
    clearTenantToolRegistries();
  });

  it('returns the SAME instance for the same (tenant, providers, options)', () => {
    const a = getTenantToolRegistry(TENANT, ['GMAIL', 'SLACK']);
    const b = getTenantToolRegistry(TENANT, ['GMAIL', 'SLACK']);
    expect(a).toBe(b);
  });

  it('returns DIFFERENT instances for different connected providers', () => {
    const withGmail = getTenantToolRegistry(TENANT, ['GMAIL']);
    const withSlack = getTenantToolRegistry(TENANT, ['SLACK']);
    expect(withGmail).not.toBe(withSlack);
  });

  it('does NOT clobber one caller\'s provider set when another caller passes a different provider list for the same tenant', () => {
    // Regression test for the old mutation bug: fetching a gmail registry
    // and then a slack registry for the same tenant must not overwrite the
    // gmail registry's identity. Re-fetching the gmail config must return
    // the ORIGINAL gmail instance, not a fresh one (cache survived) and not
    // the slack instance (no clobber).
    const gmailReg = getTenantToolRegistry(TENANT, ['GMAIL']);
    const slackReg = getTenantToolRegistry(TENANT, ['SLACK']);
    const gmailRegAgain = getTenantToolRegistry(TENANT, ['GMAIL']);
    expect(gmailRegAgain).toBe(gmailReg);
    expect(gmailReg).not.toBe(slackReg);
    expect(getTenantToolRegistry(TENANT, ['SLACK'])).toBe(slackReg);
  });

  it('treats provider lists differing only in case + ordering as the same cache key', () => {
    const a = getTenantToolRegistry(TENANT, ['GMAIL', 'SLACK']);
    const b = getTenantToolRegistry(TENANT, ['slack', 'gmail']);
    expect(a).toBe(b);
  });

  it('returns DIFFERENT instances for different options on the same tenant + providers', () => {
    const optsA: TenantToolRegistryOptions = { browserAutomationEnabled: false };
    const optsB: TenantToolRegistryOptions = { browserAutomationEnabled: true };
    const a = getTenantToolRegistry(TENANT, ['GMAIL'], optsA);
    const b = getTenantToolRegistry(TENANT, ['GMAIL'], optsB);
    expect(a).not.toBe(b);
  });

  it('treats options differing only in array ordering as the same cache key', () => {
    const a = getTenantToolRegistry(TENANT, ['GMAIL'], {
      restrictedCategories: [ToolCategory.BROWSER, ToolCategory.CRM],
    });
    const b = getTenantToolRegistry(TENANT, ['GMAIL'], {
      restrictedCategories: [ToolCategory.CRM, ToolCategory.BROWSER],
    });
    expect(a).toBe(b);
  });

  it('treats an undefined options arg and an explicit options object as distinct cache keys', () => {
    // Documented behavior: `registryCacheKey` serializes an explicit options
    // object (even one holding only default values) to a JSON string, while
    // `undefined` options map to the literal 'none'. These are different
    // cache keys → different instances. This is a minor perf cost (two
    // instances for semantically-equal config) but NOT a correctness bug —
    // neither instance can clobber the other. Asserted here so a future
    // "normalize undefined === default-options" refactor knows the current
    // contract.
    const a = getTenantToolRegistry(TENANT, ['GMAIL']);
    const b = getTenantToolRegistry(TENANT, ['GMAIL'], { browserAutomationEnabled: false });
    expect(a).not.toBe(b);
  });

  it('clearTenantToolRegistries drops all cached instances', () => {
    const a = getTenantToolRegistry(TENANT, ['GMAIL']);
    clearTenantToolRegistries();
    const b = getTenantToolRegistry(TENANT, ['GMAIL']);
    expect(a).not.toBe(b);
  });
});