# Sprint 1 — LinkedIn Browser Operator Adapter

**Base commit:** `744eadb`
**Goal:** ship the first per-platform browser adapter for LinkedIn,
read-only + draft-first + approval-gated, **never auto-posts**.

## What shipped

### Code

- **`packages/tools/src/browser-operator/platform-adapter.ts`** (NEW)
  Per-platform adapter contract: `PlatformAdapter` interface +
  `PlatformLoginState` / `PlatformDraft` / `PlatformPublishResult`
  types + `redactSensitiveValues()` helper that scrubs 6-digit codes
  and password labels from any DOM text the adapter logs.

- **`packages/tools/src/browser-operator/linkedin-adapter.ts`** (NEW)
  `LinkedInBrowserAdapter` class implementing the contract:
  - **URL allowlist** scoped to `linkedin.com` + subdomains;
    rejects http://, file://, javascript:, malformed URLs, and
    `linkedin.com.evil.com`-style spoofs
  - **Login-state heuristic** via DOM selectors with explicit
    precedence: captcha → 2FA → logged-in → logged-out → conservative
    fallback
  - **Draft generation** with LinkedIn 3000-char limit, three tones
    (professional / casual / enthusiastic), keyword-based hashtag
    suggestions, plus a 4-item author checklist
  - **Approval-gated publish** — `recordApprovedPublish` REFUSES
    without approvalId AND ALWAYS returns `published: false,
    manualHandoffRequired: true`. JAK never auto-posts in this
    sprint; the user clicks publish themselves in the open browser
    window. Approval is recorded in the audit log either way.

- **`packages/tools/src/index.ts`** re-exports the adapter +
  `redactSensitiveValues` for API-layer use.

### UI

- **`apps/web/src/components/integrations/BrowserOperatorComingSoon.tsx`**
  flips the LinkedIn card from `functional: false` to
  `functional: true` with honest copy:
  > "Active for browser-assisted review and draft preparation.
  > Publishing requires your approval AND a manual click — JAK never
  > auto-posts. Login / 2FA must be completed by you."

  Status badge updates from "Generic mode live" → "Generic + LinkedIn live".

### Tests

- **`tests/unit/api/linkedin-adapter.test.ts`** — 22 tests covering:
  URL allowlist (4) + login-state detection (5) + draft generation
  (6) + approval-gated publish (2) + redactor (4) + singleton (1).
  All 22 pass.

- **`tests/e2e/browser-operator-honesty.spec.ts`** updated to assert
  LinkedIn is now functional (not "Coming soon") AND that
  Instagram/YouTube/Meta are still honestly marked "Coming soon".

## Hard rules enforced (proven by tests)

| Rule | Test |
|---|---|
| No auto-posting | `recordApprovedPublish` returns `published: false`, `manualHandoffRequired: true` ALWAYS — even with valid approvalId |
| No 2FA bypass | DOM selectors only OBSERVE the challenge; nothing types into pin/code fields |
| No captcha bypass | Captcha detection sets `challengeDetected: true`; UI surfaces "user takeover required" |
| No password storage | The adapter never reads form-field VALUES, only selector COUNT |
| No mass messaging | The adapter has no `sendMessage` / `connectRequest` / mass-DM method at all — only `buildDraft` + `recordApprovedPublish` |
| No private-profile scraping | `isUrlAllowed` enforces the LinkedIn TLD; the adapter has no profile-data extraction method |
| No credentials in JAK form | The adapter never prompts for credentials; the user logs in on linkedin.com directly |

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @jak-swarm/tools build` | green |
| `pnpm --filter @jak-swarm/web typecheck` | green |
| `pnpm exec vitest run unit/api/linkedin-adapter.test.ts` | **22/22 pass** |

## Honest deferrals from this sprint

- **Real-LinkedIn end-to-end test (logs in to a sandbox account, drafts a real post)** — requires a sandbox LinkedIn account + secrets in CI. The unit tests use a stubbed Playwright `Page`. The browser-operator's existing `JAK_E2E_REAL_BROWSER=1` real-browser integration test covers the operator-level launch loop already; per-platform real-account testing is a follow-up infrastructure task.
- **LLM-driven draft body** — today the adapter produces a deterministic template with placeholder bullets. Real CMO Agent flows can layer LLM generation on top of `buildDraft`'s scaffold; the `body` field is plain text the agent can rewrite.
- **Publish-via-DOM** — explicitly out of scope per the brief: "if publish is still not implemented, approval should produce a safe 'manual publish required' result, not fake success." That's exactly what `recordApprovedPublish` returns.

## Status

**Sprint 1 complete.** LinkedIn adapter is functional today for
browser-assisted profile review + draft preparation, with all
publishes deferred to user manual action. Moving to Sprint 2.
