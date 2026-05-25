import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'https://jak-swarm-api-production.up.railway.app';
const WEB_BASE_URL = process.env['E2E_BASE_URL'] ?? 'https://jakswarm.com';
const PROOF_DIR = path.join(__dirname, '..', 'test-results', 'production-proof');

interface BackendAuthSession {
  token: string;
  authUser: {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string;
    tenantName: string;
    industry: string;
  };
}

interface WorkflowListItem {
  id: string;
  status: string;
  finalOutput?: string | null;
  error?: string | null;
}

interface RoleResult {
  roleLabel: string;
  roleMode: string;
  roleSelection: boolean;
  workflowId: string;
  workflowCreated: boolean;
  workflowPersisted: boolean;
  sseHealthy: boolean;
  terminalStatus: string;
  meaningfulOrHonest: boolean;
  details: string;
  screenshotPath: string;
}

const ROLE_CASES = [
  { roleLabel: 'CEO', roleMode: 'ceo' },
  { roleLabel: 'CTO', roleMode: 'cto' },
  { roleLabel: 'CMO', roleMode: 'cmo' },
  { roleLabel: 'Code', roleMode: 'coding' },
  { roleLabel: 'Research', roleMode: 'research' },
  { roleLabel: 'Design', roleMode: 'design' },
  { roleLabel: 'Auto', roleMode: 'automation' },
  { roleLabel: 'Legal', roleMode: 'legal' },
] as const;

async function createBackendAuthSession(): Promise<BackendAuthSession> {
  const unique = Date.now();
  const email = `e2e-role-${unique}@jaktest.dev`;
  const password = `ProdRole${unique}A1!`;
  const tenantSlug = `e2e-role-${unique}`;

  const register = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      name: 'Role Matrix User',
      tenantName: `Role Matrix ${unique}`,
      tenantSlug,
    }),
  });

  if (register.status !== 201) {
    throw new Error(`Backend auth bootstrap failed with status ${register.status}`);
  }

  const payload = (await register.json()) as {
    data?: {
      token?: string;
      user?: {
        userId?: string;
        id?: string;
        email?: string;
        name?: string;
        tenantId?: string;
        role?: string;
      };
    };
  };

  const token = payload.data?.token;
  if (!token) {
    throw new Error('Backend auth bootstrap did not return a token');
  }

  const user = payload.data?.user;
  return {
    token,
    authUser: {
      id: user?.userId ?? user?.id ?? `user-${unique}`,
      email: user?.email ?? email,
      name: user?.name ?? 'Role Matrix User',
      role: user?.role ?? 'TENANT_ADMIN',
      tenantId: user?.tenantId ?? '',
      tenantName: `Role Matrix ${unique}`,
      industry: 'TECHNOLOGY',
    },
  };
}

async function seedBackendSession(context: BrowserContext, page: Page, session: BackendAuthSession): Promise<void> {
  const baseHost = new URL(WEB_BASE_URL).hostname.replace(/^www\./i, '');
  const cookieOrigins = Array.from(new Set([`https://${baseHost}/`, `https://www.${baseHost}/`]));

  await context.addCookies(
    cookieOrigins.map((url) => ({
      name: 'jak-auth-token',
      value: session.token,
      url,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax' as const,
    })),
  );

  await page.addInitScript(
    ({ token, authUser }) => {
      localStorage.setItem('jak-auth-token', token);
      localStorage.setItem('jak-auth-user', JSON.stringify(authUser));
    },
    { token: session.token, authUser: session.authUser },
  );
}

