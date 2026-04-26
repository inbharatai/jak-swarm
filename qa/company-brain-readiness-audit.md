# Company Brain — readiness audit

The user's spec asked for a Company Brain: knowledge base ingestion (docs + URLs), company profile extraction with user approval, memory items, brand voice, agents grounded in company context. This document classifies what exists vs what would need to be built.

## Spec requirements

1. **Document ingestion** — upload PDFs / DOCXs / URLs, extract content into vector store.
2. **Company profile extraction** — auto-extract name, industry, brand voice, target customers, competitors, pricing from uploaded docs + URLs, with user approval before persisting.
3. **Memory items** — open-vocabulary scoped facts with `status: 'extracted' | 'suggested' | 'user_approved'`.
4. **Brand voice** — explicit field stored on company profile, injected into agent system prompts.
5. **Agents grounded in company context** — every agent's prompt carries brand voice + audience + competitors automatically.
6. **Onboarding wizard** — guided UX for first-time company setup.

## Per-item classification

### 1. Document ingestion

**Status: PARTIAL.** Foundation exists; URL ingestion is missing.

- ✅ `TenantDocument` Prisma model + upload endpoints (`/documents`)
- ✅ `VectorDocument` (pgvector) — chunked + embedded for semantic search
- ✅ `find_document` tool — agents search the vector store at runtime
- ❌ No URL crawler / fetcher — can only ingest uploaded files today
- ⚠️ DOCX/XLSX/image content parsing is `STORED_NOT_PARSED` — only text/PDF actually have content extracted

**Effort to close:** ~3 days for DOCX/XLSX parsing (mammoth + xlsx libs), ~3-5 days for URL crawler.

### 2. Company profile extraction

**Status: NOT BUILT.**

- No `CompanyProfile` Prisma model exists.
- No extraction service exists.
- No user-approval flow exists.

**Effort to build:** ~1-2 weeks. New Prisma model + extraction service (LLM-driven over uploaded docs) + approval-gated persistence + UI.

### 3. Memory items with approval status

**Status: PARTIAL.**

- ✅ `MemoryItem` model exists with open-vocabulary types (`FACT`, `PREFERENCE`, `CONTEXT`, `SKILL_RESULT`)
- ✅ `/knowledge` UI page — generic memory CRUD
- ❌ No `status: 'extracted' | 'suggested' | 'user_approved'` field — every memory is treated as user-validated
- ❌ No memory-suggestion-with-approval flow — agents can't propose memories for the user to confirm

**Effort to close:** ~2-3 days for the schema field + service updates + UI badge.

### 4. Brand voice field

**Status: NOT BUILT.** No CompanyProfile model, so no brand voice field.

**Effort:** rolled into item 2 (Company Profile build).

### 5. Agents grounded in company context

**Status: NOT BUILT.** Agents don't auto-load brand voice / audience / competitors.

- BaseAgent constructs system prompts from a static template + tool descriptions.
- There's no system-prompt-extension layer that injects company context.

**Effort:** ~1 week (after items 2 + 4 ship). BaseAgent extension + per-tier prompt injection.

### 6. Onboarding wizard

**Status: PARTIAL (different scope).**

- ✅ `/onboarding` page exists — asks for user job function + integrations
- ❌ Does NOT ask for company info (name, industry, brand voice, target customers)
- ❌ Does NOT trigger document upload + profile extraction

**Effort to close:** ~1 week. New wizard step + integration with the (not-yet-built) profile extraction service.

## Summary table

| Item | Status | Effort to close |
|---|---|---|
| 1. Document ingestion (PDF/text) | ✅ Real | — |
| 1. Document ingestion (DOCX/XLSX/image) | ❌ STORED_NOT_PARSED | ~3 days |
| 1. URL crawler | ❌ Not built | ~3-5 days |
| 2. CompanyProfile extraction | ❌ Not built | ~1-2 weeks |
| 3. MemoryItem + approval status | ⚠️ Partial | ~2-3 days |
| 4. Brand voice field | ❌ Not built (rolled into #2) | — |
| 5. Agents grounded in context | ❌ Not built | ~1 week (after #2) |
| 6. Onboarding wizard for company | ⚠️ Partial | ~1 week (after #2) |

**Total to ship the full Company Brain: ~3-4 weeks of focused engineering.**

## What we have today that's useful

- `MemoryItem` + `TenantDocument` + `VectorDocument` are real, in production, and used by agents at runtime via the `find_document` tool.
- The vector store is real pgvector — semantic search works against any uploaded document.
- The cost model is honest: every embedding + LLM extraction run will be billed via the existing usage ledger.

## Honesty notes

- This document does not claim Company Brain is "in flight." It is not started.
- The existing knowledge primitives are genuinely useful even without the full Brain — they just don't auto-propose facts or ground every agent prompt yet.
- The deferral order matters: ship Document parsing improvements first (3 days, low risk), then CompanyProfile model (2 weeks, the big one), then context auto-injection (1 week), then onboarding wizard (1 week). That sequence ships value at each stage without big-bang releases.
