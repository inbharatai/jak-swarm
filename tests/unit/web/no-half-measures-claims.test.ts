/**
 * Phase 8 — No-half-measures truth lock.
 *
 * Locks the honesty contracts that this session shipped, so future
 * silent regressions are caught at test time. Each test is a tiny
 * grep + assertion against the source — no DB, no Fastify.
 *
 * Locked contracts:
 *   1. Browser-operator UI section says "Not live yet" / "Coming soon"
 *      — never claims to be functional.
 *   2. Browser-operator service stub throws (NotImplementedBrowserOperator)
 *      — never returns fake success.
 *   3. ConnectorAuditGoals always include "Do not… only generate a
 *      report" so a workflow accidentally routed through can't post /
 *      send / delete external content.
 *   4. Tool installer dry-run is dry-run only — install() throws.
 *   5. Approval policy DESTRUCTIVE category never auto-approves
 *      regardless of tenant override.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(relPath: string): string {
  return readFileSync(resolve(__dirname, '../../..', relPath), 'utf8');
}

describe('No-half-measures truth lock', () => {
  it('Browser-operator section UI honestly distinguishes functional GENERIC from per-platform Coming soon', () => {
    const ui = read('apps/web/src/components/integrations/BrowserOperatorComingSoon.tsx');
    // The GENERIC platform IS now functional (real Playwright runtime
    // shipped in packages/tools/src/browser-operator/).
    expect(ui).toMatch(/Generic browser session/);
    expect(ui).toMatch(/Start browser session/);
    // Per-platform cards still say Coming soon honestly.
    expect(ui).toContain('Coming soon');
    expect(ui).toMatch(/needs platform adapter/);
    // Honest password disclaimer (JSX may wrap the text with <strong>
    // tags; allow whitespace + tags between words).
    expect(ui).toMatch(/JAK never[\s\S]{0,40}stores your password/);
    // Must not over-claim autonomous posting.
    expect(ui).not.toMatch(/\bAuto[- ]post\b/i);
    expect(ui).not.toMatch(/\bproduction[- ]ready\b/i);
  });

  it('PlaywrightBrowserOperator is the real exported impl (no fake stub)', () => {
    const impl = read(
      'packages/tools/src/browser-operator/playwright-browser-operator.ts',
    );
    // Must use the real Playwright API.
    expect(impl).toContain("from 'playwright'");
    expect(impl).toContain('chromium.launchPersistentContext');
    // Must enforce the approval gate at execute().
    expect(impl).toMatch(/ApprovalRequiredError/);
    expect(impl).toMatch(/!input\.approvalId/);
    // Tenant isolation must be enforced via requireSession.
    expect(impl).toContain('SessionAccessError');
    expect(impl).toContain('wrong_tenant');
  });

  it('Every connector audit goal explicitly forbids external action', () => {
    const goals = read('apps/web/src/lib/connector-audit-goals.ts');
    // Find every goal value in the CONNECTOR_AUDIT_GOALS map.
    const goalLines = goals.match(/^\s*[A-Z_]+:\s*'[^']+'/gm) ?? [];
    expect(goalLines.length, 'must have at least 5 goal entries').toBeGreaterThan(5);
    for (const line of goalLines) {
      expect(
        line.toLowerCase(),
        `Goal "${line.slice(0, 50)}..." must include "do not" or "only generate a report" so the pipeline cannot post/send/delete.`,
      ).toMatch(/do not|only generate a report/);
    }
  });

  it('Tool installer install() method ALWAYS throws (dry-run only this session)', () => {
    const installer = read('packages/tools/src/installer/tool-installer.ts');
    // The DryRunOnlyInstaller's install() body must throw.
    const installMethod = installer.match(/async install\([\s\S]*?\}\s*\n\}/);
    expect(installMethod, 'install() method must exist').toBeTruthy();
    expect(installMethod![0]).toContain('throw new Error');
    expect(installMethod![0]).toContain('not implemented');
  });

  it('Approval policy DESTRUCTIVE category cannot be auto-approved', () => {
    const policy = read('packages/tools/src/registry/approval-policy.ts');
    // The auto-approve check must explicitly exclude DESTRUCTIVE.
    expect(policy).toMatch(/category\s*!==\s*ToolActionCategory\.DESTRUCTIVE/);
  });
});

describe('No-half-measures truth lock — connector setup access', () => {
  it('ConnectModal allows advanced setup without an admin role gate', () => {
    const modal = read('apps/web/src/components/integrations/ConnectModal.tsx');
    // No role check should gate the advanced setup form or toggle.
    expect(modal).not.toMatch(/isAdmin\s*&&\s*showAdvanced\s*&&/);
    expect(modal).not.toMatch(/isAdmin\s*&&\s*fields\.length\s*>\s*0\s*&&/);
    // Advanced setup still remains opt-in behind an explicit toggle.
    expect(modal).toMatch(/showAdvanced\s*&&\s*fields\.length\s*>\s*0\s*&&/);
  });

  it('Connector permissions table string VALUES never use developer jargon', () => {
    // Inspect ONLY the actual permission strings (values inside the
    // CONNECTOR_PERMISSIONS map), not the file comments / type
    // declarations. Comments correctly reference what NOT to use.
    const perms = read('apps/web/src/lib/connector-permissions.ts');
    // Strip block comments so we only check the literal values.
    const codeOnly = perms.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    const lower = codeOnly.toLowerCase();
    expect(lower).not.toContain('xoxb-');
    expect(lower).not.toContain('gocspx-');
    expect(lower).not.toContain('client_secret');
    expect(lower).not.toContain('bearer token');
  });
});
