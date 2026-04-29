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

import { join, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import {
  loadSkills as loadSkillsFromDir,
  formatSkillsForPrompt,
  type SkillManifest,
  type SkillRiskLevel,
} from '@jak-swarm/shared';

/**
 * Thrown when a root passed to `loadSkillsWithCascade` fails the
 * path-traversal guard. Distinct from generic Error so callers can
 * surface the offending root in audit logs without losing the type.
 */
export class SkillRootRejectedError extends Error {
  readonly root: string;
  readonly reason: 'contains-parent-segment' | 'outside-safe-roots';
  constructor(root: string, reason: 'contains-parent-segment' | 'outside-safe-roots') {
    super(`Skill root "${root}" rejected: ${reason}`);
    this.name = 'SkillRootRejectedError';
    this.root = root;
    this.reason = reason;
  }
}

export interface CascadeOptions {
  /**
   * If provided, every root must resolve inside one of these directories
   * (also resolved). Roots outside the allowlist throw
   * `SkillRootRejectedError`. Useful for the agent layer to confine
   * tenant-supplied skill paths to a managed directory tree.
   */
  safeRoots?: string[];
}

/** Returns true when the raw input contains a `..` segment. */
function hasParentSegment(input: string): boolean {
  // Match `..` as a path segment (not `..` inside a name like `foo..bar`).
  // Posix and win32 separators both checked.
  const normalized = input.replace(/\\/g, '/');
  return /(^|\/)\.\.(\/|$)/.test(normalized);
}

/** Returns true when `child` is `parent` or a subdirectory of it. */
function isInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

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
 * Load skill packs from a precedence-ordered list of root directories.
 *
 * Roots are processed in the order given — `roots[0]` has the highest
 * precedence. When two roots define a pack with the same `manifest.name`,
 * the higher-precedence pack wins (FIRST occurrence is kept).
 *
 * Recommended order for the full OpenClaw cascade:
 *   workspace > project > org > tenant > user > bundled
 *
 * Path-traversal guard:
 *   - Any root whose raw input contains a `..` segment is rejected with
 *     `SkillRootRejectedError('contains-parent-segment')` — defense
 *     against `tenants/abc/../../etc/passwd` shaped paths.
 *   - When `options.safeRoots` is provided, every root must resolve
 *     inside one of the safe roots; otherwise
 *     `SkillRootRejectedError('outside-safe-roots')` is thrown.
 *   - Missing directories DO NOT throw — they contribute zero packs and
 *     the cascade continues. This matches the existing
 *     `loadSkillsFromDir` contract for in-test / stripped environments.
 */
export function loadSkillsWithCascade(
  roots: string[],
  options: CascadeOptions = {},
): SkillManifest[] {
  const safe = options.safeRoots?.map((r) => resolve(r));

  const merged = new Map<string, SkillManifest>();

  for (const root of roots) {
    if (hasParentSegment(root)) {
      throw new SkillRootRejectedError(root, 'contains-parent-segment');
    }
    const resolvedRoot = resolve(root);
    if (safe && !safe.some((s) => isInside(resolvedRoot, s))) {
      throw new SkillRootRejectedError(root, 'outside-safe-roots');
    }
    if (!existsSync(resolvedRoot)) continue;

    const skills = loadSkillsFromDir(resolvedRoot);
    for (const skill of skills) {
      // FIRST wins: higher-precedence root listed earlier shadows later.
      if (!merged.has(skill.name)) {
        merged.set(skill.name, skill);
      }
    }
  }

  return Array.from(merged.values());
}

/**
 * Load every bundled skill pack. Returns an empty array when the
 * `public/` and `custom/` directories don't exist (so callers in
 * stripped-down test environments don't crash).
 *
 * Implemented on top of `loadSkillsWithCascade` so the bundled tier
 * shares the same path-traversal posture as the full cascade.
 */
export function loadBundledSkills(): SkillManifest[] {
  return loadSkillsWithCascade([bundledSkillsRoot()]);
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

// Re-exported for callers that want to detect (vs. swallow) traversal
// rejections via instanceof.
export type { CascadeOptions as SkillCascadeOptions };
