# JAK Swarm — FAQ

Every claim in this section maps to a real file path or a CI-locked test. If a feature is on the roadmap and NOT yet shipped, that's said plainly. No marketing fog.

---

## About the Product

### What is JAK Swarm in one sentence?

A beta closed-loop company operating layer: JAK turns company evidence into drift findings, executable specs, approved agent/human work, and signed audit evidence.

### What's the unique thing JAK does that nothing else does?

**A closed loop from company evidence to controlled execution.** JAK has two code-backed loops: the Company OS loop (artifacts → graph entities → drift findings → agent-executable specs → reviewer decision) and the workflow loop (Commander → Planner → Router → agents/humans → approval → verifier → audit). The point is not "more agents"; the point is keeping execution aligned with cited company context.

The Company OS implementation lives in `CompanyArtifact`, `CompanyGraphEntity`, `ExecutionDriftFinding`, and `AgentExecutableSpec` (`packages/db/prisma/schema.prisma`) plus `apps/api/src/routes/company-operating-layer.routes.ts`. Human task execution lives in `TaskAssignment` + `apps/api/src/routes/task-assignments.routes.ts`; UI is `/company` and `/my-tasks`.

### Is the closed-loop Company OS complete?

**No — it is a real beta foundation, not a finished company-wide OS.** Shipped today:

- Tenant-scoped evidence artifacts with source/type labels and body hashes
- Company graph entities that must cite artifacts
- Deterministic drift detection for customer signals, decisions, execution work, and stale high-priority tasks
- Agent-backed executable spec generation with no template fallback
- Reviewer approval/rejection for specs, now immutable after first review
- `/company` UI for manual/API-fed evidence ingestion, extraction, drift analysis, and spec review

Still not complete:

- First-party background sync jobs for every connector source
- Real customer-call/meeting transcript ingestion pipeline into the graph
- Cross-tool drift monitors that run continuously without manual trigger
- Production smoke tests against the hosted Cloud Run + Railway + Supabase + Railway Redis environment

So the accurate public phrase is **"closed-loop Company OS beta foundation"**, not "finished company AI OS."

### Who is JAK Swarm for?

- **Solo founders + small ops teams** that want AI to do real work, not just give answers
- **Compliance-aware teams** that need a tamper-evident trail of every agent action
- **Teams already on Slack + HubSpot + Gmail** that want one orchestration layer driving workflows across both AI and human steps

