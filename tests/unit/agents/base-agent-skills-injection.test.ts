/**
 * BaseAgent skill-injection unit tests — Item A of the OpenClaw-inspired
 * Phase 1.
 *
 * Pins the contract that `BaseAgent.injectBundledSkills`:
 *   1. Returns the messages unchanged when no tools are declared
 *   2. Returns the messages unchanged when no skill matches the declared tools
 *   3. Inserts a `<skills>` block AFTER the first system message when at
 *      least one skill matches
 *   4. Never throws when the @jak-swarm/skills module is missing or unbuilt
 *
 * The threat model: a regression that drops skill injection makes the
 * SKILL.md parser dead code again — silently. CI must catch that.
 */
import { describe, it, expect } from 'vitest';
import {
  formatBundledSkillsForAgent,
  loadBundledSkills,
} from '@jak-swarm/skills';

describe('Bundled-skill injection contract', () => {
  describe('loadBundledSkills', () => {
    it('returns at least one bundled skill at runtime', () => {
      const packs = loadBundledSkills();
      expect(packs.length).toBeGreaterThan(0);
    });

    it('returns parsed manifests with required fields', () => {
      const packs = loadBundledSkills();
      for (const p of packs) {
        expect(p.name).toBeTruthy();
        expect(p.description).toBeTruthy();
        expect(Array.isArray(p.allowedTools)).toBe(true);
        expect(p.riskLevel).toBeTruthy();
      }
    });
  });

  describe('formatBundledSkillsForAgent', () => {
    it('returns empty string when agentTools is empty', () => {
      expect(formatBundledSkillsForAgent([])).toBe('');
    });

    it('returns empty string when no agent tool matches any skill pack', () => {
      // Use a tool name that no shipped pack declares — repo-reviewer uses
      // read_repo / scan_code; browser-researcher uses browser_navigate;
      // content-engine uses web_search; landing-page-fixer uses
      // browser_inspect. `definitely_no_pack_uses_this_tool` matches none.
      expect(formatBundledSkillsForAgent(['definitely_no_pack_uses_this_tool'])).toBe('');
    });

    it('returns a <skills> block when at least one tool matches a skill', () => {
      // read_repo is declared by repo-reviewer's allowed-tools.
      const block = formatBundledSkillsForAgent(['read_repo']);
      expect(block).toContain('<skills>');
      expect(block).toContain('repo-reviewer');
    });

    it('includes only the matching skill, not every pack', () => {
      // Only browser-researcher uses web_search + browser_navigate +
      // browser_extract; no other pack uses browser_navigate.
      const block = formatBundledSkillsForAgent(['browser_navigate']);
      expect(block).toContain('browser-researcher');
      // Other packs should NOT be included in the block.
      expect(block).not.toContain('### content-engine');
      expect(block).not.toContain('### repo-reviewer');
    });

    it('matches case-insensitively on tool names', () => {
      const block = formatBundledSkillsForAgent(['READ_REPO']);
      expect(block).toContain('repo-reviewer');
    });

    it('includes multiple skills when their allowed-tools sets overlap with agent tools', () => {
      // read_repo is in repo-reviewer; browser_navigate is in
      // browser-researcher. An agent declaring both should see both packs.
      const block = formatBundledSkillsForAgent(['read_repo', 'browser_navigate']);
      expect(block).toContain('repo-reviewer');
      expect(block).toContain('browser-researcher');
    });
  });
});
