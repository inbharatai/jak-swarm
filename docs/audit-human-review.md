# Audit human-in-the-loop review

The audit pack has three explicit human review surfaces. None of them are optional — the state machine + gates refuse to advance without them.

## 1. Control test reviewer override (low-confidence path)

When LLM evaluation returns confidence `< 0.7`, the `ControlTest` row's status becomes `reviewer_required` instead of `passed`. The workpaper is still generated, but the cockpit flags it for reviewer attention.

**Why:** ambiguous LLM judgments shouldn't auto-pass a control. A human must override.

**Where:** `ControlTestService.runSingle()` → status mapping. `confidence < 0.7` → `reviewer_required`.

## 2. Workpaper approval gate

Every generated workpaper PDF is persisted with `approvalState='REQUIRES_APPROVAL'`. Until a reviewer flips it to `APPROVED`, the workpaper:
- cannot be downloaded (`ArtifactGatedError` thrown at `requestSignedDownloadUrl`)
- blocks the audit run from advancing to `READY_TO_PACK`
- blocks final-pack generation (`FinalPackGateError`)

**Reviewer actions:**
- `POST /audit/runs/:id/workpapers/:wpId/decide` with `{decision: 'approved'|'rejected', reviewerNotes?}`
- Approval propagates to the underlying `WorkflowArtifact.approvalState` so the download path aligns.
- Reviewer identity (`reviewedBy`) and timestamp (`approvedAt`) are persisted.

**Why:** The signed final pack is the legally binding artefact handed to the external auditor. Signing over un-reviewed evidence would defeat the entire compliance posture.

## 3. Exception lifecycle review

Every `AuditException` has a state machine:
```
open → remediation_planned → remediation_in_progress → remediation_complete
        ↓                       ↓                         ↓
        accepted (with reviewer note)   rejected (with reviewer note)
        closed (terminal — included in final pack)
```

Reviewers drive transitions via:
- `PATCH /audit/runs/:id/exceptions/:exId/remediation` — fill remediation plan + owner + due date (auto-advances `open → remediation_planned`)
- `POST /audit/runs/:id/exceptions/:exId/decide` with `{to: 'accepted'|'rejected'|'closed', reviewerComment?}`

Illegal transitions throw `IllegalAuditExceptionTransitionError` at the service layer (HTTP 409).

**Why:** Exceptions can be legitimate (compensating control accepted by management) or invalid (control failure that needs remediation). The reviewer's decision matters for the final pack's risk narrative.

## 4. Final pack signing

Only REVIEWER+ roles can call `POST /audit/runs/:id/final-pack`. The route layer enforces RBAC; the service layer re-validates the workpaper-approval gate. The signed bundle itself has `approvalState='REQUIRES_APPROVAL'` — a final-pack download still requires explicit approval before it leaves the platform.

## RBAC summary

| Action | Required role |
|---|---|
| Read runs / tests / exceptions / workpapers | any authenticated tenant member |
| Create / plan / auto-map / test / generate workpapers / final-pack | REVIEWER, TENANT_ADMIN, SYSTEM_ADMIN |
| Decide on workpapers / exceptions | REVIEWER, TENANT_ADMIN, SYSTEM_ADMIN |
| Soft-delete an audit run | TENANT_ADMIN, SYSTEM_ADMIN |

The route file ([audit-runs.routes.ts](../apps/api/src/routes/audit-runs.routes.ts)) wires `fastify.requireRole(...)` on every write endpoint. RBAC is enforced even when the UI button is shown.

## Honesty notes

- The state machines for `AuditRun`, `ControlTest`, `AuditException`, and `WorkflowArtifact.approvalState` are the source of truth. The UI cannot bypass them.
- Reviewer identity is persisted on every approve/reject (`reviewedBy`, `approvedBy`) for the audit trail.
- The `audit_log` table records every transition via the existing `AuditLogger.log()` calls — search by `resource='audit_run' / 'audit_exception' / 'workflow_artifact'`.
