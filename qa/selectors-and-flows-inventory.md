# JAK Swarm — Selectors + flows inventory

What we used to drive the live audit, where the selectors are stable, where the DX needs work. Useful for the next QA pass + for anyone writing test automation against `jakswarm.com`.

## Stable, reliable selectors

These are stable enough that we'd ship a Playwright suite against them today.

| Page | Selector | Purpose | Stability |
|---|---|---|---|
| `/login` | `input[type="email"]` | Email input | ✓ |
| `/login` | `input[type="password"]` | Password input | ✓ |
| `/login` | `button[type="submit"]` | Sign In button | ✓ |
| `/login` | `a:has-text("Use magic PIN instead")` | Magic-link toggle | ✓ |
| `/workspace` | `[data-testid="message-thread"]` | Message thread root (added in commit 14eeb55) | ✓ |
| `/workspace` | `[data-testid="assistant-message"]` | Each assistant bubble | ✓ |
| `/workspace` | `[data-testid="user-message"]` | Each user bubble | ✓ |
| `/workspace` | `button[aria-label="Send message"]` | Send button | ✓ |
| `/workspace` | `button:has-text("New chat")` | Sidebar "New chat" CTA | ✓ |
| Sidebar (any page) | `button[aria-label="Sign out"]` | Sign out button | ✓ |
| Sidebar (any page) | `aside button:has(svg.lucide-message-square)` | Past-conversation rows in Recent list | ✓ (lucide icon class) |
| `/builder` | `button:has-text("New Project")` | Create project CTA | ✓ |
| Any modal | `[role="dialog"]` | Dialog root (added in commit 2bba588) | ✓ |
| `/knowledge` | `button:has-text("Add Memory")` | Open Add Memory dialog | ✓ |
| `/integrations` | `text=/slack|github|gmail|notion/i` | Provider tiles | ✓ |
| `/swarm` | `main button` filtered by `/Failed|Completed|Pending|Running|Paused/` | Workflow rows | ✓ |

## Selectors needing test-id improvements

These work but rely on text-matching that's fragile to copy changes. Adding `data-testid` would harden the suite.

| Page | What we matched on | Suggested testid |
|---|---|---|
| `/builder` | `button:has-text("New Project"), button:has-text("Create Project")` (two CTAs in different states) | `data-testid="builder-new-project"` on both |
| `/workspace` | Role picker chips matched via `button:has-text("CEO")` etc | `data-testid="role-chip"` + `data-role="ceo"` |
| `/swarm` | Filter tabs (`All`, `Active`, `Completed`, `Failed`) | `data-testid="run-filter-tab"` + `data-filter="failed"` |
| `/integrations` | Per-provider tiles | `data-testid="integration-tile"` + `data-provider="slack"` |
| `/analytics` | Period tabs (`7 Days`, `30 Days`, `90 Days`) | `data-testid="analytics-period"` + `data-window="30d"` |
| `/skills` | Tabs (`Installed (N)`, `Marketplace`, `Create`) | `data-testid="skills-tab"` + `data-tab="installed"` |

## Selectors that broke or were unreliable

These caused real test pain in this run.

### `/workspace` — chat textarea

`page.locator('textarea').first()` finds the textarea on most pages, but on a fresh `/workspace` (no prior conversation) the workspace renders the function-picker tile screen and **does not include a textarea at all** until the user clicks a function. This is a real product UX issue, not just a selector issue — see Bug H1 in `live-bug-matrix.md`.

**Workaround for tests:** click `text=/CTO|CMO|CEO/`'s first match before targeting the textarea. Cleaner fix: ship the textarea unconditionally.

### `/swarm` — workflow row clicks

Rows are `<button>` wrapping the goal + status badge + agent count. The earliest spec used `main a[href*="/swarm/"]` which never matched; the working selector is:

```ts
page.locator('main button').filter({ hasText: /Failed|Completed|Pending|Running|Paused/i })
```

Stable enough for now. A `data-testid="run-row"` on each row would be cleaner.

### `/login` — magic-link / OAuth alternates

Only email/password was exercised in this audit. The page also shows "Use magic PIN instead" and the register link. Magic-PIN flow not tested in this pass.

## Page-by-page flow inventory

For each page reachable from the sidebar, this is the canonical user-visible flow that an automation suite should cover.

### `/workspace`

