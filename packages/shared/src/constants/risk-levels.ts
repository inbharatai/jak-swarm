import { RiskLevel } from '../types/workflow.js';

export const RISK_LEVEL_WEIGHTS: Record<RiskLevel, number> = {
  [RiskLevel.LOW]: 1,
  [RiskLevel.MEDIUM]: 2,
  [RiskLevel.HIGH]: 3,
  [RiskLevel.CRITICAL]: 4,
};

export const DEFAULT_APPROVAL_THRESHOLD: RiskLevel = RiskLevel.HIGH;

/**
 * Returns true if the given risk level meets or exceeds the approval threshold.
 * Example: requiresApproval(RiskLevel.HIGH, RiskLevel.HIGH) => true
 *          requiresApproval(RiskLevel.LOW, RiskLevel.HIGH)  => false
 */
export function requiresApproval(risk: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_LEVEL_WEIGHTS[risk] >= RISK_LEVEL_WEIGHTS[threshold];
}
