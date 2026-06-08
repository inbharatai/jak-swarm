#!/bin/sh
# ─── JAK Swarm API — Production Entrypoint ────────────────────────────────
#
# Runs Prisma migrations then starts the API server.
#
# On Cloud Run the server MUST start listening within a strict timeout.
# Migration failures are logged but do NOT prevent the server from starting
# (the /ready endpoint reports degraded state and self-heals once the DB is
# reachable).
# ────────────────────────────────────────────────────────────────────────────

if [ -n "$DATABASE_URL" ]; then
  echo "[boot] Applying Prisma migrations..."
  pnpm --filter @jak-swarm/db db:migrate:deploy || {
    echo "[boot] WARNING: Prisma migrations failed — server will start in degraded mode; /ready will report 503 until DB is reachable" >&2
  }
else
  echo "[boot] DATABASE_URL not set; skipping migrations"
fi

echo "[boot] Starting JAK Swarm API..."
exec node apps/api/dist/index.js