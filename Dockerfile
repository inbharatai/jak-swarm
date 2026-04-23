# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

# Copy all package.json files for dependency resolution
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/agents/package.json packages/agents/
COPY packages/tools/package.json packages/tools/
COPY packages/swarm/package.json packages/swarm/
COPY packages/security/package.json packages/security/
COPY packages/verification/package.json packages/verification/
COPY packages/voice/package.json packages/voice/
COPY packages/workflows/package.json packages/workflows/
COPY packages/industry-packs/package.json packages/industry-packs/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tests/package.json tests/

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY packages/ packages/
COPY apps/api/ apps/api/

# Nuke any stale dist/ + .tsbuildinfo that could have snuck into the source
# checkout. Without this, Render's builder-layer cache can serve a previous
# build's compiled output even after we push fresh source — we've seen this
# cause @jak-swarm/swarm to keep old graph routing while @jak-swarm/agents
# rebuilds fine, producing workflow-level bugs that look like "the deploy
# didn't happen" but are actually "the build picked up stale dist/".
RUN find packages apps -type d -name dist -exec rm -rf {} + 2>/dev/null || true
RUN find packages apps -name "*.tsbuildinfo" -delete 2>/dev/null || true

# Generate Prisma client
RUN pnpm --filter @jak-swarm/db exec prisma generate

# Build all packages in dependency order
RUN pnpm --filter @jak-swarm/shared build && \
    pnpm --filter @jak-swarm/db build && \
    pnpm --filter @jak-swarm/security build && \
    pnpm --filter @jak-swarm/verification build && \
    pnpm --filter @jak-swarm/tools build && \
    pnpm --filter @jak-swarm/agents build && \
    pnpm --filter @jak-swarm/industry-packs build && \
    pnpm --filter @jak-swarm/swarm build && \
    pnpm --filter @jak-swarm/api build

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Install chromium for Playwright browser automation
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

RUN chmod +x /app/apps/api/scripts/start-with-migrations.sh

# Security: non-root user
RUN addgroup -g 1001 -S jak && \
    adduser -S jak -u 1001 -G jak
USER jak

ENV NODE_ENV=production
ENV PORT=4000
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/healthz || exit 1

CMD ["/app/apps/api/scripts/start-with-migrations.sh"]
