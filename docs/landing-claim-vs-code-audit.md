# Landing Page → Code Truth Audit

**Question:** does the JAK Swarm codebase actually back up everything
the landing page claims?

**Method:** every claim on `https://jakswarm.com/` mapped to a
specific file path or function. The `tests/unit/landing/landing-claim-vs-code.test.ts`
suite asserts each mapping exists; CI fails if any drifts.

**Run:** `pnpm --filter @jak-swarm/tests exec vitest run unit/landing/landing-claim-vs-code.test.ts`
→ 59/59 passing as of the 20 May 2026 Company OS hardening pass.

## Section 1 — Hero

| Hero element | Claim | Backed by |
|---|---|---|
| H1 | "Turn company context into approved agent work." | `apps/web/src/app/page.tsx` (test: hero copy contains "Turn company context") |
| Subheadline | Evidence from docs/tickets/code/meetings/customer feedback becomes drift detection, specs, OpenAI-first agent routing, approvals, sandboxing, risk scoring, defensive security review, and audit trails | Each shipped pillar is asserted in `tests/unit/landing/landing-claim-vs-code.test.ts` |
| Capability strip | Evidence Graph, Drift Detection, Executable Specs, Approvals, JAK Shield, Audit Trail | `CompanyArtifact`, `CompanyGraphEntity`, `ExecutionDriftFinding`, `AgentExecutableSpec`, approval routes, and audit/bundle services |
| Nav chip "JAK Shield" | clickable, scrolls to `#jak-shield` | `<JAKShield />` component + `id="jak-shield"` section (asserted via `href="#jak-shield"`) |
| Mobile menu | "JAK Shield" link at top | Same — asserted by ≥2 `JAK Shield` text occurrences in page.tsx |

## Section 2 — Company OS wedge

The YC-aligned claim is intentionally bounded: JAK is not presented as a
finished all-company auto-sync OS. The landing page says the beta wedge is
product/engineering context alignment: evidence → graph → drift → spec →
approval-gated execution.

| Layer | Backed by |
|---|---|
| Evidence artifacts | `CompanyArtifact` model + `apps/api/src/routes/company-operating-layer.routes.ts` |
| Company graph | `CompanyGraphEntity` model + `/company/entities` routes + `/company` dashboard |
| Drift detection | `buildDriftCandidates()` in `company-operating-layer.service.ts` |
| Agent-executable specs | `generateSpec()` + `/company/specs/generate` |
| Reviewer decision gate | `decideSpec()` + immutable decision regression test |

## Section 3 — HowItWorks (7-step pipeline)

Every step's italicised `status:` line names a real symbol in the code:

| # | Step | Status line | Backing file |
|---|---|---|---|
| 1 | Command | `commander.parses(intent)` | `packages/agents/src/roles/commander.agent.ts` |
| 2 | Plan | `planner.decompose() → 4 steps` | `packages/agents/src/roles/planner.agent.ts` (`decomposeGoal` symbol) |
| 3 | Route | `router.assign(task → CMO / CTO / Research)` | `packages/agents/src/roles/router.agent.ts` |
| 4 | Execute | `worker.run() · live in cockpit` | `packages/agents/src/base/base-agent.ts` (`executeWithTools` symbol) |
| 5 | Approve | `approval.gate(payload-bound)` | `packages/tools/src/registry/approval-policy.ts` (`DefaultApprovalPolicy`) + `proposedDataHash` in `schema.prisma` |
| 6 | Verify | `verifier.check() · 4-layer` | `packages/agents/src/roles/verifier.agent.ts` |
| 7 | Deliver | "signed audit trail, replayable run" | `apps/api/src/services/bundle.service.ts` + `bundle-signing.service.ts` |

## Section 4 — ProductCockpit

The dashboard mockup names 6 agents (Commander, Planner, Research,
CEO, CMO, Verifier). Each agent is a real `BaseAgent` subclass:

- `commander.agent.ts` ✓
- `planner.agent.ts` ✓
- `workers/research.agent.ts` ✓
- `workers/strategist.agent.ts` ✓ (CEO)
- `workers/marketing.agent.ts` ✓ (CMO)
- `verifier.agent.ts` ✓

The "Approval required" right-rail card claims `linkedin_publish` is
the gated tool. That tool is registered in
`packages/tools/src/builtin/index.ts` and the LinkedIn adapter at
`packages/tools/src/browser-operator/linkedin-adapter.ts` returns
`manualHandoffRequired: true` always — never auto-publishes.

## Section 5 — ShowTheWork (4 outcome cards)

| Outcome | Backed by |
|---|---|
| Execution drift brief | `buildDriftCandidates()` in `company-operating-layer.service.ts` |
| Agent-executable product spec | `/company/specs/generate`, `AgentExecutableSpec`, and `decideSpec()` |
| Browser QA + source-linked fixes | `packages/tools/src/browser-operator/playwright-browser-operator.ts` |
| Audit-ready evidence pack | `apps/api/src/routes/audit-runs.routes.ts` + `apps/api/src/services/bundle.service.ts` |

