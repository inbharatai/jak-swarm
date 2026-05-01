/**
 * Root vitest config — exists ONLY so `pnpm exec vitest run` from the
 * repo root behaves correctly. The canonical test command is
 * `pnpm test` (turbo orchestrates per-workspace runs); this config is
 * the safety net for a developer or CI runner who reaches for vitest
 * directly without `cd`ing into a workspace.
 *
 * Why we need this: vitest's default test-file glob is
 *   **\/*.{test,spec}.?(c|m)[jt]s?(x)
 * which picks up `tests/e2e/*.spec.ts` — Playwright files that share
 * the `.spec.ts` extension but use the Playwright runner, not vitest.
 * Without this config, `pnpm exec vitest run` from the root reports
 * 24 file-level failures because vitest can't load `@playwright/test`
 * stubs.
 *
 * This config:
 *   - Excludes `**\/e2e/**` and `**\/*.spec.ts` so vitest only runs
 *     `*.test.ts` files (the vitest convention in this repo).
 *   - Loads `tests/vitest.setup.ts` so BaseAgent's OpenAI constructor
 *     gets a placeholder key — same fix as the in-workspace config.
 *   - Mirrors the package aliases so `@jak-swarm/*` imports resolve.
 *
 * If you're running tests for a single workspace, prefer
 *   pnpm --filter @jak-swarm/<pkg> test
 * which uses each package's own vitest config and is the path turbo
 * takes during `pnpm test`.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@jak-swarm/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@jak-swarm/security': path.resolve(__dirname, 'packages/security/src/index.ts'),
      '@jak-swarm/industry-packs': path.resolve(__dirname, 'packages/industry-packs/src/index.ts'),
      '@jak-swarm/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
      '@jak-swarm/agents': path.resolve(__dirname, 'packages/agents/src/index.ts'),
      '@jak-swarm/tools': path.resolve(__dirname, 'packages/tools/src/index.ts'),
      '@jak-swarm/skills': path.resolve(__dirname, 'packages/skills/src/index.ts'),
      '@jak-swarm/swarm': path.resolve(__dirname, 'packages/swarm/src/index.ts'),
      '@jak-swarm/voice': path.resolve(__dirname, 'packages/voice/src/index.ts'),
      '@jak-swarm/verification': path.resolve(__dirname, 'packages/verification/src/index.ts'),
      '@jak-swarm/client': path.resolve(__dirname, 'packages/client/src/index.ts'),
      '@jak-swarm/workflows': path.resolve(__dirname, 'packages/workflows/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Absolute path so per-workspace vitest runs (which set their own
    // cwd inside packages/*) still resolve the same setup file. Using
    // './tests/vitest.setup.ts' resolved relative to cwd, breaking
    // packages/swarm runs.
    setupFiles: [path.resolve(__dirname, 'tests/vitest.setup.ts')],
    // ONLY run vitest-style test files. The .spec.ts extension is
    // reserved here for Playwright e2e specs (see tests/playwright.config.ts).
    include: ['**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/e2e/**',
      '**/*.spec.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
