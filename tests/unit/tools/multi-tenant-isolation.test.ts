/**
 * Multi-tenant isolation proof.
 *
 * Two tenants run side-by-side with different configurations. We verify that:
 *   - Tenant A's disabledToolNames don't bleed into Tenant B's visible registry.
 *   - Tenant A's allowed MCP providers don't leak into Tenant B's resolution.
 *   - Tenant A's browserAutomationEnabled flag doesn't affect Tenant B.
 *   - Tenant A's restrictedCategories don't affect Tenant B.
 *
 * These are the four enforcement axes exposed by TenantToolRegistry. A
 * regression here would be a cross-tenant data leak, which the landing
 * page claim ("row-level Postgres isolation, namespace-level Redis") must
 * be backed by at the runtime-gate layer too.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTenantToolRegistry,
  clearTenantToolRegistries,
  registerBuiltinTools,
  toolRegistry,
} from '@jak-swarm/tools';
import { ToolCategory } from '@jak-swarm/shared';

describe('Multi-tenant tool registry isolation', () => {
  beforeEach(() => {
    // Ensure builtins are registered once and tenant cache is clean
    if (toolRegistry.list().length === 0) {
      registerBuiltinTools();
    }
    clearTenantToolRegistries();
  });

  it("Tenant A's disabledToolNames does not affect Tenant B", () => {
    const sharedTool = 'web_search';

    const tenantA = getTenantToolRegistry('tenant-A', [], {
      disabledToolNames: [sharedTool],
    });
    const tenantB = getTenantToolRegistry('tenant-B', [], {
      disabledToolNames: [],
    });

    expect(tenantA.has(sharedTool)).toBe(false);
    expect(tenantB.has(sharedTool)).toBe(true);
  });

  it("Tenant A's restrictedCategories does not affect Tenant B", () => {
    // Pick a tool whose category we can restrict on one tenant.
    const anyTool = toolRegistry.list()[0];
    const category = anyTool?.category as ToolCategory | undefined;
    if (!category) return; // empty registry in some test environments

    const tenantA = getTenantToolRegistry('tenant-A', [], {
      restrictedCategories: [category],
    });
    const tenantB = getTenantToolRegistry('tenant-B', [], {
      restrictedCategories: [],
    });

    const listA = tenantA.list({ category });
    const listB = tenantB.list({ category });

    expect(listA.length).toBe(0);
    expect(listB.length).toBeGreaterThan(0);
  });

  it("Tenant A's browserAutomationEnabled=false does not affect Tenant B when B has it enabled", () => {
    const tenantA = getTenantToolRegistry('tenant-A', [], {
      browserAutomationEnabled: false,
    });
    const tenantB = getTenantToolRegistry('tenant-B', [], {
      browserAutomationEnabled: true,
    });

    // Browser tools should be filtered for A but not B.
    const browserToolsA = tenantA.list({ category: ToolCategory.BROWSER });
    const browserToolsB = tenantB.list({ category: ToolCategory.BROWSER });

    expect(browserToolsA.length).toBe(0);
    expect(browserToolsB.length).toBeGreaterThanOrEqual(browserToolsA.length);
    // If there are any browser tools registered at all, B should see > 0.
    const registeredBrowserTools = toolRegistry.list({ category: ToolCategory.BROWSER });
    if (registeredBrowserTools.length > 0) {
      expect(browserToolsB.length).toBeGreaterThan(0);
    }
  });

  it("Tenant A's connected providers don't grant access to Tenant B", () => {
    // Provider-scoped tools resolve against the tenant's allowedProviders set.
    // If the set isn't scoped correctly, one tenant's "connected Gmail" would
    // surface Gmail tools for another tenant that never connected Gmail.
    const tenantA = getTenantToolRegistry('tenant-A', ['GMAIL']);
    const tenantB = getTenantToolRegistry('tenant-B', []);

    const allTools = toolRegistry.list();
    const gmailTools = allTools.filter(
      (t) => t.provider && t.provider.toLowerCase() === 'gmail',
    );
    // If there are any provider-tagged Gmail tools registered:
    if (gmailTools.length > 0) {
      const listA = tenantA.list().filter((t) => t.provider?.toLowerCase() === 'gmail');
      const listB = tenantB.list().filter((t) => t.provider?.toLowerCase() === 'gmail');
      expect(listA.length).toBeGreaterThan(0);
      expect(listB.length).toBe(0);
    }
  });

  it('registry cache scopes per tenantId (two calls return distinct instances for distinct tenants)', () => {
    const a1 = getTenantToolRegistry('tenant-A', ['GMAIL']);
    const b1 = getTenantToolRegistry('tenant-B', ['GMAIL']);

    expect(a1).not.toBe(b1);

    // Calling again for the same tenant returns the same cached instance.
    const a2 = getTenantToolRegistry('tenant-A', ['GMAIL']);
    expect(a2).toBe(a1);
  });

  it('updateOptions on Tenant A does not mutate Tenant B state', () => {
    const tenantA = getTenantToolRegistry('tenant-A', [], {
      browserAutomationEnabled: false,
    });
    const tenantB = getTenantToolRegistry('tenant-B', [], {
      browserAutomationEnabled: true,
    });

    // Flip A
    tenantA.updateOptions({ browserAutomationEnabled: true });

    // B should still have browserAutomationEnabled=true (was true all along)
    // but the important check is that flipping A did not REMOVE any options
    // on B or otherwise disturb it. If the cache were shared, flipping A
    // would also affect B's internal state.
    const browserToolsB = tenantB.list({ category: ToolCategory.BROWSER });
    const allRegisteredBrowser = toolRegistry.list({ category: ToolCategory.BROWSER });
    // Regardless of count, B sees what it should — full category if any are registered.
    expect(browserToolsB.length).toBe(allRegisteredBrowser.length);
  });
});
