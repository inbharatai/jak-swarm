import { describe, it, expect, beforeAll } from 'vitest';
import { ToolRegistry } from '../../../packages/tools/src/registry/tool-registry.js';
import { TenantToolRegistry } from '../../../packages/tools/src/registry/tenant-tool-registry.js';
import { registerBuiltinTools } from '../../../packages/tools/src/builtin/index.js';
import { ToolCategory, ToolRiskClass } from '../../../packages/shared/src/types/tool.js';

describe('TenantToolRegistry', () => {
  const globalRegistry = ToolRegistry.getInstance();

  beforeAll(() => {
    registerBuiltinTools(globalRegistry);
  });

  it('exposes built-in tools with no connected providers', () => {
    const registry = new TenantToolRegistry('t1', []);
    const tools = registry.list();
    // All returned tools should be built-in (no provider)
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.provider).toBeUndefined();
    }
  });

  it('blocks explicitly disabled tool names', () => {
    const registry = new TenantToolRegistry('t1', [], { disabledToolNames: ['read_email'] });
    expect(registry.has('read_email')).toBe(false);
    expect(registry.get('read_email')).toBeUndefined();
    const tools = registry.list();
    expect(tools.find(t => t.name === 'read_email')).toBeUndefined();
  });

  it('allows tool that is not in disabledToolNames', () => {
    const registry = new TenantToolRegistry('t1', [], { disabledToolNames: ['send_email'] });
    expect(registry.has('read_email')).toBe(true);
    expect(registry.has('send_email')).toBe(false);
  });

  it('blocks browser tools when browser automation is disabled', () => {
    const registry = new TenantToolRegistry('t1', [], { browserAutomationEnabled: false });
    const browserTools = registry.list({ category: ToolCategory.BROWSER });
    expect(browserTools).toHaveLength(0);
  });

  it('allows browser tools when browser automation is enabled', () => {
    const globalTools = globalRegistry.list({ category: ToolCategory.BROWSER });
    if (globalTools.length === 0) return; // skip if no browser tools registered
    const registry = new TenantToolRegistry('t1', [], { browserAutomationEnabled: true });
    const browserTools = registry.list({ category: ToolCategory.BROWSER });
    expect(browserTools.length).toBeGreaterThan(0);
  });

  it('blocks restricted category tools', () => {
    const allEmail = globalRegistry.list({ category: ToolCategory.EMAIL });
    if (allEmail.length === 0) return; // skip if no email tools
    const registry = new TenantToolRegistry('t1', [], {
      restrictedCategories: [ToolCategory.EMAIL],
    });
    const emailTools = registry.list({ category: ToolCategory.EMAIL });
    expect(emailTools).toHaveLength(0);
  });

  it('reflects disabledToolNames update via updateOptions', () => {
    const registry = new TenantToolRegistry('t1', []);
    expect(registry.has('read_email')).toBe(true);
    registry.updateOptions({ disabledToolNames: ['read_email'] });
    expect(registry.has('read_email')).toBe(false);
    // Undoing via empty list restores access
    registry.updateOptions({ disabledToolNames: [] });
    expect(registry.has('read_email')).toBe(true);
  });

  it('execute returns error for a disabled tool without calling executor', async () => {
    const registry = new TenantToolRegistry('t1', [], { disabledToolNames: ['read_email'] });
    const result = await registry.execute('read_email', {}, {
      tenantId: 't1',
      userId: 'u1',
      workflowId: 'w1',
      runId: 'r1',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('execute blocks tool requiring approval when no approvalId provided', async () => {
    const registry = new TenantToolRegistry('t1', []);
    // send_email requires approval
    const result = await registry.execute('send_email', {}, {
      tenantId: 't1',
      userId: 'u1',
      workflowId: 'w1',
      runId: 'r1',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires approval');
  });
});
