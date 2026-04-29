/**
 * GAP 4 — Skill cascade.
 *
 * Tests the ordered-precedence loader (`loadSkillsWithCascade`) and the
 * path-traversal guard. Higher-precedence root listed earlier shadows
 * lower; missing roots contribute zero packs without throwing; raw `..`
 * segments and roots outside `safeRoots` throw `SkillRootRejectedError`.
 *
 * The cascade design follows the OpenClaw precedence order
 * (workspace > project > org > tenant > user > bundled). This Phase 1.1
 * ships the loader; the agent-layer wiring of additional roots is Phase 2.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSkillsWithCascade,
  loadBundledSkills,
  SkillRootRejectedError,
} from '@jak-swarm/skills';

function writeSkillPack(rootDir: string, name: string, body = 'body'): void {
  const packDir = join(rootDir, 'public', name);
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'SKILL.md'),
    `---
name: ${name}
description: test pack ${name}
version: 1.0.0
allowed-tools:
  - read_repo
risk-level: READ_ONLY
---

${body}
`,
    'utf8',
  );
}

let scratchA: string;
let scratchB: string;
let scratchSafeParent: string;
let scratchSafeChild: string;

beforeAll(() => {
  scratchA = mkdtempSync(join(tmpdir(), 'jak-skills-a-'));
  scratchB = mkdtempSync(join(tmpdir(), 'jak-skills-b-'));
  scratchSafeParent = mkdtempSync(join(tmpdir(), 'jak-skills-safe-'));
  scratchSafeChild = join(scratchSafeParent, 'child');
  mkdirSync(scratchSafeChild, { recursive: true });

  // Pack `repo-reviewer` exists in BOTH roots with different bodies.
  // Pack `only-in-a` exists in A only.
  writeSkillPack(scratchA, 'repo-reviewer', 'Body from A (high precedence)');
  writeSkillPack(scratchA, 'only-in-a', 'A-only body');
  writeSkillPack(scratchB, 'repo-reviewer', 'Body from B (low precedence)');
  writeSkillPack(scratchB, 'only-in-b', 'B-only body');

  // Pack inside the safe parent for the safe-roots test.
  writeSkillPack(scratchSafeChild, 'safe-pack', 'Safe pack');
});

afterAll(() => {
  for (const d of [scratchA, scratchB, scratchSafeParent]) {
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('loadSkillsWithCascade', () => {
  it('higher-precedence root shadows lower-precedence with the same skill name', () => {
    // A first → A wins for the dup; B contributes only `only-in-b`.
    const skills = loadSkillsWithCascade([scratchA, scratchB]);
    const byName = new Map(skills.map((s) => [s.name, s] as const));

    expect(byName.has('repo-reviewer')).toBe(true);
    expect(byName.has('only-in-a')).toBe(true);
    expect(byName.has('only-in-b')).toBe(true);

    // Body of repo-reviewer must come from A (higher precedence).
    expect(byName.get('repo-reviewer')!.body).toContain('Body from A');
    expect(byName.get('repo-reviewer')!.body).not.toContain('Body from B');
  });

  it('reverses cleanly when precedence order is flipped', () => {
    const skills = loadSkillsWithCascade([scratchB, scratchA]);
    const repoReviewer = skills.find((s) => s.name === 'repo-reviewer')!;
    expect(repoReviewer.body).toContain('Body from B');
    expect(repoReviewer.body).not.toContain('Body from A');
  });

  it('rejects a root whose raw input contains a `..` segment', () => {
    expect(() =>
      loadSkillsWithCascade([`${scratchA}/../../etc`]),
    ).toThrowError(SkillRootRejectedError);

    try {
      loadSkillsWithCascade([`${scratchA}/../../etc`]);
    } catch (err) {
      expect(err).toBeInstanceOf(SkillRootRejectedError);
      expect((err as SkillRootRejectedError).reason).toBe('contains-parent-segment');
    }
  });

  it('rejects a root that resolves outside the `safeRoots` allowlist', () => {
    // scratchB is outside scratchSafeParent — must be rejected.
    expect(() =>
      loadSkillsWithCascade([scratchB], { safeRoots: [scratchSafeParent] }),
    ).toThrowError(SkillRootRejectedError);

    try {
      loadSkillsWithCascade([scratchB], { safeRoots: [scratchSafeParent] });
    } catch (err) {
      expect((err as SkillRootRejectedError).reason).toBe('outside-safe-roots');
    }

    // scratchSafeChild is inside scratchSafeParent — must succeed.
    const skills = loadSkillsWithCascade([scratchSafeChild], {
      safeRoots: [scratchSafeParent],
    });
    expect(skills.find((s) => s.name === 'safe-pack')).toBeDefined();
  });

  it('returns an empty array for a missing root without throwing', () => {
    const missing = join(tmpdir(), 'jak-skills-does-not-exist-' + Date.now());
    const skills = loadSkillsWithCascade([missing]);
    expect(skills).toEqual([]);
  });

  it('skips missing roots in a multi-root cascade and uses the present ones', () => {
    const missing = join(tmpdir(), 'jak-skills-also-gone-' + Date.now());
    const skills = loadSkillsWithCascade([missing, scratchA]);
    expect(skills.find((s) => s.name === 'only-in-a')).toBeDefined();
  });
});

describe('loadBundledSkills (regression)', () => {
  it('still loads the 4 bundled packs after the cascade refactor', () => {
    // The cascade refactor must not break the existing bundled-tier API.
    // The 4 bundled packs ship in packages/skills/public/.
    const bundled = loadBundledSkills();
    const names = new Set(bundled.map((s) => s.name));

    // Be permissive: assert the cascade returns at least the 4 known packs.
    // If new packs ship later, this assertion still holds.
    expect(names.has('repo-reviewer')).toBe(true);
    expect(names.has('landing-page-fixer')).toBe(true);
    expect(names.has('browser-researcher')).toBe(true);
    expect(names.has('content-engine')).toBe(true);
  });
});
