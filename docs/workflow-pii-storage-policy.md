# Workflow-Level PII Storage Policy

**Status:** drafted in Local Sprint 3, after the Phase 3 finding that
`workflows.{goal,error,finalOutput,planJson,stateJson}` were persisting
raw user PII verbatim — uncovered when a workflow created with literal
email + SSN + credit-card values left them readable in plain SQL.

## 1. Inventory of workflow persistence boundaries

| # | Where written | Field | UI-visible? | Risk class |
|---|---|---|---|---|
| 1 | `WorkflowService.createWorkflow` (route layer entry) | `workflows.goal` | YES (cockpit shows the user's typed prompt back to them) | Tenant-private |
| 2 | `apps/api/src/routes/{schedules,slack,voice}.routes.ts` `db.workflow.create` | `workflows.goal` | YES (same surface as 1) | Tenant-private |
| 3 | `apps/api/src/services/audit/workpaper.service.ts` `db.workflow.create` | `workflows.goal` (synthetic; "audit grouping") | YES (audit operators) | Tenant-private |
| 4 | `WorkflowService.updateWorkflowStatus` | `workflows.error` | YES (shown in cockpit when a run fails) | Tenant-private; may echo user input |
| 5 | `apps/api/src/services/swarm-execution.service.ts:1573` | `workflows.finalOutput` | YES (the cockpit's main output panel) | Tenant-private |
| 6 | `apps/api/src/services/db-state-store.ts:55` + `swarm-execution.service.ts:1034` | `workflows.stateJson` | NO (engine-internal checkpoint) | Tenant-private; may contain restored PII per P0-B's runtime restore step |
| 7 | `swarm-execution.service.ts` (planner output) | `workflows.planJson` | YES (cockpit's plan view) | Tenant-private |
| 8 | `WorkflowService.saveTrace` | `agent_traces.{input,output,toolCalls,handoffs,error}Json` | YES (Run Inspector) | **Already redacted** via P0-B (`redactJsonForPersistence`) |
| 9 | `audit-log` plugin | `audit_logs.details` | YES to operators | May contain workflow IDs + brief metadata only |

## 2. Field classification

| Field | Class | Action |
|---|---|---|
| `workflows.goal` | (1) Must preserve user-visible original text | **Encrypt at rest** |
| `workflows.error` | (1) User sees these failure messages | **Encrypt at rest** |
| `workflows.finalOutput` | (1) User reads the answer | **Encrypt at rest** |
| `workflows.planJson` | (1) User sees the plan | **Encrypt at rest** (whole-blob) |
| `workflows.stateJson` | (5) Retain temporarily — engine-internal | **Encrypt at rest** + included in retention sweep |
| `agent_traces.{input,output,toolCalls}Json` | (2) Already redacted | No change (P0-B holds) |
| `audit_logs.details` | (2) Sanitize at write site (no raw PII goes in) | Existing audit-log plugin already constrains payload shape; not changing here |

## 3. Storage strategy: AES-256-GCM at-rest encryption

**Why encryption, not redaction:** the cockpit shows `goal`, `error`,
`finalOutput`, `planJson` back to the same tenant who created them.
Redacting them breaks UX. Encryption preserves the user-facing read
path (decrypt on read inside the tenant boundary) while making the
column unreadable to anyone without the key (DB operator, leaked
backup, dump, query of an unrelated tenant).

**Mechanism:**
- AES-256-GCM (authenticated; tampering detected on decrypt)
- 96-bit random IV per write
- Key from `JAK_FIELD_ENCRYPTION_KEY` env (32 bytes hex) — same env
  layer as `AUTH_SECRET`, never logged
- Output format: `enc:v1:<base64(IV || ciphertext || authTag)>`
  - The `enc:v1:` prefix lets us:
    - Detect already-encrypted values on read (idempotent decrypt)
    - Migrate gradually (rows written before this lands stay readable;
      next write encrypts)
    - Roll forward to `v2` if we ever swap algorithms
- No DB migration: encrypted output is text, fits the existing TEXT /
  JSONB columns
- For JSON columns (`planJson`, `stateJson`), the whole stringified
  blob is encrypted, then stored as a single-key JSONB
  `{"enc":"enc:v1:..."}` so Postgres still accepts it as JSON

**Key management:**
- Set `JAK_FIELD_ENCRYPTION_KEY` in production env (same place as
  `AUTH_SECRET`, `OPENAI_API_KEY`)
- If unset, the cipher operates in **passthrough mode**: writes return
  plaintext, reads return whatever's there. This is the **dev /
  local default** so existing local DBs keep working without a key.
  Production deploys MUST set the key — boot diagnostics fail-loud
  when `NODE_ENV=production && !JAK_FIELD_ENCRYPTION_KEY`.

**Application strategy: Prisma `$extends`**
- A single extension wired in `packages/db/src/index.ts` covers every
  call site — `createWorkflow`, `slack.routes`, `voice.routes`,
  `schedules.routes`, `workpaper.service`, `attestation.service`,
  `swarm-execution.service` etc. all benefit without per-route edits.
- Encryption applies in the `query` interceptor for `workflow.create`,
  `workflow.update`, `workflow.upsert`. Decryption applies in the
  `result` extension for any returned row.
- Idempotent: encrypt skips already-encrypted values; decrypt skips
  values without the `enc:v1:` prefix.

## 4. What's deliberately NOT in this sprint

- **Per-tenant key derivation.** Single shared symmetric key for now.
  Per-tenant KMS/key-derivation is a follow-on once a real KMS is
  wired (AWS KMS / GCP KMS / Vault).
- **Encrypting `audit_logs.details`.** Audit log writes are constrained
  by the audit-log plugin's payload shape; raw PII is not supposed
  to land there. We rely on the existing constraint and add a follow-on
  PII guard at the audit-log write site as a separate sprint.
- **Searching encrypted columns.** AES-GCM ciphertext is not searchable.
  We accept the loss for now (the cockpit reads by `id` / `tenantId`,
  not by `goal LIKE`). If full-text search over goals becomes needed,
  we'll layer a separate searchable index (encrypted-search or
  SearchToken table).
- **Migration to encrypt existing rows.** Existing rows stay readable
  via the passthrough-on-read path. A backfill job to encrypt old
  rows is a follow-on.

## 5. Test plan

- Unit: `field-cipher.test.ts` — round-trip of email/phone/SSN/CC,
  rejects tampered ciphertext, idempotent on already-encrypted input,
  passthrough when no key set
- Integration: `workflow-pii-encryption.test.ts` — direct SQL probe
  proves `workflows.goal` column does NOT contain plaintext PII after
  a workflow is created with PII in the goal; the API read path
  decrypts back to plaintext for the owning tenant
- Runtime: re-create the alice@acme.com / SSN / credit-card workflow
  from Sprint 2 against the local Postgres with the key set; SQL
  inspect; confirm both encryption-at-rest and decryption-on-read

## 6. Verdict on completeness

This policy closes the **`workflows.goal/error/finalOutput/planJson/stateJson`
plaintext leak** specifically. It does NOT make JAK HIPAA/SOC 2-ready
on its own — that requires per-tenant key management, KMS integration,
and a documented incident-response procedure. But it does eliminate
the most visible runtime evidence the Sprint 2 audit found.
