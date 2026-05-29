/**
 * C-Suite Agent Tool Accuracy Integration Tests
 *
 * Verifies that the CEO (Strategist), CTO (Technical), CMO (Marketing),
 * CFO (Finance), and Growth agent tool declarations are accurate:
 *  1. Every tool an agent declares actually exists in the ToolRegistry
 *  2. Tool names in the system prompt match the tool names in code declarations
 *  3. Agent tool parameter schemas align with ToolRegistry inputSchema
 *  4. Risk classifications are internally consistent
 *  5. Approval gates correctly classify high-risk tools
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolRegistry } from '../../packages/tools/src/registry/tool-registry.js';
import { registerBuiltinTools } from '../../packages/tools/src/builtin/index.js';
import { DefaultApprovalPolicy } from '../../packages/tools/src/registry/approval-policy.js';
import { ToolRiskClass } from '@jak-swarm/shared';
import type { ToolMetadata } from '@jak-swarm/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Extract tool names from the `const tools: OpenAI.ChatCompletionTool[]` array */
function extractCodeToolNames(source: string): string[] {
  const names: string[] = [];
  const regex = /name:\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    names.push(match[1]);
  }
  // Dedup, keep only snake_case tool names (filter out param names like 'query', 'title')
  return [...new Set(names)].filter(n => n.includes('_') || [
    'web_search', 'search_knowledge', 'generate_report', 'find_document',
    'score_lead', 'track_okrs', 'monitor_competitors', 'generate_board_report',
    'check_dependencies', 'estimate_tech_debt', 'analyze_github_repo',
  ].includes(n));
}

/** Extract tool names from the "You have access to these tools:" prompt section */
function extractPromptToolNames(source: string): string[] {
  const names: string[] = [];
  const section = source.match(/You have access to these tools:([\s\S]*?)(?:\n\n|\nRespond with)/);
  if (!section) return names;
  const toolLineRegex = /^-\s+(\w+)[\s:]/gm;
  let match: RegExpExecArray | null;
  while ((match = toolLineRegex.exec(section[1])) !== null) {
    names.push(match[1]);
  }
  return names;
}

/** Get ToolMetadata from the registry by name. list() returns ToolMetadata[] */
function getToolMeta(name: string): ToolMetadata | undefined {
  return toolRegistry.list().find(t => t.name === name);
}

// ─── C-Suite Agent Definitions ──────────────────────────────────────

const CSUITE_AGENTS = [
  { role: 'CEO (Strategist)', file: 'packages/agents/src/workers/strategist.agent.ts' },
  { role: 'CTO (Technical)', file: 'packages/agents/src/workers/technical.agent.ts' },
  { role: 'CMO (Marketing)', file: 'packages/agents/src/workers/marketing.agent.ts' },
  { role: 'CFO (Finance)', file: 'packages/agents/src/workers/finance.agent.ts' },
  { role: 'Growth', file: 'packages/agents/src/workers/growth.agent.ts' },
] as const;

// ─── Tests ──────────────────────────────────────────────────────────

