# Human QA Session — a-z-deep

Generated 2026-05-01T15:06:06.469Z (106.7s, 55 screenshots)

## Buyer verdict: **has-rough-edges**

**A buyer would notice these.** 1 HIGH-severity issue(s), 1 UI element(s) present but not wired to real backend behaviour. Fix before a sales walkthrough.

## Severity totals

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 2 |
| LOW | 0 |
| INFO | 6 |

## Status totals (the real "is this product done" view)

| Status | Count |
|---|---|
| working | 6 |
| partially-working | 2 |
| present-but-not-wired | 1 |
| not-implemented | 0 |
| observation | 0 |

## Session score: **6/10** (worst page)

## Per-page A-Z scoring (1-10)

| Page | URL | Score | Findings | Screenshots | Reason |
|---|---|---|---|---|---|
| landing | http://localhost:3000/ | 🟡 **8/10** | 6 | 13 | 7/12 categories tested (7 passing) · depth cap 8 |
| register | http://localhost:3000/register | 🟡 **8/10** | 0 | 8 | 7/12 categories tested (7 passing) · depth cap 8 |
| login | http://localhost:3000/login | 🟡 **8/10** | 0 | 8 | 7/12 categories tested (7 passing) · depth cap 8 |
| social-drafts | http://localhost:3000/social-drafts | 🟡 **8/10** | 1 | 8 | 11/12 categories tested (10 passing) · severity cap 9 · pass cap 8 · failed: loading-state |
| tool-installer | http://localhost:3000/tool-installer | 🔴 **6/10** | 2 | 6 | 11/12 categories tested (9 passing) · severity cap 6 · pass cap 7 · failed: loading-state, product-truth |
| workspace | http://localhost:3000/workspace | 🔴 **7/10** | 0 | 4 | 4/12 categories tested (4 passing) · depth cap 7 |
| standing-orders | http://localhost:3000/standing-orders | 🔴 **7/10** | 0 | 1 | 3/12 categories tested (3 passing) · depth cap 7 |
| audit | http://localhost:3000/audit | 🔴 **7/10** | 0 | 1 | 3/12 categories tested (3 passing) · depth cap 7 |
| integrations | http://localhost:3000/integrations | 🔴 **7/10** | 0 | 1 | 3/12 categories tested (3 passing) · depth cap 7 |
| knowledge | http://localhost:3000/knowledge | 🔴 **7/10** | 0 | 1 | 3/12 categories tested (3 passing) · depth cap 7 |
| skills | http://localhost:3000/skills | 🔴 **7/10** | 0 | 1 | 3/12 categories tested (3 passing) · depth cap 7 |
| inbox | http://localhost:3000/inbox | 🔴 **7/10** | 0 | 1 | 3/12 categories tested (3 passing) · depth cap 7 |
| schedules | http://localhost:3000/schedules | 🔴 **7/10** | 0 | 1 | 3/12 categories tested (3 passing) · depth cap 7 |
| traces | http://localhost:3000/traces | 🔴 **7/10** | 0 | 1 | 3/12 categories tested (3 passing) · depth cap 7 |

## Actionable findings (non-INFO)

| # | Page | Severity | Status | Category | Section | Expected | Actual | Fix |
|---|---|---|---|---|---|---|---|---|
| 1 | social-drafts | MEDIUM | partially-working | UX | social-drafts-initial | loading state visible after action triggers | no spinner / no "Loading" text / no disabled button observed | Show a spinner, disable the submit button, or surface "Loading…" while the request is in flight |
| 2 | tool-installer | MEDIUM | partially-working | UX | tool-installer-initial | loading state visible after action triggers | no spinner / no "Loading" text / no disabled button observed | Show a spinner, disable the submit button, or surface "Loading…" while the request is in flight |
| 3 | tool-installer | HIGH | present-but-not-wired | product-truth | tool-installer-truth | safety disclosure (sandbox / approval / reviewer) in requirements | Detected capabilities  No specific capability detected. | Surface the sandbox + approval-required disclosure on the detect result |
