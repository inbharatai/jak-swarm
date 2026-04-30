# Browser-Operator Runtime — Implementation Plan

**Status:** Not implemented. UI scaffold only at `/integrations`
("Coming soon — needs browser-operator mode" cards for Instagram /
LinkedIn / YouTube Studio / Meta Business Suite).

**Target:** allow JAK to operate inside a user-controlled browser
session for platforms that don't expose a safe public API for the
actions the user wants (review profile, draft post, schedule content).
The user logs in normally on the platform's site — JAK never sees the
password — then JAK observes the visible page, drafts changes, and
asks for human approval before any external action.

**Hard rules (NON-NEGOTIABLE):**
- JAK never stores raw passwords.
- JAK never asks for credentials inside its own form.
- JAK never bypasses captcha / 2FA — it stops and asks the user.
- JAK never publishes / posts / messages / deletes without explicit approval.
- Every browser action is logged to AuditLog with screenshots.
- JAK respects platform Terms of Service. If a platform forbids
  automation, JAK stops and surfaces an "Upload manually" fallback.

---

## Architecture

### 1. `BrowserOperatorService` interface

Lives at `apps/api/src/services/browser-operator/browser-operator.service.ts`.

```ts
export interface BrowserOperatorService {
  /** Start a fresh tenant-scoped session for a platform. Returns a
   *  `sessionId` the user can re-attach to from the dashboard. */
  startSession(input: {
    tenantId: string;
    userId: string;
    platform: BrowserPlatform;
    workflowId: string;
  }): Promise<{ sessionId: string; loginUrl: string }>;

  /** Observe the current page state (URL + accessibility tree
   *  snapshot). NEVER captures form values for password/login fields. */
  observe(sessionId: string): Promise<PageObservation>;

  /** Propose an action without executing — produces a structured
   *  preview for an ApprovalRequest. */
  propose(input: {
    sessionId: string;
    action: ProposedAction;
  }): Promise<ProposedActionPreview>;

  /** Execute an action — caller must include `approvalId` proving the
   *  ApprovalRequest was decided APPROVED. Throws otherwise. */
  execute(input: {
    sessionId: string;
    action: ProposedAction;
    approvalId: string;
  }): Promise<ExecutionResult>;

  /** Close + dispose the browser context + delete cookies. */
  endSession(sessionId: string): Promise<void>;
}
```

### 2. Session isolation

Each session uses its own Playwright `BrowserContext` — cookies +
storage are isolated per tenant. Persisted to disk under
`.jak/browser-sessions/<tenantId>/<sessionId>/` with strict 0600 perms.
On `endSession`, the directory is hard-deleted (`rmSync recursive`).

### 3. Tenant isolation

Sessions are keyed by `(tenantId, sessionId)`. The `observe` /
`propose` / `execute` methods all assert the calling user belongs to
the same tenant before touching the session. Cross-tenant attempts
return 403 + emit a `BROWSER_OPERATOR_TENANT_VIOLATION` audit event.

### 4. Audit trail

Every browser action emits an `AuditLog` row:
- `action: 'BROWSER_OBSERVE' | 'BROWSER_PROPOSE' | 'BROWSER_EXECUTE'`
- `resource: <platform>:<sessionId>`
- `metadata: { url, action, screenshotArtifactId, approvalId? }`
- `severity: INFO | WARN`

Screenshots are written as `WorkflowArtifact` rows
(`artifactType: 'browser_screenshot'`) so they appear in the
existing audit-pack export.

### 5. 2FA / captcha fallback

When `observe()` detects a 2FA challenge / captcha:
- The session emits a `lifecycle_event` with `type: 'browser_blocked_by_security'`
- The cockpit shows: *"<Platform> is asking you to complete 2FA in the
  browser window. Click here to take over."*
- JAK does not click anything until the user signals "ready" via a UI
  button.

### 6. Terms-of-service gate

