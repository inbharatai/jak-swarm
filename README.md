<div align="center">

# JAK Swarm

### Company Brain + Hyperagent for evidence-grounded company execution

**JAK builds cited understanding from company evidence, turns execution gaps into approved plans, and runs those plans through governed agents that can verify outcomes and repair eligible failures.**

[![Release](https://img.shields.io/badge/Release-Beta_0.1.0--beta.0-0ea5e9?style=flat-square)](docs/beta-release.md)
[![AI Agents](https://img.shields.io/badge/AI_Agents-38-2563eb?style=flat-square)](AGENTS.md)
[![Classified Tools](https://img.shields.io/badge/Classified_Tools-122-16a34a?style=flat-square)](docs/current-runtime-truth.md)
[![Connectors](https://img.shields.io/badge/Connectors-15-0284c7?style=flat-square)](docs/integration-maturity-matrix.md)
[![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)](LICENSE)

[Quick start](#quick-start) · [Architecture](ARCHITECTURE.md) · [Hyperagent audit](docs/hyperagent-current-state-audit.md) · [Security](SECURITY.md) · [Beta status](docs/beta-release.md)

</div>

---

## What JAK Swarm is

JAK Swarm is a **working beta build** built around two core engines:

1. **Company Brain** turns company evidence into a cited, permission-filtered graph of artifacts, entities, claims, relationships, conflicts, and execution drift.
2. **Hyperagent** turns approved Company Brain specifications into governed execution, measures the result, diagnoses failures, repairs eligible work, and promotes learning only through explicit policy and human-controlled gates.

The specialist-agent runtime, tools, connectors, JAK Shield controls, and multiplayer workspace support those two engines. They are not the primary product thesis.

```text
Company evidence
  → Company Brain
  → cited context + drift findings
  → reviewer-approved executable specification
  → Hyperagent + specialist-agent runtime
  → verification, acceptance measurement, repair, outcomes, and audit history
```

JAK is not a generic chatbot, a claim of unrestricted autonomous company operation, or a finished enterprise product.

## Company Brain

Company Brain is designed to provide **source-backed organisational context**, not untraceable chatbot memory.

### What is implemented

| Area | Current implementation |
|---|---|
| Evidence store | Tenant-scoped artifacts with source type, original body, source URL, timestamps, body hash, metadata, and audit records |
| Graph model | Entities, aliases, stable identifiers, typed claims, claim evidence, relationships, conflicts, review records, and provenance |
| Retrieval | Exact aliases, indexed identifiers, PostgreSQL full-text search, graph-neighbour expansion, recency and confidence scoring, plus optional pgvector similarity |
| Context safety | Source-less entities are removed before context construction; visible context is filtered by tenant, artifact visibility, retention, and allowed agent role |
| Drift detection | Deterministic checks for defined patterns such as customer pain without matching work, decisions without tasks, unsupported execution, and stale high-priority work |
| Executable specs | Evidence-grounded specifications containing an objective, approach, acceptance criteria, test plan, agent task plan, and approval gates |
| Review and execution | Reviewer decisions are persisted; approved specifications can be materialised into a workflow, executed, paused for approval, resumed, measured, and linked to persisted outcomes |
| Product surfaces | `/company`, `/company/graph`, Company Brain routes, background processing jobs, and optional `brain_*` MCP tools |

### Automatic ingestion currently supported

Scheduled Company Brain sync is implemented for **GitHub, Gmail, and Google Drive**. The interval is configurable and defaults to five minutes.

- **Gmail:** fetches up to 25 recent messages per sync using the full message payload; stores headers, decoded body text, recipients, labels, thread ID, and attachment metadata. Attachment file contents are not downloaded.
- **Google Drive:** paginates up to 500 files per sync. Google Docs, Sheets, plain text, and JSON can be exported as text; Slides, binary files, and unsupported formats remain metadata-only.
- **GitHub:** ingests up to 50 repositories, recent issues and pull requests for the five most recently updated repositories, and up to 50 recent user events. It does not yet index complete repository source trees, every discussion, review, workflow run, or historical event.

Connector ingestion automatically enqueues Company Brain processing. Per-tenant/provider sync claiming is atomic so concurrent manual and scheduled runs do not intentionally process the same cursor window.

Other connectors may be usable by agents, but they do not automatically become Company Brain evidence unless a specific ingestion path or manual upload is used.

### Retrieval and evidence boundaries

The live retrieval path combines lexical, identifier, graph, temporal, and confidence signals. Vector retrieval is **optional**, not assumed: it is enabled only when the Company Brain embedding provider is configured. The current real embedding path uses OpenAI; without it, retrieval continues with lexical and graph signals.

Current access filtering is useful but not equivalent to complete source-system ACL parity. It enforces tenant boundaries, provenance, visibility, retention, and agent-role rules. User-, department-, project-, region-, and source-ACL-level policy coverage is not yet complete.

Some Company Brain extraction and specification-generation paths currently require configured OpenAI credentials. JAK does not silently substitute fabricated template output when the model path is unavailable. When a spec is generated, its prose acceptance criteria are compiled into wired structured criteria against the generated task plan (see **Accuracy machinery** under Hyperagent) — criteria that cannot be deterministically bound remain `CUSTOM` and the compile report is recorded so a reviewer sees exactly what will be machine-measurable after a run.

## Hyperagent

Hyperagent is the governed reasoning, repair, and learning layer above the workflow runtime.

### What is implemented

- A deterministic failure taxonomy and persisted diagnoses.
- Bounded output correction for eligible malformed-output failures.
- Counterfactual fault isolation and dependency-aware plan repair.
- Symbolic validation before a proposed plan change is applied.
- Autonomy-controlled selective re-execution.
- Approved-spec execution with dependency and cycle validation.
- Acceptance measurement with `MET`, `UNMET`, and `UNVERIFIABLE` outcomes.
- PostgreSQL-backed checkpoints for approval interruption and resume.
- Persisted plan versions, workflow outcomes, execution attempts, artifacts, and learning records.
- A governed configuration lifecycle for proposed changes: `DRAFT → PROPOSED → SHADOW → CANARY → PROMOTED`, with operator-controlled advance and rollback.

### Accuracy machinery

Four mechanisms make the Hyperagent's answers and executions *measurably* more accurate, each extending the existing honest seams rather than adding a new engine:

| Mechanism | What it does | Honest boundary |
|---|---|---|
| **Structured-criteria compiler** | Converts the spec generator's prose acceptance criteria into wired, deterministically-validated structured criteria bound to the task plan. Unresolvable prose stays `CUSTOM`/unwired with a recorded reason. | Never invents a binding — a criterion that cannot be resolved against the plan stays `UNVERIFIABLE`, not faked `MET`. |
| **Citation-coverage gate** | Scores a worker's output prose against the Brain claims it was served, emitting a `citation_coverage` metric the acceptance checker binds via `METRIC_THRESHOLD`. Unsupported claims surface verbatim for diagnosis. | Lexical (token-containment) matching, not an embedding judge — heavy paraphrase is honestly flagged for review; an empty served-claim set is not measurable and stays unwired. |
| **Calibrated abstention** | A worker may decline rather than guess (`TaskStatus.ABSTAINED` → `TASK_ABSTAINED`). Abstentions carry reason + partial evidence to the user ("I don't know — here's what I do know"), fail completion/verification criteria deterministically, and feed chronic-abstainer routing in the learning extractor. | Abstention is honest, never a pass: a run of all-abstains is `UNVERIFIABLE`, and no LLM layer converts an abstain into a completion. |
| **Rubric quality floor** | A deterministic floor (`packages/verification/rubric`) scores instruction-following (sub-ask engagement, task-term completeness), citation presence, and format conformity, capping the verifier's composite confidence. | Escalate-only: the floor can lower confidence and surface actionable issues, but never raises it and never blocks a pass on its own; an LLM judge cannot rescue a structural floor failure. |

All four are deterministic-first and pure where the verdict must be reproducible, matching the existing acceptance-checker / outcome-evaluator / failure-diagnostician posture.

Hyperagent is **off by default**. A tenant administrator can configure it through `PUT /hyperagent/config` using modes `OFF`, `OBSERVE`, `ASSISTED`, or `AUTONOMOUS_SAFE`, together with autonomy levels and repair budgets. `OBSERVE` is read-only; enabling higher modes changes live workflow behaviour.

The live runtime harvests per-task failure classes and best-effort artifact IDs when workers emit them. Artifact emission is not yet complete across every worker, and runtime metrics are still narrower than a full production observability system.

Hyperagent is live-wired and integration-tested, including real Postgres coverage and selected real-model validation. It has **not** completed the sustained managed-Postgres, real-traffic production canary required for an unqualified production claim. The agent cannot promote its own configuration changes without the configured lifecycle and human operator controls.

## Supporting layers

### Specialist-agent runtime

The current registries contain **38 specialist agents** and **122 classified tools**. Workflows use planning, risk classification, dependency-aware execution, verification, approval gates, durable state, and audit records. Counts are checked by repository truth gates rather than maintained only as marketing text.

### Multiplayer control room

The multiplayer layer is the human control surface around Company Brain and Hyperagent execution. It supports workflow participants, presence, task-control leases, comments, human handoffs, safe task redirection, approval visibility, and replay export.

See [`docs/multiplayer-ai.md`](docs/multiplayer-ai.md).

### Connectors

The public product registry currently shows **15 connectors with real runtime paths**, plus several adapters that do not have dedicated UI tiles. Maturity varies; not every connector has equal depth, automatic Brain ingestion, or production validation.

See [`docs/integration-maturity-matrix.md`](docs/integration-maturity-matrix.md).

### JAK Shield

The enforced in-process path uses `packages/security` for prompt-injection checks, PII handling, risk classification, RBAC, approvals, autonomy policy, and audit logging. The separate external JAK Shield MCP project is not represented as universally gating every JAK Swarm action. Its signed-decision integration remains limited and observational where enabled.

See [`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md) and [`SECURITY.md`](SECURITY.md).

## Honest beta status

JAK Swarm is appropriate for local evaluation, self-hosted validation, controlled pilots, and design-partner testing.

It is **not yet enterprise-SLA ready**. Important boundaries include:

- no completed third-party security audit, penetration test, or compliance certification;
- no claim that legal documents are lawyer-reviewed enterprise agreements;
- Company Brain automatic ingestion currently covers three providers and has explicit per-provider limits;
- access control does not yet reproduce every source system's user and document ACL;
- Hyperagent is default-off and still needs sustained production-canary evidence;
- connector maturity and provider behaviour vary and depend on valid credentials and permissions;
- API keys are required for the external model and connector providers that use them, and provider usage may incur costs;
- production operation requires migrations, queues, monitoring, backups, incident procedures, and human review.

Use **beta**, **design partner**, or **self-hosted validation** language. Do not claim production SLA, certification, complete compliance, or unrestricted autonomous operation.

The remaining operational work is tracked in [`docs/beta-release.md`](docs/beta-release.md) and the **post-build production hardening roadmap**.

## FAQ

### Is JAK Swarm production-ready?

For paying enterprise customers expecting an SLA: **NO, not yet.** JAK has not completed a third-party security audit, SOC 2 or ISO 27001 attestation, or lawyer-reviewed Terms of Service, Privacy Policy, and DPA. It should be evaluated as a beta, design-partner, or self-hosted-validation product until those gates and the production canary are closed.

## Architecture

```text
Next.js dashboard
  ├─ Company Brain and graph review
  ├─ Hyperagent control centre
  ├─ multiplayer workflow sessions
  ├─ approvals, inbox, artifacts, and audit
  └─ tenant administration

Fastify API
  ├─ Company Brain ingestion, processing, retrieval, drift, and spec services
  ├─ Hyperagent configuration, execution, outcome, and learning services
  ├─ workflow collaboration and human-task bridge
  ├─ connector, tool, approval, and audit routes
  └─ queue, scheduler, and coordination services

LangGraph runtime
  ├─ Guardrail
  ├─ Planner and Router
  ├─ specialist workers
  ├─ Verifier and Validator
  ├─ approval interrupt/resume
  └─ Hyperagent diagnosis, repair, and learning nodes

PostgreSQL
  ├─ Company Brain artifacts, graph, claims, evidence, reviews, and jobs
  ├─ workflows and LangGraph checkpoints
  ├─ Hyperagent diagnoses, plans, outcomes, executions, and learnings
  ├─ participants, task assignments, approvals, traces, and artifacts
  └─ tenant-scoped audit history
```

Full architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Quick start

### Requirements

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+ with pgvector recommended
- Redis for distributed scheduling, coordination, and queue-backed deployments
- Supabase configuration for the current authentication and storage surfaces
- credentials for each external model or connector you enable

### Install

```bash
git clone https://github.com/inbharatai/jak-swarm.git
cd jak-swarm
pnpm install
cp .env.example .env
```

Configure the database, authentication, Supabase, signing, and any provider credentials you intend to use. See [`docs/environment-setup.md`](docs/environment-setup.md).

```bash
pnpm db:generate
pnpm db:migrate
```

Run the API and web application in separate terminals:

```bash
pnpm --filter @jak-swarm/api dev
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

Integration tests use PostgreSQL Testcontainers for database-backed behaviour. Live-provider and browser workflows require their own environment, credentials, and services; passing unit and integration tests is not the same as proving a hosted production deployment.

## Main documentation

| Document | Purpose |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System architecture and runtime design |
| [`docs/hyperagent-current-state-audit.md`](docs/hyperagent-current-state-audit.md) | Hyperagent implementation history, resolved findings, and remaining boundaries |
| [`docs/production-canary-plan.md`](docs/production-canary-plan.md) | Required production-canary procedure |
| [`docs/multiplayer-ai.md`](docs/multiplayer-ai.md) | Human collaboration, handoff, redirection, and replay |
| [`docs/integration-maturity-matrix.md`](docs/integration-maturity-matrix.md) | Connector paths and maturity |
| [`docs/beta-release.md`](docs/beta-release.md) | Beta scope and release boundaries |
| [`SECURITY.md`](SECURITY.md) | Security policy and vulnerability reporting |

## Security and responsible use

JAK Swarm is intended for defensive, permissioned business automation. High-risk external actions require approval, and critical manual-only operations remain human controlled.

Do not use the project for malware, phishing, credential theft, exploit generation, unauthorised access, or other offensive activity. Report vulnerabilities through [`SECURITY.md`](SECURITY.md).

## License

MIT. See [`LICENSE`](LICENSE).
