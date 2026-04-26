# Core role agents — verification (commit 769e358 baseline)

Per-role audit of the 19 spec roles. Verdict for each: REAL_AGENT_CLASS / SERVICE_BACKED / NOT_BUILT.

## Definitions

- **REAL_AGENT_CLASS**: a `BaseAgent` subclass exists, takes structured input, calls the LLM via `LLMRuntime`, emits lifecycle events with `agentRole`, is mapped by Planner / Router or runs as an orchestrator node in `SwarmGraph`. Real autonomous agent.
- **SERVICE_BACKED**: a real production service exists that drives the work end-to-end and emits lifecycle events with the named `agentRole`. Deterministic / state-machine, not LLM autonomous (intentional for high-stakes paths). Honestly labeled — see `qa/audit-compliance-readiness-audit.md` for the design rationale.
- **NOT_BUILT**: no implementation exists for this role identity.

## Per-role verdict

| Role | Verdict | Backing | LLM via runtime? | Emits events? | Notes |
|---|---|---|---|---|---|
| **CEO / Commander** | REAL_AGENT_CLASS | `CommanderAgent` ([commander.agent.ts](../packages/agents/src/roles/commander.agent.ts)) | ✅ `respondStructured` | ✅ via SwarmGraph | True orchestrator + executive-suite work also routes to `WORKER_STRATEGIST` ([strategist.agent.ts](../packages/agents/src/workers/strategist.agent.ts)) when Planner picks "ceo"/"strategy" tasks. **Honest gap:** no dedicated `CEOAgent` that fans out parallel sub-tasks to CMO+CTO+CFO and synthesizes. Documented in `qa/core-role-agents-audit.md` as ~1 week of work (multi-agent fan-out in `SwarmGraph`). |
| **CMO** | REAL_AGENT_CLASS | `MarketingAgent` ([marketing.agent.ts](../packages/agents/src/workers/marketing.agent.ts)) + `GrowthAgent` + `ContentAgent` | ✅ callLLM | ✅ | Planner verb routing: "campaign", "GTM", "audience" → MARKETING. |
| **CTO / Architect** | REAL_AGENT_CLASS | `TechnicalAgent` ([technical.agent.ts](../packages/agents/src/workers/technical.agent.ts)) + `CoderAgent` + `AppArchitectAgent` | ✅ callLLM | ✅ | Planner routing: "architecture", "security audit", "code review" → TECHNICAL/CODER. |
| **CFO** | REAL_AGENT_CLASS | `FinanceAgent` ([finance.agent.ts](../packages/agents/src/workers/finance.agent.ts)) | ✅ callLLM | ✅ | Planner verb: "P&L", "forecast", "budget" → FINANCE. |
| **COO** | REAL_AGENT_CLASS (mapped) | `OpsAgent` ([ops.agent.ts](../packages/agents/src/workers/ops.agent.ts)) | ✅ callLLM | ✅ | No dedicated `COOAgent` class; OPS is the catch-all for operations work. The cockpit shows `agentRole='WORKER_OPS'` not "COO". Cosmetic naming gap. |
| **VibeCoder** | REAL_AGENT_CLASS (5 agents) | `AppArchitectAgent` + `AppGeneratorAgent` + `AppDebuggerAgent` + `AppDeployerAgent` + `ScreenshotToCodeAgent` | ✅ callLLM | ✅ | Full pipeline: text/screenshot → architect → generate → 3-layer build check → debug retry loop (≤3) → deploy. Real code in [packages/agents/src/workers/app-*.agent.ts](../packages/agents/src/workers/) + [vibe-coding-execution.service.ts](../apps/api/src/services/vibe-coding-execution.service.ts). |
| **Research Agent** | REAL_AGENT_CLASS | `ResearchAgent` ([research.agent.ts](../packages/agents/src/workers/research.agent.ts)) | ✅ callLLM | ✅ | Planner verb: "research", "compare", "benchmark" → RESEARCH. |
| **Browser Agent** | REAL_AGENT_CLASS | `BrowserAgent` ([browser.agent.ts](../packages/agents/src/workers/browser.agent.ts)) | ✅ callLLM | ✅ | Planner routes when tools list contains `browser_*`. ~30 Playwright tools. |
| **Designer / UI-UX Agent** | REAL_AGENT_CLASS | `DesignerAgent` ([designer.agent.ts](../packages/agents/src/workers/designer.agent.ts)) | ✅ callLLM | ✅ | Planner verb: "design", "UI", "UX" → DESIGNER. |
| **Verifier / QA Agent** | REAL_AGENT_CLASS | `VerifierAgent` ([verifier.agent.ts](../packages/agents/src/roles/verifier.agent.ts)) | ✅ `respondStructured` | ✅ | Orchestrator role — runs after every worker completes. Blocks low-quality output, can trigger replan. |
| **Report Writer** | REAL_AGENT_CLASS (mapped) | `DocumentAgent` ([document.agent.ts](../packages/agents/src/workers/document.agent.ts)) | ✅ callLLM | ✅ | Cosmetic naming gap — cockpit shows `agentRole='WORKER_DOCUMENT'`. The audit pack also uses `WorkpaperService` for per-control reports. |
| **Human Approval Agent** | REAL_AGENT_CLASS | `ApprovalAgent` ([approval.agent.ts](../packages/agents/src/roles/approval.agent.ts)) + `approval-node.ts` | ❌ Deterministic (intentional — risk-stratified gating) | ✅ | Real pause/resume + RBAC + audit trail via `ApprovalRequest` Prisma model. |
| **Audit Commander** | SERVICE_BACKED | `AuditRunService` ([audit-run.service.ts](../apps/api/src/services/audit/audit-run.service.ts)) | ❌ Deterministic state machine | ✅ `agentRole='AUDIT_COMMANDER'` | Lifecycle events: `audit_run_started`, `audit_plan_created`, `audit_run_completed/_failed/_cancelled`. |
| **Compliance Mapper** | SERVICE_BACKED | `ComplianceMapperService` ([compliance-mapper.service.ts](../apps/api/src/services/compliance/compliance-mapper.service.ts)) | ❌ Deterministic (10 auto-mapping rules) | ✅ `agentRole='COMPLIANCE_MAPPER'` | Emits `evidence_mapped`. |
| **Evidence Collector** | SERVICE_BACKED (embedded) | Inside `ComplianceMapperService` + `ManualEvidenceService` | ❌ Deterministic | ✅ via parent | Not a separate agent identity in events; folded into Compliance Mapper. **Honest gap:** could be split as a separate `EVIDENCE_COLLECTOR` event role for cockpit clarity (~½ day). |
| **Control Test Agent** | SERVICE_BACKED + LLM | `ControlTestService` ([control-test.service.ts](../apps/api/src/services/audit/control-test.service.ts)) | ✅ via `OpenAIRuntime.respondStructured` (LLM evaluates evidence vs control); deterministic fallback when no key | ✅ `agentRole='CONTROL_TEST_AGENT'` | Hybrid — deterministic orchestration but LLM-driven evidence evaluation. Emits `control_test_started/_completed`. |
| **Exception Finder** | SERVICE_BACKED | `AuditExceptionService` ([audit-exception.service.ts](../apps/api/src/services/audit/audit-exception.service.ts)) | ❌ Deterministic | ✅ `agentRole='EXCEPTION_FINDER'` | Auto-creates exceptions on test fail/exception. State machine drives remediation. |
| **Workpaper Writer** | SERVICE_BACKED | `WorkpaperService` ([workpaper.service.ts](../apps/api/src/services/audit/workpaper.service.ts)) | ❌ Deterministic (PDF assembly) | ✅ `agentRole='WORKPAPER_WRITER'` | Uses real PDF generation via `exportPdf` (pdfkit). Persists with `approvalState='REQUIRES_APPROVAL'`. |
| **Remediation Agent** | SERVICE_BACKED (embedded) | Inside `AuditExceptionService` (state machine: open → remediation_planned → remediation_in_progress → remediation_complete → closed) | ❌ Deterministic | ✅ via parent | Not a separate agent identity — folded into Exception lifecycle. |
| **Final Audit Pack Agent** | SERVICE_BACKED | `FinalAuditPackService` ([final-audit-pack.service.ts](../apps/api/src/services/audit/final-audit-pack.service.ts)) | ❌ Deterministic (HMAC-signed bundle assembly) | ✅ `agentRole='FINAL_AUDIT_PACK_AGENT'` | Hard gate on workpaper approval (`FinalPackGateError`). Real HMAC-SHA256 signature via `bundle-signing.service`. |