Before each platform is enabled in production:
- A signed Terms-of-Service-OK gate is required (per platform).
- The gate file lives at `apps/api/src/services/browser-operator/tos-gates.ts`
  with a per-platform allowed-action allowlist.
- Actions outside the allowlist are rejected with a `tos_blocked`
  outcome.

### 7. Approval gates

Every `execute()` call REQUIRES an `approvalId` arg. The service
re-validates the approval is:
- For this `tenantId`
- For this exact `proposedDataHash` (matches the centralized
  `ApprovalScope` table — same payload-binding pattern shipped 2026-04-28)
- Status `APPROVED`
- Not yet consumed (idempotency)

The centralized `DefaultApprovalPolicy` shipped today
(`packages/tools/src/registry/approval-policy.ts`) classifies browser
operator actions in the `EXTERNAL_POST` or `DESTRUCTIVE` categories,
so this gate is enforced automatically when browser tools register
through the standard `ToolRegistry`.

---

## First adapter — LinkedIn read-only "Review profile"

**Why first:** read-only, no posting, lowest TOS risk, highest layman
value (CMO Agent reviewing your profile + suggesting edits).

**Scope:**
1. User clicks "Connect LinkedIn — browser session" on `/integrations`
2. JAK opens a browser window pointed at `https://www.linkedin.com/login`
3. User logs in on the LinkedIn page (NOT in a JAK form)
4. JAK observes profile page → captures structured profile data via
   accessibility-tree snapshot
5. CMO Agent reads the snapshot, drafts profile improvements
6. ApprovalRequest emitted with the proposed edits
7. User approves → JAK does NOT auto-publish (read-only adapter); shows
   a copy-paste suggestion or saves a draft document

**Effort estimate:** 5–7 days for adapter + tests + UI
("Connect via browser session" button on the LinkedIn card +
session-attach UX).

---

## Phased rollout

| Sprint | Scope | Effort |
|---|---|---|
| Sprint 1 (1 wk) | `BrowserOperatorService` interface + Playwright BrowserContext per tenant + session lifecycle + audit log + tests. NO platform adapters yet. | 1 week |
| Sprint 2 (1 wk) | LinkedIn read-only "Review profile" adapter + UI ("Connect via browser") + e2e test against a known fixture page | 1 week |
| Sprint 3 (1 wk) | Approval-gated draft creation (LinkedIn post draft, NOT publish) + screenshot evidence in audit log | 1 week |
| Sprint 4 (1 wk) | Instagram read-only profile review (same shape as LinkedIn read-only) | 1 week |
| Sprint 5 (2 wk) | YouTube Studio read-only channel review + first publish-with-approval flow on LinkedIn (signed TOS gate, draft → approval → publish) | 2 weeks |
| Sprint 6 (1 wk) | Captcha/2FA detection + user-takeover handoff UX + production hardening | 1 week |

**Total: ~7 weeks for first 4 platforms in production-ready state.**

---

## Honest UI copy (already shipped at `/integrations`)

The "Coming soon" cards now say:

> "For platforms that don't expose a safe API for what we need, JAK is
> building a secure browser-operator mode — you log in normally on the
> platform's site, JAK watches the page, drafts changes, and asks for
> your approval before anything is published. **This is not live yet.
> No fake activity is run.**"

When Sprint 1 ships, the copy changes to:

> "Browser session runtime active. Click *Connect via browser* to start
> a private browser window — log in normally on <Platform>'s site;
> JAK never sees your password. Read-only review available; publishing
> requires your approval per action."

---

## Why this is honest

We are NOT shipping fake browser automation. The current state is:
- UI cards exist (real — verified by `human-style-sweep.spec.ts`)
- Backend service does not exist (true — no fake runtime)
- Roadmap is concrete (this doc)
- First adapter scoped to read-only LinkedIn (lowest TOS risk)
- All approval / audit / tenant-isolation patterns reuse existing JAK
  infrastructure (no greenfield safety risk)

When Sprint 1 lands, the UI copy auto-updates and the cards become
clickable. Until then, the section honestly says "Not live yet."
