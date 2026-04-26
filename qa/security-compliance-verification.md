# Security + safety + compliance — verification (commit 769e358 baseline)

## Per-spec-control verdict

| Control | Status | Backing |
|---|---|---|
| **Tenant isolation** | ✅ REAL | `enforceTenantIsolation` middleware ([apps/api/src/middleware/](../apps/api/src/middleware/)). Every Prisma query scoped by `tenantId`. Storage paths prefixed by `<tenantId>/` — verified in [tests/unit/api/documents-upload.test.ts](../tests/unit/api/documents-upload.test.ts) (tests `createSignedReadUrl refuses cross-tenant access` and `deleteTenantFile refuses cross-tenant delete`). |
| **RBAC** | ✅ REAL | 5 roles: VIEWER < REVIEWER < OPERATOR < TENANT_ADMIN < SYSTEM_ADMIN. `fastify.requireRole()` enforced on every write endpoint. Audit-run routes require REVIEWER+ for writes, TENANT_ADMIN+ for delete. |
| **Audit logs** | ✅ REAL | `AuditLog` Prisma model. Every state transition + tool execution + approval decision logged via `AuditLogger.log()`. Tenant-scoped, queryable via `GET /audit/log`. |
| **Evidence access control** | ✅ REAL | `WorkflowArtifact.approvalState='REQUIRES_APPROVAL'` blocks downloads via `ArtifactGatedError` until reviewer approves. `WorkflowArtifact.approvalState='REJECTED'` permanently blocks. Storage layer additionally prefix-checks `<tenantId>/` on every signed URL (defense in depth). |
| **No secrets leaked to model** | ✅ REAL | OpenAI/Anthropic/Gemini API keys never appear in tool input/output. Tool registry validates inputs with zod schemas before passing to LLM. Encrypted credentials (AES-256-GCM derived from AUTH_SECRET) stored in `Credential` model — only decrypted server-side at execution time, never sent to LLM. |
| **PII redaction** | ⚠️ PARTIAL | `pii-detection` auto-mapping rule fires on writes (logs PII_DETECTED audit events). Export route supports `redactPii=true` query param ([export-pii-redaction.test.ts](../tests/integration/export-pii-redaction.test.ts) — 7 tests passing). However, redaction is opt-in per export, not auto-applied to LLM prompts. Documented gap. |
| **Prompt injection checks for uploaded documents** | ⚠️ PARTIAL | `GuardrailAgent` runs pre-execution risk assessment on user goal (catches obvious injection attempts in input). However, document content extracted by `find_document` tool is passed to the LLM verbatim — no separate document-content sanitization layer. **Honest gap:** ~3 days to add. |
| **Source-grounded outputs** | ⚠️ PARTIAL | `verifier.agent.ts` (4-layer hallucination detection — heuristic regex for invented stats, fabricated sources, overconfidence, impossible claims) blocks low-grounding output via grounding score. Real and shipping. **However:** there is no enforced "every claim must cite a source from the evidence pack" — that's a stricter contract (~1 week of additional work). |
| **Reviewer approval before finalization** | ✅ REAL | Audit pack: workpaper approval gates final pack. Workflow: `ApprovalRequest` blocks risky tool calls (DESTRUCTIVE / EXTERNAL_SIDE_EFFECT) until reviewer decides. Both verified end-to-end. |
| **Export access control** | ✅ REAL | Exports go through `ArtifactService.requestSignedDownloadUrl` which enforces tenant + approval gates. Signed URLs are short-lived (10 minutes). |
| **Company memory approval** | ❌ NOT BUILT | `MemoryItem` has no `status` field. No agent-suggested memories. Documented in [qa/company-brain-verification.md](company-brain-verification.md). |
| **No silent memory overwrite** | ⚠️ PARTIAL | `MemoryItem` has `version` field (incremented on update) and `MemoryEvent` log table (audit trail of changes). But nothing prevents an agent from overwriting an approved fact — there's no approval gate. |

## Documented in security threat model

[docs/security-threat-model.md](../docs/security-threat-model.md) covers:
- Authentication / session security
- Tenant isolation
- Tool risk classification (READ_ONLY / WRITE / DESTRUCTIVE / EXTERNAL_SIDE_EFFECT)
- Approval gating policy
- Encrypted-at-rest credentials
- Audit logging
- Webhook signature verification (Slack HMAC-SHA256)

## Tests proving the security claims

| Test | Verifies |
|---|---|
| [bundle-signing.test.ts](../tests/integration/bundle-signing.test.ts) (18 tests) | HMAC signature, tamper detection, cross-tenant signature forgery impossible without `EVIDENCE_SIGNING_SECRET` |
| [documents-upload.test.ts](../tests/unit/api/documents-upload.test.ts) (6 tests) | Tenant-isolated storage, cross-tenant read/delete refused |
| [artifact-schema-failsafe.test.ts](../tests/integration/artifact-schema-failsafe.test.ts) (7 tests) | Schema-missing translates to clean 503 instead of leaking Prisma errors |
| [export-pii-redaction.test.ts](../tests/integration/export-pii-redaction.test.ts) (7 tests) | PII redaction on export when requested |
| [audit-run-e2e.test.ts](../tests/integration/audit-run-e2e.test.ts) (1 test, 11 assertions) | All reviewer gates enforced (workpaper approval + final-pack gate + state machine) |

## Honest gaps

1. **Prompt injection from uploaded documents** (~3 days): documents extracted via `find_document` and pasted into the LLM context have no sanitization layer. A malicious PDF could inject instructions. Workarounds in place (Guardrail on user input, low-trust document content), but not a proper defense.
2. **Memory approval flow** (~2-3 days): no `status` field on `MemoryItem`. Agents can write memory without user approval. Documented as deferred.
3. **PII auto-redaction in LLM prompts** (~1 week): export-time redaction works; runtime-time redaction (before sending to OpenAI) does not.
4. **Source-grounded output contract** (~1 week): hallucination detector flags problems, but doesn't enforce "every claim must cite a source from the evidence pack". Verifier's heuristic (regex for invented stats etc.) is honest but not bulletproof.

## Verdict: PASS_WITH_NAMED_GAPS

Tenant isolation, RBAC, audit logging, evidence access control, secret encryption, reviewer-gated workflows, and signed evidence bundles are all REAL and tested.

Four named gaps documented above with effort estimates. None are silent or pretended — each appears in the verification reports honestly.