describe('C-Suite Agent Tool Accuracy', () => {
  beforeAll(() => {
    if (toolRegistry.list().length === 0) {
      registerBuiltinTools();
    }
  });

  // ─── Section 1: Agent-Tool Registry Alignment ───────────────────────
  describe('Agent-Tool Registry Alignment', () => {
    for (const agent of CSUITE_AGENTS) {
      it(`${agent.role}: every declared tool exists in ToolRegistry`, () => {
        const source = readRepoFile(agent.file);
        const codeNames = extractCodeToolNames(source);
        expect(codeNames.length, `${agent.role} should have at least 3 tool declarations`).toBeGreaterThanOrEqual(3);

        const missing: string[] = [];
        for (const name of codeNames) {
          if (!getToolMeta(name)) missing.push(name);
        }
        expect(missing, `Tools not found in ToolRegistry: ${missing.join(', ')}`).toEqual([]);
      });
    }
  });

  // ─── Section 2: Prompt-Code Name Consistency ────────────────────────
  describe('Prompt-Code Name Consistency', () => {
    for (const agent of CSUITE_AGENTS) {
      it(`${agent.role}: prompt tool names match code declarations`, () => {
        const source = readRepoFile(agent.file);
        const promptNames = extractPromptToolNames(source);
        const codeNames = extractCodeToolNames(source);

        expect(promptNames.length, `${agent.role} prompt should list at least 3 tools`).toBeGreaterThanOrEqual(3);
        expect(codeNames.length, `${agent.role} code should declare at least 3 tools`).toBeGreaterThanOrEqual(3);

        // Every tool listed in the prompt must appear in the code declarations
        const promptButNotCode = promptNames.filter(n => !codeNames.includes(n));
        expect(
          promptButNotCode,
          `${agent.role}: tools in prompt but NOT in code declarations: ${promptButNotCode.join(', ')}. ` +
          'The LLM will call these names but ToolExecutionService will reject them.',
        ).toEqual([]);

        // Every tool declared in code should appear in the prompt (otherwise the LLM doesn't know about it)
        const codeButNotPrompt = codeNames.filter(n => !promptNames.includes(n));
        expect(
          codeButNotPrompt,
          `${agent.role}: tools in code but NOT in prompt — LLM won't discover them: ${codeButNotPrompt.join(', ')}`,
        ).toEqual([]);
      });
    }
  });

  // ─── Section 3: Schema Consistency ──────────────────────────────────
  describe('Schema Consistency: Agent declarations vs ToolRegistry', () => {
    for (const agent of CSUITE_AGENTS) {
      it(`${agent.role}: tool parameter properties exist in ToolRegistry inputSchema`, () => {
        const source = readRepoFile(agent.file);
        const codeNames = extractCodeToolNames(source);

        const mismatches: string[] = [];

        for (const toolName of codeNames) {
          const meta = getToolMeta(toolName);
          if (!meta) continue; // Already caught in Section 1

          // Extract property names the agent declares for this tool from source
          const toolBlockMatch = source.match(
            new RegExp(`name:\\s*'${toolName}'[\\s\\S]*?properties:\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`, 'm'),
          );
          if (!toolBlockMatch) continue;

          const propsBlock = toolBlockMatch[1];
          const propNames: string[] = [];
          // Match top-level property declarations only — they appear as
          //   propName: { type: 'string', ... }
          // but NOT nested keys like `items: { type: 'object' }` inside arrays.
          // We identify top-level by requiring the line to NOT be deeply indented.
          const propRegex = /^\s+(\w+):\s*\{\s*type:/gm;
          let propMatch: RegExpExecArray | null;
          while ((propMatch = propRegex.exec(propsBlock)) !== null) {
            // Skip JSON Schema structural keywords that appear as property names
            if (['items', 'properties'].includes(propMatch[1])) continue;
            propNames.push(propMatch[1]);
          }

          // Check that every property the agent declares also exists in the registry
          const registryProps = Object.keys((meta.inputSchema as Record<string, unknown>).properties ?? {});
          for (const prop of propNames) {
            if (!registryProps.includes(prop)) {
              mismatches.push(
                `${toolName}: agent declares property '${prop}' but registry has [${registryProps.join(', ')}]`,
              );
            }
          }
        }

        expect(
          mismatches,
          `Schema mismatches found:\n${mismatches.join('\n')}`,
        ).toEqual([]);
      });
    }
  });

  // ─── Section 4: Risk Classification Accuracy ────────────────────────
  describe('Risk Classification Accuracy', () => {
    it('EXTERNAL_SIDE_EFFECT tools require approval', () => {
      const allTools = toolRegistry.list();
      const violations: string[] = [];

      for (const tool of allTools) {
        if (tool.riskClass === ToolRiskClass.EXTERNAL_SIDE_EFFECT && !tool.requiresApproval) {
          violations.push(
            `${tool.name}: riskClass=EXTERNAL_SIDE_EFFECT but requiresApproval=false`,
          );
        }
      }

      expect(
        violations,
        `Tools with EXTERNAL_SIDE_EFFECT risk should require approval:\n${violations.join('\n')}`,
      ).toEqual([]);
    });

    it('DESTRUCTIVE tools require approval', () => {
      const allTools = toolRegistry.list();
      const violations: string[] = [];

      for (const tool of allTools) {
        if (tool.riskClass === ToolRiskClass.DESTRUCTIVE && !tool.requiresApproval) {
          violations.push(
            `${tool.name}: riskClass=DESTRUCTIVE but requiresApproval=false`,
          );
        }
      }

      expect(
        violations,
        `Tools with DESTRUCTIVE risk should require approval:\n${violations.join('\n')}`,
      ).toEqual([]);
    });

    it('auto_engage tools are classified as read-only (search+draft, not posting)', () => {
      const engageTools = ['auto_engage_reddit', 'auto_engage_twitter', 'auto_engage_linkedin'];

      for (const toolName of engageTools) {
        const meta = getToolMeta(toolName);
        expect(meta, `${toolName} should exist in registry`).toBeDefined();
        // These tools search and draft replies but don't actually post,
        // so READ_ONLY is correct behavior
        expect(meta!.riskClass, `${toolName} should be READ_ONLY (search+draft, not posting)`).toBe(ToolRiskClass.READ_ONLY);
      }
    });

    it('sideEffectLevel is consistent with riskClass for C-suite agent tools', () => {
      const cSuiteToolNames = new Set<string>();
      for (const agent of CSUITE_AGENTS) {
        const source = readRepoFile(agent.file);
        for (const name of extractCodeToolNames(source)) {
          cSuiteToolNames.add(name);
        }
      }

      const inconsistencies: string[] = [];
      for (const toolName of cSuiteToolNames) {
        const meta = getToolMeta(toolName);
        if (!meta) continue;

        if (meta.sideEffectLevel === 'external' && meta.riskClass === ToolRiskClass.READ_ONLY) {
          // These tools search/read from external sources but don't write/post — acceptable
          const externalReadOnlyAllowlist = [
            'audit_seo', 'research_keywords', 'analyze_serp', 'monitor_rankings',
            'generate_seo_report', 'monitor_company_signals', 'monitor_competitors',
            'monitor_regulations', 'monitor_brand_mentions',
          ];
          if (!meta.name.startsWith('auto_engage_') && !meta.name.startsWith('monitor_') &&
              !meta.name.startsWith('web_search') && !meta.name.startsWith('web_fetch') &&
              !meta.name.startsWith('enrich_') && !meta.name.startsWith('find_decision') &&
              !externalReadOnlyAllowlist.includes(meta.name)) {
            inconsistencies.push(
              `${meta.name}: sideEffectLevel='external' but riskClass=READ_ONLY — ` +
              'verify this tool does not actually perform external writes',
            );
          }
        }
      }

      expect(inconsistencies, `Inconsistent sideEffectLevel/riskClass combos:\n${inconsistencies.join('\n')}`).toEqual([]);
    });
  });

  // ─── Section 5: Approval Gate Correctness ───────────────────────────
  describe('Approval Gate Correctness', () => {
    const policy = new DefaultApprovalPolicy();

    it('classifies send_email as requiring approval', () => {
      const meta = getToolMeta('send_email');
      expect(meta).toBeDefined();
      expect(meta!.riskClass).toBe(ToolRiskClass.EXTERNAL_SIDE_EFFECT);
      expect(meta!.requiresApproval).toBe(true);

      const decision = policy.classify(meta!);
      expect(['EXTERNAL_POST', 'DESTRUCTIVE']).toContain(decision);
    });

    it('classifies web_search as SAFE_READ (no approval needed)', () => {
      const meta = getToolMeta('web_search');
      expect(meta).toBeDefined();
      expect(meta!.riskClass).toBe(ToolRiskClass.READ_ONLY);

      const decision = policy.classify(meta!);
      expect(decision).toBe('SAFE_READ');
    });

    it('classifies generate_report as WRITE (no approval needed)', () => {
      const meta = getToolMeta('generate_report');
      expect(meta).toBeDefined();
      expect(meta!.riskClass).toBe(ToolRiskClass.WRITE);

      const decision = policy.classify(meta!);
      expect(decision).toBe('WRITE');
    });

    it('classifies github_create_repo as requiring approval', () => {
      const meta = getToolMeta('github_create_repo');
      expect(meta).toBeDefined();
      expect(meta!.riskClass).toBe(ToolRiskClass.EXTERNAL_SIDE_EFFECT);
      expect(meta!.requiresApproval).toBe(true);

      const decision = policy.classify(meta!);
      expect(['EXTERNAL_POST', 'DESTRUCTIVE']).toContain(decision);
    });

    it('SAFE_READ and WRITE C-suite tools do not require approval (unless explicitly flagged)', () => {
      const cSuiteToolNames = new Set<string>();
      for (const agent of CSUITE_AGENTS) {
        const source = readRepoFile(agent.file);
        for (const name of extractCodeToolNames(source)) {
          cSuiteToolNames.add(name);
        }
      }

      const violations: string[] = [];
      for (const toolName of cSuiteToolNames) {
        const meta = getToolMeta(toolName);
        if (!meta) continue;

        const decision = policy.classify(meta);
        if (decision === 'SAFE_READ' && meta.requiresApproval) {
          violations.push(`${toolName}: classified as SAFE_READ but requiresApproval=true`);
        }
      }

      expect(violations, `SAFE_READ tools shouldn't require approval:\n${violations.join('\n')}`).toEqual([]);
    });
  });
});