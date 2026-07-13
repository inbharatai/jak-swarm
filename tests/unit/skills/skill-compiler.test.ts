/**
 * Phase 8 — procedural skill compiler + fail-closed sandbox verdict core.
 *
 * Pure-core unit tests for `compilePlanToSkill` (the Tier 2 GENERATED_PLAN
 * producer) and `resolveSandboxVerdict` (the fail-closed sandbox decider).
 * No DB, no sandbox runtime, no LLM — the cores are deterministic + pure.
 */
import { describe, it, expect } from 'vitest';
import {
  compilePlanToSkill,
  maxRiskLevel,
  resolveSandboxVerdict,
  type PlanTaskInput,
} from '@jak-swarm/skills';
import { SkillTier } from '@jak-swarm/shared';

const NOW = '2026-07-13T00:00:00.000Z';

describe('compilePlanToSkill — Tier 2 GENERATED_PLAN producer', () => {
  const tasks: PlanTaskInput[] = [
    { id: 't1', name: 'Fetch inbox', description: 'Pull recent emails', agentRole: 'WORKER_RESEARCH', toolsRequired: ['read_email'], riskLevel: 'LOW' },
    { id: 't2', name: 'Summarize', description: 'Summarize threads', agentRole: 'WORKER_CONTENT', toolsRequired: ['browser_read'], riskLevel: 'MEDIUM' },
    { id: 't3', name: 'Send digest', description: 'Send the digest', agentRole: 'WORKER_CONTENT', toolsRequired: ['external_message'], riskLevel: 'HIGH' },
  ];

  it('compiles a plan into an ordered procedure whose steps are 1:1 with the tasks (order preserved)', () => {
    const spec = compilePlanToSkill({
      sourceSpecId: 'spec-1',
      sourceSpecTitle: 'Daily inbox digest',
      goal: 'Produce a daily inbox digest',
      tasks,
      now: NOW,
    });
    expect(spec.tier).toBe(SkillTier.GENERATED_PLAN);
    expect(spec.steps).toHaveLength(3);
    expect(spec.steps.map((s) => s.id)).toEqual(['t1', 't2', 't3']);
    expect(spec.steps[0]).toMatchObject({ name: 'Fetch inbox', agentRole: 'WORKER_RESEARCH', toolsRequired: ['read_email'], riskLevel: 'LOW' });
    // Provenance is recorded.
    expect(spec.sourceSpecId).toBe('spec-1');
    expect(spec.sourceSpecTitle).toBe('Daily inbox digest');
    expect(spec.generatedAt).toBe(NOW);
    // The skill name derives from the goal; description carries provenance.
    expect(spec.name).toBe('Produce a daily inbox digest');
    expect(spec.description).toContain('spec-1');
  });

  it('the compiled skill risk level is the MAX across the plan tasks (drives approval gating)', () => {
    const spec = compilePlanToSkill({
      sourceSpecId: 'spec-1',
      sourceSpecTitle: 'T',
      goal: 'G',
      tasks,
      now: NOW,
    });
    expect(spec.riskLevel).toBe('HIGH');
  });

  it('refuses to compile an empty plan (no no-op skill masquerading as executable)', () => {
    expect(() =>
      compilePlanToSkill({ sourceSpecId: 's', sourceSpecTitle: 'T', goal: 'G', tasks: [], now: NOW }),
    ).toThrow(/no tasks/);
  });

  it('defaults a missing task risk level to LOW and an empty tools list to []', () => {
    const spec = compilePlanToSkill({
      sourceSpecId: 's',
      sourceSpecTitle: 'T',
      goal: 'G',
      tasks: [{ id: 't1', name: 'n', description: 'd' }],
      now: NOW,
    });
    expect(spec.steps[0].riskLevel).toBe('LOW');
    expect(spec.steps[0].toolsRequired).toEqual([]);
    expect(spec.riskLevel).toBe('LOW');
  });

  it('is deterministic — same input ⇒ identical output', () => {
    const a = compilePlanToSkill({ sourceSpecId: 's', sourceSpecTitle: 'T', goal: 'G', tasks, now: NOW });
    const b = compilePlanToSkill({ sourceSpecId: 's', sourceSpecTitle: 'T', goal: 'G', tasks, now: NOW });
    expect(a).toEqual(b);
  });
});