async function listWorkflows(token: string): Promise<{ total: number; items: WorkflowListItem[] }> {
  const res = await fetch(`${API_BASE_URL}/workflows/?page=1&limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    throw new Error(`List workflows failed with status ${res.status}`);
  }

  const payload = (await res.json()) as {
    data?: { total?: number; items?: WorkflowListItem[] };
  };
  return {
    total: payload.data?.total ?? 0,
    items: payload.data?.items ?? [],
  };
}

async function getWorkflow(token: string, workflowId: string): Promise<WorkflowListItem> {
  const res = await fetch(`${API_BASE_URL}/workflows/${workflowId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    throw new Error(`Get workflow ${workflowId} failed with status ${res.status}`);
  }

  const payload = (await res.json()) as { data?: WorkflowListItem };
  if (!payload.data?.id) {
    throw new Error(`Malformed workflow payload for ${workflowId}`);
  }
  return payload.data;
}

async function activateOnlyRole(page: Page, targetRoleLabel: string): Promise<boolean> {
  for (const role of ROLE_CASES) {
    const button = page.getByRole('button', { name: new RegExp(`^${role.roleLabel}$`, 'i') }).first();
    await expect(button).toBeVisible({ timeout: 20_000 });
    const pressed = await button.getAttribute('aria-pressed');
    const shouldBeActive = role.roleLabel === targetRoleLabel;
    if (shouldBeActive && pressed !== 'true') {
      await button.click();
    }
    if (!shouldBeActive && pressed === 'true') {
      await button.click();
    }
  }

  const target = page.getByRole('button', { name: new RegExp(`^${targetRoleLabel}$`, 'i') }).first();
  return (await target.getAttribute('aria-pressed')) === 'true';
}

test.describe('Production role workflow matrix (token auth)', () => {
  test('runs one workflow per marketed role with lifecycle proof', async ({ page, context }) => {
    test.setTimeout(900_000);

    await fs.mkdir(PROOF_DIR, { recursive: true });

    const session = await createBackendAuthSession();
    await seedBackendSession(context, page, session);

    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/login$/);

    const input = page.locator('textarea').first();
    const sendButton = page.getByRole('button', { name: 'Send message' });

    const results: RoleResult[] = [];

    for (const role of ROLE_CASES) {
      const roleSelection = await activateOnlyRole(page, role.roleLabel);

      const before = await listWorkflows(session.token);
      const existingIds = new Set(before.items.map((wf) => wf.id));

      const startedLocator = page.getByText('Workflow started — processing your request...');
      const startedBefore = await startedLocator.count();

      const prompt = `${role.roleLabel} role smoke: Review www.jakswarm.com and provide concise findings, top risks, and next actions.`;
      await input.fill(prompt);
      await sendButton.click();

      await expect.poll(async () => startedLocator.count(), { timeout: 30_000 }).toBe(startedBefore + 1);

      let workflowId = '';
      await expect
        .poll(
          async () => {
            const list = await listWorkflows(session.token);
            const created = list.items.find((wf) => !existingIds.has(wf.id));
            if (created?.id) {
              workflowId = created.id;
              return workflowId;
            }
            return '';
          },
          { timeout: 120_000 },
        )
        .not.toBe('');

      let persisted = false;
      let terminalStatus = 'UNKNOWN';
      let meaningfulOrHonest = false;
      let details = '';

      try {
        const loaded = await getWorkflow(session.token, workflowId);
        persisted = loaded.id === workflowId;
      } catch (err) {
        persisted = false;
        details = err instanceof Error ? err.message : String(err);
      }

      await expect
        .poll(
          async () => {
            const text = (await page.locator('[data-testid="assistant-message"] p').allTextContents())
              .join('\n')
              .toLowerCase();
            return /(workflow not found|failed to connect to workflow|sse connection failed|failed to start workflow)/.test(text);
          },
          { timeout: 120_000 },
        )
        .toBe(false);

      await expect
        .poll(async () => {
          const text = (await page.locator('[data-testid="assistant-message"] p').allTextContents()).join('\n');
          return /working on:|calling \*\*|\*\*plan\*\*|completed|review/i.test(text);
        }, { timeout: 120_000 })
        .toBe(true);

      await expect
        .poll(
          async () => {
            const wf = await getWorkflow(session.token, workflowId);
            terminalStatus = wf.status;
            const output = (wf.finalOutput ?? '').trim();
            const errorText = (wf.error ?? '').trim();
            meaningfulOrHonest =
              output.length >= 80 ||
              /not connected|not configured|mock|draft|requires config|blocked|manual handoff/i.test(`${output} ${errorText}`) ||
              errorText.length > 0;
            details = output.length > 0 ? output.slice(0, 240) : errorText.slice(0, 240);

            return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(wf.status) && meaningfulOrHonest;
          },
          { timeout: 240_000 },
        )
        .toBe(true);

      const screenshotPath = path.join(PROOF_DIR, `role-${role.roleMode}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      results.push({
        roleLabel: role.roleLabel,
        roleMode: role.roleMode,
        roleSelection,
        workflowId,
        workflowCreated: workflowId.length > 0,
        workflowPersisted: persisted,
        sseHealthy: true,
        terminalStatus,
        meaningfulOrHonest,
        details,
        screenshotPath,
      });
    }

    await fs.writeFile(
      path.join(PROOF_DIR, 'role-matrix-results.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          apiBaseUrl: API_BASE_URL,
          webBaseUrl: WEB_BASE_URL,
          results,
        },
        null,
        2,
      ),
    );

    const failed = results.filter(
      (r) => !(r.roleSelection && r.workflowCreated && r.workflowPersisted && r.sseHealthy && r.meaningfulOrHonest),
    );
    expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
  });
});
