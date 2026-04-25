# Export system

## Overview

The export system turns a workflow's data into customer-deliverable file artefacts. Five formats are supported:

| Format | Library | Use case |
|---|---|---|
| `json` | built-in | Machine-readable audit packs, API integrations |
| `csv` | built-in (RFC 4180-ish quoting) | Tabular evidence indexes, control matrices, spreadsheet imports |
| `xlsx` | [`xlsx`](https://www.npmjs.com/package/xlsx) (SheetJS) | Excel-friendly evidence tables |
| `pdf` | [`pdfkit`](https://www.npmjs.com/package/pdfkit) | Workflow reports, workpapers, signed final outputs |
| `docx` | [`docx`](https://www.npmjs.com/package/docx) | Editable workpapers, customer-deliverable narrative reports |

PDF rendering uses **server-side PDFKit** — no Chromium / Puppeteer dependency. Total added node_modules footprint is ≈4MB.

## Five export "kinds"

Each kind knows how to map a workflow into the right document/data shape.

| Kind | Best formats | Description |
|---|---|---|
| `workflow_report` | `pdf`, `docx`, `json` | Plain-prose summary of plan + final output + cost. The default deliverable for a customer-facing workflow result. |
| `audit_evidence_index` | `csv`, `xlsx` | One row per artifact: id, type, file, size, hash, approval state. The "index card" for an audit pack. |
| `control_matrix` | `csv`, `xlsx` | One row per task: agent, risk level, requires-approval flag, status. Maps tasks → controls. |
| `workpaper` | `pdf`, `docx` | Workflow report PLUS per-step trace summary + per-approval log. Compliance workpaper format. |
| `audit_pack` | `json` | Full JSON dump of workflow + traces + approvals + artifacts. The machine-readable counterpart to `workpaper`. |

Format mismatches (e.g. `audit_evidence_index` requested as `pdf`) are accepted — the dispatcher falls back to a sensible representation (a table-as-prose for tabular kinds rendered as PDF).

## Producing an export

`POST /workflows/:workflowId/export`

```json
{
  "kind": "workflow_report",
  "format": "pdf",
  "markFinal": false
}
```

Response:

```json
{
  "data": {
    "artifactId": "art_abcdef123",
    "status": "READY",
    "approvalState": "NOT_REQUIRED",
    "fileName": "workflow_report-12345678-DRAFT.pdf",
    "sizeBytes": 4317
  }
}
```

The artifact is downloadable via `POST /artifacts/:id/download` (returns a signed Supabase Storage URL valid for 10 minutes).

## `markFinal` semantics

- **`markFinal=false` (default)** — the artifact is a draft. File name carries `-DRAFT` suffix. `approvalState='NOT_REQUIRED'` — anyone in the tenant can download.
- **`markFinal=true`** — binding artefact. File name has no `-DRAFT` suffix. `approvalState='REQUIRES_APPROVAL'`. Download is blocked until a reviewer (`REVIEWER+` role) approves via `POST /artifacts/:id/approve`. Until then, download requests return HTTP 403 with code `ARTIFACT_GATED_REQUIRES_APPROVAL`.

This is the compliance gate — final exports cannot leave the system without a recorded human decision.

## Failure handling

When a converter throws (bad input shape, OOM, library bug), the export route does NOT return a generic 500. Instead:

1. A `WorkflowArtifact` row is created with `status='FAILED'` and `error` populated.
2. The route returns 200 with `{status: 'FAILED', error: '...'}` so the cockpit can render the failure honestly.
3. The audit log records the attempt + failure.

The user sees a red-flagged row in the artifacts list with the converter error — never silently dropped.

## Tenant isolation

Three layers:

1. **Route layer** — `request.user.tenantId` scopes every query.
2. **Service layer** — `ExportService.export` validates the workflow belongs to the requesting tenant before any data is read.
3. **Storage layer** — every artifact's storage key is prefixed `<tenantId>/<workflowId>/<contentHash>.<ext>`. The Supabase service-role client refuses cross-tenant writes via the prefix invariant.

## When to use which format

| Goal | Best fit |
|---|---|
| Customer-deliverable narrative report | `workflow_report` + `pdf` (locked) or `docx` (editable) |
| Machine-readable evidence dump | `audit_pack` + `json` |
| Spreadsheet of all artefacts in an audit | `audit_evidence_index` + `xlsx` |
| Compliance workpaper for a reviewer | `workpaper` + `docx` |
| Quick CSV of task statuses for stakeholder | `control_matrix` + `csv` |

## Limits

- Inline content cap: **256 KB**. Larger artefacts go to Supabase Storage.
- Total artifact cap: **100 MB**. Reject larger to keep the system responsive; raise the limit only after profiling.
- File-name sanitisation: only `[a-zA-Z0-9._-]` allowed; ≤80 chars after stripping. Path traversal (`../`) is structurally impossible.

## Tests

- `tests/integration/exporters.test.ts` — 15 tests covering all 5 formats, including magic-byte verification (PDF `%PDF-`, XLSX/DOCX `PK\x03\x04`).
- File-name sanitisation test confirms `<>?|"*` and `../` are stripped.
