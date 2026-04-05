import { describe, it, expect } from 'vitest';
import { requiresApproval, RISK_LEVEL_WEIGHTS, DEFAULT_APPROVAL_THRESHOLD } from '../../../packages/shared/src/constants/risk-levels.js';
import { RiskLevel } from '../../../packages/shared/src/types/workflow.js';

describe('Risk Levels', () => {
  it('requires approval for HIGH risk at default threshold', () => {
    expect(requiresApproval(RiskLevel.HIGH, DEFAULT_APPROVAL_THRESHOLD)).toBe(true);
  });

  it('does not require approval for LOW risk at default threshold', () => {
    expect(requiresApproval(RiskLevel.LOW, DEFAULT_APPROVAL_THRESHOLD)).toBe(false);
  });

  it('does not require approval for MEDIUM risk at default (HIGH) threshold', () => {
    expect(requiresApproval(RiskLevel.MEDIUM, DEFAULT_APPROVAL_THRESHOLD)).toBe(false);
  });

  it('requires approval for CRITICAL risk at any threshold', () => {
    expect(requiresApproval(RiskLevel.CRITICAL, RiskLevel.LOW)).toBe(true);
    expect(requiresApproval(RiskLevel.CRITICAL, RiskLevel.MEDIUM)).toBe(true);
    expect(requiresApproval(RiskLevel.CRITICAL, RiskLevel.HIGH)).toBe(true);
  });

  it('weights are in ascending order', () => {
    expect(RISK_LEVEL_WEIGHTS[RiskLevel.LOW]).toBeLessThan(RISK_LEVEL_WEIGHTS[RiskLevel.MEDIUM]);
    expect(RISK_LEVEL_WEIGHTS[RiskLevel.MEDIUM]).toBeLessThan(RISK_LEVEL_WEIGHTS[RiskLevel.HIGH]);
    expect(RISK_LEVEL_WEIGHTS[RiskLevel.HIGH]).toBeLessThan(RISK_LEVEL_WEIGHTS[RiskLevel.CRITICAL]);
  });
});
