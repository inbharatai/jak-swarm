import { describe, it, expect, beforeAll } from 'vitest';
import { ToolRegistry } from '../../../packages/tools/src/registry/tool-registry.js';
import { registerBuiltinTools } from '../../../packages/tools/src/builtin/index.js';
import { ToolRiskClass, ToolCategory } from '../../../packages/shared/src/types/tool.js';

describe('ToolRegistry', () => {
  const registry = ToolRegistry.getInstance();

  beforeAll(() => {
    registerBuiltinTools(registry);
  });

  it('lists all built-in tools', () => {
    const tools = registry.list();
    expect(tools.length).toBeGreaterThanOrEqual(16);
  });

  it('finds read_email tool', () => {
    const tool = registry.get('read_email');
    expect(tool).toBeDefined();
    expect(tool?.metadata.riskClass).toBe(ToolRiskClass.READ_ONLY);
    expect(tool?.metadata.requiresApproval).toBe(false);
  });

  it('marks send_email as requiring approval', () => {
    const tool = registry.get('send_email');
    expect(tool?.metadata.requiresApproval).toBe(true);
    expect(tool?.metadata.riskClass).toBe(ToolRiskClass.EXTERNAL_SIDE_EFFECT);
  });

  it('filters by category', () => {
    const emailTools = registry.list({ category: ToolCategory.EMAIL });
    expect(emailTools.every(t => t.category === ToolCategory.EMAIL)).toBe(true);
  });

  it('filters by risk class', () => {
    const readOnly = registry.list({ riskClass: ToolRiskClass.READ_ONLY });
    expect(readOnly.every(t => t.riskClass === ToolRiskClass.READ_ONLY)).toBe(true);
  });
});
