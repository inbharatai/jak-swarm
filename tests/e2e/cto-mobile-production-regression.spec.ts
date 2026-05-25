import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const EMAIL = process.env['E2E_AUTH_EMAIL'];
const PASSWORD = process.env['E2E_AUTH_PASSWORD'];
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
  createdAt?: string;
}

async function createBackendAuthSession(): Promise<BackendAuthSession> {
  const unique = Date.now();
  const email = `e2e-prod-${unique}@jaktest.dev`;
  const password = `ProdE2E${unique}A1!`;
  const tenantSlug = `e2e-prod-${unique}`;

  const register = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      name: 'Prod E2E User',
      tenantName: `Prod E2E ${unique}`,
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
      name: user?.name ?? 'Prod E2E User',
      role: user?.role ?? 'TENANT_ADMIN',
      tenantId: user?.tenantId ?? '',
      tenantName: `Prod E2E ${unique}`,
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
  const res = await fetch(`${API_BASE_URL}/workflows/?page=1&limit=50`, {
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
    throw new Error(`Get workflow ${workflowId} returned malformed payload`);
  }
  return payload.data;
}

async function continueWorkflow(token: string, goal = 'continue'): Promise<{ status: number; kind: string; workflowId: string | null }> {
  const res = await fetch(`${API_BASE_URL}/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ goal }),
  });

  const payload = (await res.json().catch(() => null)) as {
    data?: { kind?: string; workflowId?: string; id?: string };
  } | null;

  return {
    status: res.status,
    kind: payload?.data?.kind ?? 'legacy_shape',
    workflowId: payload?.data?.workflowId ?? payload?.data?.id ?? null,
  };
}

test.describe('CTO mobile production workflow regression', () => {
  test('executes CTO website-review flow without workflow lifecycle errors', async ({ page, context }) => {
    test.setTimeout(720_000);

    let backendSession: BackendAuthSession | null = null;
    if (!EMAIL || !PASSWORD) {
      backendSession = await createBackendAuthSession();
      await seedBackendSession(context, page, backendSession);
    }

    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const currentPath = new URL(page.url()).pathname;
    if (/\/(login|register|forgot-password)/.test(currentPath) && EMAIL && PASSWORD) {
      await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL!);
      await page.locator('input[type="password"]').first().fill(PASSWORD!);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL((url) => !/\/(login|register|forgot-password)/.test(url.pathname), {
        timeout: 20_000,
      });
    }

    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/login$/);

    const ctoChip = page.getByRole('button', { name: /^CTO$/ }).first();
    await expect(ctoChip).toBeVisible({ timeout: 20_000 });
    const ctoPressed = await ctoChip.getAttribute('aria-pressed');
    if (ctoPressed !== 'true') {
      await ctoChip.click();
    }

    let workflowId = '';
    let workflowCountBeforeContinue = -1;
    if (backendSession) {
      const screenshotPath = path.join(PROOF_DIR, 'cto-mobile-production-proof.png');
      const beforeList = await listWorkflows(backendSession.token);
      const existingIds = new Set(beforeList.items.map((wf) => wf.id));

      const prompt = 'Review https://www.jakswarm.com and provide a CTO audit with top issues, risks, and prioritized fixes.';
      const startedMessage = page.getByText('Workflow started — processing your request...');
      const startedBefore = await startedMessage.count();
      const input = page.locator('textarea').first();
      await input.fill(prompt);
      await page.getByRole('button', { name: 'Send message' }).click();

      await expect.poll(async () => startedMessage.count(), { timeout: 30_000 }).toBe(startedBefore + 1);

      await expect
        .poll(
          async () => {
            const list = await listWorkflows(backendSession.token);
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

      const persisted = await getWorkflow(backendSession.token, workflowId);
      expect(persisted.id).toBe(workflowId);

      workflowCountBeforeContinue = (await listWorkflows(backendSession.token)).total;
      const continueResult = await continueWorkflow(backendSession.token, 'continue');
      expect([200, 202]).toContain(continueResult.status);
      expect(continueResult.kind).toBe('followup_executed');
      expect(continueResult.workflowId).toBe(workflowId);

      await expect
        .poll(async () => (await listWorkflows(backendSession.token)).total, { timeout: 60_000 })
        .toBe(workflowCountBeforeContinue);

      await expect
        .poll(
          async () => {
            const text = (await page.locator('[data-testid="assistant-message"] p').allTextContents())
              .join('\n')
              .toLowerCase();
            return /(workflow not found|failed to connect to workflow|failed to start workflow|sse connection failed)/.test(text);
          },
          { timeout: 120_000 },
        )
        .toBe(false);

      await expect
        .poll(
          async () => {
            const assistantText = (await page.locator('[data-testid="assistant-message"] p').allTextContents())
              .join('\n')
              .toLowerCase();
            const assistantCount = await page.locator('[data-testid="assistant-message"]').count();
            const stuckVisible = (await page.getByText('Still running…').count()) > 0;
            const inspectorLinkVisible = (await page.getByRole('link', { name: /View in Run Inspector/i }).count()) > 0;
            const liveCostVisible = (await page.getByTestId('live-cost-ticker').count()) > 0;

            return (
              assistantCount >= 2 ||
              /working on:|calling \*\*|\*\*plan\*\*/.test(assistantText) ||
              liveCostVisible ||
              (stuckVisible && inspectorLinkVisible)
            );
          },
          { timeout: 180_000 },
        )
        .toBe(true);

      await fs.mkdir(PROOF_DIR, { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });

      let terminalStatus = 'UNKNOWN';
      let finalOutputLen = 0;

      await expect
        .poll(
          async () => {
            const wf = await getWorkflow(backendSession.token, workflowId);
            terminalStatus = wf.status;
            finalOutputLen = (wf.finalOutput ?? '').trim().length;
            return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(wf.status) && finalOutputLen > 120;
          },
          { timeout: 420_000 },
        )
        .toBe(true);

      await fs.writeFile(
        path.join(PROOF_DIR, 'cto-mobile-production-proof.json'),
        JSON.stringify(
          {
            workflowId,
            workflowCountBeforeContinue,
            terminalStatus,
            finalOutputLen,
            continueStatus: continueResult.status,
            continueKind: continueResult.kind,
            continueWorkflowId: continueResult.workflowId,
            sameWorkflowId: continueResult.workflowId === workflowId,
            screenshotPath,
            apiBaseUrl: API_BASE_URL,
            webBaseUrl: WEB_BASE_URL,
            capturedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      return;
    }

    const prompt = 'Review https://www.jakswarm.com and provide a CTO audit with top issues, risks, and prioritized fixes.';
    const input = page.locator('textarea').first();
    await input.fill(prompt);
    await page.getByRole('button', { name: 'Send message' }).click();

    const startedMessage = page.getByText('Workflow started — processing your request...');
    const startedBefore = await startedMessage.count();
    await expect.poll(async () => startedMessage.count(), { timeout: 30_000 }).toBe(startedBefore + 1);

    await expect
      .poll(
        async () => {
          const text = (await page.locator('[data-testid="assistant-message"] p').allTextContents())
            .join('\n')
            .toLowerCase();
          return /(workflow not found|failed to connect to workflow|failed to start workflow)/.test(text);
        },
        { timeout: 120_000 },
      )
      .toBe(false);

    await expect
      .poll(async () => page.locator('[data-testid="assistant-message"]').count(), {
        timeout: 120_000,
      })
      .toBeGreaterThanOrEqual(2);

    await expect
      .poll(
        async () => {
          const texts = await page.locator('[data-testid="assistant-message"] p').allTextContents();
          const substantive = texts.find(
            (text) =>
              text.trim().length > 120 &&
              !text.includes('Workflow started — processing your request...') &&
              !text.includes('View live status in [Run Inspector]'),
          );
          return substantive?.length ?? 0;
        },
        { timeout: 120_000 },
      )
      .toBeGreaterThan(120);

    await fs.mkdir(PROOF_DIR, { recursive: true });
    await page.screenshot({ path: path.join(PROOF_DIR, 'cto-mobile-production-proof.png'), fullPage: true });
  });
});
