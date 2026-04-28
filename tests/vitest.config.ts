import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // Point all @jak-swarm/* package imports to their TypeScript sources so
    // Vitest's transform pipeline handles them (avoids CJS require() bypassing
    // the alias system when using pre-built dist files).
    alias: {
      '@jak-swarm/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
      '@jak-swarm/security': path.resolve(__dirname, '../packages/security/src/index.ts'),
      '@jak-swarm/industry-packs': path.resolve(__dirname, '../packages/industry-packs/src/index.ts'),
      '@jak-swarm/db': path.resolve(__dirname, '../packages/db/src/index.ts'),
      '@jak-swarm/agents': path.resolve(__dirname, '../packages/agents/src/index.ts'),
      '@jak-swarm/tools': path.resolve(__dirname, '../packages/tools/src/index.ts'),
      '@jak-swarm/swarm': path.resolve(__dirname, '../packages/swarm/src/index.ts'),
      '@jak-swarm/voice': path.resolve(__dirname, '../packages/voice/src/index.ts'),
      '@jak-swarm/verification': path.resolve(__dirname, '../packages/verification/src/index.ts'),
      '@jak-swarm/client': path.resolve(__dirname, '../packages/client/src/index.ts'),
      '@jak-swarm/workflows': path.resolve(__dirname, '../packages/workflows/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Vitest default `testTimeout` is 5000ms which is too tight for the
    // integration tests in this suite — they hit a real Postgres
    // (testcontainers), a real OpenAI Responses API in stub mode, real
    // Playwright browser tooling, and the full LangGraph orchestrator end-
    // to-end. Under CPU contention those tests routinely sit at 3-5s and
    // hit the ceiling intermittently (we observed 2 flakes on a parallel
    // turbo run that went green on retry). Bumping the budget to 30s
    // gives integration tests headroom without masking real bugs — a test
    // that takes longer than 30s genuinely has a problem worth fixing.
    // Hooks (`beforeAll`/`afterAll`) get the same budget so DB setup +
    // testcontainer boot don't flake on cold caches.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Coverage gate. Not enabled by default (keeps local `pnpm test` fast);
    // CI runs `pnpm vitest run --coverage` which picks up these thresholds
    // and fails the build if either package drops below floor.
    //
    // The 50% floor is intentional: the codebase currently tests behavior
    // via integration tests that hit multiple packages at once, so raw
    // line coverage for any single package looks lower than the actual
    // safety net. Raising the floor is a separate, quality-improving PR.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: '../coverage',
      include: [
        '../packages/swarm/src/**/*.ts',
        '../packages/agents/src/**/*.ts',
      ],
      exclude: [
        '../packages/*/src/index.ts',
        '../packages/*/src/**/*.d.ts',
      ],
      thresholds: {
        // Floors ratcheted from the first measured coverage run.
        // Ratchet upward in follow-up commits as coverage improves;
        // never ratchet downward without explicit justification.
        'packages/swarm/src/**/*.ts': {
          lines: 50,
          branches: 40,
          functions: 50,
          statements: 50,
        },
        'packages/agents/src/**/*.ts': {
          lines: 50,
          branches: 40,
          functions: 50,
          statements: 50,
        },
      },
    },
  },
});
