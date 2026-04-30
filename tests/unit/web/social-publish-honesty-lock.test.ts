/**
 * Release-candidate truth-lock: social-publish language honesty.
 *
 * Locks the rule that NO source file in apps/ or packages/ may
 * contain a positive claim that JAK auto-publishes / auto-posts /
 * one-click-publishes to LinkedIn / Instagram / YouTube / Meta.
 *
 * Disclaimers are FINE ("never auto-posts", "no auto-publish") and
 * are matched + excluded explicitly. The forbidden shape is a
 * positive assertion ("can auto-publish", "auto-publish to LinkedIn",
 * "one-click publish", etc.).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');

const SCAN_DIRS = [
  'apps/web/src',
  'apps/api/src',
  'packages/agents/src',
  'packages/tools/src',
  'packages/shared/src',
  'docs',
];

/** Forbidden positive claims (regex). */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // "can auto-publish" / "will auto-post" / "able to autopost"
  {
    pattern: /\b(can|will|able to)\b[\s\S]{0,40}\b(auto[- ]?publish|auto[- ]?post|autopost|autopublish)\b/i,
    label: 'positive auto-publish/post claim',
  },
  // "one-click publish" — promises one-click publishing
  { pattern: /\bone[- ]click[\s-]+(publish|post)\b/i, label: 'one-click publish' },
  // "fully autonomous publishing/posting"
  { pattern: /\bfully autonomous (publishing|posting)\b/i, label: 'fully autonomous publishing' },
  // "no human needed" — implies no approval
  { pattern: /\bno human (needed|required)\b/i, label: 'no human needed' },
  // "complete social automation" — implies full posting automation
  { pattern: /\bcomplete social automation\b/i, label: 'complete social automation' },
];

/** Walks dir, returns absolute paths of relevant source files. */
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile() && /\.(ts|tsx|md)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('Social-publish language honesty (release-candidate truth-lock)', () => {
  const files: string[] = [];
  for (const sub of SCAN_DIRS) {
    files.push(...walk(resolve(REPO_ROOT, sub)));
  }

  it('scans a real number of files (sanity check)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    it(`no file contains a positive "${label}" claim`, () => {
      const violations: Array<{ file: string; match: string }> = [];
      for (const file of files) {
        let content: string;
        try {
          content = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        // Scan line-by-line so we can attribute violations precisely.
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          // Skip comment-only lines that are explicit disclaimers.
          // Simple heuristic: if the line starts with `//` or `*` and
          // contains a NEGATION of the pattern, treat as disclaimer.
          const trimmed = line.trim();
          const isCommentLine = /^(\/\/|\*|#)/.test(trimmed);
          if (isCommentLine && /\b(never|no|not|don'?t|disallow|reject|forbid|out of scope|deferred)\b/i.test(line)) {
            continue;
          }
          // Common explicit disclaimer phrases anywhere on the line —
          // also skip. These are the negative form of the claim.
          if (/\b(never auto[- ]?(publish|post)|does NOT auto|JAK never|no auto[- ]?publish)\b/i.test(line)) {
            continue;
          }
          if (pattern.test(line)) {
            violations.push({ file: file.replace(REPO_ROOT, ''), match: line.trim().slice(0, 200) });
          }
        }
      }
      expect(
        violations,
        `Forbidden "${label}" claim found:\n${violations.map((v) => `  ${v.file}: ${v.match}`).join('\n')}`,
      ).toEqual([]);
    });
  }
});
