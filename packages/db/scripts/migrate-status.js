#!/usr/bin/env node

const { spawnSync } = require('child_process');

function run(env) {
  return spawnSync('pnpm exec prisma migrate status', {
    shell: true,
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
}

function write(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

const baseEnv = { ...process.env };

// Default DIRECT_URL to DATABASE_URL when DIRECT_URL is missing.
if (!baseEnv.DIRECT_URL && baseEnv.DATABASE_URL) {
  baseEnv.DIRECT_URL = baseEnv.DATABASE_URL;
}

let result = run(baseEnv);
if (result.error) {
  process.stderr.write(`[db:migrate:status] Failed to start prisma command: ${result.error.message}\n`);
  process.exit(1);
}
write(result);

// If direct connection fails on :5432 but pooler URL exists, retry with DATABASE_URL.
const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
const hasP1001 = combined.includes('Error: P1001');
const directLooks5432 = (baseEnv.DIRECT_URL || '').includes(':5432');
const dbLooks6543 = (baseEnv.DATABASE_URL || '').includes(':6543');

if (result.status !== 0 && hasP1001 && directLooks5432 && dbLooks6543) {
  process.stderr.write('\n[db:migrate:status] Retrying with DIRECT_URL set to DATABASE_URL (pooler).\n');
  const retryEnv = { ...baseEnv, DIRECT_URL: baseEnv.DATABASE_URL };
  result = run(retryEnv);
  if (result.error) {
    process.stderr.write(`[db:migrate:status] Retry failed to start prisma command: ${result.error.message}\n`);
    process.exit(1);
  }
  write(result);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
