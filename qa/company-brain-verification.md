# Company Brain — verification (commit 769e358 baseline)

The user's spec asks for a Company Brain that lets the user upload company context (docs + URLs), auto-extracts a `CompanyProfile`, gates on user approval, and grounds every agent's prompt in that approved context.

## Per-surface verdict

| Surface | Status | Evidence | Effort to close |
|---|---|---|---|
| **A. Document ingestion (PDF + plain text)** | REAL | `TenantDocument` model ([schema.prisma:475](../packages/db/prisma/schema.prisma)) + `VectorDocument` (pgvector, lines 437-463) + `POST /documents/upload` ([documents.routes.ts:57-180](../apps/api/src/routes/documents.routes.ts)) + `find_document` tool in [packages/tools/src/builtin/](../packages/tools/src/builtin/) | — |
| **A. Document ingestion (DOCX/XLSX/image)** | PARTIAL | Code path exists at [documents.routes.ts:336-374](../apps/api/src/routes/documents.routes.ts) but office docs flip to `STORED_NOT_PARSED` instead of extracting content (honest, not faked) | ~3 days (mammoth + xlsx-write-only via exceljs + tesseract) |
| **B. URL crawler / website ingestion** | NOT BUILT | 0 matches in codebase for crawler / URL fetcher service | ~3-5 days |
| **C. CompanyProfile extraction** | NOT BUILT | No `CompanyProfile` Prisma model. No extraction service. No approval flow. | ~1-2 weeks |
| **D. MemoryItem with approval status** | PARTIAL | `MemoryItem` model exists ([schema.prisma:383-412](../packages/db/prisma/schema.prisma)) with open-vocabulary types (FACT/PREFERENCE/CONTEXT/SKILL_RESULT). **No `status` field** — every memory is treated as user-validated; agents cannot propose memories for approval. | ~2-3 days |
| **E. Brand voice field** | NOT BUILT | Depends on (C). `brand_voice_check` is **declared** in `content.agent.ts` tool list but the tool handler is not implemented in `packages/tools/src/builtin/` — would surface as `ToolOutcome.failed` "tool not found" if invoked. | Rolled into (C) |
| **F. Agents grounded in company context** | NOT BUILT | `BaseAgent` ([base-agent.ts](../packages/agents/src/base/base-agent.ts)) constructs system prompts from a static template + tool descriptions. There is NO code path that auto-loads CompanyProfile / brand voice / target audience and injects it into the prompt. | ~1 week (after C+D ship) |
| **G. Onboarding wizard for company setup** | PARTIAL (different scope) | [/onboarding](../apps/web/src/app/(auth)/onboarding/page.tsx) page asks for user job function (CEO/CTO/CMO/etc.) + integration setup (Gmail/Slack/GitHub/GCal). **Does NOT** ask for company name/industry/brand voice/target customers, does NOT trigger document upload, does NOT trigger profile extraction. | ~1 week (after C) |

## Useful primitives that DO exist

- `TenantDocument` + `VectorDocument` (pgvector) — semantic search on uploaded files works at runtime via the `find_document` tool. Tenant-scoped, documented in [tests/unit/api/documents-upload.test.ts](../tests/unit/api/documents-upload.test.ts) (6 tests passing — verifies tenant isolation).
- `MemoryItem` — generic memory CRUD over scoped facts. Works, exposed at `/memory` route.
- `Knowledge` page in the dashboard — lets users CRUD memory items by hand.
- File upload + virus-safe storage on Supabase — tested.

## Spec features that are MISSING

The spec asks Company Brain to support / store:

- ❌ company name (no field anywhere)
- ❌ business description (no field)
- ❌ products/services list (no field)
- ❌ target customers (no field)
- ❌ brand tone (no field — just declared in `content.agent.ts` schema)
- ❌ pricing (no field)
- ❌ competitors (no field)
- ❌ website pages indexed (no crawler)
- ✅ uploaded files (TenantDocument)
- ✅ key documents (TenantDocument with tags)
- ❌ goals (no field — could shoehorn into MemoryItem of type 'CONTEXT')
- ❌ constraints (no field — same)
- ❌ compliance requirements (lives in `ScheduledAttestation` model + AuditRun, not Brain)
- ❌ preferred channels (no field)
- ❌ previous outputs (no aggregation)
- ❌ reusable context (no aggregation)
- ❌ approved company memory (no `status` field on MemoryItem)

The spec asks for an ingestion flow:
1. ✅ user uploads docs (works)
2. ❌ JAK extracts company profile (no extraction service)
3. ❌ JAK shows what it learned (no UI)
4. ❌ user approves/edits/corrects (no approval flow)
5. ❌ agents use approved context (no auto-injection in BaseAgent)
6. ❌ new approved outputs become memory (no suggestion-and-approval flow)

The spec asks for a Company Brain UI showing:
- ❌ uploaded sources (only inside Knowledge page; no Brain-specific view)
- ❌ indexed URLs/pages (no crawler)
- ❌ extracted company profile (no profile)
- ❌ brand voice (no field)
- ❌ products/services (no field)
- ❌ target audience (no field)
- ❌ competitors (no field)
- ❌ compliance needs (lives in audit pack, not Brain)
- ❌ confidence level (no extraction → no confidence)
- ❌ missing information (no profile → no missing-info diff)
- ❌ approval status (no approval flow)

## Honest summary

The Company Brain product is **NOT BUILT**. The foundational knowledge primitives (`TenantDocument`, `VectorDocument`, `MemoryItem`) exist and are useful, but the full Brain (CompanyProfile + extraction + approval + agent grounding + onboarding wizard) is not started. This was documented as deferred in [qa/company-brain-readiness-audit.md](company-brain-readiness-audit.md) (~3-4 weeks of focused engineering) and is reaffirmed here.

**No part of the codebase falsely claims a Company Brain exists.** No agent prompt currently mentions "your company brand voice is X". No UI surface labeled "Company Brain" exists. The honest absence is preserved.

## Verdict: NOT_BUILT (foundational primitives only — flagged honestly)

To ship the full Brain end-to-end:
1. **Phase 1** (~3 days): DOCX/XLSX/image content extraction + URL crawler service.
2. **Phase 2** (~1-2 weeks): `CompanyProfile` Prisma model + LLM-driven extraction service over uploaded docs + approval-gated persistence + Brain UI.
3. **Phase 3** (~2-3 days): `MemoryItem.status` field (`extracted | suggested | user_approved`) + agent suggestion flow + approval UI.
4. **Phase 4** (~1 week): BaseAgent system-prompt extension that loads approved CompanyProfile + injects into every agent's prompt at construction time.
5. **Phase 5** (~1 week): Onboarding wizard step that asks for company info + triggers document upload + shows extracted profile for approval.

**Total: ~3-4 weeks** to bring the Company Brain to production.