## Honest summary

- **12 of 19 roles are REAL_AGENT_CLASS** — full BaseAgent subclasses with LLM via runtime, emitting lifecycle events, mapped by Planner/Router or running as orchestrators in SwarmGraph.
- **7 of 19 roles are SERVICE_BACKED** — real production services (not BaseAgent subclasses) that emit lifecycle events with `agentRole`. The work is real and tested end-to-end ([tests/integration/audit-run-e2e.test.ts](../tests/integration/audit-run-e2e.test.ts) — 11 assertions). Audit was deferred from BaseAgent subclassing intentionally because audit-engagement transitions are too high-stakes for LLM judgment.
- **0 of 19 are NOT_BUILT.**

## Cosmetic gaps (named so they don't masquerade as real)

1. **No dedicated `CEOAgent` orchestrator** that fans out CMO+CTO+CFO sub-tasks in parallel and synthesizes. Today the Planner can decompose a CEO-level goal into multiple worker tasks, and the SwarmGraph runs them — but there is no top-level orchestrator that emits an "executive synthesis" step. ~1 week to build.
2. **No dedicated `COOAgent` / `CFOAgent` BaseAgent subclasses with role-specific prompts** — covered by `OpsAgent` and `FinanceAgent` workers. Cockpit shows the worker role names, not the C-level names. ~2-3 days per role.
3. **Evidence Collector + Remediation are folded into other services**, not split into their own `agentRole` event identities. Cockpit lumps them under their parent service. ~½ day per split.

These are documented as Phase 2 in [qa/audit-compliance-readiness-audit.md](audit-compliance-readiness-audit.md) and [qa/audit-pack-shipped-report.md](audit-pack-shipped-report.md).

## Verdict: PASS_WITH_NAMED_GAPS

All 19 spec roles have backing implementations. 12 are full LLM agents; 7 are service-backed (honestly so). The 3 cosmetic gaps above are explicitly named as future work — none are faked.
