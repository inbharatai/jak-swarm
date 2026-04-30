# JAK Swarm — No-Half-Measures Gap Audit (2026-04-30)

**Base commit:** `bfbd6ab`
**Branch:** `main`
**Audit purpose:** brutal-honest review of what previous "completion"
reports left as scaffold vs. real production code.

---

## 1. What is actually implemented (REAL)

| Capability | Evidence |
|---|---|
| OpenAI Responses API as default agentic runtime | `packages/agents/src/runtime/index.ts:59-72` — selected when `OPENAI_API_KEY` set + `JAK_EXECUTION_ENGINE !== 'legacy'` |
| 9 OAuth provider scaffolding | `apps/api/src/routes/oauth.routes.ts` — provider list at boot via `listOAuthProviders()` |
| 38 specialist agents | `packages/shared/src/types/agent.ts` — AgentRole enum has 38 entries (verified by `tests/integration/truth-claims.test.ts:96`) |
| 122 classified tools | `packages/tools/src/builtin/index.ts` — verified by `pnpm audit:tools` (122/0 fail) |
| Encrypted credentials at rest | `packages/db/prisma/schema.prisma:617-629` — `IntegrationCredential.accessTokenEnc` AES via `apps/api/src/utils/crypto.ts` |
| Approval engine — task-level | `packages/swarm/src/graph/nodes/approval-node.ts:31-94` — `RISK_ORDER` map, `autoApproveEnabled`/`approvalThreshold` opt-in, default fail-closed |
| Approval payload binding (no replay) | `ApprovalRequest.proposedDataHash` + `ApprovalScope` table (shipped 2026-04-28) |
| Audit log emission | `apps/api/src/plugins/audit-log.ts` — automatic for compliance events |
| Standing orders (autonomy boundaries) | `apps/api/src/routes/standing-orders.routes.ts` + `/standing-orders` UI |
| Skill-pack precedence cascade | `packages/skills/src/index.ts` — `loadSkillsWithCascade` + path-traversal guard |
| Workspace edit lock | `apps/api/src/coordination/workspace-lock.ts` — wired into StandingOrder PATCH |
| Slack ChannelAdapter | `apps/api/src/channels/slack-adapter.ts` — verified by 14 unit tests |
| Layman ConnectModal | `apps/web/src/components/integrations/ConnectModal.tsx` — locked by 7-provider forbidden-jargon Playwright spec |
| Plain-English permissions per provider | `apps/web/src/lib/connector-permissions.ts` — locked by unit tests |
| Agent friendly names in cockpit | `apps/web/src/lib/agent-friendly-names.ts` — wired into `AgentTracker.tsx` + `ChatWorkspace.tsx` |
| Run-audit button on connected cards | `IntegrationCard.tsx` + `connector-audit-goals.ts` |
| 1154 unit/integration tests | All passing |
| 10 Playwright sweep tests | All passing — covers 13 surfaces × 3 modes |

## 2. What is only UI / scaffold (NOT FUNCTIONAL END-TO-END)

| Item | What's there | What's missing |
|---|---|---|
| **Run-audit on connected providers** | Button + `workflowApi.create(goal)` wiring | NEVER tested with a CONNECTED integration in dev (dev tenant is empty); Playwright spec scopes to admin advanced flow only |
| **Browser-operator cards** (Instagram/LinkedIn/YouTube/Meta) | "Coming soon" UI cards on `/integrations` | NO backend service, NO secure-session runtime, NO captcha/2FA handling, NO audit trail. Pure UI placeholder. |
| **Tool installer service** | Connector registry has `status` field that tracks install state | NO `ToolInstallerService`, NO `MissingToolDetected` event, NO approval-gated install pipeline, NO trusted-registry allowlist |

## 3. What is not connected to backend

| Item | File | Gap |
|---|---|---|
| `requiresApproval` flag on tool metadata | `packages/shared/src/types/tool.ts:155` defined; counted in stats at `tool-registry.ts:382` | **NEVER consulted at execution time.** No `if (metadata.requiresApproval) emitApprovalRequest()` anywhere in `BaseAgent.executeWithTools`, `ToolRegistry.execute`, or worker-node code paths. The flag is currently DEAD. |
| Browser-operator cards | `BrowserOperatorComingSoon.tsx` | No `BrowserOperatorService` — cards are pure HTML, no state, no API |
| Integration.status enum | `schema.prisma:600` is `String @default("CONNECTED")` | Free-form string. Front-end normalizer (`connection-status.ts`) maps it client-side. DB has NO type safety. |

## 4. What is not tested with realistic data

