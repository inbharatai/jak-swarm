# JAK Swarm — Setup Guide

This guide walks you through running JAK Swarm locally from scratch.

---

## Prerequisites

| Requirement | Minimum Version | Notes |
|---|---|---|
| Node.js | 20.x LTS | Use `nvm` or `fnm` to manage versions |
| pnpm | 9.x | Install via `npm install -g pnpm@9` |
| Docker Desktop | Latest | Required for Postgres, Redis, Temporal |
| Git | 2.x | |

### Optional (for voice features)
- OpenAI API key with Realtime API access
- Deepgram API key (STT fallback)
- ElevenLabs API key (TTS fallback)

---

## 1. Clone the Repository

```bash
git clone https://github.com/your-org/jak-swarm.git
cd jak-swarm
```

---

## 2. Environment Setup

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Minimum required values to get started locally:

```env
DATABASE_URL="postgresql://jakswarm:jakswarm@localhost:5432/jakswarm"
REDIS_URL="redis://localhost:6379"
AUTH_SECRET="any-random-32-char-string-here-abc"
OPENAI_API_KEY="sk-your-openai-key"
NODE_ENV="development"
```

All other values default to local addresses. Voice features require the additional voice API keys.

---

## 3. Start Infrastructure Services

Start Postgres, Redis, Temporal, and Temporal UI using Docker Compose:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Verify services are healthy:

```bash
docker compose -f docker/docker-compose.yml ps
```

Expected output — all services should show `healthy` or `running`:
```
NAME           STATUS          PORTS
postgres       running (healthy)    0.0.0.0:5432->5432/tcp
redis          running (healthy)    0.0.0.0:6379->6379/tcp
temporal       running              0.0.0.0:7233->7233/tcp
temporal-ui    running              0.0.0.0:8080->8080/tcp
```

Temporal UI is available at `http://localhost:8080` once started.

---

## 4. Install Dependencies

Install all workspace dependencies:

```bash
pnpm install
```

This installs dependencies for all packages in the monorepo using pnpm workspaces.

---

## 5. Build Shared Packages

Build `packages/shared` first (other packages depend on it):

```bash
pnpm build --filter @jak-swarm/shared
```

Then build the DB package:

```bash
pnpm build --filter @jak-swarm/db
```

Or build everything at once:

```bash
pnpm build
```

Turbo handles the correct build order automatically via `dependsOn` configuration in `turbo.json`.

---

## 6. Database Setup

### Generate Prisma Client

```bash
pnpm db:generate
```

This generates the Prisma TypeScript client from `packages/db/prisma/schema.prisma`.

### Push Schema to Database

For local development (no migration history needed):

```bash
pnpm db:push
```

This introspects the schema and creates all tables directly.

### Run Migrations (for staging/production)

```bash
pnpm db:migrate
```

This runs `prisma migrate dev` which creates migration files and applies them. You will be prompted to name the migration.

### Verify Schema

Open Prisma Studio to visually inspect the database:

```bash
cd packages/db && pnpm db:studio
```

Prisma Studio opens at `http://localhost:5555`.

---

## 7. Run Development Servers

Start all services in development mode with hot reload:

```bash
pnpm dev
```

This runs via Turbo in parallel:
- `apps/web` — Next.js app at `http://localhost:3000`
- `apps/api` — Hono API server at `http://localhost:4000`
- `apps/worker` — Temporal worker (connects to `localhost:7233`)
- `packages/shared` — TypeScript watch mode
- `packages/db` — TypeScript watch mode

To run a specific app only:

```bash
pnpm dev --filter apps/api
```

---

## 8. Run Tests

Run all tests across the monorepo:

```bash
pnpm test
```

Run tests for a specific package:

```bash
pnpm test --filter @jak-swarm/shared
```

Run tests in watch mode (during development):

```bash
cd packages/shared && pnpm vitest --watch
```

---

## 9. Type Checking

Run TypeScript type checks without emitting files:

```bash
pnpm typecheck
```

---

## 10. Linting

Run ESLint across all packages:

```bash
pnpm lint
```

Auto-fix lint issues:

```bash
pnpm lint --fix
```

---

## Common Troubleshooting

### `prisma generate` fails — "engine not found"

```bash
# Clean and reinstall
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm db:generate
```

### `npx prisma ...` fails with `P1012` (`url/directUrl no longer supported`)

This repo is pinned to Prisma 6 in `packages/db`.
Running `npx prisma ...` can download Prisma 7, which is incompatible with the current schema datasource config.

Use the workspace-pinned commands instead:

```bash
pnpm db:generate
pnpm db:push
pnpm db:migrate
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:seed
```

### `pnpm dev` fails — "Cannot find module @jak-swarm/shared"

Build shared packages first:
```bash
pnpm build --filter @jak-swarm/shared
pnpm build --filter @jak-swarm/db
pnpm dev
```

### Temporal worker fails to connect — "Connection refused at localhost:7233"

Ensure Docker Compose services are running:
```bash
docker compose -f docker/docker-compose.yml up -d temporal
# Wait ~30 seconds for Temporal to start
docker compose -f docker/docker-compose.yml logs temporal --tail 20
```

### Database connection error — "ECONNREFUSED 127.0.0.1:5432"

Ensure Postgres container is running and healthy:
```bash
docker compose -f docker/docker-compose.yml ps postgres
docker compose -f docker/docker-compose.yml up -d postgres
```

Check `DATABASE_URL` in your `.env` matches the Docker Compose credentials (`jakswarm:jakswarm@localhost:5432/jakswarm`).

### Port already in use

If port 3000, 4000, 5432, 6379, or 7233 are taken by other services, either stop those services or update the port values in `.env` and `docker/docker-compose.yml`.

### `pnpm install` fails with engine incompatibility

Ensure you are using Node.js >= 20 and pnpm >= 9:
```bash
node --version    # should be v20.x.x or higher
pnpm --version    # should be 9.x.x
```

Use `nvm use 20` or `fnm use 20` to switch Node versions.

### Turbo cache causing stale builds

```bash
pnpm turbo run build --force
```

Or clear the Turbo cache entirely:
```bash
rm -rf .turbo
pnpm build
```

---

## Directory Structure Reference

```
jak-swarm/
├── apps/
│   ├── api/          — Hono REST API server
│   ├── web/          — Next.js frontend
│   └── worker/       — Temporal workflow worker
├── packages/
│   ├── shared/       — Types, schemas, constants, utils
│   ├── db/           — Prisma client + schema
│   ├── agents/       — Agent implementations (Phase 1b)
│   └── tools/        — Tool registry + adapters (Phase 1b)
├── docker/
│   └── docker-compose.yml
├── docs/             — Architecture, security, setup docs
├── .env.example      — Environment variable template
├── package.json      — Monorepo root
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```
