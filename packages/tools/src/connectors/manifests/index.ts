/**
 * Connector manifest bootstrap.
 *
 * On module load this file registers every connector JAK knows about:
 *   1. Auto-mapped from `MCP_PROVIDERS` (21 entries today: Slack, GitHub,
 *      Notion, Supabase, Stripe, …) so we don't duplicate metadata.
 *   2. Hand-written manifests for non-MCP connectors (Remotion, Blender,
 *      future: FFmpeg, Vercel, GitHub Actions, …).
 *
 * Idempotent: re-importing the module is a no-op because the registry
 * skips ids already present. This matters in vitest where modules can
 * be loaded by multiple test files in the same process.
 */

import { RiskLevel } from '@jak-swarm/shared';
import { connectorRegistry } from '../registry.js';
import { MCP_PROVIDERS, type McpProviderDef } from '../../mcp/mcp-providers.js';
import type { ConnectorManifest } from '../types.js';
import { REMOTION_MANIFEST } from './remotion.js';
import { BLENDER_MANIFEST } from './blender.js';

// ─── Auto-mapping from MCP_PROVIDERS ──────────────────────────────────────

/**
 * Heuristic mapper: turn an `McpProviderDef` (the existing shape) into a
 * `ConnectorManifest` (the new shape). Most fields map 1:1; the new
 * fields (`riskLevel`, `runtimeType`, `category`, etc.) are inferred
 * from the provider's domain.
 *
 * Keep this simple. If a provider needs custom metadata, override here
 * by name; don't make the inference smart.
 */
function mcpProviderToManifest(key: string, def: McpProviderDef): ConnectorManifest {
  const id = `mcp-${key.toLowerCase().replace(/_/g, '-')}`;
  return {
    id,
    name: def.name,
    category: inferCategory(key),
    description: def.description,
    runtimeType: 'mcp',
    installMethod: 'mcp-stdio',
    // Source is the npx package the buildConfig uses. Extracted for the
    // allowlist; the actual command stays in mcp-providers.ts where the
    // McpClientManager already runs it.
    sourceAllowlist: [extractMcpPackage(def)],
    availableTools: def.testToolName ? [def.testToolName] : [],
    riskLevel: inferRiskLevel(key, def),
    approvalRequired: true,
    // MCP servers backed by Anthropic / official packages may auto-approve
    // their install (the bits are vetted by the publisher). Community
    // packages always require manual approval.
    supportsAutoApproval:
      def.packageStatus === 'OFFICIAL' || def.packageStatus === 'ANTHROPIC',
    supportsSandbox: true,
    supportsCloud: false,
    supportsLocal: true,
    canModifyFiles: false, // most MCP read APIs don't; flip per-provider as needed
    canPublishExternalContent: hasPublishCapability(key),
    canAccessUserData: hasUserDataAccess(key),
    defaultEnabled: false,
    credentialFields: def.credentialFields,
    setupInstructions: def.setupInstructions,
    source: 'mcp-providers',
    packageStatus: def.packageStatus,
  };
}

/** Category inference: groups MCP providers into the same UI buckets the
    handwritten manifests use. */
function inferCategory(key: string): ConnectorManifest['category'] {
  const k = key.toUpperCase();
  if (['SLACK', 'NOTION', 'HUBSPOT', 'CLICKUP', 'AIRTABLE', 'SENDGRID', 'DISCORD', 'LINEAR'].includes(k)) return 'business';
  if (['GITHUB', 'STRIPE', 'SUPABASE', 'POSTGRES', 'SENTRY', 'SALESFORCE'].includes(k)) return 'coding';
  if (['BRAVE_SEARCH', 'FETCH', 'PUPPETEER'].includes(k)) return 'research';
  if (['GOOGLE_DRIVE', 'FILESYSTEM', 'MEMORY', 'SEQUENTIAL_THINKING'].includes(k)) return 'local';
  return 'business';
}

/** Risk level inference: write/publish-capable surfaces are higher. */
function inferRiskLevel(key: string, def: McpProviderDef): RiskLevel {
  const k = key.toUpperCase();
  // Anything that can modify production state or publish content goes to HIGH.
  if (['STRIPE', 'SUPABASE', 'POSTGRES', 'SALESFORCE', 'SENDGRID'].includes(k)) {
    return RiskLevel.HIGH;
  }
  // Read-only research / fetch surfaces are LOW.
  if (['BRAVE_SEARCH', 'FETCH', 'MEMORY', 'SEQUENTIAL_THINKING'].includes(k)) {
    return RiskLevel.LOW;
  }
  // Community-maintained packages are MEDIUM by default — Anthropic /
  // official ones can be MEDIUM unless explicitly elevated above.
  return def.packageStatus === 'COMMUNITY' ? RiskLevel.MEDIUM : RiskLevel.MEDIUM;
}

/** Does this MCP server expose tools that publish to an external audience? */
function hasPublishCapability(key: string): boolean {
  return ['SLACK', 'DISCORD', 'NOTION', 'HUBSPOT', 'SENDGRID', 'GITHUB', 'LINEAR', 'CLICKUP'].includes(key.toUpperCase());
}

/** Does this MCP server read user PII / customer data? */
function hasUserDataAccess(key: string): boolean {
  return ['HUBSPOT', 'SALESFORCE', 'SENDGRID', 'GMAIL', 'GOOGLE_DRIVE', 'SUPABASE', 'POSTGRES'].includes(key.toUpperCase());
}

/** Extract the npm package name out of an MCP buildConfig.args list.
    Most are `['-y', '@scope/name']` — we want the @scope/name. */
function extractMcpPackage(def: McpProviderDef): string {
  try {
    const cfg = def.buildConfig({});
    const pkgArg = cfg.args.find((a) => a.startsWith('@') || a.includes('/'));
    return pkgArg ?? cfg.command;
  } catch {
    return 'unknown-mcp-package';
  }
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────

/**
 * Register every known connector. Safe to call multiple times — the
 * registry's `register()` throws on duplicate ids, so we only register
 * if the id isn't already present (handles vitest module reloads where
 * the singleton survives but the manifests file is re-imported).
 */
export function bootstrapConnectorRegistry(): void {
  // 1. Auto-mapped MCP providers
  for (const [key, def] of Object.entries(MCP_PROVIDERS)) {
    const manifest = mcpProviderToManifest(key, def);
    if (!connectorRegistry.has(manifest.id)) {
      connectorRegistry.register(manifest);
    }
  }
  // 2. Handwritten first-class manifests
  for (const manifest of [REMOTION_MANIFEST, BLENDER_MANIFEST]) {
    if (!connectorRegistry.has(manifest.id)) {
      connectorRegistry.register(manifest);
    }
  }
}

// Auto-bootstrap on import. Production callers (api routes, resolver,
// dashboard data layer) all import this module; the registry is populated
// before any of them try to read it.
bootstrapConnectorRegistry();

// Re-export the manifests for testing + custom-build paths.
export { REMOTION_MANIFEST } from './remotion.js';
export { BLENDER_MANIFEST } from './blender.js';
