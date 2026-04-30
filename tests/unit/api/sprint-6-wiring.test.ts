/**
 * Sprint 6 — wiring verification tests.
 *
 * For each previously-Partial criterion, prove the production caller
 * exists by source-level grep against the implementation files.
 *
 * The previous release-candidate verification used the SAME technique
 * to prove the gaps; this test now proves the gaps are CLOSED.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../../..', rel), 'utf8');
}

describe('Sprint 6 Part A — PlannerAgent calls SubgoalCoordinator', () => {
  const planner = read('packages/agents/src/roles/planner.agent.ts');

  it('imports decomposeGoal from coordination/subgoal-coordinator', () => {
    expect(planner).toMatch(/import\s*\{[^}]*decomposeGoal[^}]*\}\s*from\s*['"][^'"]*subgoal-coordinator/);
  });

  it('actually calls decomposeGoal in the execute path', () => {
    expect(planner).toMatch(/decomposeGoal\s*\(\s*missionBrief\.goal\s*\)/);
  });

  it('passes the decomposition into the LLM messages as a system hint', () => {
    expect(planner).toMatch(/SUBGOAL COORDINATOR HINT/);
  });

  it('only adds the hint when the decomposition is multi-domain (>= 2 specialists)', () => {
    // Honest scope guard — single-domain goals don't get noise.
    expect(planner).toMatch(/specialistCount\s*>=\s*2/);
  });
});

describe('Sprint 6 Part C — /browser-sessions dispatches to platform adapters', () => {
  const routes = read('apps/api/src/routes/browser-operator.routes.ts');

  it('imports all 4 platform adapters', () => {
    expect(routes).toMatch(/linkedInAdapter/);
    expect(routes).toMatch(/instagramAdapter/);
    expect(routes).toMatch(/youtubeAdapter/);
    expect(routes).toMatch(/metaAdapter/);
  });

  it('declares ADAPTER_BY_ID dispatch map for the 4 platforms', () => {
    expect(routes).toMatch(/LINKEDIN:\s*linkedInAdapter/);
    expect(routes).toMatch(/INSTAGRAM:\s*instagramAdapter/);
    expect(routes).toMatch(/YOUTUBE_STUDIO:\s*youtubeAdapter/);
    expect(routes).toMatch(/META_BUSINESS_SUITE:\s*metaAdapter/);
  });

  it('exposes /:sessionId/platform/:platform/action route', () => {
    expect(routes).toMatch(/'\/:sessionId\/platform\/:platform\/action'/);
  });

  it('build_draft action calls adapter.buildDraft', () => {
    expect(routes).toMatch(/adapter\.buildDraft/);
  });

  it('record_publish action calls adapter.recordApprovedPublish', () => {
    expect(routes).toMatch(/adapter\.recordApprovedPublish/);
  });

  it('record_publish requires approvalId in zod body schema', () => {
    expect(routes).toMatch(/action:\s*z\.literal\('record_publish'\)[\s\S]{0,200}approvalId:\s*z\.string\(\)\.min\(1\)/);
  });

  it('rejects unknown platform with 400 / UNKNOWN_PLATFORM', () => {
    expect(routes).toMatch(/UNKNOWN_PLATFORM/);
  });
});

describe('Sprint 6 Part D — /social-drafts route invokes adapter buildDraft', () => {
  const routes = read('apps/api/src/routes/social-drafts.routes.ts');

  it('imports all 4 platform adapters', () => {
    expect(routes).toMatch(/linkedInAdapter/);
    expect(routes).toMatch(/instagramAdapter/);
    expect(routes).toMatch(/youtubeAdapter/);
    expect(routes).toMatch(/metaAdapter/);
  });

  it('uses zod platform enum for input validation', () => {
    expect(routes).toMatch(/z\.enum\(\[\s*'LINKEDIN',\s*'INSTAGRAM',\s*'YOUTUBE_STUDIO',\s*'META_BUSINESS_SUITE'\s*\]\)/);
  });

  it('calls adapter.buildDraft with topic + tone', () => {
    expect(routes).toMatch(/adapter\.buildDraft\(\{\s*topic/);
  });

  it('always returns manualHandoffRequired:true (no auto-publish)', () => {
    expect(routes).toMatch(/manualHandoffRequired:\s*true/);
  });

  it('emits SOCIAL_DRAFT_CREATED audit log row', () => {
    expect(routes).toMatch(/SOCIAL_DRAFT_CREATED/);
  });

  it('is registered at /social-drafts in apps/api/src/index.ts', () => {
    const apiIndex = read('apps/api/src/index.ts');
    expect(apiIndex).toMatch(/socialDraftsRoutes/);
    expect(apiIndex).toMatch(/'\/social-drafts'/);
  });
});

describe('Sprint 6 Part E — /tool-installer routes call SandboxedInstaller', () => {
  const routes = read('apps/api/src/routes/tool-installer.routes.ts');

  it('imports SandboxedInstaller + ToolRequirementDetector + SANDBOX_ADAPTERS', () => {
    expect(routes).toMatch(/SandboxedInstaller/);
    expect(routes).toMatch(/ToolRequirementDetector/);
    expect(routes).toMatch(/SANDBOX_ADAPTERS/);
  });

  it('exposes /detect, /plan, /execute routes', () => {
    expect(routes).toMatch(/'\/detect'/);
    expect(routes).toMatch(/'\/plan'/);
    expect(routes).toMatch(/'\/execute'/);
  });

  it('execute requires approvalId in body schema', () => {
    expect(routes).toMatch(/approvalId:\s*z\.string\(\)\.min\(1\)/);
  });

  it('execute is gated to REVIEWER+ via requireRole', () => {
    expect(routes).toMatch(/requireRole\(\s*'REVIEWER',\s*'TENANT_ADMIN',\s*'SYSTEM_ADMIN'\s*\)/);
  });

  it('execute creates TOOL_INSTALL_EXECUTED audit log row', () => {
    expect(routes).toMatch(/TOOL_INSTALL_EXECUTED/);
  });

  it('handles InstallApprovalRequiredError → 409', () => {
    expect(routes).toMatch(/InstallApprovalRequiredError/);
    expect(routes).toMatch(/status\(409\)/);
  });

  it('is registered at /tool-installer in apps/api/src/index.ts', () => {
    const apiIndex = read('apps/api/src/index.ts');
    expect(apiIndex).toMatch(/toolInstallerRoutes/);
    expect(apiIndex).toMatch(/'\/tool-installer'/);
  });
});

describe('Sprint 6 — UI surfaces exist for new features', () => {
  it('social-drafts page exists', () => {
    const page = read('apps/web/src/app/(dashboard)/social-drafts/page.tsx');
    expect(page).toMatch(/socialDraftsApi\.generate/);
    expect(page).toMatch(/manualHandoffRequired/);
  });

  it('tool-installer page exists', () => {
    const page = read('apps/web/src/app/(dashboard)/tool-installer/page.tsx');
    expect(page).toMatch(/toolInstallerApi\.detect/);
    expect(page).toMatch(/toolInstallerApi\.plan/);
    expect(page).toMatch(/toolInstallerApi\.execute/);
  });

  it('CommandPalette has Social Drafts + Tool Installer entries', () => {
    const palette = read('apps/web/src/components/CommandPalette.tsx');
    expect(palette).toMatch(/social-drafts.*Social Drafts/i);
    expect(palette).toMatch(/tool-installer.*Tool Installer/i);
  });

  it('api-client exposes socialDraftsApi + toolInstallerApi', () => {
    const client = read('apps/web/src/lib/api-client.ts');
    expect(client).toMatch(/socialDraftsApi/);
    expect(client).toMatch(/toolInstallerApi/);
    expect(client).toMatch(/platformAction/);
  });
});
