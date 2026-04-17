#!/bin/sh
set -e

if [ -n "$DATABASE_URL" ]; then
  echo "[boot] Applying Prisma migrations..."
  pnpm --filter @jak-swarm/db db:migrate:deploy
else
  echo "[boot] DATABASE_URL not set; skipping migrations"
fi

exec node apps/api/dist/index.js