| Item | Current state | What's missing |
|---|---|---|
| **Run audit on CONNECTED provider** | Phase 2 e2e only verifies the button DOES NOT show on disconnected cards | No mock/seeded test that creates a CONNECTED Integration row, opens `/integrations`, asserts button visible, clicks it, verifies workflow creation with the right per-provider goal |
| **Approval gate for sensitive tool calls** | `tests/unit/skills/skill-cascade.test.ts` etc. cover utilities; no test asserts "calling `gmail_send_email` triggers approval" | No integration test that exercises the per-tool-call approval gate (because the gate doesn't exist yet — see §3) |
| **Cross-tenant approval leakage** | `requireRole('REVIEWER+')` enforced at HTTP route level | No test that proves Tenant A cannot decide Tenant B's approval |
| **Browser operator** | N/A | No test possible — runtime doesn't exist |

## 5. What could mislead a user

| Surface | Misleading claim | Reality |
|---|---|---|
| `/integrations` browser-operator section | "JAK is building a secure browser-operator mode — you log in normally on the platform's site, JAK watches the page…" | The runtime is **not started**. No code exists. Copy already says "This is not live yet. No fake activity is run." — accurate but the cards STILL invite the user to think it's coming "soon" without a date. |
| Run-audit button on connected cards | Implies any connected provider can be audited | Workflow is created and pipeline runs, but **the per-provider goal does NOT yet route to a provider-specific specialist agent** — it goes through the generic Commander/Planner/Worker pipeline. May produce a generic report instead of a Gmail-specific one. |
| Landing page "approval-gated execution" claim | True at the TASK level | False at the per-tool-call level — `requiresApproval` flag is dead; sensitive tools currently execute without per-call approval prompt |

## 6. What MUST be fixed now (this session)

Ranked by user-visible impact and engineering safety:

1. **Phase 4 — Centralized `ApprovalPolicy` class + wire into `ToolRegistry.execute`** — fixes the dead `requiresApproval` flag at the chokepoint where every tool runs. Highest production-readiness win. Must include cross-tenant safety tests.
2. **Phase 2 — `Integration.status` Prisma enum** — additive migration; locks down the status taxonomy at the DB level. Removes free-string drift.
3. **Phase 3 — Playwright test with mocked CONNECTED Integration** — proves the Run-audit button + workflow creation work end-to-end. Fixes "untested connected-state claim."
4. **Phase 8 — Truth audit + landing-page downgrade for any over-reach.**

## 7. What MUST be deferred (with exact reason + next step)

| Item | Why it cannot honestly fit in one session | Exact next engineering step |
|---|---|---|
| **Phase 5 — Real browser-operator runtime** | Multi-week. Needs: secure user-logged-in browser session adapter (Playwright BrowserContext per tenant), captcha/2FA fallback, audit trail per click, terms-safe operation gate, approval per action. | Build `BrowserOperatorService` interface (Path B) + `docs/browser-operator-runtime-plan.md`. First real adapter (e.g. LinkedIn read-only "review profile") in a follow-up 1-week sprint. |
| **Phase 6 — Real tool installer execution** | Touching production install paths is too dangerous to land without a 1-week safety pass (sandbox isolation, command allowlisting, rollback on failure). | Ship `ToolRequirementDetector` + `ToolInstallRequest` interfaces + dry-run only. Real exec gated to allowlisted adapters in a follow-up. |
| **Live LLM bench run** | Physical limitation — needs user's `OPENAI_API_KEY` + budget approval. | `pnpm bench:runtime -- --yc-wedge --persona cmo --max-cost-usd 0.50` ($0.05–$0.20/run). User runs. |
| **Per-tool-call wire-up beyond ToolRegistry chokepoint** | If a worker bypasses `ToolRegistry.execute` and calls a tool function directly, the gate is bypassed. Auditing all 122 tools for this is a multi-day task. | After Phase 4 lands, add a CI rule: any `tool: ToolMetadata` callsite that doesn't go through `toolRegistry.execute()` fails lint. |

---

## Summary table — JAK Swarm production-readiness rating (1–10)

| Dimension | Today | Target | Gap |
|---|---|---|---|
| Connector readiness (OAuth, layman UX) | **7/10** | 9/10 | 2 deferred connectors + Phase 3 mock test |
| Browser operator readiness | **1/10** | 7/10 | Multi-week sprint required |
| Approval safety (per-tool gate) | **3/10** | 8/10 | **Closing this session via Phase 4** |
| Layman UX | **8/10** | 9/10 | Cockpit task-execution-view polish |
| Task visibility (cockpit) | **7/10** | 9/10 | Phase 7 layman-clarity test |
| Backend reality (vs. UI claims) | **6/10** | 9/10 | This audit closes the dishonesty gaps |
| Investor/demo readiness | **6/10** | 8/10 | After Phase 4 lands → 7/10 |

Honest verdict: **JAK Swarm is a strong MVP** with real backend (LangGraph,
ApprovalRequest, AuditLog, encrypted creds, approval payload binding,
38 agents, 122 tools, OpenAI-first) and recently shipped layman UX. The
production gaps are: per-tool approval gate (closing this session),
browser-operator runtime (multi-week), tool installer (multi-week), and
some untested connected-state flows.

It is **NOT** "production-ready" today by a brutal-honest standard. After
this session it WILL be ready for paid pilots with the deferred items
clearly named in the product roadmap.
