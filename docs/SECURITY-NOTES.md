# Security Notes — Dual-Use Surfaces

JAK Swarm exists to let agents execute real actions. That means several features are intentionally high-privilege; locking them down to the point of uselessness would defeat the product. This document inventories every such surface, explains the guardrails in place, and cites the test coverage that prevents regression.

If you're looking for how to report a vulnerability, see [SECURITY.md](../SECURITY.md).

---

## 1. `browser_evaluate_js` — arbitrary JS in a headless browser

**What it does:** executes a JavaScript snippet inside an active Playwright page context. Used by the browser agent to extract data, fill forms, or navigate sites that require scripted interaction.

**Guardrails:**

- Requires tenant-level `enableBrowserAutomation = true`. See [tenant-tool-registry.ts](../packages/tools/src/registry/tenant-tool-registry.ts) — `isAllowed()` returns `false` for any `ToolCategory.BROWSER` tool when the flag is off, and emits a structured debug log with `reason: 'browser_automation_disabled'`.
- The tool metadata sets `requiresApproval = true` (high-risk category), so every invocation passes through the approval gate defined in `approval-node.ts`. With `autoApproveEnabled = false` (the default after Phase 1), this means human review on every run.
- Executed in a per-session browser context; no credentials or cookies persist across workflows by default.

**Tests:**

- `tests/unit/tools/tenant-tool-registry.test.ts` — 9 cases covering the browser-automation gate + restricted categories + explicit disabled names.
- `tests/unit/swarm/worker-node-browser.test.ts` — end-to-end browser agent flow with gate enforcement.

**Known limits:**

- There is no per-origin allowlist yet; a tenant with the flag on can navigate the agent to any URL. A `allowedDomains` list exists on the tenant record but is only applied in the agent prompt, not enforced at the Playwright-navigation layer. Tracked for a future release.

---

## 2. `code_execute` — sandboxed code execution

**What it does:** runs a user-provided code snippet in an E2B sandbox with a 30-second wall-clock timeout and no network egress except to explicitly-allowed hosts.

**Guardrails:**

- Execution happens in an E2B container, not the API host. A crash or infinite loop in the sandbox never reaches JAK's process.
- Sandbox lifecycle is spawn-on-demand, destroy-after-use. No state survives between invocations.
- `process.exit` and `child_process.spawn` are blocked at the sandbox level. See `tests/unit/tools/tool-execution-behavioral.test.ts` — the `code_execute blocks process.exit` case asserts this directly.
- Tool metadata sets `riskClass = CODE_EXECUTION` so it's gated by the tenant's risk-class filter and by the approval node.

**Tests:**

- `tests/unit/tools/tool-execution-behavioral.test.ts` — 10 cases covering sandbox isolation, timeouts, and the round-trip of `memory_store` → `memory_retrieve` (a companion safety-critical flow).

---

## 3. Skill extension system — user-submitted skills

**What it does:** third-party developers submit skill implementations (source code + test cases + input/output schemas). The system sandbox-tests the skill, then routes it to a human admin for approval. Approved skills become callable by agents at runtime.

**Guardrails:**

- **Sandbox phase:** the submitted code is written to an E2B sandbox, executed against the submitter's test cases, with a 30-second timeout. If tests fail or the sandbox crashes, the skill is marked `SANDBOX_FAILED` and never reaches a human.
- **Human review:** `POST /skills/:skillId/approve` requires `TENANT_ADMIN` or `SYSTEM_ADMIN` role; a non-admin call is rejected at the route's `preHandler`. An audit log row records `approvedBy` + `approvedAt` for every state transition.
- **Tier system:** `BUILTIN` (shipped with the platform, no sandbox needed) / `COMMUNITY` (pre-vetted skills released under MIT) / `TENANT` (a specific tenant's custom skill, always sandbox-gated). Only `TENANT` skills require sandbox + approval.

**Tests:**

- Integration tests for the approve/reject state machine (`tests/integration/skills-approval.test.ts`).
- Sandbox execution verified as part of the tool execution behavioral suite.

**Known limits:**

- The sandbox is hardened against escape but we do not yet publish a formal threat model for the E2B deployment. Customers running on-prem should audit their sandbox provider independently.

---

## 4. Webhook signature verification

**What it does:** inbound webhooks from Slack, Paddle, Supabase, Stripe (MCP), and WhatsApp carry HMAC signatures the API must verify before trusting the payload.

**Guardrails:**

- All verifications use **`crypto.timingSafeEqual`**, never `===`. See [slack.routes.ts:44](../apps/api/src/routes/slack.routes.ts) — the canonical pattern:

  ```ts
  const expected = hmacSha256(slackSigningSecret, `v0:${ts}:${rawBody}`);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  ```

- **Replay protection:** requests older than 5 minutes are rejected. Slack: `X-Slack-Request-Timestamp`; Paddle: `p5` header + timestamp; Supabase: `svix-timestamp`.
- **Raw body preservation:** Fastify's default JSON parser rewrites payloads. We use a `rawBody` parser on these routes so the HMAC verifies against the exact bytes the sender signed.

**Tests:**

- `tests/integration/slack-hmac-verify.test.ts` — positive + negative cases (wrong secret, stale timestamp, bit-flip in signature).
- Paddle and Supabase webhook verification follow the same pattern and are covered in their respective integration suites.

---

## 5. Approval gate auto-bypass

**What it does:** optionally allows a tenant to skip human review for tasks whose risk level is strictly below their configured threshold.

**Guardrails (Phase 1, landed in commit `478d874`):**

- **Opt-in required.** `tenant.autoApproveEnabled = false` by default. Any workflow routed to the approval node with this flag off will pause at `AWAITING_APPROVAL` until a human decides, no matter what `approvalThreshold` says.
- **Auditable.** Every decision — including auto-approvals — writes a row to `approval_audit_logs` with `decision`, `approverId` (null for auto-approvals), `rationale`, `rawDecisionJson`, and timestamps. Append-only.
- **Back-fill preserves behavior.** The Phase 1 migration sets every existing tenant to `autoApproveEnabled = true` so nothing breaks mid-flight; only tenants created after the migration get the strict default.

**Tests:**

- `tests/unit/swarm/approval-gate.test.ts` — 6 cases proving the policy: pauses without opt-in, pauses with opt-in but threshold not satisfied, only auto-approves on explicit opt-in + strict risk-below-threshold, audit payload carries workflow/task/agent/risk context.

---

## 6. Circuit breaker — universal worker wrap

**What it does:** wraps every agent tool-loop execution in a Redis-backed circuit breaker so repeated failures in an external provider don't cascade.

**Guardrails:**

- 5 consecutive failures → breaker opens for 30 seconds. 6th call rejects in <1ms without touching the provider.
- Half-open probe after cooldown; one test call decides whether to close.
- Per-agent-role isolation — CRM failures don't open the Email breaker.
- Fallback to in-process breaker if Redis is unreachable. See [distributed-circuit-breaker.ts:135-146](../apps/api/src/coordination/distributed-circuit-breaker.ts).

**Tests:**

- Dedicated test suite planned for Phase 3 of the hardening plan. Until it lands, coverage comes from integration tests that intentionally inject failures in `tests/integration/full-pipeline.test.ts`.

---

## How we keep this document honest

- Every item above cites a file path and a test.
- If you add a new high-privilege surface, add an entry here in the same PR.
- The [CI truth-check job](../.github/workflows/ci.yml) will eventually be extended to require every tool with `requiresApproval = true` to have a mention in this document; until then, PR review is the guard.
