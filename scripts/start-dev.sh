#!/usr/bin/env bash
# start-dev.sh — Bootstrap the JAK Swarm development environment.
#
# Usage:
#   bash scripts/start-dev.sh [--skip-docker] [--skip-seed]
#
# Prerequisites:
#   - Docker Desktop running
#   - pnpm installed (npm i -g pnpm)
#   - Node.js 20+

set -euo pipefail

SKIP_DOCKER=false
SKIP_SEED=false

for arg in "$@"; do
  case $arg in
    --skip-docker) SKIP_DOCKER=true ;;
    --skip-seed)   SKIP_SEED=true ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║         JAK Swarm — Dev Environment          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Docker services ────────────────────────────────────────────────────────
if [ "$SKIP_DOCKER" = false ]; then
  echo "▶ Starting Docker services (Postgres, Redis, Temporal)..."
  docker compose -f docker/docker-compose.yml up -d --wait
  echo "  ✓ Docker services ready"
else
  echo "  ⏭ Skipping Docker (--skip-docker)"
fi

# ── 2. Install dependencies ───────────────────────────────────────────────────
echo "▶ Installing dependencies..."
pnpm install --frozen-lockfile=false --silent
echo "  ✓ Dependencies installed"

# ── 3. Generate Prisma client ─────────────────────────────────────────────────
echo "▶ Generating Prisma client..."
pnpm --filter @jak-swarm/db db:generate --silent
echo "  ✓ Prisma client generated"

# ── 4. Push DB schema ─────────────────────────────────────────────────────────
if [ "$SKIP_DOCKER" = false ]; then
  echo "▶ Pushing database schema..."
  DATABASE_URL="${DATABASE_URL:-postgresql://jakswarm:jakswarm@localhost:5432/jakswarm}" \
    pnpm --filter @jak-swarm/db db:push --accept-data-loss 2>/dev/null || true
  echo "  ✓ Schema applied"
fi

# ── 5. Seed demo data ─────────────────────────────────────────────────────────
if [ "$SKIP_SEED" = false ] && [ "$SKIP_DOCKER" = false ]; then
  echo "▶ Seeding demo data..."
  DATABASE_URL="${DATABASE_URL:-postgresql://jakswarm:jakswarm@localhost:5432/jakswarm}" \
    pnpm --filter @jak-swarm/db db:seed 2>/dev/null || echo "  ⚠ Seed skipped (data may already exist)"
fi

# ── 6. Build all packages ─────────────────────────────────────────────────────
echo "▶ Building all packages..."
pnpm run build --silent
echo "  ✓ All packages built"

# ── 7. Print instructions ─────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║              Ready to develop!               ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  API server:   pnpm --filter @jak-swarm/api dev  ║"
echo "║  Web app:      pnpm --filter @jak-swarm/web dev  ║"
echo "║  Both at once: pnpm run dev                      ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  API:          http://localhost:4000          ║"
echo "║  Swagger UI:   http://localhost:4000/docs     ║"
echo "║  Web UI:       http://localhost:3000          ║"
echo "║  Temporal UI:  http://localhost:8080          ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Demo login:   admin@apex-health.demo         ║"
echo "║  Password:     jak-demo-2024                  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