1. Land — see "What would you like to build?" + function-picker tiles + (sometimes) chat input depending on state
2. Click a function chip → chat input becomes available
3. Type into textarea → Send button enables
4. Click Send → workflow starts; status messages appear as `data-testid="assistant-message"` bubbles
5. SSE stream emits `worker_started` / `worker_completed` events → those become "⏳ Agent: working" / "✓ Agent: completed" bubbles
6. On `completed` event → `workflowApi.get(workflowId)` is called → `finalOutput` is appended as a final assistant bubble
7. On `failed` event → fetches `finalOutput` first; if a recovered answer exists, appends it; else appends "Workflow failed: …"

### `/swarm` (Run Inspector)

1. Land — list of workflow rows, newest first; filter tabs (All / Active / Completed / Failed); Refresh button
2. Click a row → expands inline to show per-agent timeline
3. Per-agent card shows: agent role, status badge, duration, input/output JSON
4. Active workflows have Pause + Stop controls (not tested in this run)

### `/schedules`

1. Land — empty state with "Create Schedule" CTA, OR a list of recurring schedules
2. Click "New Schedule" → opens modal (not tested in this run)
3. Fill name + cron + workflow goal → Create

### `/builder`

1. Land — project list (cards) + "New Project" CTA
2. Click "New Project" → modal opens with name input + framework picker
3. Fill name + select framework (`nextjs` / `react-spa`) → Create
4. Navigate to `/builder/:projectId` → Monaco code editor + chat prompt area + file tree
5. Type a prompt → Send → Architect → Generator → Debugger → Deployer pipeline runs
6. Files appear in the tree; preview URL appears when Deployer finishes

### `/analytics`

1. Land — header + period tabs (7d / 30d / 90d)
2. After SWR fetch resolves: Workflows Run count, Avg Cost / Workflow, Token Usage Over Time chart, Cost by Provider, Cost by Agent Role breakdown
3. **Real timing risk:** body is empty for the first 4-5 seconds on cold load (Bug H4)

### `/integrations`

1. Land — grouped provider tiles + WhatsApp Control tile
2. Click a tile → connection modal opens (not exercised in this run)
3. Connection state per tile: `Disconnected` / `Connected` badge

### `/files`

1. Land — "0 files · 0 indexed" + drop-zone
2. Drop a file or click to choose → upload + auto-tag + index for `find_document` tool
3. Uploaded files appear with name + tags + size

### `/knowledge`

1. Land — Knowledge Console + tab strip (All / FACT / PREFERENCE / CONTEXT / SKILL_RESULT)
2. Click "Add Memory" → modal with key + value + type fields opens
3. Save → entry appears in the appropriate tab

### `/skills`

1. Land — header + tabs (Installed (N) / Marketplace / Create)
2. Empty state for new tenants — see Bug M4

### `/settings`

1. Land — AI Backends section + "Backend provider identity is restricted. Owner-only." copy
2. Per-provider rows showing name, source (database/env/local/managed), model, API key mask
3. Keys are masked as `••• (N chars)` — verified no leaks of last-N characters or fingerprints

## Test infrastructure summary

- **Spec file:** `tests/e2e/qa-live-human-audit.spec.ts`
- **Reusable helpers:** `attachLoggers(page)` captures console errors + 4xx/5xx responses; `snap(page, subfolder, name)` takes a screenshot under `qa/playwright-artifacts/`; `record(finding)` appends to the in-memory findings array, dumped on `afterAll` to `qa/live-findings.json`.
- **Auth:** uses `E2E_AUTH_EMAIL` + `E2E_AUTH_PASSWORD` env vars; defaults to the project's known test user.
- **Headless toggle:** `PWHEADLESS=1` for CI; default is headed so the operator can watch.
- **Project:** `chromium-desktop` (1440x900). Mobile project also available but not used in this run.

## Selectors / testids the team should add next

Highest leverage, in order:

1. `data-testid="role-chip"` + `data-role="ceo"` (one for each role) — eliminates fragile `:has-text("CEO")` selectors that break when copy changes
2. `data-testid="builder-new-project"` — same reason
3. `data-testid="run-row"` + `data-status="failed"` — cleaner Inspector tests
4. `data-testid="integration-tile"` + `data-provider="slack"` — typed integration assertions
5. A shared `data-testid="loading"` skeleton component on every SWR-backed page — lets tests wait for "loading gone" instead of guessing wait times
