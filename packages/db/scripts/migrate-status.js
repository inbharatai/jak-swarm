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

// Exit-code semantics — distinguish "pending migrations" (informational,
// the user already knows about it) from "tooling broken" (real failure):
//   - Prisma exit 0  → all migrations applied → exit 0
//   - Prisma exit 1 + stdout contains "have not yet been applied"
//     → pending migrations exist; this is INFORMATIONAL, not a crash.
//     Print a clear note + exit 0 so routine `pnpm db:migrate:status`
//     calls don't look like failures in CLI sweeps.
//   - Prisma exit 1 for any other reason → real failure → exit 1
const finalCombined = `${result.stdout || ''}\n${result.stderr || ''}`;
const pendingMigrations = /have not yet been applied/i.test(finalCombined);

if (result.status === 0) {
  process.exit(0);
}
if (result.status === 1 && pendingMigrations) {
  process.stderr.write(
    '\n[db:migrate:status] INFO: pending migrations exist (see list above). ' +
      'This is not a script failure — run `pnpm db:migrate:deploy` to apply them. ' +
      'Exiting 0 so this status check does not block routine CLI sweeps.\n',
  );
  process.exit(0);
}
process.exit(typeof result.status === 'number' ? result.status : 1);