describe('maxRiskLevel', () => {
  it('picks the highest risk (LOW < MEDIUM < HIGH < CRITICAL)', () => {
    expect(maxRiskLevel(['LOW', 'MEDIUM'])).toBe('MEDIUM');
    expect(maxRiskLevel(['LOW', 'HIGH', 'MEDIUM'])).toBe('HIGH');
    expect(maxRiskLevel(['MEDIUM', 'CRITICAL', 'HIGH'])).toBe('CRITICAL');
    expect(maxRiskLevel([undefined, 'LOW'])).toBe('LOW');
    expect(maxRiskLevel([])).toBe('LOW');
  });
});

describe('resolveSandboxVerdict — fail-closed for coded skills', () => {
  const base = {
    testCasesCount: 2,
    testResults: [{ passed: true }, { passed: true }],
    executionError: null,
    sandboxAvailable: true,
    schemaValid: true,
  };

  it('codeless skill passes on schema validity alone (legitimate no-code path preserved)', () => {
    const v = resolveSandboxVerdict({ ...base, hasCode: false });
    expect(v.passed).toBe(true);
    expect(v.finalStatus).toBe('SANDBOX_PASSED');
    expect(v.phase).toBe('validation');
  });

  it('fails when the schema is invalid (regardless of code)', () => {
    const v = resolveSandboxVerdict({ ...base, hasCode: false, schemaValid: false });
    expect(v.passed).toBe(false);
    expect(v.finalStatus).toBe('PROPOSED');
  });

  it('coded skill FAILS when the sandbox adapter is unavailable (never schema-only pass — fail-closed)', () => {
    const v = resolveSandboxVerdict({ ...base, hasCode: true, sandboxAvailable: false });
    expect(v.passed).toBe(false);
    expect(v.finalStatus).toBe('PROPOSED');
    expect(v.reason).toMatch(/sandbox unavailable/i);
  });

  it('coded skill with zero test cases FAILS (no-tests ≠ pass)', () => {
    const v = resolveSandboxVerdict({
      ...base,
      hasCode: true,
      testCasesCount: 0,
      testResults: [],
    });
    expect(v.passed).toBe(false);
    expect(v.finalStatus).toBe('PROPOSED');
    expect(v.reason).toMatch(/≥1 test case/i);
  });

  it('coded skill whose tests did not run (no results) FAILS', () => {
    const v = resolveSandboxVerdict({
      ...base,
      hasCode: true,
      testCasesCount: 2,
      testResults: [],
    });
    expect(v.passed).toBe(false);
    expect(v.finalStatus).toBe('PROPOSED');
    expect(v.reason).toMatch(/no tests ran/i);
  });

  it('coded skill with an execution error FAILS', () => {
    const v = resolveSandboxVerdict({ ...base, hasCode: true, executionError: 'exit code 1' });
    expect(v.passed).toBe(false);
    expect(v.finalStatus).toBe('PROPOSED');
  });

  it('coded skill with any failed test FAILS', () => {
    const v = resolveSandboxVerdict({
      ...base,
      hasCode: true,
      testResults: [{ passed: true }, { passed: false }],
    });
    expect(v.passed).toBe(false);
    expect(v.finalStatus).toBe('PROPOSED');
    expect(v.reason).toMatch(/1\/2 test\(s\) failed/);
  });

  it('coded skill with all tests passed + sandbox available PASSES', () => {
    const v = resolveSandboxVerdict({ ...base, hasCode: true });
    expect(v.passed).toBe(true);
    expect(v.finalStatus).toBe('SANDBOX_PASSED');
    expect(v.phase).toBe('execution');
  });
});