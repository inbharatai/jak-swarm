# Browser, Playwright + Folder Control — Audit

**Scope:** every place JAK uses Playwright, opens browser sessions, or
reads/writes files. What's wired correctly, what was hardened in this
sprint, what's still a gap.

## 1. Playwright usage map

| File | Role |
|---|---|
| `packages/tools/src/browser-operator/playwright-browser-operator.ts` | Production browser-session runtime. Real `chromium.launchPersistentContext` per session. |
| `packages/tools/src/adapters/browser/playwright-engine.ts` | Singleton dev-only browser used by older builtin tools (`browser_navigate`, `browser_extract`). Per-user data dir. |
| `packages/tools/src/browser-operator/{linkedin,instagram,youtube,meta}-adapter.ts` | 4 platform adapters that build draft posts. **Manual handoff only — never auto-publish.** |
| `apps/api/src/routes/browser-operator.routes.ts` | `/browser-sessions/...` HTTP routes that the dashboard hits. |
| `tests/playwright.config.ts` | Playwright config for end-to-end UI tests. Separate from product code. |

## 2. Browser session lifecycle (production runtime)

```
startSession(input)
  ├─ isUrlAllowed(initialUrl)        ← FIRST line of defence
  ├─ tenantDir = baseDataDir/{tenantId}/
  ├─ sessionDataDir = tenantDir/{sessionId}/
  ├─ chromium.launchPersistentContext(sessionDataDir, {
  │     headless: env-controlled,
  │     acceptDownloads: false,        ← no surprise file writes
  │   })
  ├─ context.route('**', SSRF guard)   ← SECOND line of defence (NEW)
  └─ audit emit BROWSER_SESSION_STARTED

observe / propose / execute (gated by approval)
  ├─ requireSession(sessionId, tenantId) → throws SessionAccessError on cross-tenant
  ├─ approval policy gate on every non-readonly action
  ├─ payload-binding hash so an approval id can't be reused with different data
  └─ audit emit per action

endSession
  ├─ context.close()
  ├─ rmSync(sessionDataDir, { recursive, force })   ← cookies/localStorage/IDB wiped
  └─ audit emit BROWSER_SESSION_ENDED

idle sweep (timer)
  └─ endSession() any session past TTL
```

## 3. SSRF guard — what changed this sprint

**Before:** the URL allowlist blocked `localhost`, `127.0.0.1`, `::1`,
and the three RFC1918 ranges. It missed:
- `0.0.0.0` — equivalent to localhost on most stacks
- `169.254.x.x` — link-local, **AWS metadata IP is `169.254.169.254`**
- IPv6 link-local (`fe80::`), unique-local (`fc00::/7`), loopback `::`
- Cloud metadata FQDNs (`metadata.google.internal`, `metadata.azure.com`, Alibaba `100.100.100.200`)
- Carrier-grade NAT `100.64.0.0/10`
- Test-net ranges + benchmark range
- The `.localhost` / `.internal` / `.local` TLDs
- **Per-request re-checking** — a public URL we initiated could 302 to `http://169.254.169.254/iam/credentials` and the headless browser would fetch it before any guard ran

**After (`packages/tools/src/browser-operator/playwright-browser-operator.ts`):**
- Allowlist function expanded to cover every class above.
  Implementation: `defaultIsUrlAllowed()` (now exported for tests + adapters).
