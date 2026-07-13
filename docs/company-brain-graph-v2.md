# Company Brain Graph V2

Company Brain Graph V2 upgrades JAK's existing evidence-first Company Operating Layer from artifact lists and JSON links into a governed organisational memory system that Hyperagents can safely invoke.

## What ships

### Canonical organisational graph

- `CompanyGraphEntity` remains the canonical node store.
- `company_entity_aliases` resolves exact and near-duplicate names without silently merging uncertain matches.
- `company_edges` stores first-class typed relationships with confidence, evidence ids, temporal validity, and lifecycle status.
- `company_entity_merges` preserves an audit trail when duplicate nodes are consolidated.

### Evidence-backed truth

- `company_claims` stores subject-predicate-object assertions separately from entities.
- Every claim records confidence, source-authority score, valid-from/valid-to, status, and supersession history.
- `company_claim_evidence` links claims back to the exact artifacts that support them.
- Low-authority claims remain `proposed`; comparable contradictions become `disputed`; only materially newer and more authoritative evidence auto-supersedes an active claim.
- `company_memory_reviews` provides a human review queue for disputed claims and uncertain entity merges.

### Governed evidence access

`company_artifact_policies` adds a non-destructive policy layer over existing artifacts:

- visibility: `public`, `internal`, or `restricted`;
- explicit allowed agent roles for restricted evidence;
- sensitivity classification;
- retention deadline;
- processing state, attempts, and failure reason.

The original `company_artifacts` table remains unchanged. This keeps migration 118 additive and avoids invalidating existing connector ingestion.

### Automatic processing

Creating a company artifact schedules processing immediately. A database-claimed background sweep also picks up connector-created and previously ingested artifacts, so GitHub/Gmail/Drive syncs do not depend on the HTTP artifact route. Atomic policy-state claims prevent duplicate processing across API instances.

1. entity extraction through the existing Company Operating Layer;
2. canonical entity resolution;
3. claim extraction from structured entity fields;
4. source-authority and contradiction evaluation;
5. typed relationship creation;
6. review-queue creation where deterministic rules cannot safely decide;
7. artifact processing-state update.

Manual reprocessing is available for previously extracted artifacts. Failures are persisted honestly and retried only within a bounded three-attempt budget; stale `processing` claims can be recovered after 30 minutes. No fake successful processing state is written.

Runtime controls:

- `COMPANY_BRAIN_AUTO_PROCESS_ENABLED` (default `true`)
- `COMPANY_BRAIN_AUTO_PROCESS_INTERVAL_MS` (default `60000`, minimum `15000`)
- `COMPANY_BRAIN_AUTO_PROCESS_BATCH_SIZE` (default `3`, maximum `25`)

### Hyperagent context engine

Every BaseAgent can receive a task-specific `<company_brain>` block in addition to the approved static CompanyProfile.

The context engine combines:

- task/entity full-text relevance;
- canonical entities;
- active and disputed claims;
- typed graph relationships;
- evidence references and excerpts;
- artifact visibility, role allowlists, and retention;
- a strict character/token budget.

Restricted evidence is removed before claims and edges are packaged. Relationships to omitted entities are also removed, preventing indirect identifier leakage.

## API surface

Existing artifact, entity, drift, specification, approval, and execution routes remain compatible.

New routes:

- `POST /company/artifacts/:id/process`
- `PATCH /company/artifacts/:id/policy`
- `GET /company/brain/graph`
- `GET /company/brain/entities/:id`
- `POST /company/brain/context`
- `GET /company/brain/reviews`
- `POST /company/brain/claims/:id/decide`
- `POST /company/brain/entities/:id/merge`

Review and policy mutations require `REVIEWER`, `TENANT_ADMIN`, or `SYSTEM_ADMIN`. Normal authenticated tenant members can query the graph and task-specific context.

## Graph UI

`/company/graph` provides:

- searchable and filterable node-edge visualisation;
- selected-entity claims and relationships;
- confidence and truth-status visibility;
- reviewer claim approval/rejection;
- reviewer entity-merge approval;
- graceful read-only operation for users without review permissions.

## Migration and generation

Migration: `118_company_brain_graph_v2`

The Prisma schema is split across the `packages/db/prisma` directory. Database scripts explicitly pass `--schema prisma`, so Prisma loads `schema.prisma` together with `company-brain-v2.prisma`.

Run:

```bash
pnpm --filter @jak-swarm/db db:generate
pnpm --filter @jak-swarm/db db:migrate:deploy
```

## Truth and safety rules

- The LLM may extract candidate facts; deterministic code decides whether they are proposed, active, disputed, or superseding.
- Agents never silently rewrite active company truth.
- Important ambiguity is surfaced to a human review queue.
- All SQL uses fixed statements with parameter values; caller-controlled strings are never interpolated as SQL identifiers or clauses.
- Tenant ids scope every graph, claim, edge, evidence, review, and policy query.
- Entity merges transfer evidence, aliases, claims, and edges before soft-deleting the duplicate node.
- The existing Hyperagent repair/learning loop remains independent: Graph V2 supplies organisational truth; WorkflowOutcome/LearningRecord continues to learn execution performance.

## Focused tests

`tests/unit/company-brain/company-brain-v2-core.test.ts` covers:

- canonical label normalisation;
- conservative entity similarity;
- source-authority ranking;
- low-authority proposal behavior;
- trusted first-claim activation;
- deterministic supersession;
- contradiction review;
- visibility/role/retention enforcement;
- typed relationship inference.

Production deployment still requires the normal repository CI and migration deployment gates. No claim is made that migration 118 has run against production until the deployment pipeline reports it.
