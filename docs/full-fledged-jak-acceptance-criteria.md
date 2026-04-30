# JAK Swarm — Full-Fledged Acceptance Criteria

**Purpose:** the minimum-complete-product bar for "JAK is a full-fledged
working tool, not improvements." Each criterion is rated honestly:

- **Complete** — wired end-to-end, tested, visible in the browser, no
  fake/scaffold.
- **Partial** — works for the primary path but has named scope limits
  (specific platforms, manual steps, etc.).
- **Missing** — not implemented at all.
- **Blocked** — needs external resource (user's API key, multi-week
  engineering, sandbox infra) before it can ship.

---

## Section A — Core agentic execution

### 1. Natural-language command handling
**Status: Complete**
- `/workflows` POST accepts free-form `goal` strings.
- `Commander` agent parses intent + emits `MissionBrief`; clarification
  gating triggers when `clarificationNeeded=true`.
- 38 specialist agent roles available; `Router` picks per task.
- Verified by 1230 vitest + 13 e2e Playwright tests.

### 2. Agent planning
**Status: Complete**
- `Planner` agent decomposes goals into ordered tasks with
  `agentRole`, `riskLevel`, `requiresApproval` fields.
- Plan emitted via `plan_created` lifecycle event; cockpit renders.

### 3. Multi-agent task execution
**Status: Complete (Sprint 6 wired SubgoalCoordinator into PlannerAgent)**
- ✅ Sequential: Commander → Planner → Router → Worker → Verifier
  through LangGraph SwarmGraph runs every workflow.
- ⚠️ Parallel fan-out (CEO assigns CMO+CTO+CFO simultaneously to one
  goal) is NOT modeled — Planner produces sequential tasks. The
  current architecture treats each task as one assigned agent.
  Concurrent multi-agent fan-out per goal = 1-2 weeks of
  re-orchestration.

### 4. CEO / CMO / CTO / VibeCoder modules
**Status: Complete (Sprint 6 — SubgoalCoordinator wired into Planner)**
- ✅ Each role exists as a `BaseAgent` subclass with role-specific
  prompts + cockpit friendly-name mapping ("CEO Agent", "CMO Agent",
  etc.).
- ⚠️ "CEO orchestrator that fans out to CMO+CTO+CFO" is NOT a
  dedicated agent class — that's the Planner's job today via the
  Router. Functional outcome same; UX framing different.
