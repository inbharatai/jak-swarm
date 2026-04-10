#!/usr/bin/env node

const args = process.argv.slice(2).join(' ').trim();

console.error('[guard] Direct Prisma CLI usage from repo root is disabled.');
if (args) {
  console.error(`[guard] Received: pnpm prisma ${args}`);
}
console.error('[guard] Use workspace-pinned commands instead:');
console.error('  pnpm db:generate');
console.error('  pnpm db:push');
console.error('  pnpm db:migrate');
console.error('  pnpm db:migrate:status');
console.error('  pnpm db:migrate:deploy');
console.error('  pnpm db:migrate:reset');
console.error('  pnpm db:seed');
console.error('  pnpm db:studio');
console.error('');
console.error('[why] npx prisma may pull Prisma 7, which is incompatible with this repo\'s Prisma 6 schema config.');

process.exit(1);