## Section 6 — TrustLayer (6 grep-able guarantees)

| Trust claim | Backed by |
|---|---|
| Human approval gates | `DefaultApprovalPolicy` + `model ApprovalRequest` |
| Source-grounded outputs | `verifier.agent.ts` `citationDensity` field |
| Tool maturity labels | `ToolMaturity` union in `packages/shared/src/types/tool.ts` (and the CI-enforced `audit:tools` script) |
| Tamper-evident audit trail | `bundle-signing.service.ts` uses `createHmac` (HMAC-SHA256) |
| Self-hostable open-source core | `LICENSE` file (MIT) |
| Gemini + OpenAI runtime | `packages/agents/src/runtime/gemini-runtime.ts` (primary) + `packages/agents/src/runtime/openai-runtime.ts` (alternate) |

## Section 7 — JAK Shield (the trust boundary section)

Already locked by `tests/unit/landing/jak-shield-truth.test.ts`. Every
one of the 6 local policy feature cards carries a `data-evidence-path` HTML
attribute pointing at a real file in JAK Swarm. These are **local policy
enforcement features** — not the JAK Shield MCP 10-stage pipeline, which is
a separate service at [github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield).

```
data-evidence-path="packages/security/src/guardrails/offensive-cyber-detector.ts"
data-evidence-path="packages/tools/src/registry/approval-policy.ts"
data-evidence-path="packages/tools/src/registry/tenant-tool-registry.ts"
data-evidence-path="packages/tools/src/browser-operator/playwright-browser-operator.ts"
data-evidence-path="docs/jak-shield-manifest.md"
data-evidence-path="apps/api/src/services/bundle.service.ts"
```

Plus the SSRF / DNS-rebind / disk-quota defenses are explicitly
asserted to exist in the operator file by symbol name:

- `defaultIsUrlAllowed` ✓
- `resolveAndCheckHost` ✓ (DNS rebinding)
- `tenantQuotaBytes` ✓ (disk quota)
- `BROWSER_REQUEST_BLOCKED` ✓ (URL allowlist)
- `BROWSER_DNS_REBIND_BLOCKED` ✓ (DNS rebinding)
- `BROWSER_QUOTA_EXCEEDED` ✓ (quota exceeded)

## Section 8 — Top-line counts

These are pinned by both this test AND `pnpm check:truth`:

| Stat | Source of truth |
|---|---|
| 38 specialist agents | `AgentRole` enum size (live) |
| 122 classified tools | `toolRegistry.list().length` (live) |
| 22 connectors | `INTEGRATIONS_CORE` + `INTEGRATIONS_INFRA` tile counts |
| MIT open-source | `LICENSE` file |

## Honest claim-vs-code gap that this audit FIXED

**Gap discovered:** landing claimed "MIT licensed" but the `LICENSE`
file did not exist in the repo root. The first run of
`landing-claim-vs-code.test.ts` failed at the MIT assertion. Fixed
by adding a proper MIT `LICENSE` file (commit see git log).

This is exactly what the truth-lock test is designed to catch — a
public claim that has no backing file. The fix wasn't to soften the
claim, it was to back the claim with the real artefact.

## Honest claim-vs-code gaps still on the roadmap

These are documented in `docs/jak-shield-manifest.md` as roadmap, NOT
claimed as shipped on the landing page:

| Gap | Where |
|---|---|
| First-party defensive-review agent | The Shield boundary blocks offensive requests; an actual "audit my repo" agent does not exist yet. JAK Shield card body says "supports defensive security work" — true (boundary allows it) but no purpose-built agent. |
| Dedicated `/shield` dashboard tab | Shield state is currently visible at `/audit` + `/inbox`. Not yet a unified panel. |
| Chain-hashed AuditLog rows | Bundles are HMAC-SHA256 signed; individual `AuditLog` rows are NOT yet chain-hashed (a SYSTEM_ADMIN with DB access could rewrite a row). |
| JAK Shield MCP integration | JAK Shield is a separate 10-stage MCP-native gateway ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)). The `ShieldMcpClient` and Agent Governance Overlay are planned (Phase 1 of the evolution plan). Today, security enforcement uses local policy logic in `packages/security`. |
| Agent Governance Overlay | Agent profiles, memory scopes, autonomy boundaries (L0–L5), and Ability Packs are planned, not shipped. |

## How to re-run

```bash
# Full claim-vs-code audit (33 tests)
cd tests && pnpm exec vitest run unit/landing/landing-claim-vs-code.test.ts

# JAK Shield specific truth-lock (9 tests)
pnpm exec vitest run unit/landing/jak-shield-truth.test.ts

# Counts truth-check (badge + product-truth.ts vs registry)
pnpm check:truth

# Full sweep
pnpm test
```

If any single line of landing copy changes, one of these tests will
catch the drift before it ships.
