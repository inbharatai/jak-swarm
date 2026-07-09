/**
 * risk-classifier.test.ts — tool risk classification + approval gating.
 *
 * Pins:
 *   - the explicit TOOL_RISK_OVERRIDES table + name heuristics;
 *   - toolRequiresApproval honours the configured threshold;
 *   - the SECURITY FLOOR: `metadata.requiresApproval === false` can NEVER
 *     disarm a risk-mandated approval for EXTERNAL_SIDE_EFFECT / DESTRUCTIVE
 *     tools. Before the fix, the `=== false` short-circuit returned false
 *     before the risk check, bypassing approval for send_email /
 *     submit_payment / delete_* at a HIGH/CRITICAL threshold.
 *   - `requiresApproval === true` always mandates approval (metadata may only
 *     RAISE the bar).
 */
import { describe, it, expect } from 'vitest';
import { ToolRiskClass, RiskLevel } from '../../../packages/shared/src/index.js';
import {
  classifyToolRisk,
  toolRequiresApproval,
  describeRiskClass,
  TOOL_RISK_OVERRIDES,
} from '../../../packages/security/src/tool-risk/risk-classifier.js';

describe('classifyToolRisk — overrides + heuristics', () => {
  it('honours explicit overrides for known tool names', () => {
    expect(classifyToolRisk('send_email')).toBe(ToolRiskClass.EXTERNAL_SIDE_EFFECT);
    expect(classifyToolRisk('delete_document')).toBe(ToolRiskClass.DESTRUCTIVE);
    expect(classifyToolRisk('read_email')).toBe(ToolRiskClass.READ_ONLY);
    expect(classifyToolRisk('create_calendar_event')).toBe(ToolRiskClass.WRITE);
  });

  it('falls back to name heuristics for unknown tools', () => {
    expect(classifyToolRisk('delete_custom_thing')).toBe(ToolRiskClass.DESTRUCTIVE);
    expect(classifyToolRisk('publish_article')).toBe(ToolRiskClass.EXTERNAL_SIDE_EFFECT);
    expect(classifyToolRisk('update_profile')).toBe(ToolRiskClass.WRITE);
    expect(classifyToolRisk('fetch_weather')).toBe(ToolRiskClass.READ_ONLY);
  });

  it('uses metadata.riskClass when no override matches', () => {
    expect(classifyToolRisk('custom_thing', { riskClass: ToolRiskClass.DESTRUCTIVE })).toBe(
      ToolRiskClass.DESTRUCTIVE,
    );
  });

  it('is case-insensitive on the override lookup', () => {
    expect(classifyToolRisk('SEND_EMAIL')).toBe(ToolRiskClass.EXTERNAL_SIDE_EFFECT);
  });
});

describe('toolRequiresApproval — threshold gating', () => {
  it('requires approval when the tool risk meets the threshold', () => {
    // send_email is EXTERNAL_SIDE_EFFECT (= HIGH). At a HIGH threshold it needs approval.
    expect(toolRequiresApproval('send_email', RiskLevel.HIGH)).toBe(true);
    // At a CRITICAL threshold, a HIGH tool does not meet it.
    expect(toolRequiresApproval('send_email', RiskLevel.CRITICAL)).toBe(false);
  });

  it('does not require approval for read-only tools below threshold', () => {
    expect(toolRequiresApproval('read_email', RiskLevel.HIGH)).toBe(false);
    expect(toolRequiresApproval('read_email', RiskLevel.MEDIUM)).toBe(false);
  });

  it('requires approval for DESTRUCTIVE tools at HIGH threshold', () => {
    expect(toolRequiresApproval('submit_payment', RiskLevel.HIGH)).toBe(true);
    expect(toolRequiresApproval('delete_record', RiskLevel.HIGH)).toBe(true);
  });
});

describe('toolRequiresApproval — SECURITY FLOOR (Bug 16)', () => {
  it('requiresApproval: false can NEVER disarm a DESTRUCTIVE tool at its threshold', () => {
    // Before the fix: `metadata.requiresApproval === false` short-circuited to
    // `return false` BEFORE the risk check — bypassing approval for submit_payment
    // even at a CRITICAL threshold. This is the no-half-measures bypass.
    expect(
      toolRequiresApproval('submit_payment', RiskLevel.CRITICAL, { requiresApproval: false }),
    ).toBe(true);
    expect(
      toolRequiresApproval('delete_document', RiskLevel.CRITICAL, { requiresApproval: false }),
    ).toBe(true);
  });

  it('requiresApproval: false can NEVER disarm an EXTERNAL_SIDE_EFFECT tool at HIGH', () => {
    expect(
      toolRequiresApproval('send_email', RiskLevel.HIGH, { requiresApproval: false }),
    ).toBe(true);
    expect(
      toolRequiresApproval('browser_submit', RiskLevel.HIGH, { requiresApproval: false }),
    ).toBe(true);
  });

  it('requiresApproval: true ALWAYS mandates approval even for a low-risk read-only tool', () => {
    expect(
      toolRequiresApproval('read_email', RiskLevel.CRITICAL, { requiresApproval: true }),
    ).toBe(true);
  });

  it('requiresApproval: false is a harmless no-op when the risk is already below threshold', () => {
    // A read-only tool below a HIGH threshold needs no approval anyway; `false`
    // stays a no-op (it must not be able to lower an already-off bar).
    expect(
      toolRequiresApproval('read_email', RiskLevel.HIGH, { requiresApproval: false }),
    ).toBe(false);
    // A WRITE tool (MEDIUM) at a HIGH threshold is below the bar — `false` no-op.
    expect(
      toolRequiresApproval('update_profile', RiskLevel.HIGH, { requiresApproval: false }),
    ).toBe(false);
  });
});

describe('describeRiskClass', () => {
  it('describes every risk class without throwing', () => {
    for (const cls of Object.values(ToolRiskClass)) {
      expect(typeof describeRiskClass(cls)).toBe('string');
    }
  });
});

describe('TOOL_RISK_OVERRIDES sanity', () => {
  it('marks the irreversible financial / external tools as the highest risk', () => {
    expect(TOOL_RISK_OVERRIDES['submit_payment']).toBe(ToolRiskClass.DESTRUCTIVE);
    expect(TOOL_RISK_OVERRIDES['send_email']).toBe(ToolRiskClass.EXTERNAL_SIDE_EFFECT);
    expect(TOOL_RISK_OVERRIDES['delete_calendar_event']).toBe(ToolRiskClass.DESTRUCTIVE);
  });
});