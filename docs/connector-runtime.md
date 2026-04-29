# Connector Runtime

> **Status (2026-04-29):** Phase 1 shipped. Foundation + read-only dashboard + Remotion + Blender registered + 21 MCP providers auto-mapped. Installer / setup-assistant / cloud-render / publish flows are explicitly NOT shipped yet — see [Honest limitations](#honest-limitations) below.

## What it is

JAK does not need every tool preinstalled. The Connector Runtime is the layer that makes that possible: it understands what tool a task requires, explains why, safely connects/installs/configures it (gated by the existing approval system), routes the work to the right agent, validates the output, and surfaces every step in the dashboard.

It builds on top of — does **not** replace — the existing infrastructure:

- `packages/tools/src/mcp/*` — the 21 MCP server entries already shipped
- `packages/tools/src/registry/tool-registry.ts` — the tool registry with maturity labels
- `apps/api/src/routes/integrations.routes.ts` — OAuth + credential storage + audit logs
- `apps/api/src/routes/approvals.routes.ts` — the approval gate with `RiskLevel` thresholds

## What shipped in Phase 1

| Surface | File | What it does |
|---|---|---|
| Type definitions | [`packages/tools/src/connectors/types.ts`](../packages/tools/src/connectors/types.ts) | `ConnectorManifest`, `ConnectorStatus`, `ConnectorRuntimeType`, `ConnectorView`, `ConnectorCandidate`, `ConnectorResolveResult` |
| Singleton registry | [`packages/tools/src/connectors/registry.ts`](../packages/tools/src/connectors/registry.ts) | Process-local registry. Honesty rules: status `installed`/`configured` requires `installMethod` on the manifest; `failed_validation` only clears via a successful `recordValidation` |
| Manifest bootstrap | [`packages/tools/src/connectors/manifests/index.ts`](../packages/tools/src/connectors/manifests/index.ts) | Auto-maps every `MCP_PROVIDERS` entry to a `ConnectorManifest` (21 today) + registers Remotion + Blender |
| First-class manifests | [`remotion.ts`](../packages/tools/src/connectors/manifests/remotion.ts), [`blender.ts`](../packages/tools/src/connectors/manifests/blender.ts) | Hand-written entries with full risk + capability metadata |
| Resolver | [`packages/tools/src/connectors/resolver.ts`](../packages/tools/src/connectors/resolver.ts) | Heuristic NL → connector candidate ranking. LLM-pluggable in a future sprint |
| REST surface | [`apps/api/src/routes/connectors.routes.ts`](../apps/api/src/routes/connectors.routes.ts) | `GET /connectors`, `GET /connectors/:id`, `POST /connectors/resolve` |
| Dashboard page | [`apps/web/src/app/(dashboard)/connectors/page.tsx`](../apps/web/src/app/\(dashboard\)/connectors/page.tsx) | Read-only marketplace. Status counts ribbon. Category filter. Honest status badges per card |
| Cmd+K + zone rail | [`CommandPalette.tsx`](../apps/web/src/components/layout/CommandPalette.tsx), [`ChatSidebar.tsx`](../apps/web/src/components/layout/ChatSidebar.tsx) | New `Connectors` palette entry; the Setup zone rail icon highlights for `/connectors` too |
| Tests | `tests/unit/connectors/{registry,resolver,manifests}.test.ts` | 43 tests — registry CRUD + status honesty + Remotion + Blender + auto-mapped MCP entries + resolver behaviour |

## Architecture in one diagram

```
User command (NL)
    │
    ▼
OpenAI Planner
    │
    ▼
JAK Execution Plan ──┐
                     │
                     ▼
        Connector Resolver  ◄────  Connector Registry  ◄── Manifests/
              │                          │                 ├── remotion.ts
              ▼                          │                 ├── blender.ts
        Candidates (ranked)              │                 └── index.ts
              │                          │                     (auto-maps
              ▼                          │                      MCP_PROVIDERS)
        Approval Gate (existing)         │
              │                          │
              ▼                          │
        Connector Installer  ────────────┤   (Phase 2 — not yet shipped)
              │                          │
              ▼                          │
        Tool / MCP / API / Browser  ─────┤
              │                          │
              ▼                          │
        Validation Layer                 │
              │                          │
              ▼                          │
        Worker-node + Verifier           │
              │                          │
              ▼                          │
        Dashboard timeline (cockpit) ◄───┘
```

## ConnectorManifest schema

Read [`types.ts`](../packages/tools/src/connectors/types.ts) for the canonical doc-commented shape. Every field is required unless marked optional. Highlights:

- `id` — stable kebab-case identifier; never changes
- `runtimeType` — `mcp` / `api` / `browser` / `node_cli` / `python_cli` / `local_script` / `cloud_service`
- `installMethod` + `installCommand` — only executed after explicit approval AND only if `sourceAllowlist` matches
- `validationCommand` + `validationExpectedOutput` — single source of truth for "is this connector real today?"
- `riskLevel` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`) — same enum the existing approval gate uses
- `supportsAutoApproval` — opt-in. Tenant-admin still has to enable trusted auto-approval per tenant
- `canPublishExternalContent` — ALWAYS triggers an approval gate on publish-class tool calls, regardless of auto-approval
- `manualSetupSteps` — when present, `register()` automatically sets the connector to `needs_user_setup` (no fake "available" status)
- `source` — `mcp-providers` (auto-mapped) or `manual` (hand-written manifest)

## Status state machine

```
                       ┌─ installed ─┐
                       │     │       │
                       │     ▼       │
       available ──────┴─ configured │
        │                            │
        │    (installer + validate)  │
        │                            │
        ▼                            │
   needs_user_setup                  ▼
        │                       failed_validation
        │                            ▲
        ▼                            │
        unavailable (transient)      │
                                     │
                                     │
   disabled / blocked_by_policy ─────┘  (tenant-admin / industry pack)
```

The registry refuses transitions that would lie:
- `installed` / `configured` requires the manifest to declare an `installMethod` — pure REST connectors never claim "installed"
- `failed_validation` only lifts when `recordValidation({ success: true })` is called
- Transitions are logged via the existing audit-log plugin (Phase 2 wires the audit emit)

## Remotion connector

> **Status:** `available` — registered + manifest is real, but install + validation have not run. Manifest declares `npx --yes create-video@latest` as install + `npx --yes remotion --version` (matching `^[0-9]+\.[0-9]+`) as validation. Both gated by approval before they ever run.

[`packages/tools/src/connectors/manifests/remotion.ts`](../packages/tools/src/connectors/manifests/remotion.ts) is the source of truth.

**What Remotion will do once installed:**
- Generate React video compositions (`remotion_create_project`, `remotion_list_compositions`)
- Local + Lambda + Cloud Run rendering (`remotion_render_video`, `remotion_render_lambda`)
- Caption generation aligned to scene timings (`remotion_generate_caption_track`)

**Honesty rules:**
- We do NOT bundle Remotion. Marketing must read the registry status, not assume it.
- We do NOT auto-publish rendered videos to social platforms — separate connectors with their own gates.
- Cloud render needs `REMOTION_AWS_*` envs; without them, the runtime falls back to local render.

## Blender connector

> **Status:** `needs_user_setup` — Blender desktop must be installed by the user, the MCP add-on enabled, and the MCP server started. JAK cannot automate any of those. Status reflects that honestly.

[`packages/tools/src/connectors/manifests/blender.ts`](../packages/tools/src/connectors/manifests/blender.ts) is the source of truth.

**Risk note:** Blender exposes `blender_run_python` which executes arbitrary Python in your Blender process. Manifest declares `riskLevel: HIGH` and `supportsAutoApproval: false`. Every call goes through the existing approval gate, even in tenants that have auto-approval enabled for medium-risk connectors.

The pattern (MCP plug-in to a desktop app) is borrowed from Anthropic's Claude for Creative Work direction. JAK shares the architectural insight; no shared code.

## Resolver behaviour

Heuristic for v1. See [`resolver.ts`](../packages/tools/src/connectors/resolver.ts).

```ts
import { resolveConnectorsForTask } from '@jak-swarm/tools';

const result = resolveConnectorsForTask(
  'Create a 30-second product demo video for our landing page',
);
// → primary: { connectorId: 'remotion', confidence: 0.8, reason: '...', isReady: false, nextStep: 'Install via approval: ...' }
// → alternatives: []
// → unavailable: []
```

The resolver always returns BOTH the primary candidate AND any unavailable connectors that would have matched (so the user sees why a stronger match was skipped). Confidence is conservative — when in doubt, lower the score so the cockpit surfaces the choice instead of silently picking.

## REST surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/connectors` | List all registered connectors. Optional `?category=` and `?status=` filters. Returns `{ connectors, total, registered, counts }` |
| `GET` | `/connectors/:id` | Single connector view (manifest + status) |
| `POST` | `/connectors/resolve` | Body `{ task, hintedRoles?, maxAlternatives? }`. Returns `{ primary?, alternatives, unavailable }` |

All require auth. Mutation endpoints (install / approve / disable) intentionally not exposed yet — those flow through the existing `/integrations/*` + `/approvals/*` routes.

## Honest limitations

**Phase 1 is the foundation, not the full master spec.** The following are NOT shipped yet, in priority order for the next sprints:

| What's missing | Why it's deferred | Phase |
|---|---|---|
| Connector installer service (run `installCommand` in a sandbox; record validation) | Needs a real install runtime — E2B/Docker for `npx`, OS binary downloads for desktop apps. Significant new safety surface | Phase 2 |
| `POST /connectors/:id/install` route | Depends on installer service | Phase 2 |
| Trusted auto-approval setting in tenant-admin UI | Approval gate exists; admin UI does not yet expose the toggle | Phase 2 |
| Setup-assistant chat flow ("JAK noticed you need Blender — here's the setup wizard") | Requires the cockpit to consume `/connectors/resolve` + thread setup-step messages back into the chat | Phase 3 |
| Cloud render path for Remotion (Lambda + Cloud Run wiring) | Manifest declares it; the actual runtime adapter is not implemented | Phase 3 |
| Per-tenant industry-pack policy → `blocked_by_policy` status | Registry already has the status; the policy engine doesn't write to it yet | Phase 3 |
| Live tool registration when a connector finishes installing (auto-`toolRegistry.register` for Remotion's tools) | Needs the installer service first | Phase 3 |
| Connector audit-log emits | Existing audit plugin can be wired into `setStatus` and `recordValidation`; not done yet | Phase 2 |
| LLM-driven resolver (richer than the regex heuristic) | Heuristic covers the obvious cases; LLM upgrade is a follow-up sprint | Phase 4 |

## Adding a new connector

1. Write a manifest in `packages/tools/src/connectors/manifests/your-connector.ts` exporting `YOUR_MANIFEST: ConnectorManifest`.
2. Register it from `manifests/index.ts` by appending to the manual-manifests loop.
3. Add intent patterns to `resolver.ts` so NL tasks route to your id.
4. Write tests under `tests/unit/connectors/`.
5. Run `pnpm --filter @jak-swarm/tools build && pnpm exec vitest run unit/connectors`.

## Reading

- The master spec for the connector-first direction: `qa/connector-runtime-phase1-status.md`
- Original A-to-Z launch audit: `qa/a-to-z-pre-launch-blunt-audit.md`
- Existing tool registry: `packages/tools/src/registry/tool-registry.ts`
- Existing MCP infrastructure: `packages/tools/src/mcp/{mcp-providers,mcp-client,tenant-mcp-manager}.ts`
- Approval gate: `apps/api/src/routes/approvals.routes.ts`
