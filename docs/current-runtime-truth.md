# Current Runtime Truth — JAK Swarm

**Commit audited:** `27583a4` (main, 2026-07-14)
**Method:** Every capability below was traced against executable source on `main` at `27583a4` by three read-only passes over the live runtime path (HTTP route → service → worker → agent → tool → DB → UI → audit). Old audit documents (`docs/current-system-truth-audit.md` at `59db931`, mandate-completion-report, external-audit notes) were NOT copied — every file:line below was re-read against current source. A class, interface, migration, prompt, MCP provider definition, or test mock is NOT counted as a working feature unless the live runtime calls it.

**Status refresh (post-audit, this commit):** Sections A1/A2/A4/A5/A6 + the summary-table and remediation-order rows were reclassified after the audit commit to reflect PR 1 (#159, `f619629`) and PR 2 (#160, `45d0f1b`), which both merged on `main` after `27583a4`. The reclassification is forward-progress only — no capability was demoted; the `27583a4` audit's gap verdicts for A1/A2/A4/A5/A6 are superseded by the PR 1/PR 2 paragraphs now in those sections. All other sections (A3, A7–A9, B–G) remain at their `27583a4` audit verdicts. No `PRODUCTION_PROVEN` label was introduced — PR 1/PR 2 are `LIVE_RUNTIME_WIRED` / `INTEGRATION_PROVEN` only (named stops F3 / PR 14, rule 10).

## Classification legend

| Class | Meaning |
|---|---|
| `PRODUCTION_PROVEN` | Exercised end-to-end against real external providers + managed Postgres with measured canary evidence. |
| `LIVE_RUNTIME_WIRED` | Reachable from a live HTTP route / scheduler / worker into real service code, but not yet proven against real providers or only exercised behind a default-off gate. |
| `INTEGRATION_PROVEN` | Proven against real Postgres (testcontainers) and/or a real-DB integration test, but not against managed Postgres + real external provider in production. |
| `UNIT_PROVEN` | Proven only by unit tests against pure functions / mocks; no live-DB or live-provider proof. |
| `CONFIGURATION_DEPENDENT` | Behavior depends on env vars / credential presence; unconfigured → explicit failure (no silent empty success). |
| `PARTIAL` | A slice of the capability is live; material dimensions are missing or stubbed. |
| `ROADMAP` | Designed/declared but no live caller in the runtime. |
| `DEAD_OR_DUPLICATE` | Code exists but no live caller reaches it, or duplicates another path. |

---

## A. Connector credential backbone

### A1. Email (Gmail) adapter — `LIVE_RUNTIME_WIRED` (per-tenant resolver + live population; NOT production-proven)

- **PR 1 (#159, `f619629`) closed the rule-7 violation.** The process-global module singleton (`const emailAdapter = getEmailAdapter()` at the old `builtin/index.ts:13`) is removed. Each email tool call now resolves its own adapter from the trusted per-tenant context via `resolveEmailAdapterForContext(context)` (`packages/tools/src/adapters/adapter-factory.ts`), mirroring the CRM resolver.
- `ToolExecutionContext.emailCredentials?: { email; appPassword }` (`packages/shared/src/types/tool.ts`) is now declared and **populated live** (see A2/A6).
- Resolution order: per-tenant context creds → labelled single-tenant dev opt-in (`JAK_EMAIL_SINGLE_TENANT_DEV=1`) → `UnconfiguredEmailAdapter` (throws on use). Without the opt-in flag, process-env Gmail creds are NEVER used (no cross-tenant env bleed).
- **PR 2 (#160, `45d0f1b`) wired live population:** `apps/api/src/services/tenant-connector-credentials.ts` resolves the tenant's Gmail app-password via `credential.service.resolveCredentials(..., { allowEnvFallback: false })`, registers it in the `tenant-credential-registry` side-channel keyed by `workflowId`, `worker-node` looks it up by `state.workflowId` into the `AgentContext`, and `tool-execution.service` forwards it into the `ToolExecutionContext`. Secret never touches serialized SwarmState (mirrors the `llmApiKey` side-channel — see A6).
- **Honest label:** `LIVE_RUNTIME_WIRED` + `INTEGRATION_PROVEN` (resolver + forwarding seam + population all exercised by unit/integration tests in PR 1/PR 2). **NOT `PRODUCTION_PROVEN`** — no real Gmail IMAP response was asserted (named stop F3 / PR 14, gated on owner production provider creds, rule 10). An OAuth-access-token Gmail connection is NOT IMAP-driveable yet → left unset → Unconfigured (never another tenant's creds).

### A2. Calendar (CalDAV) adapter — `LIVE_RUNTIME_WIRED` (per-tenant resolver + live population; NOT production-proven)

- **PR 1 (#159, `f619629`) closed the rule-7 violation.** The process-global module singleton (`const calendarAdapter = getCalendarAdapter()` at the old `builtin/index.ts:14`) is removed; each calendar tool call now resolves its own adapter via `resolveCalendarAdapterForContext(context)` (`packages/tools/src/adapters/adapter-factory.ts`).
- `ToolExecutionContext.calendarCredentials?: { email; appPassword }` is declared and **populated live** (PR 2 #160). The `CalDAVCalendarAdapter` is Google-specific and authenticates with the SAME Gmail app-password (basic auth), so calendar is driveable iff the tenant connected Gmail via app-password — `tenant-connector-credentials.ts` populates `calendarCredentials` from the same Gmail resolution as `emailCredentials`.
- Resolution order mirrors A1: per-tenant context → `JAK_CALENDAR_SINGLE_TENANT_DEV=1` opt-in → `UnconfiguredCalendarAdapter` (throws on use). Same side-channel transport as A1 (no SwarmState secret-leak).
- **Honest label:** `LIVE_RUNTIME_WIRED` + `INTEGRATION_PROVEN`, **NOT `PRODUCTION_PROVEN`** (no real CalDAV response asserted — named stop F3 / PR 14).

### A3. Deployment tools (Vercel / GitHub-native) — `CONFIGURATION_DEPENDENT` (process-global, inline)

- `packages/tools/src/builtin/index.ts:5974-6023` — `deploy_to_vercel` reads `process.env['VERCEL_TOKEN']` inline per call.
- `builtin/index.ts:6029` `github_create_repo`, `:6077` `github_push_files` read `process.env['GITHUB_PAT']` inline per call.
- **No `DeploymentAdapter` interface or factory exists.** No `deploymentCredentials` on `ToolExecutionContext`; no `resolveDeploymentAdapterForContext`. 
- **Verdict:** every call reads process env directly; no per-tenant path at all.

### A4. CRM adapter — `LIVE_RUNTIME_WIRED` (resolver reached; per-tenant Salesforce branch now REACHABLE via PR 2; NOT production-proven)

- `packages/tools/src/adapters/adapter-factory.ts` — `resolveCrmAdapterForContext(context)` priority chain:
  1. `JAK_CRM_SINGLE_TENANT_DEV=1` → `getCRMAdapterFromEnv(tenantId)` (env-keyed dev opt-in).
  2. Per-tenant Salesforce when `context.crmCredentials?.salesforce.{accessToken,instanceUrl}` present → `getSalesforceCRMAdapterForTenant(sf)`.
  3. Per-tenant Prisma → `new PrismaCRMAdapter(db, context.tenantId)`.
  4. `UnconfiguredCRMAdapter` (throws on use).
- Live tool call sites: `builtin/index.ts` email/calendar/CRM tools call the resolver — it IS reached.
- **PR 2 (#160, `45d0f1b`) made step 2 REACHABLE live.** Previously `context.crmCredentials` was declared but never populated (the branch was `DEAD_OR_DUPLICATE`). PR 2 populates `context.crmCredentials.salesforce` from the tenant's CONNECTED Integration row: `tenant-connector-credentials.ts` reads the Integration, decrypts the raw access token from `IntegrationCredential.accessTokenEnc`, reads `salesforceInstanceUrl` from `Integration.metadata`, and registers the bundle in the side-channel registry → `worker-node` → `AgentContext` → `ToolExecutionContext` (same secure transport as A1/A2). `getSalesforceCRMAdapterForTenant` now has a live caller path.
- **Honest label:** resolver `LIVE_RUNTIME_WIRED`; per-tenant Salesforce branch now `LIVE_RUNTIME_WIRED` + `INTEGRATION_PROVEN` (PR 2 unit tests cover decrypt + instanceUrl + tenant-scoping + malformed-row resilience); Prisma-tenant branch `INTEGRATION_PROVEN` (CRM tenant-isolation from PR #154 via `tests/integration/crm-tenant-isolation.integration.test.ts`). **None `PRODUCTION_PROVEN`** — no real Salesforce API response asserted (named stop F3 / PR 14, rule 10).

### A5. `context.crmCredentials` / `emailCredentials` / `calendarCredentials` population — `LIVE_RUNTIME_WIRED` (PR 2; NOT production-proven)

- **PR 2 (#160, `45d0f1b`) wired the apps/api → context credential seam for email/calendar/CRM-salesforce together** (the three share the deep SwarmState/AgentContext/ADK threading). Previously this was `ROADMAP` — declared but never written, which made the A4 Salesforce branch dead.
- Population site: `apps/api/src/services/tenant-connector-credentials.ts` (`resolveTenantConnectorCredentials(tenantId, db)`) is called from `swarm-execution.service.ts` at workflow start. The resolved bundle is threaded into:
  - the LangGraph `runner.run` params (new `emailCredentials` / `calendarCredentials` / `crmCredentials` on `RunParams`), and
  - the ADK `toolContext` object (`swarm-execution.service.ts`, threaded via AsyncLocalStorage by the ADK tool bridge).
- Secure transport (the critical constraint): secrets travel via a NEW side-channel registry `packages/swarm/src/supervisor/tenant-credential-registry.ts` keyed by `workflowId` — `swarm-runner` registers them and **deliberately omits them from the `runtime.start` spread** that builds SwarmState (so they never land in the `stateJson` DB checkpoint = no secret-leak). `worker-node` looks them up by `state.workflowId` into the per-node `AgentContext`; `tool-execution.service.ts` forwards them `AgentContext → ToolExecutionContext`. Cleared in the runner `finally`.
- `AgentContextParams`/`AgentContext` now declare the three fields (and `clone()` preserves them).
- **Honest label:** `LIVE_RUNTIME_WIRED` + `INTEGRATION_PROVEN` (registry, population, and forwarding-seam unit tests in PR 2). **NOT `PRODUCTION_PROVEN`** — no real Gmail/Salesforce response asserted (named stop F3 / PR 14, rule 10).

### A6. `credential.service.ts` — `LIVE_RUNTIME_WIRED` (PR 2 made it live-reachable; partial consolidation; NOT the complete single source of truth yet)

- `apps/api/src/services/credential.service.ts` exports `resolveCredentials(tenantId, provider, db, opts?)` and `listConnectedProviders(tenantId, db)`. Internally `ensureFreshOAuthToken` for Gmail OAuth PKCE refresh.
- **PR 2 (#160, `45d0f1b`) made `credential.service` live-reachable for the first time** (previously `DEAD_OR_DUPLICATE` — zero production callers, only its own test imported it). `apps/api/src/services/tenant-connector-credentials.ts` calls `resolveCredentials(tenantId, 'GMAIL', db, { allowEnvFallback: false })` to populate `emailCredentials`/`calendarCredentials` (Workstream A2, partially done).
- **Partial consolidation — NOT the complete single source of truth yet:**
  - Salesforce is NOT a `BYOProvider` in `credential.service` (`BYOProvider = 'GMAIL' | 'VERCEL' | 'CALDAV' | 'GITHUB'`). PR 2 reads the Salesforce Integration row + decrypts the token directly in `tenant-connector-credentials.ts` (using `decrypt` from `crypto.ts`). Consolidating Salesforce into `credential.service` (adding a `SALESFORCE` case) is a follow-up.
  - `Vercel`/`GITHUB` (`BYOProvider`) are still NOT called by any live tool path — deployment tools still read `process.env` inline (see A3). `CALDAV` is structurally covered by the Gmail app-password path (the adapter is Google-specific).
  - Company Brain ingestion (`company-connector-sync.service.ts`) still has its own `resolveGitHubAccessToken`/`resolveGoogleAccessToken` calling `decryptCredentials` directly — NOT routed through `credential.service`.
- **Honest label:** `LIVE_RUNTIME_WIRED` (Gmail resolution path now called live). Workstream A2 is **partially closed**; completing it (Salesforce + Vercel + GitHub + Company Brain consolidation into `credential.service`) is a follow-up PR.

### A7. MCP reconnect — `PARTIAL` → **broken at runtime**

- `apps/api/src/plugins/swarm.plugin.ts:282-314` — `setImmediate` at startup loads every `Integration` with `status='CONNECTED'` and reconnects MCP providers.
- `:297` — `const creds = JSON.parse(integration.credentials.accessTokenEnc) as Record<string,string>;` — **does NOT call `credential.service` or `decrypt()` from `crypto.ts`**; it runs `JSON.parse` directly on the stored column.
- Storage contract (`schema.prisma:1099-1111`, `IntegrationCredential`): `accessTokenEnc` is AES-256-GCM ciphertext (`iv:authTag:ciphertext` base64) produced by `encryptCredentials` (`apps/api/src/utils/crypto.ts:22-29`). Connect-MCP route writes `accessTokenEnc: encryptCredentials(JSON.stringify(credentials))` (`integrations.routes.ts:446-450`); OAuth-callback writes `accessTokenEnc: encryptCredentials(tokens.accessToken)` (`:714-727`).
- **`JSON.parse` on `iv:authTag:ciphertext` base64 throws on every connected MCP provider** → catch at `swarm.plugin.ts:302-309` flips the Integration to `status='NEEDS_REAUTH'`.
- **Verdict:** MCP reconnect is broken — it parses encrypted ciphertext as JSON without decrypting. Every MCP provider that was connected is marked NEEDS_REAUTH at boot. Workstream A4 (fix MCP reconnect) is the unblock.

### A8. Connector health contract — `PARTIAL` (no unified contract)

- `ConnectorStatus` (`packages/tools/src/connectors/types.ts:41` + `apps/api/src/routes/connectors.routes.ts:31-34`): 8-state static-registry enum (`available|installed|configured|needs_user_setup|failed_validation|unavailable|disabled|blocked_by_policy`). `ConnectorView` (`types.ts:271-281`) carries `manifest`, `status`, `lastValidatedAt?`, `installedToolCount?`, `statusReason?`. This is manifest-registry state, NOT runtime auth/reachability. **No `authenticated`/`reachable`/`permissionStatus`/`lastSuccessfulCallAt`/`maturity` runtime fields.**
- `ToolMaturity` (`packages/shared/src/types/tool.ts:128-140`: `real|real_external|config_dependent|heuristic|llm_passthrough|experimental|test_only|unclassified`) is a static per-tool registration value, not a runtime health signal.
- `CompanyConnectorSyncStatus` (`company-connector-sync.service.ts:97-120`: `{ provider, integrationProvider, connected, enabled, status, lastSyncedAt, lastSuccessAt, lastError, lastErrorAt, consecutiveFailures, cursor, latestRun }`) is the closest thing to a runtime connector-health surface — but covers **GITHUB/GMAIL/GOOGLE_DRIVE only** (per `runScheduledTick` filter `:487`), not CRM/Salesforce/CalDAV/Vercel/GitHub-native-tool/MCP.
- **Verdict:** no unified connector-health contract. Workstream A5 is the unblock.

### A9. Connector-sync atomicity — `PARTIAL` (non-atomic claim)

- Scheduler: `company-connector-sync-scheduler.service.ts` (5-min default), wired `swarm.plugin.ts:265-277` with `isLeader: () => leader.isLeader()`. Leader election = `RedisSchedulerLeader` (`apps/api/src/coordination/scheduler-leader.ts:32-130`) via Redis `SET NX` TTL on `instanceId`. Per-process `inFlight` flag (`scheduler.service.ts:76,78,106`) prevents overlapping ticks within a process.
- Claim in `triggerSync` (`company-connector-sync.service.ts:309-454`):
  1. Read state row via `upsert` (`:335-346`).
  2. Check `state.status === 'running'` (`:348`) → throw "already running" if so.
  3. Create `companyConnectorSyncRun` row `status='running'` (`:358-367`).
  4. **Separate** `companyConnectorSyncState.update({ where: { id }, data: { status: 'running' } })` (`:369-375`).
- **The status check and the status write are two separate statements** — no transaction, no `SELECT … FOR UPDATE`, no conditional `UPDATE WHERE status='idle'`, no advisory lock. Schema (`schema.prisma:2231-2252`): `@@unique([tenantId, provider])` on `SyncState`, `@@index([tenantId, status, updatedAt])`; **no unique index on `(tenantId, provider, running)`**.
- Manual trigger `POST /company/sync/:provider/trigger` (`company-sync.routes.ts:126`) calls `triggerSync` directly, **bypassing the scheduler's `inFlight` + `isLeader` guards**.
- Stale-running safety net (`:538-557`) only reclaims after `staleRunningMs` (default 45 min) — a real overlap finishes long before it triggers.
- **Verdict:** scheduled-vs-scheduled across replicas is guarded (Redis leader + `inFlight`); scheduled-vs-manual and manual-vs-manual on the same `(tenantId, provider)` are NOT guarded at the DB level — two triggers can both read `status='idle'`, both create `SyncRun` rows, both fetch the same cursor window → duplicate ingestion. Workstream B4 (advisory-lock claim) is the unblock.

---

## B. Company Brain ingestion depth

### B1. Gmail ingestion — `LIVE_RUNTIME_WIRED` but `PARTIAL` (metadata-only)

- `company-connector-sync.service.ts` `syncGmail` (`:745-882`) calls the Gmail REST API directly (NOT the `GmailImapAdapter`).
- List: `GET .../messages?maxResults=25&q=after:<cursor>` (`:762-766`) — message `id` list only, no thread expansion.
- Per message: `GET .../messages/{id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date` (`:794-798`). **`format=metadata` → full body NOT fetched**; only named headers + Gmail `snippet` (truncated preview, `:835`).
- Stored `body` (`:837-841`) = `"Subject: …\nFrom: …\nSnippet: …"`. **No full body, no body HTML, no To/CC/BCC, no attachment metadata, no attachment content.** (Recipients/CC not in `metadataHeaders` → dropped.)
- `externalId` = message `id` (`:852`); `metadata` carries `threadId` + `labelIds` (`:856-857`); `sourceUrl` = Gmail web URL.
- Dedupe: `CompanyOperatingLayerService.createArtifact` upserts on `@@unique([tenantId, sourceType, externalId])` (`schema.prisma:2053`; service `company-operating-layer.service.ts:728-742`). `bodyHash = sha256(body)` is computed (`:719`) but **NOT used for dedupe** — only provider-ID. A re-ingested message ID with a changed snippet overwrites in place (`update: { ...data, extractedAt: null }`).
- Live runtime: YES — `syncGmail` ← `syncProvider` (`:611`) ← `triggerSync` (`:378`) ← `POST /company/sync/:provider/trigger` (`company-sync.routes.ts:136`) + `runScheduledTick` (`:572`) on the `CompanyConnectorSyncScheduler` `setInterval` (5 min; `swarm.plugin.ts:264-280`; `COMPANY_CONNECTOR_SYNC_ENABLED=true`, `config.ts:260`). Provider must be a CONNECTED `GMAIL` integration.
- **Verdict:** metadata-only (subject + from + snippet + threadId/labelIds), single-message, no body/recipients/CC/attachments; dedupe is provider-ID only. Workstream B1 (full body/threads/attachments/labels) is the unblock.

### B2. Google Drive ingestion — `LIVE_RUNTIME_WIRED` but `PARTIAL` (metadata-only, pagination capped)

- `syncGoogleDrive` (`:884-1005`).
- `GET .../drive/v3/files?q=trashed=false&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName),size),nextPageToken` (`:896-905`). **`nextPageToken` requested in `fields` but never followed** — only the first 100 files ever fetched.
- Cursor: `modifiedTime > previousCursor` (`:921-933`). **No `headRevisionId`/revision requested or stored.**
- Stored `body` (`:958-963`) = `"Google Drive file: <name>\nMime type: <mimeType>\nModified: <modifiedTime>\nOpen: <webViewLink>"`. **No file content downloaded or parsed.** Docs/Sheets/Slides NOT exported to text; PDF/DOCX/TXT/CSV/MD NOT downloaded. Body is pure metadata.
- `externalId` = Drive file `id` (`:972`); `metadata` carries `mimeType`, `size`, `owners` (`:977-982`); `authorName` = first owner only (`:953-956`); `sourceUrl` = `webViewLink`. **No permissions, no revision id, no full owner list, no createdTime.**
- No revision tracking → any modification re-ingests the same `externalId` row (upsert overwrites, `extractedAt: null`). No deleted/inaccessible tombstoning (`q=trashed=false` excludes trashed; a 404 on per-item fetch is caught+`skippedCount++` but no tombstone marks previously-ingested now-deleted files).
- Live runtime: YES (same scheduler + trigger path; provider aliases `GOOGLE_DRIVE`/`DRIVE`, `sync-provider-normalization.ts:22-27`).
- **Verdict:** metadata-only (name/mime/modifiedTime/link/first-owner/size); no content export/parse for any MIME; no revision/permissions/full-owner tracking; no deleted-file tombstoning; pagination capped at 100. Workstream B2 (Docs/Sheets/Slides/PDF/DOCX export) is the unblock.

### B3. GitHub ingestion — `LIVE_RUNTIME_WIRED` but `PARTIAL` (user-events stream only)

- `syncGitHub` (`:616-743`).
- **Only `GET https://api.github.com/user/events?per_page=50`** (`:628-635`) — the authenticated user's public activity stream. **No `/repos`, no issues, no issue comments, no PR reviews, no releases, no deployments, no workflows/check-runs, no CODEOWNERS, no repo metadata, no default branch.**
- Event → artifact type: `PullRequestEvent→pull_request`, `IssuesEvent|IssueCommentEvent→issue`, `PushEvent→commit`, `DiscussionEvent|DiscussionCommentEvent→ticket`, else `other` (`:176-182`, `:683`).
- Cursor: `lastEventAtIso` from most recent event; only events newer than cursor ingested (`:647-660`). 50-event cap per tick; older events beyond the API recent-events window are never backfilled.
- Per event: `externalId` = event `id`; `body` = `"GitHub <type> in <repo>.\nEvent ID: …\nOccurred At: …\nPayload: <JSON.stringify(payload).slice(0,5000)>"` (`:696-701`). **Payload truncated to 5000 chars, stored as stringified JSON blob — no structured PR/review/comment/commit parsing.** `sourceUrl` falls through `pull_request.html_url`/`issue.html_url`/`comment.html_url`/`release.html_url`/commit URL (`:685-694`); `metadata` stores `eventType`, `repoName`, `payload` (`:715-720`).
- **No repo selection** — ingests whatever the user-events stream surfaces. No per-repo fetching. **No webhooks** — polling-only via `runScheduledTick` (5-min, exponential backoff up to 16×, `nextScheduledRunAtMs` `:456-465`). No webhook receiver for GitHub.
- Live runtime: YES (same scheduler + `POST /company/sync/GITHUB/trigger` path).
- **Verdict:** user-events-stream-only (50 most recent, polling, no webhooks); no repos/issues/comments/reviews/commits/releases/workflows/CODEOWNERS/repo-metadata; payload is a 5000-char truncated JSON blob. Workstream B3 (issues/PRs/reviews/commits/releases/CI/deployments/webhooks) is the unblock.

### B4. Ingestion → Brain processing auto-enqueue — `ROADMAP` (not wired)

- Connector sync calls `createArtifact(...)` (`:704`, `:844`, `:966`) → `CompanyOperatingLayerService.createArtifact` (`company-operating-layer.service.ts:694`) upserts a `company_artifacts` row.
- **But the connector path never calls `processor.schedule(...)` or `enqueueCompanyBrainJob(...)`.** `enqueueCompanyBrainJob` is only invoked from `company-brain-v2.processing.ts:48` (the `schedule` helper), called only from the manual-INGEST route `company-operating-layer.legacy-routes.ts:18`.
- Connector-ingested artifacts therefore sit as raw `company_artifacts` rows with `processingState='ingested'` until either (a) the boot-time `backfillCompanyBrainJobs` reconciliation enqueues them (`company-brain-worker.service.ts:499`, one-shot at startup, only for artifacts whose policy is still `ingested`/`failed` with no live job), or (b) a human hits `POST /company/artifacts/:id/process` (`company-brain-v2.routes.ts:17-21`).
- **Verdict:** no per-ingest auto-enqueue in the connector path. Extraction/claims/edges depend on a boot-time backfill or a manual trigger. This is a material gap: a freshly-connected Gmail tenant's new messages are not extracted until either a process restart or a manual process call.

---

## C. Company Brain truth quality

### C1. Provenance / source states — `PARTIAL` (no `human_approved`/`evidence_backed`/`expired`/`disputed` artifact state)

- `CompanyArtifact.ingestionStatus String @default("ingested")` (`schema.prisma:2043`) — comment `'ingested' | 'extracted' | 'failed'`.
- `CompanyArtifactPolicyV2.processingState String @default("ingested")` (`company-brain-v2.prisma:16`) — states used in code: `'ingested'`, `'processing'`, `'ready'`, `'failed'` (via `setArtifactProcessingState`/`markArtifactFailure`, `company-brain-v2.context.ts:392-401`, `company-brain-worker.service.ts:454,461`). **No `human_approved`/`disputed`/`expired` artifact state.** `expired` is a runtime check on `retentionUntil` (`core.ts:274`, `context.ts:252`), not a stored state.
- `CompanyClaimV2.status String @default("proposed")` (`company-brain-v2.prisma:54`) — `ClaimStatus` (`core.ts:20`): `'proposed' | 'active' | 'disputed' | 'superseded' | 'rejected'`. **No `extracted_unverified`/`evidence_backed`/`human_approved`/`expired`.** `reviewedBy`/`reviewedAt`/`reviewComment` exist (`:60-63`) — human approval is a review action on a claim, not a top-level artifact-state enum.
- `CompanyArtifactPolicyV2.visibility` (`public|internal|restricted`), `sensitivity` (`normal|confidential|highly_confidential`), `retentionUntil` — access-policy provenance, not truth-state.
- `CompanyMemoryReviewV2` (`company-brain-v2.prisma:124-141`): `reviewType` (`claim|entity_merge|edge|retention|access`), `status` (`open|approved|rejected|resolved`), `priority`.
- **Source-less entity gate:** legacy `createEntity` (`company-operating-layer.service.ts:787`) throws if `sourceArtifactIds` is empty (`:818`) and verifies artifacts belong to the tenant (`:821`) — source-less forbidden. **But V2 retrieval (`getContextPackage`, `context.ts:258-270`) KEEPS entities with `sourceArtifactIds = []`** ("No sources → no restriction → keep", `:262`). A source-less V2 entity CAN enter agent context. Such entities can arise from V2 `mergeEntities` or direct raw-SQL inserts (V2 tables written via raw SQL, not Prisma's typed `create` with the assertion).
- **Verdict:** no `extracted_unverified`/`evidence_backed`/`human_approved`/`disputed`/`rejected`/`expired` artifact-state enum exists; states are `ingested/processing/ready/failed` (artifacts) and `proposed/active/disputed/superseded/rejected` (claims). A source-less V2 entity CAN enter agent context — **violates rule 8** (no source-less company knowledge enters agent context as trusted truth). Workstream C1 (provenance states) + the source-less gate fix are the unblock.

### C2. Stable identifiers — `ROADMAP` (no `CompanyEntityIdentifier` model; `ILIKE` substring scan)

- **No `CompanyEntityIdentifier` model exists.** Grep across `packages/db/prisma/*.prisma` and all migrations: no `CompanyEntityIdentifier`, no `identifierType`, no `normalizedValue`, no `valueHash`, no `authorityScore`/`verified`/`externalId` identifier-relation columns. The only `authorityScore` field is on `CompanyClaimV2` (`:56`) and `CompanyClaimEvidenceV2.sourceAuthority` (`:80`).
- Identifiers stored as free-form JSONB inside `CompanyGraphEntity.properties` (`schema.prisma:2077`) and `CompanyEntityV2Row.properties` (`core.ts:65`). Recognized keys = hardcoded const `STABLE_IDENTIFIER_KEYS = ['email','domain','website','url','crmid','externalid','handle','linkedin','github']` (`core.ts:323-333`). Extraction: `extractStableIdentifiers` (`core.ts:373-396`) reads these keys with case/snake/camel-insensitive matching (`pickProperty`, `:350-360`).
- **Retrieval match (`company-brain-v2.context.ts:136-151`):**
  ```sql
  SELECT * FROM "company_graph_entities"
    WHERE "tenantId" = $1 AND "deletedAt" IS NULL
      AND "properties"::TEXT ILIKE ANY($2::TEXT[])
    LIMIT 50
  ```
  patterns `%email%`, `%url%`, `%id%`. **`properties::TEXT ILIKE` — full-row text scan with substring patterns, NOT a normalized indexed identifier table.** No index on `properties::TEXT`, no GIN on a normalized identifier column, no `valueHash` lookup. The `company_entity_aliases` table IS a normalized indexed table (`@@unique([tenantId, entityType, normalizedAlias])`, `company-brain-v2.prisma:40`) but stores canonical name aliases, not durable identifiers.
- Entity resolver (`company-brain-v2.entities.ts:69-122`, `classifyEntityCandidate`): compares extracted `properties` identifiers in memory via `extractStableIdentifiers` — tier 1 (provider+externalId), tier 2 (shared stable identifier). In-memory comparison of JSONB-read rows, not an indexed DB lookup.
- Live runtime: YES — retrieval signal (b) is in `getContextPackage` (live route `POST /company/brain/context`, `company-brain-v2.routes.ts:43`); resolver runs in `processExtractedEntities` (`entities.ts:201`) via the durable worker.
- **Verdict:** no `CompanyEntityIdentifier` table; stable identifiers live in `properties::TEXT` JSONB and are matched at retrieval by unindexed `ILIKE '%...%'` substring patterns (not even key-scoped). Workstream C2 is the unblock.

### C3. Retrieval — `LIVE_RUNTIME_WIRED` but `PARTIAL` (lexical+graph, no vector, additive weighted not RRF)

- `CompanyBrainContextStore.getContextPackage` (`company-brain-v2.context.ts:57-375`). Wired to live agents via `company-context-provider.factory.ts:60-62` → `BaseAgent.companyContextProvider` (`packages/agents/src/base/base-agent.ts:209,275`) → `PromptBuilder` (`packages/agents/src/base/prompt-builder.service.ts:89`).
- Signals (explicitly tagged in `CandidateEntity.signal`, `context.ts:27-35`):
  - (a) **Exact canonical alias** — `company_entity_aliases.normalizedAlias = ANY($2)` (`:122-133`). PRESENT.
  - (b) **Stable identifier** — `properties::TEXT ILIKE ANY($2)` (`:136-151`). PRESENT but unindexed substring match (see C2).
  - (c) **Lexical FTS (ts_rank)** — `to_tsvector('simple', title||' '||summary) @@ websearch_to_tsquery('simple', $2)` ordered `ts_rank DESC` (`:156-170`). PRESENT (Postgres built-in text search, not pgvector).
  - (d) **1-hop graph-neighbourhood expansion** — `company_edges` where `sourceEntityId|targetEntityId ∈ seedIds`, status `active|disputed`, LIMIT 60 (`:196-220`). PRESENT.
- Composite scoring: `compositeEntityScore` (`core.ts:706-713`) with hardcoded `RETRIEVAL_WEIGHTS = { exactAlias:1.0, identifier:0.95, keyword:0.6, graphNeighbor:0.25 }` (`core.ts:690-695`). **Additive weighted sum, capped at 1.0 — NOT reciprocal-rank fusion, NOT RRF, NOT learned/measured.** Direct matches top-20; neighbours fill to 30 total (`context.ts:188-230`).
- **MISSING signals:**
  - **VECTOR / pgvector / embeddings / cosine — ABSENT.** Only `embedding`/`vector` grep hit in company-brain dir is "tsvector" (Postgres text search). No `vector(` column, no `<=>`/`<->` operator, no embedding model call, no cosine. The `pgvector/pgvector:pg16` testcontainer is used purely because it bundles Postgres 16; pgvector is not exercised by retrieval. (Migration `1_add_vector_and_crm` provisions `vector_documents(embedding vector(1536), HNSW cosine)` but Company Brain does not read it.)
  - **Temporal relevance** — ABSENT as a retrieval signal. `occurredAt`/`updatedAt` are tie-breakers in `ORDER BY` (`:165`, `:284`), not a scored relevance dimension. No decay/recency score.
  - **Source authority** in entity ranking — ABSENT at entity-candidate scoring (authority used only later for claim ordering, `context.ts:284`, and claim transitions). `sourceAuthorityScore` (`core.ts:249-267`) is computed for claims, not entity relevance.
  - **Claim confidence** — used for claim/edge ordering/filtering (`:284`, `:292`), NOT as an entity-retrieval signal.
- **Access policy** — PRESENT and taint-safe (`context.ts:236-270`): per-artifact `visibility`/`allowedAgentRoles`/`retentionUntil` enforced via `canAgentAccessArtifact` (`core.ts:269-278`); restricted/expired source drops the entity; omissions counted (`:350`, counts only, no identity oracle).
- **"No relevant result → empty governed context" guarantee** — PRESENT (`context.ts:178-181` returns `empty(...)` when `byId.size === 0`; comment `:39-55` confirms the recency fallback was removed). On retrieval ERROR the failure propagates (no silent catch).
- `COMPANY_BRAIN_RETRIEVAL_STRATEGY_VERSION = 'hybrid-v1'` (`core.ts:555`).
- Live runtime: YES via agent prompt-builder path AND `POST /company/brain/context` (`company-brain-v2.routes.ts:43-47`, REVIEWER-gated).
- **Verdict:** combines exact-alias + identifier-ILIKE + ts_rank FTS + 1-hop graph, additive weighted (not RRF); empty-result guarantee present. MISSING: pgvector/embeddings/cosine, temporal-relevance scoring, source-authority and claim-confidence as entity-retrieval signals. Workstream C3 (exact+alias+FTS+vector+graph+temporal+authority+confidence+access with reciprocal-rank fusion) is the unblock.

### C4. Typed claims + predicate policies — `PARTIAL` (untyped JSONB, one universal threshold)

- `CompanyClaimV2` (`company-brain-v2.prisma:45-72`). Value column = `objectValue Json?` (`:51`) + `normalizedObject String` (`:52`). **No typed-value discriminator** — no `valueType`, no enum `string|number|boolean|money|percentage|date|datetime|duration|URL|entity-ref|enum|JSON`. `objectValue` is opaque JSONB. `normalizeObjectValue` (`core.ts:521-526`) special-cases `entity:<id>` when `objectEntityId` set, else `normalizeEntityLabel` for strings, ISO for Dates, else `stableJson` — normalization for the fingerprint, not a typed value schema. Claim candidates (`claimCandidatesFromEntity`, `entities.ts:313-343`) only produce `status`/`owned_by`/`priority`/`due_at` + allowlisted `properties` keys whose value is `string|number|boolean` (`:339`) — so in practice only string/number/boolean/date values are produced, but the model stores arbitrary JSONB with no type tag.
- **Predicate policy:** `predicateFromProperty` (`core.ts:511-519`) has a single hardcoded allowlist: `['contract_value','deal_value','deadline','launch_date','metric_value','project','product','customer','requirement','decision','version','region','country','currency','stage','owner','status','priority']`. Unknown keys → `null` → skipped (`entities.ts:338`). **No versioned predicate policy table** — no per-predicate config for single-current vs multi-value vs append-only vs time-series vs human-approval-required vs high-impact vs expiry vs allowed-source-types vs authority-hierarchy vs contradiction-rules.
- **Contradiction / supersession:** `decideClaimTransition` (`core.ts:450-497`) is a single global rule, not per-predicate. Auto-activate requires `authorityScore >= 0.82 AND confidence >= 0.75` (`:455`). Supersession requires newer candidate with `authorityDelta >= 0.15` (`:474`). `|Δauthority| < 0.15` → `disputed` + review (`:484`). **One universal set of constants, not per-predicate.**
- Live runtime: YES — `claimCandidatesFromEntity` (`entities.ts:318`) runs in `processExtractedEntities` (live worker path).
- **Verdict:** claims are untyped JSONB with no value-type discriminator; predicate recognition is a single hardcoded allowlist; NO per-predicate policies. Workstream C4 (typed claims + predicate policies) is the unblock.

### C5. Source-authority — `UNIT_PROVEN` (global hardcoded constants, not per-tenant/per-predicate)

- `sourceAuthorityScore` (`company-brain-v2.core.ts:249-267`) — global hardcoded constants keyed on `sourceType:artifactType`:
  - `signed` metadata → 0.98; `approved` → 0.92; `decision_note` → 0.90; `pull_request|commit` → 0.78; `ticket|issue` → 0.72; `customer_call|customer_feedback` → 0.68; `support` → 0.64; `meeting` → 0.60; `gmail|email` → 0.58; `manual` → 0.55; `document` → 0.70; default → 0.50.
- Grep for per-tenant/per-predicate authority config: none. No `CompanyAuthorityConfig`/`SourceAuthority` model. No env-var override. `authorityScore` on `CompanyClaimV2` and `sourceAuthority` on `CompanyClaimEvidenceV2` store the per-claim computed value, but the computation is the hardcoded function. `claimCandidatesFromEntity` (`entities.ts:318`) calls `sourceAuthorityScore(artifact)` once per artifact for all its claims — predicate not consulted for authority.
- Live runtime: YES (called from `claimCandidatesFromEntity`, live worker path).
- **Verdict:** global hardcoded constants, not per-tenant, not per-predicate, not configurable via DB/env. Workstream C5 (per-tenant/predicate source authority) is the unblock.

### C6. Accuracy benchmark — `ROADMAP` (none exists)

- Grep across `tests/` and `apps/api/src/services/company-brain/` for `benchmark|precision|recall|f1|false.?merge|missed.?merge|retrieval.?P@K|access.?leak`:
  - `tests/integration/company-brain-retrieval-correctness.test.ts` — **correctness test suite, not a benchmark harness.** Fixed-fixture assertions: task-relevant entity selected, off-topic not selected, restricted-leakage, expired-retention, conflict-recall, evidence-id preservation, graph-neighbourhood, empty-query rule, token-budget ceiling (header lines 1-34). Does NOT compute/persist precision/recall/F1, false-merge/missed-merge rates, retrieval P@K curves, or faithfulness scores.
  - `company-brain-agent-wiring.test.ts`, `company-brain-merge-atomicity.test.ts` — wiring + atomicity, not benchmark metrics.
  - `tests/unit/company-brain/*` — pure helpers (`compositeEntityScore`, `extractStableIdentifiers`, `decideClaimTransition`, `classifyEntityCandidate`), not a benchmark.
  - No `benchmark` directory/script under company-brain or `tests/` that measures Company Brain accuracy. No persisted benchmark rows. `qa/benchmark-optimization-before-after.md` is a GEPA/HyperAgent optimization doc, not a Company Brain accuracy benchmark.
- **Verdict:** no Company Brain accuracy benchmark (precision/recall/F1, false-merge, missed-merge, retrieval P@K, access-leakage, faithfulness) exists. Workstream C6 is the unblock.

---

## D. Hyperagent execution evidence

### D1. Artifact harvesting — pure core `LIVE_RUNTIME_WIRED`; live seam `PARTIAL` (`artifacts: []`)

- Pure core `executeApprovedSpec` (`packages/swarm/src/hyperagent/spec-executor.ts:286`) harvests by passing `finished.artifacts` into `acceptanceEvidence` (`:325-329`) then `evaluateOutcome` (`:330-344`). `failureClassByTask` accepted as input (`:218`) and threaded into `evaluateOutcome` (`:343`).
- Live seam `runPlanViaLangGraph` (`packages/swarm/src/hyperagent/spec-executor-runtime.ts:58`) IS the production `runPlan`, called by the live service `apps/api/src/services/company-brain/company-operating-layer.service.ts:1361` (`executeSpec`) and `:1463` (`resumeSpecExecution`), fed into `executeApprovedSpec` at `:1352` and `:1454`. **The pure core IS called by the live seam** — the seam is the `deps.runPlan` injected into the pure orchestrator.
- `hyperAgentEnabled` default-off: `schema.prisma:96` (`@default(false)`), `swarm-state.ts:299` (`?? false`), `graph/edges.ts:74` (`?? false`). Graph gates every Hyperagent node on it.
- **Live seam harvesting (`spec-executor-runtime.ts`):**
  - `:111` `artifacts: [],` (awaiting-approval return path).
  - `:131-132` `// Open edge: the real graph does not harvest artifact ids from taskResults.` → `artifacts: [],` (normal completion path).
  - Header `:26-31`: "Artifact harvesting remains an OPEN EDGE … the real graph does not yet extract artifact ids from `taskResults`, so `artifacts` is `[]` and an ARTIFACT_PRESENT criterion will be UNMET unless the run explicitly produces one."
- **Verdict:** live seam harvests NOTHING — no task results, tool results, generated files, code patches, deployment receipts, screenshots, CRM mutations, outbound messages, or DB changes. Both return paths emit `artifacts: []`. Workstream D1 (real artifact harvesting) is the unblock. Default-off gate means this is `LIVE_RUNTIME_WIRED`-behind-gate, not production-reachable today.

### D2. Failure-class propagation — `ROADMAP` (computed in graph, never surfaced to `FinishedRun`)

- `spec-executor-runtime.ts` awaiting-approval return (`:105-118`) and normal return (`:125-138`) both OMIT `failureClassByTask`. Field declared optional on `FinishedRun` (`spec-executor.ts:218`); pure core threads it (`:343`); live seam never sets it.
- `failureClassByTask` is computed inside the live *graph* (`packages/swarm/src/graph/nodes/learning-node.ts:65` function, `:98` emitted) — written into `SwarmState` for the learning node, NOT harvested into `FinishedRun` by `runPlanViaLangGraph`.
- The terminal `FinishedRun` does not persist: failure class, root-cause evidence, retry count, repair action, changed plan version, invalidated dependants, or final disposition. Only `accumulatedCostUsd`, task id lists, `blocked`, and (on pause) `approvalRequestId` are surfaced.
- Confirmed by `docs/current-system-truth-audit.md:232`: "`failureClassByTask` not wired".
- **Verdict:** `failureClassByTask` ABSENT from the live runtime seam. Workstream D2 is the unblock.

### D3. Metrics — `PARTIAL` (only `accumulatedCostUsd`)

- `spec-executor-runtime.ts:112` `metrics: { accumulatedCostUsd: state.accumulatedCostUsd ?? 0 }` (awaiting); `:134` `metrics: { accumulatedCostUsd: finalState.accumulatedCostUsd ?? 0 }` (completion). Comment `:133`: "The one metric SwarmState tracks."
- Missing: total latency, per-node latency, per-agent cost+tokens, tool calls, connector retries, verifier scores, repair loops, plan versions, approval wait, artifact count, acceptance result, rollback count.
- **Verdict:** only `accumulatedCostUsd` emitted. Workstream D3 (real metrics) is the unblock.

### D4. Approval interrupt/resume — wiring `LIVE_RUNTIME_WIRED`; real-provider E2E `ROADMAP` (env-blocked)

- Approval node: `packages/swarm/src/graph/nodes/approval-node.ts:30`. Auto-approve only on `state.autoApproveEnabled === true` + risk below threshold (`:38-65`); otherwise `status: AWAITING_APPROVAL` + `pendingApprovals` (`:104-108`).
- Real provider-backed interrupt/resume: `packages/swarm/src/workflow-runtime/langgraph-graph-builder.ts:493` calls `interrupt()` inside an approval wrapper (`:473-479`). Graph compiled with `PostgresCheckpointSaver` at `:623`, `:698`, `:736`, `:770` — real Postgres checkpointer.
- `spec-executor-runtime.ts:100` catches `GraphInterrupt`/`isInterrupted`, reads pending approvals off `graph.getState(config)` (`:101`), returns `awaitingApproval: true` + `approvalRequestId` (`:105-118`). Resume re-drives the SAME `workflowId` so `makeRunnableConfig` keys the same thread (`company-operating-layer.service.ts:1454-1467`, comment `:1450-1453`).
- Payload-hash binding + replay rejection: `apps/api/src/services/workflow.service.ts:410-423` re-hashes `proposedDataJson`, throws `ApprovalPayloadMismatchError` (`errors.ts:88`, code `APPROVAL_PAYLOAD_MISMATCH`, 409). Unique `(approvalId, proposedDataHash)` (`workflow.service.ts:426`, `schema.prisma:791`). Idempotent replay of same hash = no-op (`:471-477`); changed-payload replay = 409.
- "Execute once": `resolveApproval` uses `updateMany({ where: { id, status: 'PENDING' } })` atomic guard (`:441-448`) — double-decide cannot succeed twice.
- **E2E test reality:**
  - `tests/integration/hyperagent-spec-execution.test.ts:126-177` — `runPlan` is a STUB (`stubRunPlan`), NOT `runPlanViaLangGraph`. Header `:16-24`: "integration-logic-proven, NOT production-proven (the live LangGraph + LLM E2E is env-blocked)."
  - `tests/integration/approval-roundtrip.test.ts` header `:25-31`: "What this test does NOT prove: That the SwarmRunner actually pauses on a real high-risk task (requires a live LLM …)". Uses stub Prisma, exercises `emitLifecycle` only.
  - `tests/integration/approval-payload-binding.test.ts:259,325` — proves the 409 path at the service layer, NOT a live LangGraph interrupt round-trip.
  - `tests/integration/swarm-live.test.ts` — `describe.skipIf(!LIVE)` gated on a real `OPENAI_API_KEY`; not run in CI.
  - `tests/integration/spec-execution-persistence.test.ts:33` (header): "env-blocked (PR G canary)".
- **Verdict:** real provider-backed interrupt/resume/checkpoint/409-replay/execute-once WIRING exists in source. NO real-provider E2E drives interrupt→resume through a live LLM — all approval tests are stub-`runPlan`/stub-Prisma/`skipIf(!LIVE)`. The live interrupt+resume E2E is env-blocked and unproven. Workstream D4 (live approval E2E) is gated on owner prod creds (OpenAI-or-Gemini).

### D5. Learning canary (ConfigLifecycleService) — `LIVE_RUNTIME_WIRED` behind gate; never run against managed Postgres + real LLM

- `apps/api/src/services/company-brain/config-lifecycle.service.ts:1-41` — LIVE caller of the pure lifecycle core (DRAFT→PROPOSED→SHADOW→CANARY(ramp)→PROMOTED). Imports pure gates from `@jak-swarm/swarm` (`:57-68`).
- Wired behind `hyperAgentEnabled`: `AUTONOMY_POLICY_SPEC_SCHEMA` carries `hyperAgentEnabled` (`:120`); only `AUTONOMY_POLICY` + `REPAIR_BUDGET` PROMOTED specs applied to the live `HyperAgentConfig` row (header `:32-36`). Live graph reads that row gated on `hyperAgentEnabled` (default false).
- Measured MI signal gate: pure core `evaluateStage`/`withEvaluation` (imported `:66-68`) computes the gate. Live `advance` passes `metrics` + `baseline` into the pure gate; on HOLD it refuses to advance (header `:18-20`). MI signal = `learning-gate.ts` info-theoretic gate.
- Real canary runbook: `docs/production-canary-plan.md:134-161` ("Set `hyperAgentEnabled=true` for the CANARY tenant only … 1%-traffic, 7-day, human-promote-only canary").
- **Has the canary ever run against managed Postgres + real LLM? NO.** `tests/integration/config-lifecycle-live.test.ts:25-26` (header): "the canary TRAFFIC-PERCENT routing into the live graph (N% of executions to a CANARY config) is NOT consumed by the live graph yet." Runs against testcontainers pgvector, NOT managed Postgres, and exercises NO real LLM (pure DB transitions only). `tests/integration/hyperagent-self-healing.test.ts:551-572` walks the lifecycle with the pure core against stubbed evidence. No test anywhere claims a real-LLM canary run.
- **Verdict:** ConfigLifecycleService is wired, gated behind `hyperAgentEnabled` (default false), has a measured MI gate + written runbook. NEVER run against managed Postgres + real LLM — only testcontainers Postgres + no LLM. Canary traffic routing into the live graph is an unwired open edge. Workstream D5 (1% 7-day canary) is gated on owner prod creds. **Promoting learning globally without this canary would violate rule 9.**

---

## E. Access control

### E1. Artifact/entity/claim access policy — `LIVE_RUNTIME_WIRED` but `PARTIAL` (role + retention + visibility only)

- Policy code: `company-brain-v2.core.ts:269-278` (`canAgentAccessArtifact`) + `company-brain-v2.store.ts:199-223` (policy upsert) + `company-brain-v2.context.ts:235-270` (access filter).
- **Policy model (actual):**
  - `visibility`: `public | internal | restricted` (`core.ts:22,37`).
  - `allowedAgentRoles`: `string[]` — role list (`core.ts:38`).
  - `sensitivity`: `normal | confidential | highly_confidential` (`store.ts:201`) — **stored but NOT enforced** by `canAgentAccessArtifact` (it checks only `retentionUntil`, `visibility`, `allowedAgentRoles`).
  - `retentionUntil`: `Date | null` — expiry gate (`core.ts:274`).
- `canAgentAccessArtifact` (`core.ts:269-278`): drops if expired; `public`/`internal` → allow; `restricted` → allow only if actor's role ∈ `allowedAgentRoles`. **Role-based + retention-based. Does NOT gate by user ID, department, project, customer/account team, group, source-system ACL, purpose, region, or sensitivity.**
- **Derived-entity/claim inheritance (`context.ts:260-270`):** taint-safe source-AND — entity kept only if `sources.length === 0 || sources.every(id => visibleArtifactIds.has(id))`. A derived entity inherits the STRICTEST policy of every source (any restricted/expired source drops it). Comment `:261`: "Any source restricted/expired → drop (taint-safe)."
- **Restricted-source leakage via derived summary:**
  - Edges (`context.ts:321-327`): both endpoints must be in `visibleEntityIdSet`; edge to a dropped (restricted) entity is filtered. Test `tests/integration/company-brain-entity-access-control.test.ts:13-19` confirms the edge is dropped for non-allowed roles — "the relationship never leaks through graph structure."
  - Claims (`context.ts:312-320`): both `subjectEntityId` and `objectEntityId` (when present) must be visible.
  - Restricted-leakage test `tests/integration/company-brain-retrieval-correctness.test.ts:173`: "restricted artifact's entity is omitted and its secret never reaches contextText."
  - Omissions telemetry (`context.ts:350`): reports counts (`restricted`, `expired`, `irrelevant`) NOT identities — no existence oracle.
- **Verdict:** policy is role + retention + visibility (sensitivity stored but not enforced). NO user/department/project/account-team/group/source-system-ACL/purpose/region gating. Derived entities/claims/edges DO inherit strictest-source via taint-safe source-AND; edges/claims to restricted endpoints dropped — existence/degree/relationship of a restricted source does NOT leak. Adversarial tests exist (entity-access-control + retrieval-correctness) but cover only role/retention/edge leakage, not the absent dimensions. Workstream E (access-control expansion + inference-leakage tests) is the unblock.

---

## F. Tests / proof

### F1. Browser E2E CI — `ROADMAP` (not in CI at all)

- E2E dir: `tests/e2e/` (32 `.spec.ts`/`.ts` files). Playwright config: `tests/playwright.config.ts`.
- CI jobs (`.github/workflows/ci.yml`): `build`, `test`, `security-gate`, `secret-scan`, `lint`, `dependency-audit`, `sbom`, `truth-check` (`:14,73,196,252,274,306,337,383`). **NO playwright/e2e job.** Grep for `playwright|e2e|browser` in `ci.yml` returns nothing. The `test` job (`:73`) runs `vitest run --coverage unit integration/circuit-breaker.test.ts integration/truth-claims.test.ts` (`:161`) + a separate integration job (`:185`) — both vitest, not Playwright.
- **Browser E2E is NOT run in CI at all** — neither blocking-on-every-PR nor scheduled. Every e2e `.spec.ts` is ops/manual-only.
- Coverage of listed flows: signup/register (`az-portal-audit.spec.ts:193`, `qa-audit.spec.ts:241,322`, `qa-live-demo.spec.ts:133`, `api-e2e.ts:92`), onboarding (`human-qa-buyer-walk.spec.ts:62`, `human-qa-az.spec.ts:55` — partial/landing-copy only), tenant creation (`api-e2e.ts:92`), connector setup (`connect-modal-layman.spec.ts`, `connected-run-audit.spec.ts`), approval (`standing-orders.spec.ts:72-81`, `connect-modal-layman.spec.ts:31`, `qa-a-to-z.spec.ts:724-743`, `human-style-sweep.spec.ts:205`), execution (`api-e2e.ts:195`, `qa-a-to-z.spec.ts:5`, `task-execution-view-layman.spec.ts`), pause/resume (`qa-a-to-z.spec.ts:947` — partial). All non-blocking.
- **NO browser E2E at all for:** ingestion, Company Brain graph, evidence drawer, conflict review, spec generation, artifact display, audit export, tenant isolation (the latter two are covered by integration testcontainers suites, not browser).
- **Verdict:** no browser E2E is CI-blocking. Many listed flows have no browser E2E at all. Workstream F1 (blocking browser E2E CI) is the unblock.

### F2. Connector contract tests — `PARTIAL` (no dedicated mock-server contract suite)

- `tests/unit/connectors/` contains only `manifests.test.ts`, `registry.test.ts`, `resolver.test.ts` — pin manifest honesty (Remotion/Blender risk, allowlist, validation) + registry behavior. NOT contract tests with mock servers.
- Adapter tests with mocked HTTP/DOM:
  - `tests/unit/tools/serper-adapter.test.ts` (header `:4-11`): retries on 5xx/429/timeout (single retry), fail-fast on 401/403 and 400, news/images/KG modes. `Response`/`jsonResponse` mocks (`:143` `status: 429`). **Covers 401/403, 429, 5xx, timeout, malformed.** No pagination, no token refresh, no webhook, no reconnect.
  - `tests/unit/api/slack-adapter.test.ts` (header `:9-16`): `verifySignature` HMAC-SHA256 v0 + 5-min replay window, `handleHandshake`, `extractInbound` (drops bot echoes), `resolveTenant`. **Covers duplicate-webhook replay window, auth signature.** No token refresh/pagination/429/reconnect.
  - `tests/unit/api/linkedin-adapter.test.ts`, `social-adapters.test.ts`: URL allowlist, DOM login/2FA/captcha detection (stubbed Page), approval-gated publish. **No HTTP contract tests.**
  - `tests/integration/crm-tenant-isolation.integration.test.ts`: real Postgres testcontainers, IDOR/tenant-scoping only. No mock-server contract behavior.
  - `tests/unit/services/oauth-providers.test.ts:30,311`: malformed-response parsing for OAuth providers. Partial.
  - `tests/unit/services/repair-service.test.ts:17`: classifies HTTP 429 as `transient_api`. Classification only.
  - `tests/unit/swarm/failure-classifier.test.ts:48`: classifies 429 as `RATE_LIMIT`. Classification only.
- **Verdict:** NO dedicated connector contract-test suite with mock servers covering the full contract (auth, token refresh, pagination, rate limiting, 401/403/429/5xx, timeout, malformed response, duplicate webhook, restart reconnect). Serper covers a subset; Slack covers signature-replay. The "connector contract tests" referenced in truth docs are manifest/registry unit tests, not behavioral contracts. Workstream F2 is the unblock.

### F3. Live paid-provider tests — `ROADMAP` (env-blocked, not scheduled)

- `tests/integration/swarm-live.test.ts` is `describe.skipIf(!LIVE)` gated on a real `OPENAI_API_KEY`; not run in CI, not scheduled.
- No scheduled canary against real Gmail/Drive/GitHub/Salesforce/Vercel providers exists.
- **Verdict:** live paid-provider tests are env-blocked and not scheduled. Workstream F3 (live paid-provider tests as scheduled canary only) is gated on owner prod creds.

---

## G. Product truth (capability registry / truth checker)

### G1. `check-docs-truth.ts` — `LIVE_RUNTIME_WIRED` but `PARTIAL` (numeric/phrase drift gate only)

- `scripts/check-docs-truth.ts`.
- **What it DOES check (exits non-zero on drift):**
  - README + product-truth tool count == `toolRegistry.getManifest().total` (`:77-110`).
  - README + landing agent count == `AgentRole` enum size (`:116-149`).
  - product-truth Connectors stat == matrix summary + `INTEGRATIONS_CORE`+`INTEGRATIONS_INFRA` tile counts (`:156-185`).
  - PremiumCTA stat counters match (`:192-220`).
  - WhatsApp tile present iff `whatsapp.routes.ts` > 1KB (`:228-240`).
  - Sentry tile labeled "MCP" unless `@sentry/node` wired (`:247-264`).
  - Voice route has no mock-token / `isMock:true` (`:272-286`).
  - Paddle route has no placeholder price IDs (`:292-307`).
  - `docs/architecture.md` industry-pack count == `listIndustries()` (`:313-323`).
  - Prohibited marketing phrases in README/landing ("Hono", "no api keys required", "Ducky Duck", "Nx cheaper", "Your Entire Company, Automated", "autonomous multi-agent AI platform", "production tools") (`:336-416`).
  - Session 7 subset per-bucket maturity counts (`:424-443`).
  - `approval-node.ts` requires `state.autoApproveEnabled === true` (`:451-468`).
  - Prisma `autoApproveEnabled Boolean @default(false)` + `ApprovalAuditLog` model exist (`:474-493`).
  - `DistributedCircuitBreaker` defaults `failureThreshold ?? 5` + `resetTimeoutMs ?? 30_000` (`:500-520`).
  - `SECURITY.md`, `.github/dependabot.yml`, `docs/SECURITY-NOTES.md` exist (`:522-552`).
  - No unclassified tool ships (`manifest.byMaturity.unclassified > 0` fails, `:585-592`).
- **What it does NOT check:**
  - Does NOT fail when a production-ready capability has no live runtime caller. Reads no call-graph; only counts registry entries vs. prose.
  - Does NOT fail when a connector marked "live" has no passing contract test. `manifest.liveTested` is reported (`:563`) but never asserted against any threshold.
  - Does NOT fail when prose says "production-proven" without canary evidence. The only "production-proven"-adjacent guard is the phrase "production tools" ban (`:394`); no canary-evidence cross-check.
  - Does NOT fail when a placeholder is counted as production-ready. Counts `unclassified` (`:585`) but a tool explicitly classified `placeholder` is accepted as classified — never flagged for being mislabeled `real`/`production-ready`.
  - Does NOT fail when a source path no longer exists. Every file read is wrapped in `try/catch` that silently skips (e.g. `:228-240` `catch {}`, `:262-264`, `:284-286`, `:305-307`, `:518-520`, `:591-592`). A missing `whatsapp.routes.ts`/`voice.routes.ts`/`paddle.routes.ts`/`approval-node.ts`/`schema.prisma`/`distributed-circuit-breaker.ts` is either a no-op or pushes one mismatch — does not systematically verify referenced source paths exist.
- **Verdict:** `check-docs-truth.ts` is a marketing-vs-registry numeric/phrase drift gate. It does NOT verify live-runtime callership, connector contract-test passage, canary evidence for production-proven claims, placeholder-vs-production-ready mislabeling, or source-path existence. Workstream G (machine-readable capability registry + truth checker that fails on these) is the unblock.

---

## Summary table

| Capability | Class | One-line |
|---|---|---|
| A1 Email adapter | `LIVE_RUNTIME_WIRED` / `INTEGRATION_PROVEN` | per-tenant resolver (PR 1) + live side-channel population (PR 2); NOT production-proven |
| A2 Calendar adapter | `LIVE_RUNTIME_WIRED` / `INTEGRATION_PROVEN` | per-tenant resolver (PR 1) + live population from Gmail app-password (PR 2); NOT production-proven |
| A3 Deployment tools | `CONFIGURATION_DEPENDENT` | read `process.env` inline; no per-tenant path (still open — deferred from PR 1) |
| A4 CRM resolver | `LIVE_RUNTIME_WIRED` / `INTEGRATION_PROVEN` | resolver reached; Salesforce branch now REACHABLE live (PR 2 populates creds); NOT production-proven |
| A5 `context.{email,calendar,crm}Credentials` | `LIVE_RUNTIME_WIRED` / `INTEGRATION_PROVEN` | PR 2 wires apps/api → side-channel → context (no SwarmState secret-leak); NOT production-proven |
| A6 `credential.service.ts` | `LIVE_RUNTIME_WIRED` (partial) | PR 2 makes Gmail resolution live-reachable; Salesforce/Vercel/GitHub/Company-Brain consolidation still follow-up |
| A7 MCP reconnect | `PARTIAL` (broken) | `JSON.parse` on AES-GCM ciphertext → throws → NEEDS_REAUTH |
| A8 Connector health | `PARTIAL` | no unified contract; only GitHub/Gmail/Drive sync-status |
| A9 Sync atomicity | `LIVE_RUNTIME_WIRED` | atomic conditional updateMany claim (where status != running); manual + scheduled share the guard; unit-tested |
| B1 Gmail ingestion | `LIVE_RUNTIME_WIRED` | format=full: decoded body (text/plain preferred, html fallback), To/CC/BCC, attachment metadata, 20k cap; unit-tested |
| B2 Drive ingestion | `LIVE_RUNTIME_WIRED` | paginated across nextPageToken (cap 500); exports Docs/Sheets/text content; unit-tested |
| B3 GitHub ingestion | `LIVE_RUNTIME_WIRED` / `PARTIAL` | event stream + repositories (paginated via Link header); issues/PRs/reviews/commits still open |
| B4 Ingest→Brain enqueue | `LIVE_RUNTIME_WIRED` | connector ingest auto-enqueues Company Brain processing (idempotent, fire-and-forget); unit-tested |
| C1 Provenance states | `PARTIAL` | no `human_approved`/`evidence_backed`/`expired` artifact state; source-less V2 entity can enter context |
| C2 Stable identifiers | `ROADMAP` | no `CompanyEntityIdentifier`; `properties::TEXT ILIKE '%...%'` |
| C3 Retrieval | `LIVE_RUNTIME_WIRED` / `PARTIAL` | alias+ILIKE+ts_rank+graph, additive weighted; no vector/temporal/authority/confidence |
| C4 Typed claims + policy | `PARTIAL` | untyped JSONB; one universal threshold; no per-predicate policy |
| C5 Source authority | `UNIT_PROVEN` | global hardcoded constants; not per-tenant/per-predicate |
| C6 Accuracy benchmark | `LIVE_RUNTIME_WIRED` | pure entity-resolver + deterministic trap corpus (name collision, source scoping, cross-tenant, missed-merge) scored by precision/recall/F1/false-merge/missed-merge; CI-gated (F1=1.000) |
| D1 Artifact harvesting | `LIVE_RUNTIME_WIRED` / `PARTIAL` | pure `harvestRunEvidence` helper harvests best-effort artifact ids from `taskResults`; full worker artifact emission still open |
| D2 Failure-class propagation | `LIVE_RUNTIME_WIRED` | `failureClassByTask` now derived from `state.failureDiagnoses` and spread into `FinishedRun` (D2 wired); not production-proven |
| D3 Metrics | `PARTIAL` | only `accumulatedCostUsd` |
| D4 Approval interrupt/resume | `LIVE_RUNTIME_WIRED` (wiring) / `ROADMAP` (E2E) | real checkpointer+409 wiring; no live-LLM E2E (env-blocked) |
| D5 Learning canary | `LIVE_RUNTIME_WIRED` (behind gate) | wired + MI gate; never run vs managed Postgres + real LLM |
| E1 Access control | `LIVE_RUNTIME_WIRED` / `PARTIAL` | role+retention+visibility; no user/dept/project/region/purpose; sensitivity stored not enforced |
| F1 Browser E2E CI | `ROADMAP` | not in CI at all |
| F2 Connector contract tests | `PARTIAL` | no mock-server suite; Serper+Slack subsets only |
| F3 Live paid-provider tests | `ROADMAP` | env-blocked, not scheduled |
| G1 Truth checker | `LIVE_RUNTIME_WIRED` / `PARTIAL` | numeric/phrase drift only; no callership/contract/canary/path checks |

---

## Named stops (gated on owner production credentials)

Per rule 10, the following cannot be claimed `PRODUCTION_PROVEN` this session regardless of code completeness — they require managed Postgres + a real LLM/OpenAI-or-Gemini key + `EVIDENCE_SIGNING_SECRET` + Ed25519 Shield keypair + real Gmail/Drive/GitHub/Salesforce/Vercel provider credentials, all owned by the human owner:

- **D4** real provider-backed approval interrupt/resume E2E (live LLM).
- **D5** 1%-traffic 7-day learning canary against managed Postgres + real LLM.
- **F3** scheduled live paid-provider canary tests.
- Any connector-content-depth claim (B1/B2/B3) proven against real provider API rather than the REST surface.

Code + local/contract-test proof for the above can be built; the `PRODUCTION_PROVEN` label is what is gated, per rule 10.

## Remediation order (Workstreams → PRs)

This truth doc drives the 14-PR sequence. The order below respects the dependency graph surfaced by the trace (each PR's prerequisite is the seam it writes into):

1. **PR 1 — DONE #159 (`f619629`).** Per-tenant email+calendar resolver BACKBONE: added `resolveEmailAdapterForContext`/`resolveCalendarAdapterForContext` (mirror CRM), `ToolExecutionContext.emailCredentials?/calendarCredentials?`, removed the process-global module singletons in `builtin/index.ts`, 9 resolver unit tests. Deployment tools (`deploymentCredentials` / `resolveDeploymentAdapterForContext`) deferred to a later PR — they need a new `DeploymentAdapter` interface and signature changes on tools that don't yet accept a context param.
2. **PR 2 — DONE #160 (`45d0f1b`).** Live population: `tenant-connector-credentials.ts` resolves Gmail app-password (via `credential.service`, `allowEnvFallback:false`) → `emailCredentials`+`calendarCredentials`; reads+decrypts the Salesforce Integration row → `crmCredentials.salesforce`; carries them to resolvers via a NEW side-channel registry keyed by `workflowId` (mirrors `llmApiKey` — deliberately omitted from `runtime.start` so no secret lands in the `stateJson` checkpoint). Makes `credential.service` live-reachable (Workstream A2 partial) and the per-tenant Salesforce factory reachable live. HubSpot per-tenant factory still deferred.
3. **PR 3 — MCP reconnect hardening (A7).** Decrypt through `crypto.ts`/`credential.service` before `JSON.parse`; add a reconnect contract test.
4. **PR 4 — Connector-sync atomicity (A9/B4).** Advisory-lock claim (or conditional `UPDATE WHERE status='idle'` + unique index on `(tenantId, provider, running)`); auto-enqueue Brain processing on connector ingest (B4).
5. **PR 5 — Deep Gmail/Drive/GitHub ingestion (B1/B2/B3).** Full body/threads/attachments/labels; Drive content export + pagination; GitHub repos/issues/PRs/reviews/commits/releases/webhooks.
6. **PR 6 — Company Brain provenance + identifiers (C1/C2).** Provenance state enum; gate source-less V2 entities out of agent context (rule 8); `CompanyEntityIdentifier` model + indexed normalized lookup replacing `properties::TEXT ILIKE`.
7. **PR 7 — Typed claims + predicate policy (C4/C5).** Typed value discriminator; per-predicate policy table; per-tenant/predicate source-authority config.
8. **PR 8 — Semantic retrieval + benchmark (C3/C6).** Add vector (pgvector is provisioned) + temporal + authority + confidence signals; reciprocal-rank fusion; Company Brain accuracy benchmark harness (precision/recall/F1, false-merge, missed-merge, P@K, access-leakage).
9. **PR 9 — Hyperagent artifact harvesting (D1).** Harvest real artifacts from `taskResults` into `FinishedRun` via the pure-core `evaluateOutcome` path.
10. **PR 10 — Failure/metric propagation (D2/D3).** Surface `failureClassByTask` + richer metrics into `FinishedRun`.
11. **PR 11 — Live approval E2E (D4).** Real provider-backed interrupt→resume E2E. **Named stop** (owner prod creds).
12. **PR 12 — Access-control expansion (E1).** user/dept/project/team/group/ACL/purpose/region/sensitivity + inference-leakage tests.
13. **PR 13 — Browser E2E (F1).** Blocking browser E2E CI for signup/onboarding/tenant/connector/ingestion/graph/evidence-drawer/conflict/spec/approval/execution/pause-resume/artifact/audit-export/tenant-isolation.
14. **PR 14 — Production canary + truth registry (D5/F3/G1).** 1%-7-day learning canary; scheduled live paid-provider canary; machine-readable capability registry + truth checker that fails on no-live-caller / live-no-contract / production-proven-no-canary / placeholder-counted-as-ready / source-path-missing. **Named stop** on the canary + live-provider parts (owner prod creds).

PRs 1–10, 12–13 can be built with local + contract-test proof this session. PRs 11 and 14 (and the live-provider portion of F3) are named stops.