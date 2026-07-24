<div align="center">

# JAK Swarm

### Multiplayer AI for human-agent teams

**One live workspace where people and AI agents can watch, redirect, hand off, approve, and replay long-running work together.**

[![Release](https://img.shields.io/badge/release-0.1.0--beta.0-0ea5e9?style=flat-square)](docs/beta-release.md)
[![AI Agents](https://img.shields.io/badge/AI_Agents-38-2563eb?style=flat-square)](AGENTS.md)
[![Classified Tools](https://img.shields.io/badge/Classified_Tools-122-16a34a?style=flat-square)](docs/current-runtime-truth.md)
[![Connectors](https://img.shields.io/badge/Connectors-15-0284c7?style=flat-square)](docs/integration-maturity-matrix.md)
[![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)](LICENSE)

[Quick start](#quick-start) · [Multiplayer docs](docs/multiplayer-ai.md) · [Architecture](ARCHITECTURE.md) · [Security](SECURITY.md) · [Beta truth](docs/beta-release.md)

</div>

---

## What JAK Swarm is

JAK Swarm is a working beta for **shared human-agent workflow execution**.

A team can enter the same workflow session, see the task graph, follow agent activity, redirect individual tasks, assign work to a person, approve external actions, and inspect the complete execution history. The collaboration layer sits on a durable multi-agent runtime rather than a collection of isolated chat transcripts.

```text
Goal
  → shared plan and task graph
  → specialist agents + human teammates
  → comments, redirects, handoffs, and approvals
  → verification and bounded repair
  → artifacts + replayable audit history
```

JAK is not a generic chat UI, a character-level collaborative document editor, or a claim of fully autonomous enterprise operations.

## Multiplayer workflow execution

The current implementation includes:

| Capability | Current implementation |
|---|---|
| Shared participants | `OWNER`, `EDITOR`, `REVIEWER`, and `VIEWER` roles on each workflow |
| Presence | Heartbeat-based online state and active-task visibility |
| Task control | Short control leases prevent two teammates from redirecting the same task simultaneously |
| Human handoff | A workflow task can be assigned to a person, pause the run, accept the submitted result, and continue dependent work |
| Safe redirection | A paused task can be revised, plan-versioned, and resumed without silently rewriting history |
| Shared timeline | Joins, comments, handoffs, redirects, approvals, and runtime events are persisted and streamed |
| Replay | Participants, events, traces, approvals, human tasks, artifacts, and audit records can be exported together |

Open the shared control room at:

```text
/workflows/<workflowId>/session
```

Implementation details and API routes: [`docs/multiplayer-ai.md`](docs/multiplayer-ai.md).

## Platform foundations

### Company Brain

Company Brain converts company material into evidence-backed context:

```text
artifacts → entities → typed claims → drift findings → executable specs → approved work
```

It stores provenance, detects execution drift, and generates reviewer-gated specifications. GitHub, Gmail, and Google Drive support scheduled ingestion; other connectors are setup-dependent or on-demand. See [`docs/current-runtime-truth.md`](docs/current-runtime-truth.md).

### Hyperagent

Hyperagent is a governed repair and learning layer. It classifies failures, isolates likely faults, proposes bounded plan changes, and selectively re-executes eligible work.

It is **default-off and integration-proven, not production-proven**. Destructive, permission, and approval-timeout failures are not automatically retried. See [`docs/hyperagent-current-state-audit.md`](docs/hyperagent-current-state-audit.md).

### JAK Shield

The enforced runtime path uses the embedded defensive security package for guardrails, risk classification, PII handling, approval policy, and audit logging. The separate external JAK Shield MCP gateway remains a distinct project and is not represented as universally gating every JAK Swarm action today.

See [`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md) and [`SECURITY.md`](SECURITY.md).

## Verified product surface

The repository truth gates currently track:

- **38 AI Agents** across orchestration, executive, coding, operations, and worker roles.
- **122 Classified Tools**, each labeled by risk and maturity.
- **15 Connectors** surfaced through real runtime paths; maturity varies by connector.
- Approval-gated external actions and manual-only critical actions.
- PostgreSQL-backed workflow state, checkpointing, task assignments, and audit records.
- Company Brain, Hyperagent, audit/compliance, browser automation, and self-hosted deployment paths.

Counts are checked in CI against the code registry and integration matrix rather than maintained only as marketing text.

## Honest beta status

JAK Swarm is suitable for local evaluation, self-hosted validation, and controlled design-partner pilots.

It is **not yet enterprise-SLA ready**. Named boundaries include:

- no completed third-party security audit or compliance certification;
- legal documents are not represented as lawyer-reviewed enterprise agreements;
- Hyperagent still requires sustained production canary evidence;
- connector maturity is uneven;
- multiplayer execution is not a CRDT document editor or offline collaborative system;
- production deployment still requires correct infrastructure, credentials, monitoring, and operator review.

The authoritative readiness checklist is [`docs/beta-release.md`](docs/beta-release.md).

## Architecture

```text
Next.js dashboard
  ├─ shared workflow session
  ├─ Company Brain
  ├─ Hyperagent control centre
  ├─ approvals, inbox, audit, and artifacts
  └─ administration

Fastify API
  ├─ workflow collaboration service
  ├─ task-assignment bridge
  ├─ durable queue and coordination signals
  ├─ Company Brain services
  ├─ approvals and audit services
  └─ connector and tool routes

Swarm runtime
  ├─ Commander
  ├─ Guardrail
  ├─ Planner
  ├─ Router
  ├─ dependency-aware workers
  ├─ Verifier
  └─ bounded Replanner / Hyperagent

PostgreSQL
  ├─ workflows and checkpoints
  ├─ participants and session events
  ├─ assignments and approvals
  ├─ traces and artifacts
  └─ tenant-scoped audit history
```

Full architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Quick start

### Requirements

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+; pgvector recommended
- Redis optional for distributed scheduling and locks
- credentials for any external model or connector you enable

### Install

```bash
git clone https://github.com/inbharatai/jak-swarm.git
cd jak-swarm
pnpm install
cp .env.example .env
```

At minimum, configure the database and authentication secrets. Add an OpenAI or Gemini key for the model provider you intend to run.

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/jak_swarm
AUTH_SECRET=replace-with-a-random-secret
EVIDENCE_SIGNING_SECRET=replace-with-a-separate-random-secret

OPENAI_API_KEY=optional
GEMINI_API_KEY=optional

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Full environment reference: [`docs/environment-setup.md`](docs/environment-setup.md).

### Database

```bash
pnpm --filter @jak-swarm/db db:migrate
pnpm --filter @jak-swarm/db db:seed       # optional sample data
pnpm seed:compliance                      # optional compliance controls
```

### Run

```bash
# Terminal 1
pnpm --filter @jak-swarm/api dev

# Terminal 2
pnpm --filter @jak-swarm/web dev
```

Open `http://localhost:3000`.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm check:truth
```

The collaboration integration suite uses real PostgreSQL through Testcontainers and covers participant persistence, exclusive task control, ordered session events, versioned redirection, and human-result injection into workflow state.

## Technology

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js 16, React 19, Tailwind CSS |
| API | Fastify + TypeScript |
| Database | PostgreSQL, Prisma, pgvector |
| Durable workflows | LangGraph state graph + PostgreSQL checkpoints |
| Alternate orchestration | Google ADK behind configuration |
| Validation | Zod |
| Testing | Vitest + Testcontainers |
| Browser automation | Playwright |
| Integrations | MCP and provider-specific connectors |

## Documentation

| Document | Purpose |
|---|---|
| [`docs/multiplayer-ai.md`](docs/multiplayer-ai.md) | Shared-session model, routes, handoffs, redirection, and replay |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System architecture and runtime design |
| [`AGENTS.md`](AGENTS.md) | Agent roles and contracts |
| [`SECURITY.md`](SECURITY.md) | Security policy and reporting |
| [`docs/current-runtime-truth.md`](docs/current-runtime-truth.md) | What is actually wired today |
| [`docs/integration-maturity-matrix.md`](docs/integration-maturity-matrix.md) | Connector maturity and runtime paths |
| [`docs/hyperagent-current-state-audit.md`](docs/hyperagent-current-state-audit.md) | Hyperagent implementation boundaries |
| [`docs/beta-release.md`](docs/beta-release.md) | Beta scope and production-readiness checklist |
| [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md) | Cloud Run deployment guide |
| [`docs/railway-deployment.md`](docs/railway-deployment.md) | Railway deployment guide |

## Security and responsible use

JAK Swarm is designed for defensive, permissioned business automation. High-risk external actions require approval, and critical manual-only operations remain human controlled.

Report vulnerabilities through [`SECURITY.md`](SECURITY.md). Do not use the project for malware, phishing, credential theft, exploit generation, unauthorized access, or other offensive activity.

## License

MIT. See [`LICENSE`](LICENSE).
