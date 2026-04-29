/**
 * @jak-swarm/skills — Item A of the OpenClaw-inspired Phase 1.
 *
 * Thin re-export layer over the existing SKILL.md parser in
 * `@jak-swarm/shared`. The parser was 245 lines of dead code (no callers
 * outside its own re-exports) when this Phase 1 began. This package
 * gives it a real home, real packs, and a single import surface for
 * the agent layer.
 *
 * Bundled tier only (this Phase 1 ships only the public/* packs that
 * live alongside the parser). The full precedence cascade
 * (workspace > project > org > tenant > user > bundled) is documented
 * as Phase 2 work — additional skill directories compose cleanly by
 * passing them into `loadSkills()`.
 */

import { join } from 'node:path';
import {
  loadSkills as loadSkillsFromDir,
  formatSkillsForPrompt,
  type SkillManifest,
  type SkillRiskLevel,
} from '@jak-swarm/shared';

/**
 * Resolve the bundled skills directory. The package compiles to
 * `dist/index.js`, so the bundled packs at `packages/skills/{public,custom}`
 * sit one directory up from the compiled file.
 *
 * Uses CommonJS `__dirname` (automatic in CJS output) rather than
 * `import.meta.url` so this compiles cleanly under the repo's shared
 * `module: NodeNext` setup where consumer packages don't declare
 * `type: module`. If the consumer ships ESM and the package gets
 * recompiled as ESM, this branch resolves identically — Node provides
 * `__dirname` for CJS only and we emit CJS.
 */
function bundledSkillsRoot(): string {
  return join(__dirname, '..');
}

/**
 * Load every bundled skill pack. Returns an empty array when the
 * `public/` and `custom/` directories don't exist (so callers in
 * stripped-down test environments don't crash).
 */
export function loadBundledSkills(): SkillManifest[] {
  return loadSkillsFromDir(bundledSkillsRoot());
}

/**
 * Format the bundled skills for system-prompt injection. Returns an
 * empty string when no skills are bundled — agents that don't need a
 * skill block then get no extra system-prompt overhead.
 */
export function formatBundledSkillsForPrompt(): string {
  return formatSkillsForPrompt(loadBundledSkills());
}

/**
 * Format ONLY the skills whose `allowed-tools` overlap with `agentTools`.
 * Used by `BaseAgent.buildSystemMessage` so a CONTENT agent doesn't get
 * the repo-reviewer skill, and vice-versa.
 *
 * The match is name-based (substring or exact); a future enhancement
 * could be Trie-based for >100 packs, but for the bundled tier the
 * 4-pack worst case is fine as a linear scan.
 */
export function formatBundledSkillsForAgent(agentTools: string[]): string {
  const skills = loadBundledSkills();
  if (skills.length === 0 || agentTools.length === 0) return '';

  const allowedSet = new Set(agentTools.map((t) => t.toLowerCase()));
  const enabled = new Set<string>();
  for (const skill of skills) {
    for (const tool of skill.allowedTools) {
      if (allowedSet.has(tool.toLowerCase())) {
        enabled.add(skill.name);
        break;
      }
    }
  }

  if (enabled.size === 0) return '';
  return formatSkillsForPrompt(skills, enabled);
}

export {
  loadSkillsFromDir as loadSkills,
  formatSkillsForPrompt,
  type SkillManifest,
  type SkillRiskLevel,
};
