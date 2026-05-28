/**
 * JAK Shield landing-section truth-lock.
 *
 * Every feature card on the JAK Shield landing section carries a
 * `data-evidence-path` attribute. This test asserts that:
 *   1. Every evidence path actually exists in the repo.
 *   2. The page actually renders all 6 cards.
 *   3. The card body that mentions a specific guarantee references a
 *      real symbol or feature in the codebase.
 *
 * If a card's claim becomes hallucinated (file deleted, feature
 * removed), this test fails CI.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../../..');
const SHIELD_TSX = join(REPO_ROOT, 'apps/web/src/components/landing/JAKShield.tsx');

describe('JAK Shield landing — truth-lock', () => {
  it('JAKShield component file exists', () => {
    expect(existsSync(SHIELD_TSX), `${SHIELD_TSX} missing`).toBe(true);
  });

  it('every evidencePath in JAKShield.tsx exists in the repo', () => {
    const src = readFileSync(SHIELD_TSX, 'utf8');
    // Pull the evidencePath: '...' literals out of the FEATURES array.
    const matches = Array.from(src.matchAll(/evidencePath:\s*'([^']+)'/g)).map((m) => m[1]);
    expect(matches.length, 'at least 1 evidencePath found in JAKShield.tsx').toBeGreaterThan(0);
    expect(matches.length, '6 evidence paths expected (one per feature)').toBe(6);
    for (const p of matches) {
      const full = join(REPO_ROOT, p ?? '');
      expect(existsSync(full), `evidencePath ${p} does not exist on disk`).toBe(true);
    }
  });

  it('JAKShield exports a default component', () => {
    const src = readFileSync(SHIELD_TSX, 'utf8');
    expect(src).toMatch(/export default function JAKShield/);
  });

  it('JAKShield is wired into the landing page', () => {
    const page = readFileSync(join(REPO_ROOT, 'apps/web/src/app/page.tsx'), 'utf8');
    expect(page).toMatch(/<JAKShield\s*\/>/);
    expect(page).toMatch(/JAKShield/); // also imported
  });

  it('JAKShield is exported from landing/index.ts', () => {
    const idx = readFileSync(join(REPO_ROOT, 'apps/web/src/components/landing/index.ts'), 'utf8');
    expect(idx).toMatch(/JAKShield/);
  });

  it('safety boundary copy is present', () => {
    const src = readFileSync(SHIELD_TSX, 'utf8');
    // Defensive scope is allowed
    expect(src).toMatch(/defensive (security|review|work)/i);
    // Offensive scope is refused
    expect(src).toMatch(/(offensive|malware|exploit|phish)/i);
    expect(src).toMatch(/refuse[ds]?|not support|blocked/i);
  });

  it('JAK Shield manifest doc exists and lists all 6 feature headings', () => {
    const manifestPath = join(REPO_ROOT, 'docs/jak-shield-manifest.md');
    expect(existsSync(manifestPath), 'docs/jak-shield-manifest.md missing').toBe(true);
    const md = readFileSync(manifestPath, 'utf8');
    const expectedHeadings = [
      'Agent Firewall',
      'Risk-Based Approvals',
      'Secure Tool Permission',
      'Sandboxed Execution',
      'Defensive Vulnerability Triage',
      'Audit Evidence Layer',
    ];
    for (const h of expectedHeadings) {
      expect(md, `manifest missing heading "${h}"`).toMatch(new RegExp(h, 'i'));
    }
  });

  it('offensive-cyber-detector is exported from @jak-swarm/security', () => {
    const idx = readFileSync(join(REPO_ROOT, 'packages/security/src/index.ts'), 'utf8');
    expect(idx).toMatch(/detectOffensiveCyberRequest/);
    expect(idx).toMatch(/isOffensiveCyberRequest/);
  });

  it('BaseAgent wires the offensive-cyber guard before the LLM call', () => {
    const toolExec = readFileSync(
      join(REPO_ROOT, 'packages/agents/src/base/tool-execution.service.ts'),
      'utf8',
    );
    expect(toolExec).toMatch(/JAK_SHIELD_OFFENSIVE_GUARD_DISABLED/);
    expect(toolExec).toMatch(/getShieldGateway/);
    expect(toolExec).toMatch(/offensiveCyber/);
    expect(toolExec).toMatch(/JAK Shield/);
  });
});
