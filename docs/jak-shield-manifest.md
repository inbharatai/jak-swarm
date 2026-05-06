# JAK Shield — Feature Manifest

**JAK Swarm does the work. JAK Shield makes the work safe.**

JAK Shield is the security + trust layer inside JAK Swarm. Every claim
on this page maps to a real file path. If the file or behaviour ever
disappears, this manifest is wrong and CI catches it.

The product remains **JAK Swarm**. The trust layer is named **JAK Shield**.

---

## Feature 1 — Agent Firewall (input gate)

Blocks unsafe user requests **before the LLM sees them**.

| Capability | Where | What it does |
|---|---|---|
| Prompt-injection detection | `packages/security/src/guardrails/injection-detector.ts` | Catches `STANDARD_PATTERNS` (ignore-previous-instructions, identity override, system-tag injection, code-block-system) and `BROWSER_CONTENT_PATTERNS` (white-on-white hidden text, etc.) |
| Defensive-only boundary | `packages/security/src/guardrails/offensive-cyber-detector.ts` | Blocks malware-creation / exploit-generation / credential-theft / unauthorized-scanning / phishing requests; defensive markers (audit, review, harden, patch, OWASP, SAST) down-weight confidence so legitimate security work passes |
| Pre-LLM gate wiring | `packages/agents/src/base/base-agent.ts:632` (`executeWithTools`) | Both detectors run on every user-role message in the conversation BEFORE the first LLM call. HIGH-confidence hits throw a structured error, the workflow ends in `FAILED` state with the safety reason persisted to DB. |
| Off-switch | `JAK_INJECTION_GUARD_DISABLED=1`, `JAK_SHIELD_OFFENSIVE_GUARD_DISABLED=1` | Operator-only emergency overrides. Default is ON. |

**Tests:** `tests/unit/agents/injection-guard.test.ts` (22), `tests/unit/security/offensive-cyber-detector.test.ts` (46).

## Feature 2 — Risk-Based Approvals

Every tool call is classified before it runs. Risky calls pause the
workflow until a human decides.

| Capability | Where |
|---|---|
| Tool risk classes (READ_ONLY / WRITE / DESTRUCTIVE / EXTERNAL_SIDE_EFFECT) | `packages/shared/src/types/tool.ts` |
| 6-tier risk lattice (READ_ONLY → DRAFT_ONLY → SANDBOX_EDIT → LOCAL_EXEC_ALLOWLIST → EXTERNAL_ACTION_APPROVAL → CRITICAL_MANUAL_ONLY) | Same file (OpenClaw-inspired Phase 1) |
| Centralized policy classifier | `packages/tools/src/registry/approval-policy.ts` (`DefaultApprovalPolicy`) |
| Registry chokepoint that returns `outcome:'approval_required'` WITHOUT executing the tool | `packages/tools/src/registry/tool-registry.ts:288` |
| Approval persistence + payload hash binding (replay-safe) | `apps/api/src/services/workflow.service.ts` (`resolveApproval` writes `ApprovalScope`) |
| `ApprovalRequest` model + `proposedDataHash` | `packages/db/prisma/schema.prisma` |
| 409 `APPROVAL_PAYLOAD_MISMATCH` on replayed/modified payloads | `apps/api/src/routes/approvals.routes.ts` |

**Tests:** `tests/unit/swarm/approval-gate.test.ts` (6), approval-payload-binding integration (covered in approvals tests).

## Feature 3 — Secure Tool Permission Layer

Every tool declares what it does; the registry enforces the tenant's
allowlist on every call.