- `context.route('**')` interceptor on every session — every navigation,
  sub-frame, and resource fetch is checked against the allowlist. Blocked
  requests:
  - get aborted with `'blockedbyclient'` (Chrome's standard reason)
  - emit `BROWSER_REQUEST_BLOCKED` audit event with the URL + resourceType
  - never reach the network

**Tests:** `tests/unit/tools/browser-url-allowlist.test.ts` — 46 cases
covering every blocked address class + 8 legitimate-target sanity checks.
All pass.

## 4. File / folder access — current guards

### a) Browser session data dirs
- Path: `~/.jak-swarm/browser-sessions/{tenantId}/{sessionId}/`
- Tenant isolation: each tenantId gets its own subtree. Session dirs are
  hard-deleted on `endSession()`.
- Idle sweep removes sessions past TTL.

### b) Sandboxed code execution
- `packages/tools/src/adapters/sandbox/docker.adapter.ts` — Docker-based
  code sandbox.
- `sanitizePath()` blocks any path containing `..` or any absolute path.
  See line 47 — applied on every `writeFile` / `readFile`.
- `virtual-fs.ts` is the canonical caller boundary; raw `writeFile` on
  the adapter goes through the sanitizer too.

### c) Sandboxed installer
- `packages/tools/src/installer/sandboxed-installer.ts` — runs allowlisted
  install commands.
- `spawn(command, args, ...)` with **literal argv array**, never
  `spawn(shellString, { shell: true })` — shell-metachar injection
  cannot reach the shell.
- Subprocess env stripped to a minimal allowlist — secrets in the parent
  env do NOT propagate.
- 60s timeout default (override per command).
- `cwd: sandboxAdapter.cwd ?? this.options.repoRoot ?? process.cwd()` —
  scoped working dir; can't be set by user input.

### d) Document ingest path
- `apps/api/src/routes/documents.routes.ts` writes uploads to per-tenant
  storage; PII detection + injection scan run before the file is indexed.

## 5. Tests covering these areas (after this sprint)

| Test file | What it covers |
|---|---|
| `tests/unit/tools/browser-url-allowlist.test.ts` | **NEW** — 46 SSRF address-class cases |
| `tests/integration/browser-operator-real-browser.test.ts` | Real Chromium session round-trip |
| `tests/e2e/browser-operator-honesty.spec.ts` | UI honesty contract — never claims auto-publish |
| `tests/unit/api/browser-operator.test.ts` | Route-layer tenant + auth checks |
| `tests/unit/api/sandboxed-installer.test.ts` | Allowlist + argv guard + timeout |
| `tests/unit/api/tool-installer.test.ts` | `approvalId` required + role gate |

## 6. Known remaining gaps (honest)

1. **No filesystem-quota enforcement on browser session dirs.** A runaway
   session that fills the host disk would be caught only by the OS,
   not by the operator. Mitigation: idle sweep keeps active count low.
   Future: add a per-tenant disk-bytes cap.

2. **No DNS-rebinding defence.** A public domain whose A-record changes
   to `169.254.169.254` between the allowlist check and the actual fetch
   could bypass the URL guard. The per-request route interceptor closes
   most of this (it re-checks every fetch), but a TOCTOU race is
   theoretically possible. Real fix needs a custom DNS resolver that
   re-checks the IP after lookup. Scoped for a follow-on sprint.

3. **`acceptDownloads: false` is per-context.** A user-script that
   triggers a synthetic download (data URI a-tag click) could still be
   fetched into JS memory; it just can't write to disk via the standard
   download API. Scoping `download` events on the page is a follow-up.

4. **No formal Content-Security-Policy enforcement** on the headless
   browser. CSP is set by the visited page, not by us. We don't override.

5. **The dev-only `playwright-engine.ts` singleton** (`adapters/browser/`)
   uses `~/.jak-swarm/browser-profile/` shared across "users" — designed
   for single-developer local use. The route guard from this sprint does
   NOT apply to it. Production code should always go through
   `PlaywrightBrowserOperator`, which is per-session + isolated.

## 7. How to verify locally

```bash
# Unit-level SSRF guard (no Docker needed, no network)
cd tests && pnpm exec vitest run unit/tools/browser-url-allowlist.test.ts

# Real browser session round-trip (needs Playwright Chromium installed)
pnpm --filter @jak-swarm/tests exec vitest run integration/browser-operator-real-browser.test.ts

# Audit emit on blocked request — observe the audit log when running
# a session against a redirect-to-metadata URL
```

## 8. Verdict

| Area | Score | Reason |
|---|---|---|
| URL allowlist breadth | 9/10 | Covers all major SSRF classes after this sprint; DNS-rebinding follow-on remains |
| Per-request re-check (redirect bypass) | 9/10 | NEW — every navigation now goes through `context.route('**')` |
| Tenant isolation | 9/10 | Per-tenant data dirs + ownership check + audit on violation |
| Cleanup on endSession | 9/10 | Hard delete + idle sweep |
| Argv injection on subprocess | 10/10 | Literal argv, never shell-true |
| Path traversal in sandbox FS | 8/10 | `..` + absolute path blocked; symlinks rely on container filesystem semantics |
| Disk-fill protection | 5/10 | No per-tenant quota; relies on OS |
| DNS-rebinding | 6/10 | Per-request guard mostly closes it; TOCTOU race remains |

**Overall browser/folder/sandbox control: 8/10.** Solid for controlled
beta against trusted public sites; the disk-quota + DNS-rebinding
follow-ups are real backlog items, not show-stoppers.
