/**
 * StandingOrder allowedTools whitelist enforcement — closes the Item C
 * Phase-1 honest deferral. The previous shipping pin only enforced
 * blockedActions (deny-list); allowedTools was recorded in audit metadata
 * but not actually enforced at the tool-call gate.
 *
 * This test pins the new behavior:
 *   1. Empty allowedToolNames = no whitelist (default-allow)
 *   2. Non-empty allowedToolNames = strict whitelist (only listed tools)
 *   3. Whitelist is per-tenant — Tenant A's whitelist doesn't leak to B
 *   4. updateOptions can clear the whitelist by passing []
 *   5. disabledToolNames + allowedToolNames intersect (deny over allow):
 *      a tool listed in BOTH stays blocked
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTenantToolRegistry,
  clearTenantToolRegistries,
  registerBuiltinTools,
  toolRegistry,
} from '@jak-swarm/tools';

describe('StandingOrder allowedTools whitelist enforcement', () => {
  beforeEach(() => {
    if (toolRegistry.list().length === 0) {
      registerBuiltinTools();
    }
    clearTenantToolRegistries();
  });

  it('empty allowedToolNames preserves the legacy default-allow path', () => {
    const tenant = getTenantToolRegistry('tenant-default', [], {
      allowedToolNames: [],
    });
    // Default-allow means at least one built-in tool is visible.
    expect(tenant.list().length).toBeGreaterThan(0);
  });

  it('unset allowedToolNames preserves the legacy default-allow path', () => {
    const tenant = getTenantToolRegistry('tenant-unset', []);
    expect(tenant.list().length).toBeGreaterThan(0);
  });

  it('non-empty allowedToolNames blocks every tool not in the whitelist', () => {
    // Pick the first two built-in tools by name.
    const allTools = toolRegistry.list();
    expect(allTools.length).toBeGreaterThan(2);
    const permittedName = allTools[0]!.name;
    const blockedName = allTools[1]!.name;

    const tenant = getTenantToolRegistry('tenant-whitelist', [], {
      allowedToolNames: [permittedName],
    });

    expect(tenant.has(permittedName)).toBe(true);
    expect(tenant.has(blockedName)).toBe(false);
  });

  it("whitelist on Tenant A does not affect Tenant B", () => {
    const allTools = toolRegistry.list();
    const onlyToolForA = allTools[0]!.name;
    const sharedTool = allTools[1]!.name;

    const tenantA = getTenantToolRegistry('tenant-A-whitelist', [], {
      allowedToolNames: [onlyToolForA],
    });
    const tenantB = getTenantToolRegistry('tenant-B-whitelist', [], {
      allowedToolNames: [], // no whitelist
    });

    expect(tenantA.has(sharedTool)).toBe(false);
    expect(tenantB.has(sharedTool)).toBe(true);
  });

  it('updateOptions can clear an active whitelist by passing []', () => {
    const allTools = toolRegistry.list();
    const onePermittedName = allTools[0]!.name;
    const initiallyBlockedName = allTools[1]!.name;

    const tenant = getTenantToolRegistry('tenant-toggle', [], {
      allowedToolNames: [onePermittedName],
    });
    expect(tenant.has(initiallyBlockedName)).toBe(false);

    tenant.updateOptions({ allowedToolNames: [] });
    expect(tenant.has(initiallyBlockedName)).toBe(true);
  });

  it('disabledToolNames wins when a tool appears in BOTH allowed and disabled', () => {
    // Paranoid contract: an explicit deny always trumps a permit. The
    // scheduler's StandingOrder merge logic relies on this so a
    // tenant-global "block this dangerous tool" order is not undone by
    // a per-schedule "allow these tools" whitelist.
    const allTools = toolRegistry.list();
    const target = allTools[0]!.name;

    const tenant = getTenantToolRegistry('tenant-paranoid', [], {
      allowedToolNames: [target],
      disabledToolNames: [target],
    });

    expect(tenant.has(target)).toBe(false);
  });
});