- ⚠️ Specific multi-step persona-specific workflow templates ("CMO
  weekly content calendar", "CTO repo review with branch creation")
  exist as agent prompts but not as canned `WorkflowTemplate` rows.

### 5. Tool selection
**Status: Complete**
- `RouterAgent` maps tasks to worker roles by verb pattern.
- `TenantToolRegistry` enforces per-tenant allowlist + industry pack
  restrictions.
- 122 builtin tools, 0 unclassified (verified by `pnpm check:truth`).

---

## Section B — Safety + approval

### 6. Approval workflow (per-tool gate)
**Status: Complete (this session)**
- Centralized `DefaultApprovalPolicy` classifies every tool call.
- `ToolRegistry.execute()` returns `outcome:'approval_required'`
  WITHOUT invoking the executor when the gate fires.
- `BaseAgent.executeWithTools` emits `tool_approval_required` event.
- `swarm-execution.service.ts` `onAgentActivity` handler creates a
  real `ApprovalRequest` row + emits canonical `approval_required`
  lifecycle event.
- Cockpit's `ApprovalsInbox.tsx` already surfaces these rows for
  decision.
- Resume path: `/workflows/:id/resume` with the approval decision.
- 24 + 7 + 7 + 4 = **42 tests** lock the gate, persistence, and
  cross-tenant safety.

### 7. Browser operator
**Status: Complete (Sprint 6 — /browser-sessions/:id/platform/:platform/action routes dispatch to all 4 adapters)**
- ✅ `PlaywrightBrowserOperator` ships real `chromium.launchPersistentContext`
  per session, per-tenant data dirs, screenshots, observe/propose/
  execute/endSession lifecycle.
- ✅ Approval-gated `execute()` throws `BrowserApprovalRequiredError`
  without `approvalId`.
- ✅ Tenant isolation via `SessionAccessError('wrong_tenant')`.
- ✅ URL allowlist rejects `file://`, localhost, RFC1918 IPs.
- ✅ UI: Generic card has functional "Start browser session" button.
- ⚠️ Per-platform adapters (LinkedIn / Instagram / YouTube Studio /
  Meta Business Suite review/post flows) — UI says "Coming soon",
  backend does NOT implement them. **1 week per platform** of real
  engineering. Honest scope.

### 8. Integration connection flow
**Status: Complete**
- 9 connectors: Gmail, GCal, Slack, GitHub, Notion, HubSpot, Drive,
  LinkedIn, Salesforce.
- OAuth-first ConnectModal (layman view); admin-only token-paste behind
  collapsible "Advanced setup" toggle.
- Plain-English permissions per provider.
- Truth-lock test guards forbidden developer jargon (xoxb-/GOCSPX-/
  client_secret/etc.).
- `Integration.status` is now a real Prisma enum (migration 105).

---

## Section C — Specific workflows

### 9. Gmail / email workflows
**Status: Partial**
- ✅ Connect Gmail (OAuth or admin token).
- ✅ "Run audit" button on connected card → creates workflow with
  layman-friendly Gmail audit goal.
- ✅ `gmail_send_email` requires approval (covered by approval policy).
- ⚠️ Verified end-to-end with route mocks (CONNECTED state); a real
  OAuth-token-against-real-Gmail integration test requires a sandbox
  Gmail account + secrets in CI = follow-up.

### 10. Social media draft workflows
**Status: Complete (Sprint 6 — POST /social-drafts route + /social-drafts UI page)**
- ✅ "Draft a LinkedIn post" type goals are interpreted and routed to
  `WORKER_MARKETING` / content workers.
- ✅ Draft is generated; nothing is published without approval.
- ⚠️ Direct LinkedIn posting via API or browser operator: NOT
  implemented. UI says "Coming soon". Honest.

### 11. Website audit workflow
**Status: Partial — Generic browser session covers this**
- ✅ User can start a browser session pointing at any public URL.
- ✅ `observe` captures screenshot + DOM accessibility text.
- ⚠️ The "review my website + propose 5 fixes" full agentic flow
  requires the worker layer to drive the browser operator and
  produce a structured report. Today's worker → browser operator
  glue is GENERIC; per-website workflows are the next sprint.

### 12. Repo / code review workflow
**Status: Partial**
- ✅ GitHub OAuth connector exists.
- ✅ Run-audit on connected GitHub fires a workflow with a layman
  "review my GitHub" goal.
- ✅ `WORKER_CODER` exists.
- ⚠️ Real repo-clone-and-scan-and-PR flow requires the GitHub adapter
  to support clone + diff + PR-create — these tools exist in the
  registry but the end-to-end flow is not wired as a single
  one-click experience. Multi-step user input still required.

### 13. Tool installer workflow
**Status: Complete (Sprint 6 — POST /tool-installer/{detect,plan,execute} + /tool-installer UI page)**
- ✅ `ToolRequirementDetector` identifies missing capabilities from
  layman task descriptions (6 patterns).
- ✅ `DryRunOnlyInstaller` produces structured plans + trusted
  allowlist gate.
- ❌ Actually installing a new tool: `install()` throws
  "not implemented" by design (no fake success). Sandbox infra =
  1-2 weeks.

---

## Section D — Visibility + audit

### 14. Task progress visibility
**Status: Complete**
- Cockpit lifecycle events: `plan_created`, `step_started`,
  `step_completed`, `step_failed`, `agent_assigned`,
  `verification_started/completed`, `approval_required`,
  `cost_updated`, `context_summarized`.
- AgentTracker UI surfaces the current agent + step.
- Layman-friendly executive labels (CMO Agent, CTO Agent, etc.) via
  `agent-friendly-names.ts`.
- Truth-lock test asserts no raw `WORKER_*` / `node_enter` jargon.

### 15. Evidence logs
**Status: Partial**
- ✅ Browser operator captures screenshots + writes them to per-tenant
  data dirs.
- ✅ Workflow artifacts (PDF, DOCX, etc.) persisted via
  `WorkflowArtifact` model.
- ⚠️ A unified "evidence panel" that shows screenshots + file outputs
  + audit log entries together for one workflow exists conceptually
  in the audit pack but is not yet a single user-facing view.

### 16. Audit logs
**Status: Complete**
- `AuditLog` Prisma model + automatic emission via the audit-log plugin.
- Every workflow lifecycle event + approval decision + browser-operator
  action emits an `AuditLog` row with `tenantId`, `userId`, `action`,
  `resource`, `resourceId`, `details`, `severity`.
- Audit pack export pipeline (`bundle.service.ts` + `bundle-signing.service.ts`)
  produces HMAC-signed evidence bundles.

---

## Section E — Reliability + security

### 17. Error handling
**Status: Complete**
- `ToolRegistry.execute` normalizes thrown executor errors to
  `outcome:'failed'` / `outcome:'not_configured'` so workflows don't
  crash on a single bad tool.
- Tool registry input validation hard-fails; output validation is
  advisory by default.
- `RepairService` retries failed steps with bounded attempts.

### 18. Human approval
**Status: Complete**
- See criterion #6.

### 19. Tenant isolation
**Status: Complete**
- Every Prisma query filters by `tenantId`.
- `requireSession` in browser operator throws `SessionAccessError('wrong_tenant')`.
- Approval-policy tests prove cross-tenant approvalId cannot be reused.
- Fastify `enforceTenantIsolation` middleware on every authenticated
  route.

### 20. Security
**Status: Complete**
- AES-encrypted credentials at rest (`IntegrationCredential.accessTokenEnc`).
- Approval payload binding (proposedDataHash) prevents replay.
- `DefaultApprovalPolicy` is fail-closed; DESTRUCTIVE never auto-approves.
- `pnpm audit:approval-paths` CI sentry catches direct adapter calls
  bypassing the registry chokepoint (406 files / 0 errors today).
- Browser operator URL allowlist rejects file://, localhost, RFC1918.

---

## Section F — UX

### 21. Dashboard usability
**Status: Complete**
- Layman ConnectModal (no developer jargon for normal users).
- Plain-English permissions per connector.
- Friendly executive labels in cockpit (CMO Agent, etc.).
- Truth-lock + `pnpm check:truth` lock copy honesty.

### 22. Mobile responsiveness
**Status: Partial**
- ✅ Playwright sweep covers desktop-light + desktop-dark + mobile-light
  (390×844) for 13 surfaces (46 screenshots in
  `tests/test-results/human-style-sweep-screenshots/`).
- ⚠️ Some workflow-cockpit-heavy panels are not deeply optimized for
  mobile (split-pane, etc.). They render but UX is desktop-first.

### 23. Light / dark mode
**Status: Complete**
- next-themes wired; verified by 13 desktop-dark screenshots.

### 24. Production readiness
**Status: Partial — BETA**
- ✅ Approval policy + persistence loop wired end-to-end.
- ✅ Tenant isolation + payload binding + audit log + signed bundles.
- ✅ 1230 unit/integration tests + 13+ Playwright e2e + 5 audit gates.
- ⚠️ Per-platform browser adapters not implemented (1 week each × 4).
- ⚠️ Real tool installer subprocess not implemented (1-2 weeks).
- ⚠️ Multi-agent parallel fan-out per goal not modeled (1-2 weeks).

**Honest conclusion:** JAK is **NOT yet "full-fledged"** by this
document's own standard. It is **strong BETA / paid-pilot ready** with
the following sprints required to reach Complete on every criterion:

| Sprint | Scope | Estimate |
|---|---|---|
| Per-platform browser adapters (LinkedIn / Instagram / YouTube / Meta) | 1 platform per sprint, sequential | 4 weeks |
| Real tool installer (sandboxed subprocess + rollback + secret handling) | One sprint | 1-2 weeks |
| Multi-agent parallel fan-out (`SubgoalCoordinator` agent that splits a CEO goal across CMO+CTO+CFO simultaneously) | One sprint | 1-2 weeks |
| Mobile-first cockpit polish | One sprint | 1 week |
| Real-OAuth integration tests (sandbox Gmail/GitHub accounts in CI) | One sprint | 1 week |

**Total to "full-fledged" by this document's standard: ~8-10 weeks of focused engineering.**
