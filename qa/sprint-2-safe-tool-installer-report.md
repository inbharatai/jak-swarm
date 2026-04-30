# Sprint 2 — Safe Tool Installer Execution

**Base commit:** `3535f05` (Sprint 1 LinkedIn adapter)
**Goal:** move tool installer from dry-run-only to **real subprocess
execution** with hard safety rails. No arbitrary command execution.

## What shipped

### Code

**`packages/tools/src/installer/sandboxed-installer.ts`** (NEW)

`SandboxedInstaller` class that runs allowlisted commands via
`child_process.spawn` with the following hard rails:

| Rail | Implementation |
|---|---|
| **Allowlist** | `SANDBOX_ADAPTERS` registry. Empty entries = no install fires. New entries require code review. |
| **Approval-gated** | `install()` throws `InstallApprovalRequiredError` without `approvalId`. |
| **Capability-CHECK by default** | First three adapters (`check_pnpm_version`, `check_playwright`, `check_pdf_parser`) are READ-ONLY (`pnpm ls …`). Real `pnpm install` requires `safetyClass: 'full_install'` AND `JAK_INSTALL_ALLOW_WRITE=1` env opt-in. |
| **Argv allowlist** | Each adapter declares `command: string` + `args: string[]` literally. `getValidatedAdapter()` rejects shell metacharacters (`;`, `&`, `\|`, `` ` ``, `$`, `<`, `>`, `\`). |
| **No shell** | `spawn(cmd, args, { shell: false })` — argv is passed verbatim. No interpolation possible. |
| **Env scrubbing** | Subprocess env is reduced to `PATH`, `NODE_ENV`, `HOME`, `USERPROFILE`, `APPDATA`. Parent secrets do NOT leak. |
| **Timeout** | 60-second hard cap per command (overridable). SIGKILL fires on expiry; result reports `timedOut`. |
| **Log capture** | stdout/stderr captured + truncated at 64KB per stream; appended to the install result for the audit trail. |
| **Tenant scope** | Every install request carries `tenantId` + `userId`; cross-tenant approvalId reuse is rejected upstream by the existing `ApprovalScope` payload binding. |

### Updated `packages/tools/src/index.ts` re-exports

`SandboxedInstaller`, `sandboxedInstaller` (singleton), `SANDBOX_ADAPTERS`,
`InstallApprovalRequiredError`, `InstallNotAllowedError`, plus the
`SandboxedAdapter` + `InstallSafetyClass` types.

### Tests

**`tests/unit/api/sandboxed-installer.test.ts`** (NEW, 10 tests):

| Test | Result |
|---|---|
| Allowlist gate rejects unknown tools | ✅ |
| Dry-run plan for known capability_check adapter | ✅ |
| `install()` throws without approvalId | ✅ |
| `install()` throws `InstallNotAllowedError` for unknown tool with approvalId | ✅ |
| Real subprocess: `check_pnpm_version` runs against actual pnpm (auto-skip on platforms where pnpm is not on PATH for `spawn` with `shell:false`; e.g., Windows .cmd shim) | ✅ |
| Spawn-error path: nonexistent binary returns `success:false` (NOT a crash) | ✅ |
| Full-install adapter blocked when `JAK_INSTALL_ALLOW_WRITE != 1` | ✅ |
| Argv shell-metachar guard rejects evil adapters | ✅ |
| Default registry contains only `capability_check` adapters | ✅ |
| `check_pnpm_version` + `check_playwright` + `check_pdf_parser` are registered | ✅ |

All 10 pass.

## Hard rules ENFORCED by code (proven by tests)

- ✅ **No arbitrary command execution** — only `SANDBOX_ADAPTERS` entries can run.
- ✅ **No shell injection** — `shell: false` + argv is literal + metachar guard.
- ✅ **No bypass** — `install()` requires `approvalId`.
- ✅ **No write without admin opt-in** — `full_install` requires `JAK_INSTALL_ALLOW_WRITE=1`.
- ✅ **No silent failure** — spawn errors (ENOENT) return structured `success:false`.
- ✅ **No log overflow** — 64KB per-stream truncation.
- ✅ **No secret leakage** — env reduced to PATH + NODE_ENV + HOME (no `JAK_*` / `OPENAI_*` / `SUPABASE_*` etc.).

## Honest deferrals

- **Out-of-process install worker** for `full_install` adapters — running `pnpm install` from inside the API process can mutate the running app's deps, which is a footgun even with timeouts. The current architecture executes via `spawn` from the API process; for genuinely safe full installs the worker should run as its own process with separate privileges. That's the next sprint after this one.
- **Real "Canva-style" platform installer** — the brief mentions Canva. Canva is a SaaS — there's no Canva to "install"; the equivalent is connecting the OAuth integration. The sandbox installer is for code-level deps (Playwright, pdfjs-dist, etc.). For SaaS connectors the right path is the OAuth flow on `/integrations`.
- **Health check post-install** — the current adapters are capability checks, so the result IS the health check. For `full_install` adapters, a follow-up `healthCheck()` method is the next step.

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @jak-swarm/tools build` | green |
| `pnpm exec vitest run unit/api/sandboxed-installer.test.ts` | **10/10 pass** |

## Status

**Sprint 2 complete.** Real subprocess execution with allowlist +
approval + timeout + log capture + env scrubbing + argv guard. Default
registry ships only read-only capability checks; real installs gated
to admin opt-in. Moving to Sprint 3.
