/**
 * Canonical product-claims registry for marketing surfaces.
 *
 * This file is the single source of truth for the four headline counts
 * (agents, tools, connectors, providers) and the integration tile lists
 * (`INTEGRATIONS_CORE` + `INTEGRATIONS_INFRA`) that the marketing surfaces
 * historically encoded inline in `page.tsx`.
 *
 * After the 2026-04-28 simplification (commit d7bbf71) the homepage was
 * cut from 18 sections to 8 and stopped surfacing the integration chips +
 * stats band. The tests/CI guards still need to verify that whatever
 * counts we DO claim line up with reality (real ToolRegistry size, real
 * AgentRole enum entries, real whatsapp.routes.ts existence, real Sentry
 * MCP-only labelling). So the tests now read from THIS file instead of
 * scraping page.tsx — it stays accurate even if the homepage UX changes
 * again.
 *
 * Read-by:
 *   - tests/integration/truth-claims.test.ts  (the 7 landing-truth tests)
 *   - scripts/check-docs-truth.ts             (CI docs-truth gate)
 *   - any future marketing surface that wants to render these tiles
 *
 * IMPORTANT: keep the literals in the exact shape below. The test and
 * script use regexes (matching the stat object shape, and the integration
 * arrays declared with `as const` and individual `name:` keys) to extract
 * counts. If you reformat or rename, update the regexes in lockstep.
 *
 * Numbers must match the live source of truth:
 *   - agents = AgentRole enum entries in packages/shared/src/types/agent.ts
 *   - tools  = `toolRegistry.register(` call count in packages/tools/src/builtin/index.ts
 *   - connectors = INTEGRATIONS_CORE.length + INTEGRATIONS_INFRA.length
 *   - providers = number of LLM providers in packages/agents/src/runtime/
 */

// ─── Stat counts ────────────────────────────────────────────────────────────

export const STATS = [
  { value: 38, label: 'Specialist Agents', suffix: '' },
  // 122 total tools. Every tool carries an honest maturity label —
  // real / heuristic / llm_passthrough / config_dependent / experimental —
  // CI-enforced against the live registry.
  { value: 122, label: 'Classified Tools', suffix: '' },
  // 22 = 13 external SaaS connectors (incl. WhatsApp native bridge) + 9
  // infrastructure/MCP adapters surfaced in the UI. Only a subset are
  // production-ready runtime paths — see docs/integration-maturity-matrix.md.
  { value: 22, label: 'Connectors', suffix: '' },
  { value: 6, label: 'AI Providers', suffix: '' },
] as const;

// ─── Integration tiles ──────────────────────────────────────────────────────
// Real, code-backed integrations only. Do not add a name here unless the
// route + adapter actually exist in apps/api/src/routes/ or
// packages/tools/src/adapters/.

export const INTEGRATIONS_CORE = [
  { name: 'Slack', color: '#4A154B', bg: 'rgba(74,21,75,0.1)' },
  { name: 'GitHub', color: '#FFFFFF', bg: 'rgba(255,255,255,0.08)' },
  { name: 'Notion', color: '#FFFFFF', bg: 'rgba(255,255,255,0.08)' },
  { name: 'Google Drive', color: '#4285F4', bg: 'rgba(66,133,244,0.1)' },
  { name: 'Linear', color: '#5E6AD2', bg: 'rgba(94,106,210,0.1)' },
  { name: 'HubSpot', color: '#FF7A59', bg: 'rgba(255,122,89,0.1)' },
  { name: 'Stripe', color: '#635BFF', bg: 'rgba(99,91,255,0.1)' },
  { name: 'Salesforce', color: '#00A1E0', bg: 'rgba(0,161,224,0.1)' },
  { name: 'Airtable', color: '#18BFFF', bg: 'rgba(24,191,255,0.1)' },
  { name: 'ClickUp', color: '#7B68EE', bg: 'rgba(123,104,238,0.1)' },
  { name: 'SendGrid', color: '#0EA5E9', bg: 'rgba(14,165,233,0.1)' },
  { name: 'Discord', color: '#5865F2', bg: 'rgba(88,101,242,0.1)' },
  // WhatsApp: native bridge (not MCP) — apps/api/src/routes/whatsapp.routes.ts.
  // Register number, verify, send command, receive via the bridge token.
  // CI invariant (scripts/check-docs-truth.ts): if the route exists with > 1KB
  // of code, this tile MUST appear in INTEGRATIONS_CORE.
  { name: 'WhatsApp', color: '#25D366', bg: 'rgba(37,211,102,0.1)' },
] as const;

export const INTEGRATIONS_INFRA = [
  { name: 'Supabase', color: '#3ECF8E', bg: 'rgba(62,207,142,0.1)' },
  // Sentry MCP: JAK agents can query your Sentry projects via the official
  // Sentry MCP server. NOT the Sentry SDK for error reporting from this API
  // — that would require wiring @sentry/node, which is deliberately not
  // installed (no runtime dependency added until you actually want it).
  // CI invariant: tile is labeled "Sentry MCP", never bare "Sentry".
  { name: 'Sentry MCP', color: '#A855F7', bg: 'rgba(168,85,247,0.1)' },
  { name: 'Brave Search', color: '#FB6A25', bg: 'rgba(251,106,37,0.1)' },
  { name: 'PostgreSQL', color: '#336791', bg: 'rgba(51,103,145,0.1)' },
  { name: 'Puppeteer', color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
  { name: 'Filesystem', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  { name: 'Fetch', color: '#38bdf8', bg: 'rgba(56,189,248,0.1)' },
  { name: 'Memory', color: '#c084fc', bg: 'rgba(192,132,252,0.1)' },
  { name: 'Sequential Thinking', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
] as const;

export type ProductStat = (typeof STATS)[number];
export type IntegrationTile = (typeof INTEGRATIONS_CORE)[number] | (typeof INTEGRATIONS_INFRA)[number];
