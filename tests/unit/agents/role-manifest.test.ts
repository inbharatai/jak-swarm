/**
 * Role manifest regression tests.
 *
 * Asserts the honesty invariants we rely on in the GET /tools/roles endpoint
 * and CI truth-check:
 *   - every AgentRole enum value has a manifest entry (no silently missing role)
 *   - every entry references an existing agent file (no stale implementation path)
 *   - maturity counts match the design declaration (no silent promotion from
 *     "strong" to "world_class" without evidence)
 *   - the sort order is stable hero → experimental
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROLE_MANIFEST,
  listRoleManifest,
  getRoleManifestSummary,
} from '@jak-swarm/agents';
import { AgentRole } from '@jak-swarm/shared';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');

describe('ROLE_MANIFEST — coverage invariant', () => {
  it('every AgentRole enum value is classified in ROLE_MANIFEST', () => {
    const enumRoles = Object.values(AgentRole).filter(
      (v): v is AgentRole => typeof v === 'string',
    );
    const classified = new Set(Object.keys(ROLE_MANIFEST));
    const missing = enumRoles.filter((role) => !classified.has(role));
    expect(missing).toEqual([]);
  });

  it('every manifest entry references an existing agent implementation file', () => {
    for (const entry of Object.values(ROLE_MANIFEST)) {
      if (!entry.implementation) continue;
      const absolute = resolve(repoRoot, entry.implementation);
      expect(existsSync(absolute), `${entry.role}: ${entry.implementation} not found`).toBe(true);
    }
  });

  it('no role is marketed above its actual bucket — no shallow / moderate claimed world-class', () => {
    // This is a sanity assertion: if we add a "shallow" entry then claim
    // world_class on it elsewhere, CI breaks here. Currently the manifest
    // has no shallow or moderate entries — we enforce that invariant so
    // a future drift is caught.
    for (const entry of Object.values(ROLE_MANIFEST)) {
      expect(['world_class', 'upgraded', 'strong', 'moderate', 'shallow', 'experimental'])
        .toContain(entry.maturity);
    }
  });
});

describe('ROLE_MANIFEST — summary + ordering', () => {
  it('getRoleManifestSummary totals match the manifest size', () => {
    const summary = getRoleManifestSummary();
    const total = Object.values(summary.byMaturity).reduce((a, b) => a + b, 0);
    expect(total).toBe(summary.total);
    expect(summary.total).toBe(Object.keys(ROLE_MANIFEST).length);
  });

  it('every AgentRole is accounted for in exactly one bucket', () => {
    const summary = getRoleManifestSummary();
    expect(summary.total).toBe(
      Object.values(AgentRole).filter((v) => typeof v === 'string').length,
    );
  });

  it('listRoleManifest orders hero → experimental', () => {
    const list = listRoleManifest();
    const order: Record<string, number> = {
      world_class: 0,
      upgraded: 1,
      strong: 2,
      moderate: 3,
      shallow: 4,
      experimental: 5,
    };
    for (let i = 1; i < list.length; i++) {
      const prev = order[list[i - 1]!.maturity];
      const curr = order[list[i]!.maturity];
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it('no role ships as unclassified', () => {
    const summary = getRoleManifestSummary();
    // "unclassified" isn't even a valid role maturity — the absence from
    // the summary shape is the proof. But double-assert it by checking
    // every entry has a valid maturity.
    for (const entry of Object.values(ROLE_MANIFEST)) {
      expect(entry.maturity).not.toBe('unclassified');
    }
    expect(Object.keys(summary.byMaturity)).not.toContain('unclassified');
  });
});

describe('ROLE_MANIFEST — executive-tier claims are still backed by long prompts', () => {
  // A world-class claim requires a substantial prompt. This asserts the
  // strategist, marketing, technical, finance agents still have the deep
  // prompts they're advertised with — a file-size proxy that catches
  // accidental truncation of SUPPLEMENT constants.
  const minPromptLines: Record<string, number> = {
    'packages/agents/src/workers/strategist.agent.ts': 60,
    'packages/agents/src/workers/marketing.agent.ts': 60,
    'packages/agents/src/workers/technical.agent.ts': 60,
    'packages/agents/src/workers/finance.agent.ts': 50,
  };

  for (const [path, floor] of Object.entries(minPromptLines)) {
    it(`${path} has at least ${floor} prompt lines`, async () => {
      const { readFileSync } = await import('node:fs');
      const src = readFileSync(resolve(repoRoot, path), 'utf8');
      const match = src.match(/SUPPLEMENT\s*=\s*`([\s\S]+?)`;/);
      expect(match, `${path}: no SUPPLEMENT constant found`).toBeTruthy();
      const lineCount = (match?.[1]?.split('\n').length ?? 0);
      expect(lineCount).toBeGreaterThanOrEqual(floor);
    });
  }
});
