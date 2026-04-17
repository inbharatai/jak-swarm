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
  },
});
