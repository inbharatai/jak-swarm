// @ts-check
// Root ESLint flat config for the JAK Swarm monorepo.
// Uses the already-installed @typescript-eslint parser + plugin. Scope:
// catch real quality bugs (unused vars, unreachable code) across the TS
// packages + apps. Minimal recommended-only ruleset so the gate is
// enforceable from day one rather than a backlog that blocks every CI run.
import parser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.cjs',
      'apps/web/next-env.d.ts',
      'packages/db/prisma/generated/**',
      'scripts/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      'tests/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-console': 'off',
      'no-unreachable': 'error',
    },
  },
];