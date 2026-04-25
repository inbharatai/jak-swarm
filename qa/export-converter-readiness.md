# Export converter readiness

**Date:** 2026-04-25
**Verdict:** **READY** — all 5 formats produce real, verified file bytes. 15/15 tests pass.

## Per-format status

| Format | Library | Status | Magic-byte verified | Tests |
|---|---|---|---|---|
| JSON | built-in | READY | n/a (text) | round-trip parse |
| CSV | built-in | READY | n/a (text) | RFC-4180 quoting + empty rows |
| XLSX | `xlsx` (SheetJS) | READY | `PK\x03\x04` (ZIP) | non-empty + header-only |
| PDF | `pdfkit` | READY | `%PDF-` | non-empty with sections + bullets |
| DOCX | `docx` | READY | `PK\x03\x04` (ZIP) | non-empty with headings + bullets |

## Five export "kinds" (real implementations)

| Kind | Implemented | Source |
|---|---|---|
| `workflow_report` | YES | `apps/api/src/services/export.service.ts` `buildConverterInput` |
| `audit_evidence_index` | YES | same |
| `control_matrix` | YES | same |
| `workpaper` | YES | same |
| `audit_pack` | YES | same |

## Honesty rules enforced

- ✅ Every successful export creates a real `WorkflowArtifact` row with `status='READY'` and real file bytes (inline ≤256KB, otherwise Supabase Storage).
- ✅ Every failed export creates a real `WorkflowArtifact` row with `status='FAILED'` and `error` populated. The cockpit can render the failure honestly.
- ✅ Tenant isolation enforced at 3 layers (route → service → storage prefix).
- ✅ `markFinal=true` exports get `approvalState='REQUIRES_APPROVAL'` — download blocked until reviewer approves.
- ✅ File-name sanitisation strips `<>?|"*` and path-traversal sequences.
- ✅ NO format silently produces fake bytes — converter throws → row is FAILED, not faked.
- ✅ Export failure visible in cockpit/events (the artifact creation goes through the standard audit log path).

## Routes shipped

- `POST /workflows/:workflowId/export` — kicks off an export. See `docs/export-system.md` for body shape.
- Downloads via `POST /artifacts/:id/download` (existing artifacts route) respect the approval gate.

## Coverage by tests

- `tests/integration/exporters.test.ts` — 15 tests covering all 5 formats:
  - Real bytes (non-zero)
  - Magic bytes match (PDF / DOCX / XLSX)
  - Round-trip (JSON parses back correctly)
  - CSV quoting (commas, quotes, newlines)
  - Empty-row edge cases
  - Dispatcher input-shape validation
  - File-name sanitisation

## Known gaps (roadmap, not blockers)

| Gap | Why deferred |
|---|---|
| OCR for image attachments embedded in exports | Out of scope for v1; an evidence-handling roadmap item |
| Custom branding (header/footer logo, watermark) per tenant | Phase 2 product feature |
| Streaming export for very large datasets | All current exports fit comfortably under 100MB |
| Compressed bundle (ZIP of multiple artefacts) | Single-artifact downloads work; ZIP is composition over them |
| Internationalised characters in file names beyond ASCII | Sanitiser is intentionally tight; widen later if customer reports issue |
