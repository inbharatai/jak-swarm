# Sprint 4 — Instagram + YouTube Studio + Meta Business Suite Adapters

**Base commit:** `822fec3` (Sprint 3 SubgoalCoordinator)
**Goal:** ship the remaining three per-platform browser adapters
following the LinkedIn pattern (Sprint 1). Read-only review +
draft prep + manual-handoff publish. **NEVER auto-posts / uploads.**

## What shipped

### Code

Three new adapters, each implementing `PlatformAdapter`:

| Adapter | File | Char limit | Key feature |
|---|---|---|---|
| `InstagramBrowserAdapter` | `packages/tools/src/browser-operator/instagram-adapter.ts` | 2200 (caption) | Hashtag suggestions by topic + media-required checklist |
| `YouTubeStudioBrowserAdapter` | `packages/tools/src/browser-operator/youtube-adapter.ts` | 100 title + 5000 description | Chapters scaffold + thumbnail + made-for-kids legal flag in checklist |
| `MetaBusinessBrowserAdapter` | `packages/tools/src/browser-operator/meta-adapter.ts` | 63206 (page post) | Audience-targeting + ad-spend disclaimers in checklist |

Each adapter follows the same hard-rule pattern as Sprint 1's LinkedIn:

| Rule | Implementation |
|---|---|
| URL allowlist | Each adapter scoped to its own platform domain (instagram.com / youtube.com + studio.youtube.com / business.facebook.com + facebook.com); rejects http://, malformed URLs, spoof domains |
| Login-state heuristic | DOM selectors with precedence: captcha → 2FA → logged-in → logged-out → conservative fallback |
| 2FA / captcha detection | Selector-based, NEVER bypasses |
| Approval-gated publish | `recordApprovedPublish` REFUSES without approvalId AND ALWAYS returns `published: false, manualHandoffRequired: true` |
| No auto-post / auto-upload | `published` is hard-coded `false` in every adapter |
| Honest copy | Each `manualHandoffMessage` explicitly tells the user what JAK does NOT do (auto-publish / auto-upload / change ad-spend) |

### UI

`apps/web/src/components/integrations/BrowserOperatorComingSoon.tsx`
flips Instagram + YouTube + Meta cards from `functional: false` to
`functional: true` with platform-specific honest copy:

- **Instagram:** "Active for browser-assisted review and caption draft prep. Publishing is manual handoff — JAK never auto-posts."
- **YouTube Studio:** "Active for browser-assisted channel review + title/description/tag drafts. Uploading videos is always manual — JAK never auto-uploads."
- **Meta Business Suite:** "Active for browser-assisted page review + post-draft prep. Publishing + ad-spend changes are manual handoff — JAK never auto-publishes."

Status badge: "All adapters live (publish manual)".

### Tests

**`tests/unit/api/social-adapters.test.ts`** (NEW, 24 tests):

| Adapter | Tests |
|---|---|
| Instagram | URL allowlist (2) + login state (3) + draft (3) + approval-gated (2) = **10** |
| YouTube Studio | URL allowlist (1) + login (2) + draft (2) + checklist content (1) + approval-gated (2) = **8** |
| Meta Business Suite | URL allowlist (1) + login (2) + draft (1) + approval-gated (1) = **5** |
| Shared contract (all 3) | refuses without approvalId (1) + manualHandoffRequired=true (1) = **2** |

**Total: 24 / 24 pass.**

`tests/e2e/browser-operator-honesty.spec.ts` updated to assert ALL 4
platform cards (LinkedIn + Instagram + YouTube + Meta) are now
functional with manual-handoff disclaimers — and that NONE say
"Coming soon — needs platform adapter" anymore.

## Hard rules ENFORCED across all 3 adapters

- ✅ **No auto-posting** (Instagram, YouTube uploading, Meta publishing)
- ✅ **No 2FA bypass** (selectors only OBSERVE)
- ✅ **No captcha bypass** (detection sets `challengeDetected: true`)
- ✅ **No password storage** (adapters never read field VALUES)
- ✅ **No private-DM scraping** (no DM extraction methods exist)
- ✅ **No ad-spend changes** (Meta adapter explicitly disclaims this in `manualHandoffMessage`)
- ✅ **No upload of unverified content** (YouTube draft is metadata only; user uploads the video file themselves)
- ✅ **Each platform's TOS respected by default** — adapters cannot perform any action that would violate platform terms because they have no execute path that posts/uploads/messages

## Honest deferrals

- **Real-platform end-to-end tests against live LinkedIn / Instagram / YouTube / Meta accounts** — requires sandbox accounts in CI + 2FA-disabled test users. The unit tests use stubbed Playwright `Page`. The browser-operator's existing `JAK_E2E_REAL_BROWSER=1` real-browser test covers operator-level launch.
- **LLM-driven captions** — current adapters produce deterministic templates with placeholder text. CMO Agent flows can layer LLM rewrite on top of `buildDraft`'s scaffold. The `body` field is plain text the agent can rewrite.
- **Auto-publish via DOM** — explicitly out of scope per the brief: each adapter's `recordApprovedPublish` returns `manualHandoffRequired: true`. The user clicks publish themselves in the open browser window.

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @jak-swarm/tools build` | green |
| `pnpm --filter @jak-swarm/web typecheck` | green |
| `pnpm exec vitest run unit/api/social-adapters.test.ts` | **24/24 pass** |

## Status

**Sprint 4 complete.** All four per-platform adapters (LinkedIn from
Sprint 1 + Instagram + YouTube + Meta from Sprint 4) are functional
today for browser-assisted review and draft preparation. None auto-
post / auto-upload. UI flipped from "Coming soon" to functional with
honest manual-handoff disclaimers. Moving to Sprint 5.
