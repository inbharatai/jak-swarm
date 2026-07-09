# JAK Swarm Beta Release 0.1.0-beta.0

Date: 12 May 2026
Last verification update: 20 May 2026

Status: beta release candidate for self-hosted users and design partners. This is not an enterprise-SLA release.

## Honest Rating

Current local production-readiness rating: **8.5 / 10**.

That rating means the core architecture is now credible enough for controlled beta validation, but not yet ready for unqualified public/enterprise promises. The score depends on local verification only; hosted Cloud Run / Railway health, live credentials, model access, migrations, queues, and external connector accounts must still be verified in the target environment.

## What Is In Scope

- Two first-class LLM providers with per-tenant switching — OpenAI (GPT-5.5/5.4) and Gemini (2.5 Pro/Flash/Flash-Lite), selected per tenant from the Settings UI.
- LangGraph-backed workflow runtime with Postgres checkpointing.
- JAK Shield gateway — a separate MCP-native 10-stage security gateway ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)) that JAK Swarm calls for signed security decisions on high-risk actions. Local policy enforcement (injection detection, PII redaction, RBAC, audit logging) runs inside Swarm via `packages/security`.
- Risk-tiered tool execution and human approval pause semantics.
- Audit logs, traces, signed evidence bundles, and encrypted workflow fields.
- Standing Orders UI/API flow with create, edit, disable, and delete coverage.
- Document route ownership checks and shield-gated document ingestion.
- Team, inbox, approvals, trial caps, integrations registry, and dashboard surfaces for beta validation.

## What Is Not Yet Enterprise-Ready

- No third-party SOC 2, HIPAA, ISO 27001, or penetration-test attestation.
- No lawyer-reviewed Terms of Service, Privacy Policy, DPA, or incident-response operating model.
- Hosted beta deployment still needs end-to-end smoke verification before inviting users.
- Some OpenAI call sites still use chat-compatible OpenAI paths during the Responses API migration.
- External connector readiness depends on real provider credentials and provider-side permissions.
- AuditLog rows are not chain-hashed yet; evidence bundles are signed, but row-level tamper evidence still needs hardening.
- Skipped and todo tests remain, so the current suite is strong but not a final release gate.

## Local Verification Evidence

- `pnpm --filter @jak-swarm/security typecheck`
- `pnpm --filter @jak-swarm/tools typecheck`
- `pnpm --filter @jak-swarm/agents typecheck`
- `pnpm --filter @jak-swarm/api typecheck`
- `pnpm --filter @jak-swarm/web typecheck`
- `pnpm --filter @jak-swarm/shared typecheck`
- `pnpm --filter @jak-swarm/db typecheck`
- `pnpm --filter @jak-swarm/swarm exec tsc --noEmit`
- `pnpm --filter @jak-swarm/tests test`: 2200+ blocking CI (unit + integration), 101 skipped locally (integration tests run in CI with Postgres), 54 todo; full local suite reports 2,160+ including `check:truth` documentation validation. Badge uses a floor count so it stays honest without drifting on every test addition.
- `PWHEADLESS=1 E2E_START_API=1 pnpm --filter @jak-swarm/tests run test:e2e -- standing-orders.spec.ts --project=chromium-desktop`: 3 passed.
- `PWHEADLESS=1 pnpm --filter @jak-swarm/tests run test:e2e -- human-qa-landing.spec.ts --project=chromium-desktop`: passed.
- `PWHEADLESS=1 pnpm --filter @jak-swarm/tests run test:e2e -- human-qa-dashboard.spec.ts --project=chromium-desktop`: 31 dashboard `page.tsx` routes exist under `apps/web/src/app/(dashboard)/`; the local Playwright sweep covers the core flows. (An earlier sweep covered 10 — the dashboard has since grown to 31 routes.)

## Hosted Beta Go/No-Go Checklist

- [ ] Verify Vercel frontend build and runtime environment.
- [ ] Verify Railway API and worker boot from clean deploys.
- [ ] Run database migration status against the target database.
- [ ] Verify Redis/queue connectivity and worker consumption.
- [ ] Verify `OPENAI_API_KEY` and target OpenAI model access in the deployed environment.
- [ ] Smoke-test auth, tenant creation, workflow start, workflow polling, traces, and final output.
- [ ] Smoke-test approval create, approve, reject, and resume paths with real persisted state.
- [ ] Smoke-test document upload, parse, safety gate, and report generation.
- [ ] Smoke-test at least one real external connector with a real credential.
- [ ] Confirm logs redact secrets and PII before external beta users.
- [ ] Confirm backup/restore and incident-response procedures.

## Release Positioning

Use "beta", "design partner", or "self-hosted validation" language. Do not claim enterprise-ready, certified, fully compliant, SOC 2-ready, HIPAA-ready, or production SLA until the missing operational and legal gates are complete.
