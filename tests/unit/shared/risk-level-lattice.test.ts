/**
 * ToolRiskLevel lattice tests — Item D of the OpenClaw-inspired Phase 1.
 *
 * Pins:
 *   - Every legacy ToolRiskClass maps to a ToolRiskLevel (no orphans)
 *   - The mapping is conservative (WRITE -> SANDBOX_EDIT, never the
 *     looser DRAFT_ONLY)
 *   - Numeric ordering is monotonic (a higher level always carries a
 *     larger number for threshold comparisons)
 *   - resolveToolRiskLevel prefers an explicit riskLevel over the
 *     legacy riskClass back-compat map
 *
 * If any of these regress, the approval gate's threshold logic breaks
 * silently. CI must catch it.
 */
import { describe, it, expect } from 'vitest';
import {
  ToolRiskClass,
  ToolRiskLevel,
  TOOL_RISK_LEVEL_ORDER,
  RISK_CLASS_TO_LEVEL,
  resolveToolRiskLevel,
} from '@jak-swarm/shared';

describe('ToolRiskLevel lattice', () => {
  it('declares exactly 6 levels', () => {
    expect(Object.values(ToolRiskLevel).sort()).toEqual([
      'CRITICAL_MANUAL_ONLY',
      'DRAFT_ONLY',
      'EXTERNAL_ACTION_APPROVAL',
      'LOCAL_EXEC_ALLOWLIST',
      'READ_ONLY',
      'SANDBOX_EDIT',
    ]);
  });

  it('orders levels monotonically (read-only is lowest, critical is highest)', () => {
    const ordered = Object.values(ToolRiskLevel).sort(
      (a, b) => TOOL_RISK_LEVEL_ORDER[a] - TOOL_RISK_LEVEL_ORDER[b],
    );
    expect(ordered).toEqual([
      ToolRiskLevel.READ_ONLY,
      ToolRiskLevel.DRAFT_ONLY,
      ToolRiskLevel.SANDBOX_EDIT,
      ToolRiskLevel.LOCAL_EXEC_ALLOWLIST,
      ToolRiskLevel.EXTERNAL_ACTION_APPROVAL,
      ToolRiskLevel.CRITICAL_MANUAL_ONLY,
    ]);
  });

  it('every TOOL_RISK_LEVEL_ORDER value is a positive integer', () => {
    for (const lvl of Object.values(ToolRiskLevel)) {
      const n = TOOL_RISK_LEVEL_ORDER[lvl];
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
  });

  describe('back-compat: RISK_CLASS_TO_LEVEL', () => {
    it('maps every legacy ToolRiskClass to a level (no orphans)', () => {
      for (const cls of Object.values(ToolRiskClass)) {
        expect(RISK_CLASS_TO_LEVEL[cls]).toBeDefined();
      }
    });

    it('READ_ONLY -> READ_ONLY (identity)', () => {
      expect(RISK_CLASS_TO_LEVEL[ToolRiskClass.READ_ONLY]).toBe(ToolRiskLevel.READ_ONLY);
    });

    it('WRITE -> SANDBOX_EDIT (conservative — safer assumption than DRAFT_ONLY)', () => {
      // The legacy WRITE class was ambiguous: it covered both
      // "drafts an artifact" and "writes to a sandbox copy". The
      // safer assumption is SANDBOX_EDIT — this preserves whatever
      // approval gate the tool already had under the old enum.
      expect(RISK_CLASS_TO_LEVEL[ToolRiskClass.WRITE]).toBe(ToolRiskLevel.SANDBOX_EDIT);
      // Sanity: SANDBOX_EDIT is strictly higher in the lattice than DRAFT_ONLY.
      expect(TOOL_RISK_LEVEL_ORDER[ToolRiskLevel.SANDBOX_EDIT])
        .toBeGreaterThan(TOOL_RISK_LEVEL_ORDER[ToolRiskLevel.DRAFT_ONLY]);
    });

    it('DESTRUCTIVE -> CRITICAL_MANUAL_ONLY (never auto-approves)', () => {
      expect(RISK_CLASS_TO_LEVEL[ToolRiskClass.DESTRUCTIVE]).toBe(
        ToolRiskLevel.CRITICAL_MANUAL_ONLY,
      );
    });

    it('EXTERNAL_SIDE_EFFECT -> EXTERNAL_ACTION_APPROVAL', () => {
      expect(RISK_CLASS_TO_LEVEL[ToolRiskClass.EXTERNAL_SIDE_EFFECT]).toBe(
        ToolRiskLevel.EXTERNAL_ACTION_APPROVAL,
      );
    });
  });

  describe('resolveToolRiskLevel()', () => {
    it('returns the explicit riskLevel when present', () => {
      expect(
        resolveToolRiskLevel(ToolRiskClass.WRITE, ToolRiskLevel.DRAFT_ONLY),
      ).toBe(ToolRiskLevel.DRAFT_ONLY);
    });

    it('falls back to the back-compat map when no explicit level supplied', () => {
      expect(resolveToolRiskLevel(ToolRiskClass.READ_ONLY)).toBe(ToolRiskLevel.READ_ONLY);
      expect(resolveToolRiskLevel(ToolRiskClass.DESTRUCTIVE)).toBe(
        ToolRiskLevel.CRITICAL_MANUAL_ONLY,
      );
    });

    it('explicit DRAFT_ONLY wins over WRITE -> SANDBOX_EDIT default', () => {
      // A new tool author who explicitly knows their tool just drafts
      // can set riskLevel=DRAFT_ONLY without needing to change riskClass.
      const resolved = resolveToolRiskLevel(ToolRiskClass.WRITE, ToolRiskLevel.DRAFT_ONLY);
      expect(resolved).toBe(ToolRiskLevel.DRAFT_ONLY);
      expect(TOOL_RISK_LEVEL_ORDER[resolved]).toBeLessThan(
        TOOL_RISK_LEVEL_ORDER[ToolRiskLevel.SANDBOX_EDIT],
      );
    });
  });

  describe('cross-axis ordering: works alongside task-level RiskLevel', () => {
    it('the merged RISK_ORDER in approval-node covers both vocabularies', async () => {
      // Sanity check that approval-node's merged map (which spreads
      // TOOL_RISK_LEVEL_ORDER) sees both task levels and tool levels.
      // We can't import the private RISK_ORDER from approval-node, but
      // we can prove the spread shape is correct by re-creating the
      // merge here and asserting both vocabularies resolve.
      const merged: Record<string, number> = {
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3,
        CRITICAL: 4,
        ...TOOL_RISK_LEVEL_ORDER,
      };
      // Task-level
      expect(merged['LOW']).toBe(1);
      expect(merged['CRITICAL']).toBe(4);
      // Tool-level
      expect(merged['READ_ONLY']).toBe(1);
      expect(merged['CRITICAL_MANUAL_ONLY']).toBe(6);
    });
  });
});
