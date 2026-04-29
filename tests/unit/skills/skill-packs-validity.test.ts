/**
 * Bundled SKILL.md pack validity — Item A of the OpenClaw-inspired Phase 1.
 *
 * Pins the contract that every SKILL.md shipped under
 * `packages/skills/public/` parses cleanly, declares the required fields,
 * and uses an `allowed-tools` list that's syntactically valid (no empty
 * strings, no obvious typos). If a pack regresses, this test catches it
 * in CI before the agent layer silently swallows the parse failure.
 *
 * What this test PROVES:
 *   1. All bundled SKILL.md files parse via parseSkillMd (no nulls)
 *   2. Each pack declares: name, description, version, allowed-tools, risk-level
 *   3. risk-level uses one of the valid values (4-tier task OR 6-tier tool)
 *   4. allowed-tools is a non-empty array of plain strings
 *   5. The 4 expected packs (repo-reviewer / landing-page-fixer /
 *      browser-researcher / content-engine) are all present
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkillMd } from '@jak-swarm/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const publicSkillsDir = join(repoRoot, 'packages', 'skills', 'public');

const VALID_RISK_LEVELS = new Set([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
  'READ_ONLY',
  'DRAFT_ONLY',
  'SANDBOX_EDIT',
  'LOCAL_EXEC_ALLOWLIST',
  'EXTERNAL_ACTION_APPROVAL',
  'CRITICAL_MANUAL_ONLY',
]);

function discoverPackPaths(): string[] {
  if (!existsSync(publicSkillsDir)) return [];
  const entries = readdirSync(publicSkillsDir);
  const paths: string[] = [];
  for (const entry of entries) {
    const skillPath = join(publicSkillsDir, entry, 'SKILL.md');
    try {
      if (statSync(skillPath).isFile()) paths.push(skillPath);
    } catch {
      // skip directories without SKILL.md
    }
  }
  return paths;
}

describe('Bundled SKILL.md packs', () => {
  it('ships at least one pack at packages/skills/public/<pack>/SKILL.md', () => {
    const paths = discoverPackPaths();
    expect(paths.length).toBeGreaterThan(0);
  });

  it('ships exactly the 4 expected Phase 1 packs', () => {
    const paths = discoverPackPaths();
    const names = paths.map((p) => p.split(/[\\/]/).slice(-2, -1)[0]).sort();
    expect(names).toEqual([
      'browser-researcher',
      'content-engine',
      'landing-page-fixer',
      'repo-reviewer',
    ]);
  });

  it('every pack parses cleanly (parseSkillMd never returns null)', () => {
    for (const path of discoverPackPaths()) {
      const content = readFileSync(path, 'utf-8');
      const manifest = parseSkillMd(content, path);
      expect(manifest, `pack at ${path} failed to parse`).not.toBeNull();
    }
  });

  it('every pack declares name, description, version, and a markdown body', () => {
    for (const path of discoverPackPaths()) {
      const content = readFileSync(path, 'utf-8');
      const manifest = parseSkillMd(content, path)!;
      expect(manifest.name, `pack at ${path} missing name`).toBeTruthy();
      expect(manifest.description, `pack ${manifest.name} missing description`).toBeTruthy();
      expect(manifest.version, `pack ${manifest.name} missing version`).toBeTruthy();
      // Body should be non-trivial — at least a couple hundred chars.
      expect(
        manifest.body.length,
        `pack ${manifest.name} body is too short to be a useful prompt`,
      ).toBeGreaterThan(200);
    }
  });

  it('every pack declares a non-empty allowed-tools array of plain strings', () => {
    for (const path of discoverPackPaths()) {
      const manifest = parseSkillMd(readFileSync(path, 'utf-8'), path)!;
      expect(
        manifest.allowedTools.length,
        `pack ${manifest.name} declares no allowed-tools`,
      ).toBeGreaterThan(0);
      for (const tool of manifest.allowedTools) {
        expect(typeof tool, `pack ${manifest.name} has non-string tool`).toBe('string');
        expect(tool.trim().length, `pack ${manifest.name} has empty tool entry`).toBeGreaterThan(0);
      }
    }
  });

  it('every pack uses a valid risk-level (4-tier task or 6-tier tool)', () => {
    for (const path of discoverPackPaths()) {
      const manifest = parseSkillMd(readFileSync(path, 'utf-8'), path)!;
      expect(
        VALID_RISK_LEVELS.has(manifest.riskLevel),
        `pack ${manifest.name} has invalid risk-level '${manifest.riskLevel}'`,
      ).toBe(true);
    }
  });

  it('uses the new 6-tier ToolRiskLevel vocabulary in at least one pack', () => {
    // Item A explicitly calls for new risk-level values from the Item D
    // ToolRiskLevel lattice. If every pack falls back to the legacy 4-tier
    // vocabulary, we lose the precision Item D was meant to give us.
    const TOOL_LATTICE = new Set([
      'READ_ONLY',
      'DRAFT_ONLY',
      'SANDBOX_EDIT',
      'LOCAL_EXEC_ALLOWLIST',
      'EXTERNAL_ACTION_APPROVAL',
      'CRITICAL_MANUAL_ONLY',
    ]);
    const usingTool = discoverPackPaths()
      .map((p) => parseSkillMd(readFileSync(p, 'utf-8'), p)!)
      .some((m) => TOOL_LATTICE.has(m.riskLevel));
    expect(usingTool).toBe(true);
  });

  it('repo-reviewer pack declares the engineering-tier tools', () => {
    const path = join(publicSkillsDir, 'repo-reviewer', 'SKILL.md');
    const manifest = parseSkillMd(readFileSync(path, 'utf-8'), path)!;
    expect(manifest.allowedTools).toContain('read_repo');
    expect(manifest.allowedTools).toContain('scan_code');
  });

  it('browser-researcher pack is READ_ONLY (no side effects)', () => {
    const path = join(publicSkillsDir, 'browser-researcher', 'SKILL.md');
    const manifest = parseSkillMd(readFileSync(path, 'utf-8'), path)!;
    expect(manifest.riskLevel).toBe('READ_ONLY');
  });

  it('content-engine pack is DRAFT_ONLY (drafts but never publishes)', () => {
    const path = join(publicSkillsDir, 'content-engine', 'SKILL.md');
    const manifest = parseSkillMd(readFileSync(path, 'utf-8'), path)!;
    expect(manifest.riskLevel).toBe('DRAFT_ONLY');
  });
});