It is NOT yet for: enterprises requiring SOC 2 Type 2 attestation (we have the controls + evidence layer; we don't have third-party certification — see the production-readiness FAQ below).

---

## Free Trial

### How does the free trial work?

Sign up at [`/trial`](https://jakswarm.com/trial) with just an email. **No credit card.** You get 30 days with these daily caps (reset at UTC midnight):

| Resource | Daily cap |
|---|---|
| Agent runs (one workflow = one count) | **20 / day** |
| External-action approvals (LinkedIn post, send email, ...) | **5 / day** |
| Tool execution time (browser, code-interp, ...) | **120 min / day** |
| LLM tokens (input + output combined) | **200,000 / day** |

When a cap hits, your workflow pauses with a `429 TRIAL_DAILY_CAP_HIT` response carrying `resetsAt` + `daysRemaining`. The cockpit shows a banner — never a silent failure. Caps are independent: hitting the approvals cap doesn't block agent runs.

Source of truth: [`apps/api/src/services/trial/usage-counter.service.ts`](apps/api/src/services/trial/usage-counter.service.ts).

### What happens after 30 days?

Your tenant flips to `trial_expired` status. New workflow starts return `402 TRIAL_EXPIRED`. **Read access + data export still work** so you can recover anything you produced. To continue: upgrade to a paid plan (Paddle billing, integrated).

### Can I cycle the trial by re-signing up with a new email?

The TrialSignup table enforces one trial per email AND one trial per IP+UA fingerprint per 90 days. So no — the casual cycle attempt is blocked. A determined attacker can still bypass with VPN + new email; this is the same trade-off every free-trial product makes. The daily caps are the real budget protection.

### Why daily caps and not a single 30-day budget?

Because a single bad-actor workflow can drain a 30-day budget in two hours. Per-day caps mean the worst-case loss is bounded to one day, not one trial. They reset cleanly so a heavy day doesn't lock you out for a week.

---

## Beta Release and Production Readiness

### Is JAK Swarm production-ready?

**For solo founders / design partners running it themselves: BETA-YES, with eyes open.** The architecture is solid (LangGraph + Postgres checkpointer + signed evidence bundles + AES-256-GCM workflow encryption + JAK Shield trust boundary). The 20 May 2026 Company OS hardening pass re-verified the full local test suite (`2090 passed, 99 skipped, 54 todo`), landing truth-lock, Company Operating Layer unit/integration tests, web/API type-checks, production web build, and `pnpm check:truth`.

**For paying enterprise customers expecting an SLA: NO, not yet.** Concrete blockers we name openly:

1. The hosted Cloud Run API must be smoke-tested before inviting public users; local tests do not prove the live deployment, environment variables, migrations, queues, connector credentials, or LLM model entitlements are healthy.
2. No third-party security audit (no SOC 2 Type 1/2, no ISO 27001 certification). The control infrastructure is shipped (182 controls seeded, 108 operationally backed) but the certification audit itself has not happened.
3. Lawyer-reviewed Terms of Service / Privacy Policy / DPA are not in place — required for B2B and EU-region sales.
4. No third-party penetration test against the running system.
5. AuditLog rows are not yet chain-hashed (bundles ARE HMAC-signed, but a SYSTEM_ADMIN with DB access could rewrite an individual log row — bundle-level tamper-evidence only).
6. No incident-response runbook + on-call rotation.

**Honest path to "ready to take money from strangers" is ~2-3 months for B2B small business, ~9-12 months for security-conscious enterprise.** Full beta scope and go/no-go checklist: [`docs/beta-release.md`](beta-release.md).

### Does JAK Swarm have SOC 2 / HIPAA / ISO 27001 certification?

**No.** What we have is the *infrastructure* to support those audits: 182 controls seeded across SOC 2 / HIPAA / ISO 27001 (63 + 37 + 82), 108 are operationally backed by auto-mapping rules pulling evidence from system activity, 74 require reviewer attestation. We ship the control matrix, the workpaper PDFs, the HMAC-signed evidence bundles, and the External Auditor Portal — everything an external auditor needs to issue a report.

The actual third-party attestation (an external CPA firm running the audit, observing for 3+ months in the case of Type 2, and issuing the report) is **not done.** That's a customer-driven 4–9 month engagement we have not started.

We deliberately avoid the phrases that would imply third-party attestation we don't have — the landing-truth-lock test in [`tests/unit/landing/landing-claim-vs-code.test.ts`](../tests/unit/landing/landing-claim-vs-code.test.ts) bans those marketing phrases anywhere in the README or landing page.

### Can I self-host JAK Swarm?

**Yes.** It's MIT-licensed, the code is here, the README has the full Quick Start. You need: Docker for Postgres + Redis, an API key, Node 20+, pnpm 9+. Run `bash scripts/start-dev.sh` to bootstrap and you're at `http://localhost:3000` in a few minutes. There's no cloud-only feature — the same code that runs at jakswarm.com is what you self-host.

---

## Team + Assignment

### Can I assign workflow steps to a human teammate, not just an AI agent?

Yes. `POST /task-assignments` creates a TaskAssignment for a workflow step and routes it to a specific user. The user sees it in `/my-tasks`, can acknowledge / complete / decline. The workflow pauses (via the existing approval-pause mechanism) until the human posts a result, then resumes the next step.

The hierarchy is in `Department` + the `User.{departmentId, jobTitle, managerId}` fields. The org-chart UI is `/team`. Anyone in the tenant can see the directory; only `TENANT_ADMIN+` can create departments or change membership.

### What roles exist for users?

Five roles in ascending privilege:

| Role | What they can do |
|---|---|
| `END_USER` | Read-only on workflows + their own profile |
| `REVIEWER` | + approve/reject pending approvals |
| `OPERATOR` | + run workflows, manage memory, manage own tenant data |
| `TENANT_ADMIN` | + manage departments, members, integrations |
| `SYSTEM_ADMIN` | + cross-tenant (rare; platform operators only) |

Plus `EXTERNAL_AUDITOR` (Sprint 2.6) — invite-token only, scoped to one engagement, no password-based login.

---

## Integrations

### What integrations are real today vs roadmap?

**Working in code, but often credential/config dependent:**

- Gmail (send + read via App Password)
- Google Calendar
- Slack (bot + channel routes)
- WhatsApp (link verification + bot)
- LinkedIn (manual-handoff only — never auto-publishes)
- Browser automation (Playwright with full SSRF + DNS-rebind + disk-quota defenses)
- 21 MCP providers via the Connector Runtime
- Company OS source labels for GitHub, Linear, Jira, Slack, Notion, Google Drive, Gmail, meetings, customer calls, support, documents, manual notes, and other artifacts

**Roadmap / not complete yet:**

- Background auto-sync jobs that continuously ingest every Company OS source into `CompanyArtifact`
- HubSpot CRM read-through (adapter exists; UI integration is the missing piece)
- Twilio voice (click-to-call + recorded calls + transcripts → Activity feed)
- Embeddable customer chat widget
- Pipedrive (alternative to HubSpot)

The integration philosophy: **integrate, don't rebuild.** JAK is the cockpit; your existing stack stays intact. The unique value lives in the evidence graph, orchestration, approvals, and audit layer, not in re-implementing Slack or HubSpot.

### How do I connect Gmail without OAuth?

Enable 2FA on Gmail → generate an App Password at [`myaccount.google.com/apppasswords`](https://myaccount.google.com/apppasswords) → set `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD` in `.env`. Verified working in `packages/tools/src/builtin/index.ts`.

### How do I connect Slack?

In the dashboard → Integrations → click Connect on Slack → paste your Bot Token + Team ID from [`api.slack.com/apps`](https://api.slack.com/apps).

---

## Cost + LLM Choices

### How much does JAK Swarm cost?

The software is **MIT-licensed and free** (run it yourself, no SaaS fees). When using the hosted product:

- **Free trial:** 30 days, no credit card, daily caps as listed above
- **Paid plans:** Free / Builder / Pro / Team / Enterprise — pricing on the landing page. Pricing details are subject to revision before the first paying customer; do not treat current page numbers as final.

When self-hosting, you pay only for **LLM API calls** (~$0.01–$1.00 per workflow depending on complexity and provider) + your own infra (Postgres + Redis on whatever cloud).

### Can I use local LLMs or other providers?

JAK Swarm supports two first-class LLM providers: **OpenAI** (GPT-5.5 / GPT-5.4) and **Google Gemini** (2.5 Pro / 2.5 Flash / 2.5 Flash-Lite). Each tenant switches between them from the Settings UI — the preference is stored in `TenantMemory` and flows through the entire execution pipeline with zero code changes.

The `GeminiRuntime` adapter ([`packages/agents/src/runtime/gemini-runtime.ts`](../packages/agents/src/runtime/gemini-runtime.ts)) bridges the Gemini SDK to JAK's agent-first architecture: it converts OpenAI message shapes to Gemini `Content[]` format, maps tool definitions, and translates responses back via `geminiResponseToChatCompletion()`. All 38 agents, tool calling, structured output, and the Vibe Coding pipeline work identically on both providers.

Additional providers (Anthropic, DeepSeek, Ollama, OpenRouter) would follow the same adapter pattern. If local LLM support is added later, it should land as a new reviewed runtime with its own tests and documentation, not as a silent fallback.

### What does "Agent-first" mean in the architecture?

JAK routes all work through specialist agents with structured output via the Responses API (`json_schema` strict mode for OpenAI, `responseSchema` for Gemini). Prompt-cache-aware cost telemetry tracks tokens across both providers. The agent layer is the architecture — `BaseAgent.execute()` transparently swaps the LLM call service based on the tenant's preferred provider via `setContextOverride()`.

---

## Security + Data

### How does JAK protect against prompt injection?

`detectInjection()` runs every LLM input through a pattern detector BEFORE it reaches the model. Plus `offensive-cyber-detector.ts` blocks malware-creation, exploit-generation, credential-theft, unauthorized-scanning, and phishing requests at the boundary. Defensive-security work (audits, OWASP scans, SAST/DAST) passes — defensive markers down-weight the offensive-detector confidence so legitimate security teams aren't blocked.

### Is my data encrypted?

Yes:

- **At rest:** `workflows.{goal, error, finalOutput, planJson, stateJson}` are AES-256-GCM encrypted via `FieldCipher` + a Prisma `$extends` extension. Set `JAK_FIELD_ENCRYPTION_KEY` (32 hex bytes) — without it, fields are stored cleartext (development default).
- **In transit:** Standard HTTPS for all API calls.
- **PII redaction:** AgentTrace JSON columns are PII-redacted at write time via `persistence-redactor.ts`. Runtime PII redaction at the LLM boundary uses `RuntimePIIRedactor`.

### What happens to my data if I delete my tenant?

Foreign keys are mostly `onDelete: Cascade` from Tenant → child tables. Deleting a tenant removes its workflows, agent traces, approvals, task assignments, notifications, departments, etc. **Caveats:** AuditLog rows are retained per the `logRetentionDays` policy (default 90 days, tenant-configurable). Signed evidence bundles in storage are not auto-purged on tenant delete (so an external auditor with a valid bundle ID can still verify it). A working "right-to-erasure" flow that purges everything end-to-end is on the roadmap, not yet shipped.

---

## Workflow Execution

### What happens if a workflow task fails?

Other independent tasks continue (graceful failure). The Verifier can trigger auto-repair, which replans + retries failed tasks with alternative approaches (configurable max retries, default 2). Destructive actions are NEVER auto-retried — they pause for human review. Cross-task auto-repair has an error-class decision tree (`apps/api/src/services/repair.service.ts`).

### How does SSE streaming work?

`GET /workflows/:id/stream` accepts a JWT via `?token=` query param (since EventSource cannot set headers). The server emits events for node transitions, task completions, and errors. A heartbeat every 15s keeps the connection alive. The `/my-tasks` page also polls `/inbox` every 10s as a backup for clients where SSE is blocked.

### Can agents see images and PDFs?

Yes. Vision-capable models process images via `analyzeImage()`. PDFs go through `pdf_extract_text` / `pdf_analyze`. DOCX uses `mammoth`, XLSX uses `exceljs`, images use `tesseract.js` for OCR — every parser surfaces a `parseConfidence` value (0.95 DOCX, 0.85 XLSX, 0.6 OCR) so reviewers can filter.

---

## Audit & Compliance

### What audit-related lifecycle events does the cockpit show?

13 audit-specific events on the `audit_run:{id}` SSE channel: `audit_run_started`, `audit_plan_created`, `evidence_mapped`, `control_test_started`, `control_test_completed`, `exception_found`, `workpaper_generated`, `reviewer_action_required`, `final_pack_started`, `final_pack_generated`, `audit_run_completed`, `audit_run_failed`, `audit_run_cancelled`. Every event carries `agentRole` so the cockpit attributes each step to the responsible role. Full reference in [`docs/agent-run-cockpit.md`](agent-run-cockpit.md).

### Is the Audit & Compliance pack production-ready?

The pack is functionally complete and end-to-end tested ([`tests/integration/audit-run-e2e.test.ts`](../tests/integration/audit-run-e2e.test.ts) — 11 assertions covering create → plan → test → workpaper → approve → signed pack → signature verify, all green). To bring it into production:

1. Apply migration 15 (audit-run schema) against the production DB: `pnpm db:migrate:deploy`
2. Verify `EVIDENCE_SIGNING_SECRET` is set (required for HMAC final-pack signing — `openssl rand -base64 48`)
3. Verify `OPENAI_API_KEY` is set — without it, control-test evaluation uses a deterministic coverage rule with the rationale `"deterministic coverage rule (no LLM key configured)"` so reviewers see the difference
4. Smoke-test by creating an audit run via `POST /audit/runs` for an existing tenant

Honest deferrals (named, not faked): live SSE on the audit detail page (~1 day; currently 15s SWR polling). External Auditor Portal IS shipped (Sprint 2.6 — invite-token-only, SHA-256-hashed tokens, `crypto.timingSafeEqual` verification).

---

## Development + Extension

### How do I add a new agent?

Subclass `BaseAgent` in `packages/agents/src/`, register it in `packages/agents/src/index.ts`. Pattern: every agent has an `agentRole`, a system prompt, a list of tools it's allowed to call, and (optionally) a `needsGrounding` flag for citation enforcement. `BaseAgent` delegates to three composable services (`LLMCallService`, `PromptBuilderService`, `ToolExecutionService`) in `packages/agents/src/base/`; subclass overrides should target the protected hook methods rather than re-implementing the full LLM call loop.

### How do I add a new tool?

Add a tool definition to `packages/tools/src/builtin/index.ts`, classify it with a `ToolRiskLevel` (READ_ONLY → CRITICAL_MANUAL_ONLY) and a `maturity` label (`real_external` / `heuristic` / `llm_passthrough` / `config_dependent` / `experimental`). The CI `audit:tools` script enforces classification — un-classified tools fail the build.

### How do I add a new LLM provider?

Follow the `GeminiRuntime` adapter pattern: create a runtime adapter that converts message shapes, map tool definitions, and translate responses back. Wire it through `BaseAgent.setContextOverride()`. See [`gemini-runtime.ts`](../packages/agents/src/runtime/gemini-runtime.ts) as reference.

---

## Operations + Reliability

### What about durability — what if the API restarts mid-workflow?

In-flight workflows survive API restarts via DB-backed checkpoints (LangGraph's `PostgresCheckpointSaver`). The recovery handler at boot scans for ACTIVE workflows and re-enqueues them. **Caveat:** mid-node crashes (e.g. process killed in the middle of a tool call) lose the in-flight node's progress; the node retries from its last checkpoint. For dedicated workflow-engine durability guarantees (Temporal-style), this is a design decision we made for simplicity over the 0.001% edge case.

### What is the active hosted beta deployment target?

The primary deployment is Google Cloud Run (`jak-swarm-api` in `asia-south1`). The API is live at `https://jak-swarm-api-565531938617.asia-south1.run.app`. The Worker still runs on Railway. Frontend stays on Vercel. Postgres stays on Supabase for pgvector. Redis runs on Railway managed Redis (Cloud Run connects via the public `rediss://` endpoint — `.railway.internal` private DNS is unreachable from outside Railway). Railway remains available as a rollback/fallback path — switch `NEXT_PUBLIC_API_URL` in Vercel to return to Railway at any time. See `docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md` for current status.