| Capability | Where |
|---|---|
| Per-tenant tool registry | `packages/tools/src/registry/tenant-tool-registry.ts` |
| Industry-pack restrictions | `packages/industry-packs/src/index.ts` |
| `requireRole('REVIEWER','TENANT_ADMIN','SYSTEM_ADMIN')` on installer execute | `apps/api/src/routes/tool-installer.routes.ts:117` |
| Workflow-scoped Standing Orders (allowed-tools whitelist + blocked-actions list + budget cap + expiry) | `packages/db/prisma/schema.prisma` `StandingOrder` model |
| Required-env-vars metadata so unconfigured tools fail loud | `packages/tools/src/builtin/index.ts` (every tool's `requiredEnvVars`) |

**Tests:** `tests/unit/tools/tool-manifest.test.ts`, `tests/unit/api/tool-installer.test.ts`.

## Feature 4 — Sandboxed Execution

| Capability | Where |
|---|---|
| Browser sessions in per-tenant data dirs | `packages/tools/src/browser-operator/playwright-browser-operator.ts:325` (`startSession`) |
| Per-tenant **disk quota** (default 500 MB) | Same file — `tenantQuotaBytes` option, `getTenantBytesSync` walker |
| URL allowlist (no localhost / RFC1918 / link-local / cloud-metadata / IPv6 link-local) | Same file — `defaultIsUrlAllowed` |
| **DNS-rebinding defense** — every navigation re-checks resolved IPs | Same file — `resolveAndCheckHost` + `context.route('**')` interceptor |
| `acceptDownloads: false` (no surprise file writes) | Same file — context options |
| Hard-delete session data dir on `endSession` (`rmSync` recursive force) | Same file |
| Idle-session sweep timer | Same file |
| Sandboxed installer subprocess (literal argv, never `shell:true`, 60s timeout, stripped env) | `packages/tools/src/installer/sandboxed-installer.ts` |
| Docker FS sandbox path-traversal guard (`..` and absolute paths blocked) | `packages/tools/src/adapters/sandbox/docker.adapter.ts:47` (`sanitizePath`) |
| Production-DB guard for HumanQA (refuses any test that points at supabase / aws / vercel / render / fly / upstash) | `tests/human-qa/assert-local-only.ts` |

**Tests:** `tests/unit/tools/browser-url-allowlist.test.ts` (46), `tests/unit/tools/dns-rebind-guard.test.ts` (8), `tests/unit/tools/assert-local-only.test.ts` (12), `tests/unit/api/sandboxed-installer.test.ts`.

## Feature 5 — Defensive Vulnerability Triage (boundary)

JAK Shield **supports** defensive security work — auditing repos,
finding vulnerable deps, scanning for exposed secrets, recommending
patches. The offensive boundary refuses to author exploits, malware,
phishing kits, or unauthorized scans.

The boundary is encoded in `offensive-cyber-detector.ts`'s
`DEFENSIVE_MARKERS` list — markers like `audit my repo`, `find CVEs`,
`harden auth`, `OWASP`, `SAST`, `dependency audit`, `generate unit
tests`, `authorized penetration test` — soften confidence on borderline
requests so legitimate security work passes.

A purpose-built defensive-review agent is **not yet implemented**. This
manifest entry covers only the boundary. The agent itself is on the
backlog. Honest framing: "JAK Shield supports defensive security work.
A first-party defensive-review agent is on the roadmap; today, defensive
work is unblocked but driven by the same general-purpose agents."

## Feature 6 — Audit Evidence Layer

Every workflow lifecycle event lands in `AuditLog`. Evidence packs are
HMAC-signed.

| Capability | Where |
|---|---|
| `AuditLog` Prisma model | `packages/db/prisma/schema.prisma` |
| `AuditLogger` service + auto-emit on every workflow lifecycle event | `apps/api/src/services/swarm-execution.service.ts:281` |
| `audit-log` Fastify plugin | `apps/api/src/plugins/audit-log.ts` |
| HMAC-SHA256 signed evidence bundles + verification | `apps/api/src/services/bundle.service.ts` + `bundle-signing.service.ts` |
| Browser-action audit emits | `playwright-browser-operator.ts` — `BROWSER_SESSION_STARTED`, `BROWSER_OBSERVED`, `BROWSER_PROPOSED`, `BROWSER_EXECUTED`, `BROWSER_SESSION_ENDED`, `BROWSER_TENANT_VIOLATION`, `BROWSER_REQUEST_BLOCKED`, `BROWSER_DNS_REBIND_BLOCKED`, `BROWSER_QUOTA_EXCEEDED` |
| Per-tenant retention sweep (auditor invites, AgentTrace) | `apps/api/src/services/retention-sweep.service.ts` |
| At-rest field encryption for `workflows.{goal,error,finalOutput,planJson,stateJson}` (AES-256-GCM, key from `JAK_FIELD_ENCRYPTION_KEY`) | `packages/security/src/encryption/field-cipher.ts` + `packages/db/src/extensions/workflow-encryption.ts` |
| One-way persistence redactor for AgentTrace JSON columns | `packages/security/src/guardrails/persistence-redactor.ts` |

**Tests:** `tests/unit/security/persistence-redactor.test.ts` (12), `tests/unit/security/field-cipher.test.ts` (21).

---

## Honest gaps (not claimed as shipped)

- **Tamper-evident audit log itself** — bundles are HMAC-signed, but
  the AuditLog table rows are not chain-hashed. A SYSTEM_ADMIN with
  DB access could rewrite a row. We document this here rather than
  claim "tamper-evident" across the board.
- **First-party defensive-review agent** — the boundary exists; the
  agent does not yet.
- **JAK Shield dashboard surface** — the audit log + approvals are
  visible at `/audit` and `/inbox` today; a dedicated "Shield" tab
  that aggregates risk score / blocked actions / pending approvals /
  vulnerability findings into one panel is on the roadmap.
- **Real CSP override** on the headless browser — we accept whatever
  CSP the visited page sets.
- **DNS-rebinding TOCTOU** — closed for navigation-class fetches; a
  determined attacker could still race image/script loads (low
  practical risk because images don't execute on the server).

## How to verify locally

```
pnpm test                          → 1500+ passing
cd tests && pnpm exec vitest run \
   unit/security/offensive-cyber-detector.test.ts \
   unit/agents/injection-guard.test.ts \
   unit/tools/browser-url-allowlist.test.ts \
   unit/tools/dns-rebind-guard.test.ts \
   unit/tools/assert-local-only.test.ts \
   unit/security/field-cipher.test.ts \
   unit/security/persistence-redactor.test.ts
```
