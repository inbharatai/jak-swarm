/**
 * Landing claim → code truth-lock.
 *
 * Public messaging must remain tied to implemented files, routes, migrations,
 * and plan configuration. Quantitative registry counts are also checked by
 * `pnpm check:truth`.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../../..');

function exists(rel: string): boolean {
  return existsSync(join(REPO_ROOT, rel));
}

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

function contains(rel: string, pattern: RegExp | string): boolean {
  if (!exists(rel)) return false;
  const source = read(rel);
  return typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
}

function evidencePaths(rel: string): string[] {
  return Array.from(read(rel).matchAll(/evidencePath:\s*'([^']+)'/g)).map((match) => match[1]!);
}

describe('Landing — multiplayer category and hero', () => {
  it('leads with the shared human-agent workspace', () => {
    const page = read('apps/web/src/app/page.tsx');
    expect(page).toContain('One live workspace for');
    expect(page).toContain('humans and AI agents');
    for (const term of ['watch', 'redirect', 'hand work to a person', 'approve', 'replay', 'task graph']) {
      expect(page.toLowerCase()).toContain(term.toLowerCase());
    }
    expect(page).toContain('<MultiplayerPreview />');
    expect(page).toContain('<MultiplayerSection />');
  });

  it('navigation leads with Multiplayer and keeps the defensive trust layer visible', () => {
    const nav = read('apps/web/src/components/landing/LandingNavClient.tsx');
    expect(nav).toContain("href: '#multiplayer'");
    expect(nav).toContain("label: 'Multiplayer'");
    expect(nav).toContain('href="#jak-shield"');
    expect(nav).toContain('JAK Shield');
  });

  it('metadata, manifest, and social card use the same category', () => {
    expect(read('apps/web/src/app/layout.tsx')).toMatch(/Multiplayer AI for Human-Agent Teams/);
    expect(read('apps/web/public/manifest.json')).toMatch(/Multiplayer AI for Human-Agent Teams/);
    expect(read('apps/web/public/og-image.svg')).toMatch(/MULTIPLAYER AI/);
    expect(read('apps/web/public/og-image.svg')).toMatch(/humans and AI agents/);
  });
});

describe('Landing — multiplayer implementation claims', () => {
  const SECTION = 'apps/web/src/components/landing/MultiplayerSection.tsx';
  const PREVIEW = 'apps/web/src/components/landing/MultiplayerPreview.tsx';
  const ROUTES = 'apps/api/src/routes/workflow-collaboration.routes.ts';
  const SERVICE = 'apps/api/src/services/workflow-collaboration.service.ts';
  const ASSIGNMENTS = 'apps/api/src/routes/task-assignments.routes.ts';

  it('renders the multiplayer section and preview on the live homepage', () => {
    expect(exists(SECTION)).toBe(true);
    expect(exists(PREVIEW)).toBe(true);
    expect(contains(SECTION, /id="multiplayer"/)).toBe(true);
    expect(contains('apps/web/src/app/page.tsx', /<MultiplayerSection\s*\/>/)).toBe(true);
    expect(contains('apps/web/src/app/page.tsx', /<MultiplayerPreview\s*\/>/)).toBe(true);
  });

  it('every multiplayer evidence path exists', () => {
    const paths = evidencePaths(SECTION);
    expect(paths).toHaveLength(6);
    for (const path of paths) expect(exists(path), `missing evidence path: ${path}`).toBe(true);
  });

  it('shared participants, presence, comments, redirect, and replay routes exist', () => {
    const routes = read(ROUTES);
    for (const route of [
      '/:workflowId/participants',
      '/:workflowId/participants/join',
      '/:workflowId/participants/heartbeat',
      '/:workflowId/session-events',
      '/:workflowId/comments',
      '/:workflowId/tasks/:taskId/redirect',
      '/:workflowId/replay',
    ]) {
      expect(routes).toContain(route);
    }
    expect(routes).toContain('WORKFLOW_MUST_BE_PAUSED');
    expect(routes).toContain('TASK_CONTROL_HELD');
  });

  it('collaboration persistence and exclusive task control are implemented', () => {
    const service = read(SERVICE);
    expect(service).toContain('workflow_participants');
    expect(service).toContain('workflow_session_events');
    expect(service).toContain('controlLeaseUntil');
    expect(service).toContain('redirectTask');
    expect(service).toContain('applyHumanTaskResult');

    const migration = read('packages/db/prisma/migrations/125_multiplayer_collaboration/migration.sql');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "workflow_participants"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "workflow_session_events"');
  });

  it('human assignment completion writes state and requests workflow resume', () => {
    const assignments = read(ASSIGNMENTS);
    expect(assignments).toContain('markHumanTaskPending');
    expect(assignments).toContain('applyHumanTaskResult');
    expect(assignments).toContain('human_task_completed');
    expect(assignments).toContain('requestWorkflowResume');
    expect(assignments).toContain("type: 'unpause'");
  });

  it('the public copy keeps the beta boundary explicit', () => {
    const section = read(SECTION);
    expect(section).toMatch(/Beta boundary/);
    expect(section).toMatch(/not yet a character-level collaborative document editor/i);
    expect(section).not.toMatch(/fully autonomous enterprise/i);
  });
});

describe('Landing — Company Brain and Hyperagent foundations', () => {
  const COMPANY = 'apps/web/src/components/landing/CompanyBrain.tsx';
  const HYPER = 'apps/web/src/components/landing/Hyperagent.tsx';
  const DUO = 'apps/web/src/components/landing/EngineDuo.tsx';

  it('renders both foundations after the multiplayer category', () => {
    const page = read('apps/web/src/app/page.tsx');
    expect(page).toContain('<EngineDuo />');
    expect(page).toContain('<CompanyBrain />');
    expect(page).toContain('<Hyperagent />');
  });

  it('Company Brain evidence paths exist and the copy is setup-honest', () => {
    expect(contains(COMPANY, /id="company-os"/)).toBe(true);
    const paths = evidencePaths(COMPANY);
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const path of paths) expect(exists(path), `missing Company Brain path: ${path}`).toBe(true);
    expect(read(COMPANY)).toMatch(/Connector sync is setup-dependent/i);
    expect(read(COMPANY)).not.toMatch(/complete company-wide operating system/i);
  });

  it('Hyperagent stays default-off and does not claim production proof', () => {
    const source = read(HYPER);
    expect(source).toMatch(/self-healing/i);
    expect(source).toMatch(/re-plan/i);
    expect(source).toMatch(/not production-proven|integration-proven/i);
    expect(source).toMatch(/default-off|artifacts: \[\]|Open edge/i);
    const paths = evidencePaths(HYPER);
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const path of paths) expect(exists(path), `missing Hyperagent path: ${path}`).toBe(true);
  });

  it('EngineDuo links to both detailed foundation sections', () => {
    const source = read(DUO);
    expect(source).toMatch(/Company Brain/);
    expect(source).toMatch(/Hyperagent/);
    expect(source).toMatch(/href: '#company-os'/);
    expect(source).toMatch(/href: '#hyperagent'/);
  });
});

describe('Landing — execution and trust claims', () => {
  it('keeps the seven-stage runtime section wired', () => {
    const how = read('apps/web/src/components/landing/HowItWorks.tsx');
    expect(how.match(/n:\s*[1-7],\s+label:/g) ?? []).toHaveLength(7);
    expect(exists('packages/agents/src/roles/commander.agent.ts')).toBe(true);
    expect(exists('packages/agents/src/roles/planner.agent.ts')).toBe(true);
    expect(exists('packages/agents/src/roles/router.agent.ts')).toBe(true);
    expect(exists('packages/agents/src/roles/verifier.agent.ts')).toBe(true);
    expect(exists('apps/api/src/services/bundle-signing.service.ts')).toBe(true);
  });

  it('outcome cards point to implemented services', () => {
    const show = read('apps/web/src/components/landing/ShowTheWork.tsx');
    expect(show).toMatch(/Execution drift brief/i);
    expect(show).toMatch(/Agent-executable product spec/i);
    expect(show).toMatch(/Browser QA/i);
    expect(show).toMatch(/Audit-ready evidence/i);
    expect(exists('packages/tools/src/browser-operator/playwright-browser-operator.ts')).toBe(true);
    expect(exists('apps/api/src/routes/audit-runs.routes.ts')).toBe(true);
  });

  it('trust guarantees are backed by policy and signing code', () => {
    const trust = read('apps/web/src/components/landing/TrustLayer.tsx');
    expect(trust).toMatch(/Human approval gates/);
    expect(trust).toMatch(/Source-grounded/);
    expect(trust).toMatch(/Tool maturity labels/);
    expect(trust).toMatch(/Tamper-evident audit trail/);
    expect(trust).toMatch(/Self-hostable open-source core/);
    expect(exists('packages/tools/src/registry/approval-policy.ts')).toBe(true);
    expect(contains('apps/api/src/services/bundle-signing.service.ts', /createHmac/i)).toBe(true);
    expect(contains('LICENSE', /MIT/i)).toBe(true);
  });

  it('JAK Shield remains defensive and live on the homepage', () => {
    const shield = read('apps/web/src/components/landing/JAKShield.tsx');
    expect(contains('apps/web/src/app/page.tsx', /<JAKShield\s*\/>/)).toBe(true);
    expect(shield).toMatch(/defensive (security|review|work|automation)/i);
    expect(shield).toMatch(/malware|exploit|phish|credential theft/i);
    expect(shield).toMatch(/refuse|not support|blocked|does not/i);
    for (const path of evidencePaths('apps/web/src/components/landing/JAKShield.tsx')) {
      expect(exists(path), `missing Shield path: ${path}`).toBe(true);
    }
  });
});

describe('Landing — pricing and counts', () => {
  it('hosted pricing mirrors the plan definition', () => {
    const page = read('apps/web/src/app/page.tsx');
    const plans = read('apps/api/src/billing/plans.ts');
    for (const amount of ['200', '3000', '15000', '50000']) expect(plans).toContain(`creditsTotal: ${amount}`);
    for (const text of ['200 credits / month', '3,000 credits / month', '15,000 credits / month', '50,000 credits / month']) {
      expect(page).toContain(text);
    }
    expect(page).toContain('1 concurrent workflow');
    expect(page).toContain('3 concurrent workflows');
    expect(page).toContain('10 concurrent workflows');
    expect(page).toContain('50 concurrent workflows');
    expect(page).not.toContain('Bring-your-own API key');
    expect(page).not.toContain('Dedicated support');
  });

  it('canonical product counts remain truth-locked', () => {
    const truth = read('apps/web/src/lib/product-truth.ts');
    expect(truth).toMatch(/value:\s*38,\s*label:\s*'Agents'/);
    expect(truth).toMatch(/value:\s*122,\s*label:\s*'Classified Tools'/);
    expect(truth).toMatch(/value:\s*15,\s*label:\s*'Connectors'/);

    const cta = read('apps/web/src/components/landing/PremiumCTA.tsx');
    expect(cta).toMatch(/value:\s*'38',\s*label:\s*'Agents'/);
    expect(cta).toMatch(/value:\s*'122',\s*label:\s*'Tools'/);
    expect(cta).toMatch(/value:\s*'15',\s*label:\s*'Integrations'/);
  });

  it('old 22-integration metadata claim is removed', () => {
    expect(read('apps/web/src/app/layout.tsx')).not.toMatch(/22 integrations/i);
    expect(read('apps/web/public/og-image.svg')).not.toMatch(/22 Integrations/i);
  });
});
