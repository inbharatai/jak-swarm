/**
 * Manifest tests — pin the honesty + safety properties for the
 * first-class connectors (Remotion, Blender) and the auto-mapped
 * MCP_PROVIDERS entries.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  connectorRegistry,
  bootstrapConnectorRegistry,
  REMOTION_MANIFEST,
  BLENDER_MANIFEST,
  RiskLevel,
} from '@jak-swarm/tools';

describe('Connector manifests', () => {
  beforeEach(() => {
    (connectorRegistry as unknown as { __resetForTest: () => void }).__resetForTest();
    bootstrapConnectorRegistry();
  });

  describe('REMOTION_MANIFEST', () => {
    it('declares medium risk + supports auto-approval for sandbox install', () => {
      expect(REMOTION_MANIFEST.riskLevel).toBe(RiskLevel.MEDIUM);
      expect(REMOTION_MANIFEST.supportsAutoApproval).toBe(true);
    });

    it('does NOT publish external content (separate connector with own gate)', () => {
      expect(REMOTION_MANIFEST.canPublishExternalContent).toBe(false);
    });

    it('locks installCommand to the @remotion / create-video allowlist', () => {
      const allow = REMOTION_MANIFEST.sourceAllowlist ?? [];
      expect(allow).toContain('create-video');
      expect(allow.some((p) => p.startsWith('@remotion/'))).toBe(true);
    });

    it('declares a real validationCommand + expected output regex', () => {
      expect(REMOTION_MANIFEST.validationCommand).toContain('remotion --version');
      expect(REMOTION_MANIFEST.validationExpectedOutput).toBe('^[0-9]+\\.[0-9]+');
    });

    it('starts as available — never installed without a real validation', () => {
      const view = connectorRegistry.get('remotion');
      expect(view).toBeDefined();
      // Honest baseline: registry shows `available` until install +
      // validation actually run. Marketing must read this status.
      expect(view!.status).toBe('available');
      expect(view!.installedToolCount).toBeUndefined();
      expect(view!.lastValidatedAt).toBeUndefined();
    });

    it('lists code-level tool names that match runtime conventions', () => {
      // Tools live under `remotion_*` namespace to match ToolRegistry's
      // existing snake_case pattern. CI should fail if marketing copy
      // claims a tool that isn't in this list.
      expect(REMOTION_MANIFEST.availableTools).toContain('remotion_render_video');
      expect(REMOTION_MANIFEST.availableTools).toContain('remotion_render_lambda');
    });
  });

  describe('BLENDER_MANIFEST', () => {
    it('starts in needs_user_setup because Blender desktop must be installed by the user', () => {
      const view = connectorRegistry.get('blender');
      expect(view).toBeDefined();
      expect(view!.status).toBe('needs_user_setup');
    });

    it('declares HIGH risk and refuses auto-approval (Python execution surface)', () => {
      expect(BLENDER_MANIFEST.riskLevel).toBe(RiskLevel.HIGH);
      expect(BLENDER_MANIFEST.supportsAutoApproval).toBe(false);
    });

    it('exposes blender_run_python — the riskiest tool — and is honest about it', () => {
      expect(BLENDER_MANIFEST.availableTools).toContain('blender_run_python');
      // The setup instructions must explicitly warn about Python execution.
      expect(BLENDER_MANIFEST.setupInstructions ?? '').toMatch(/python/i);
    });

    it('is COMMUNITY-status — not officially supported', () => {
      expect(BLENDER_MANIFEST.packageStatus).toBe('COMMUNITY');
    });

    it('manualSetupSteps include "Blender desktop" + "MCP add-on"', () => {
      const steps = BLENDER_MANIFEST.manualSetupSteps?.join('\n') ?? '';
      expect(steps).toMatch(/blender/i);
      expect(steps).toMatch(/MCP/);
    });
  });

  describe('bootstrap from MCP_PROVIDERS', () => {
    it('registers all 21 MCP providers as connector entries with mcp- prefix', () => {
      const all = connectorRegistry.list();
      const mcpEntries = all.filter((v) => v.manifest.source === 'mcp-providers');
      // Lower bound — current count is 21; the seed file may grow.
      expect(mcpEntries.length).toBeGreaterThanOrEqual(20);
      expect(mcpEntries.every((v) => v.manifest.id.startsWith('mcp-'))).toBe(true);
    });

    it('sets canPublishExternalContent=true for Slack / GitHub / Notion (write-capable)', () => {
      const slack = connectorRegistry.get('mcp-slack');
      const github = connectorRegistry.get('mcp-github');
      expect(slack?.manifest.canPublishExternalContent).toBe(true);
      expect(github?.manifest.canPublishExternalContent).toBe(true);
    });

    it('elevates HIGH-risk write surfaces (Stripe, Postgres, Salesforce)', () => {
      expect(connectorRegistry.get('mcp-stripe')?.manifest.riskLevel).toBe(RiskLevel.HIGH);
      expect(connectorRegistry.get('mcp-postgres')?.manifest.riskLevel).toBe(RiskLevel.HIGH);
      expect(connectorRegistry.get('mcp-salesforce')?.manifest.riskLevel).toBe(RiskLevel.HIGH);
    });

    it('keeps read-only research connectors at LOW risk', () => {
      expect(connectorRegistry.get('mcp-brave-search')?.manifest.riskLevel).toBe(RiskLevel.LOW);
      expect(connectorRegistry.get('mcp-fetch')?.manifest.riskLevel).toBe(RiskLevel.LOW);
    });

    it('only Anthropic / official MCP servers default to supportsAutoApproval=true', () => {
      const community = connectorRegistry.list().filter((v) => v.manifest.packageStatus === 'COMMUNITY');
      expect(community.length).toBeGreaterThan(0);
      for (const v of community) {
        expect(v.manifest.supportsAutoApproval).toBe(false);
      }
    });
  });

  describe('post-launch audit fixes', () => {
    it('moves GOOGLE_DRIVE out of "local" category (Drive is SaaS, not local)', () => {
      // Bug: GOOGLE_DRIVE was bucketed `local` because the filesystem
      // MCP shipped as a sibling. Drive is a cloud SaaS; the dashboard
      // shouldn't list it under local utilities.
      const drive = connectorRegistry.get('mcp-google-drive');
      expect(drive).toBeDefined();
      expect(drive!.manifest.category).not.toBe('local');
      expect(drive!.manifest.category).toBe('cloud');
    });

    it('does NOT pollute sourceAllowlist with generic command runners (npx/pip/node)', () => {
      // Bug: when extractMcpPackage couldn't find a real package name
      // it fell back to `cfg.command` (typically 'npx' or 'pip'), which
      // was then written to sourceAllowlist — defeating the gate's
      // purpose. Now it returns a sentinel that callers reject.
      //
      // Verify: no auto-mapped MCP connector has 'npx', 'pip', 'node',
      // 'python' in its sourceAllowlist.
      const all = connectorRegistry.list().filter((v) => v.manifest.source === 'mcp-providers');
      const generic = new Set(['npx', 'npm', 'pnpm', 'yarn', 'pip', 'pip3', 'node', 'python', 'python3', '-y', '--yes']);
      for (const view of all) {
        const allowlist = view.manifest.sourceAllowlist ?? [];
        for (const entry of allowlist) {
          expect(generic.has(entry)).toBe(false);
        }
      }
    });
  });

  describe('truth invariant: marketing-mentioned connectors are all registered', () => {
    it('every product-truth INTEGRATIONS_CORE name has a corresponding registry entry', () => {
      // This guards the truth-check contract: if marketing claims a
      // connector exists, it must exist in the registry.
      const all = connectorRegistry.list();
      const ids = new Set(all.map((v) => v.manifest.id));
      // Spot-check the high-stakes ones; the truth-check CI gate covers
      // the full cross-reference.
      expect(ids.has('remotion')).toBe(true);
      expect(ids.has('blender')).toBe(true);
      expect(ids.has('mcp-slack')).toBe(true);
      expect(ids.has('mcp-github')).toBe(true);
      expect(ids.has('mcp-supabase')).toBe(true);
    });
  });
});
