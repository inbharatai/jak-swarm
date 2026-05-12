import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
const webPort = process.env['E2E_WEB_PORT'] ?? '3100';
const apiPort = process.env['E2E_API_PORT'] ?? '4000';
const defaultBaseURL = `http://127.0.0.1:${webPort}`;
const baseURL = process.env['E2E_BASE_URL'] ?? defaultBaseURL;
const apiURL = process.env['NEXT_PUBLIC_API_URL'] ?? `http://127.0.0.1:${apiPort}`;
const shouldStartWebServer =
  process.env['E2E_NO_WEBSERVER'] !== '1' && !process.env['E2E_BASE_URL'];
const shouldStartApiServer =
  shouldStartWebServer &&
  process.env['E2E_START_API'] === '1' &&
  !process.env['NEXT_PUBLIC_API_URL'];

const webServers = [
  ...(shouldStartApiServer
    ? [
        {
          command: 'pnpm --filter @jak-swarm/tests exec tsx e2e-api-stack.ts',
          cwd: repoRoot,
          url: `${apiURL}/healthz`,
          reuseExistingServer: false,
          timeout: 180_000,
          env: {
            ...process.env,
            E2E_API_PORT: apiPort,
            E2E_WEB_PORT: webPort,
          },
        },
      ]
    : []),
  ...(shouldStartWebServer
    ? [
        {
          command: `pnpm --filter @jak-swarm/web dev --hostname 127.0.0.1 --port ${webPort}`,
          cwd: repoRoot,
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            ...process.env,
            NEXT_PUBLIC_API_URL: apiURL,
            NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS: process.env['NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS'] ?? '1',
          },
        },
      ]
    : []),
];

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Run headed so the operator can watch the browser drive the product.
    // PWHEADLESS=1 in CI / when piping a long log keeps it offscreen.
    headless: process.env['PWHEADLESS'] === '1',
  },
  ...(webServers.length > 0
    ? {
        webServer: webServers,
      }
    : {}),
  projects: [
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
