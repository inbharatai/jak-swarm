/**
 * Connector Runtime — type definitions.
 *
 * The Connector Runtime is JAK's unified, connector-first abstraction over
 * every external capability the platform can use to do real work: MCP
 * servers, REST APIs, browser automation, local CLIs, cloud services,
 * Python or Node scripts. It builds on top of the existing infrastructure
 * (`packages/tools/src/mcp/*`, `packages/tools/src/registry/*`,
 * `apps/api/src/routes/integrations.routes.ts`) — it does NOT replace them.
 *
 * Why a runtime? See the master spec: JAK does not need every tool
 * preinstalled. It needs to understand what tool a task requires,
 * explain why, safely connect/install/configure it (with approval),
 * use it through the right agent, validate the result, and surface
 * everything in the dashboard.
 *
 * Design principles:
 *   - WRAP existing surfaces. The 21 entries in MCP_PROVIDERS auto-seed
 *     the registry. Don't duplicate metadata; map it.
 *   - HONEST status. A connector is `installed` only after a real
 *     install attempt; `configured` only after credentials persist;
 *     `available` only after a real validation_command succeeds.
 *   - APPROVAL by default. Every install / external publish / file
 *     overwrite hits the existing ApprovalRequest gate. Trusted auto-
 *     approval is opt-in and only for connectors with
 *     `supportsAutoApproval: true` AND riskLevel <= MEDIUM.
 *   - NO HALLUCINATED INTEGRATIONS. If a connector exists in the
 *     registry but is not configured, its status reflects that.
 *     Marketing copy reads from the registry, not from a wishlist.
 */

import type { RiskLevel } from '@jak-swarm/shared';

// ─── Status enum ───────────────────────────────────────────────────────────

/**
 * Lifecycle states a connector progresses through. Mirrored in the dashboard
 * UI; CI guards against any code path setting `installed`/`configured`
 * without first validating.
 */
export type ConnectorStatus =
  /** Manifest registered; nothing else done yet. The default for any
      connector with no credentials, no install attempt, no validation. */
  | 'available'
  /** Install command ran successfully + the validation_command returned
      the expected output. Credentials may or may not be present. */
  | 'installed'
  /** Installed AND user-supplied credentials are persisted (encrypted)
      in IntegrationCredential. Ready for runtime use. */
  | 'configured'
  /** Manifest declares the connector is reachable but requires the user
      to perform a one-time setup step JAK cannot automate (e.g., Blender
      desktop app must be open + MCP plug-in loaded). */
  | 'needs_user_setup'
  /** Validation command failed or returned an unexpected result. Stays
      until re-validated successfully. NEVER auto-flips back to
      `installed` without a fresh validation. */
  | 'failed_validation'
  /** Manifest exists but the connector is not reachable from this
      deployment (missing required env, OS unsupported, etc.). */
  | 'unavailable'
  /** Tenant-admin or platform-admin explicitly disabled this connector. */
  | 'disabled'
  /** Tenant policy / industry pack forbids this connector. */
  | 'blocked_by_policy';

// ─── Runtime type taxonomy ────────────────────────────────────────────────

/**
 * Tells the Connector Runtime which physical mechanism to invoke when
 * routing an agent's tool call to this connector. NOT a UI category.
 */
export type ConnectorRuntimeType =
  /** Stdio MCP server (the existing McpClientManager handles these). */
  | 'mcp'
  /** Direct REST/HTTP API (existing tool adapter pattern). */
  | 'api'
  /** Browser-automation steps (Playwright via the existing browser
      adapter). */
  | 'browser'
  /** Local Node/JS script invoked via subprocess. Remotion CLI is the
      canonical example. */
  | 'node_cli'
  /** Local Python script invoked via subprocess. */
  | 'python_cli'
  /** Generic local script (shell command). Stricter approval gates. */
  | 'local_script'
  /** Hosted cloud service we call into (e.g., AWS Lambda, Cloud Run
      render endpoint, Vercel deploy hook). */
  | 'cloud_service';

// ─── Manifest ──────────────────────────────────────────────────────────────

/**
 * Optional credential field a connector requires. Mirrors the existing
 * `ProviderCredentialField` from `mcp-providers.ts` so MCP entries can
 * be auto-mapped in `manifests/index.ts` without losing fidelity.
 */
export interface ConnectorCredentialField {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
  helpUrl?: string;
}

/**
 * Full manifest the Connector Runtime stores per registered connector.
 * Marketing copy, the resolver, the installer, the dashboard, and CI
 * guards all read from one canonical shape.
 */
export interface ConnectorManifest {
  /** Stable identifier (`remotion`, `blender`, `slack-mcp`, …). Lowercase
      kebab-case. Used everywhere — keys in the registry, URL paths, CI
      truth-checks. Never change for a connector that has shipped. */
  id: string;

  /** Human display name (`Remotion`, `Blender`, `Slack`, …). */
  name: string;

  /** UI category for the marketplace + dashboard grouping. */
  category:
    | 'creative'
    | 'coding'
    | 'research'
    | 'business'
    | 'media'
    | 'local'
    | 'cloud';

  /** One-sentence description for the marketplace card. */
  description: string;

  /** Which physical runtime to invoke. Drives routing in the worker-node. */
  runtimeType: ConnectorRuntimeType;

  /**
   * If the connector has an installable component (npm package, Docker
   * image, CLI binary), the install method. `null` if the connector has
   * no installable artifact (pure REST API).
   */
  installMethod?:
    | 'npx'
    | 'npm-global'
    | 'docker'
    | 'pip'
    | 'system-binary'
    | 'mcp-stdio';

  /**
   * Exact shell command to install. Only executed after explicit
   * approval AND only when the source is on the allowlist
   * (`sourceAllowlist` below). Never templated with user input.
   */
  installCommand?: string;

  /**
   * Where the install artifact comes from. CI rejects any installCommand
   * whose origin isn't in this allowlist. Examples:
   *   - npm: ['@remotion/cli', '@modelcontextprotocol/server-slack']
   *   - docker: ['blender/blender:latest']
   *   - github: ['ahujasid/blender-mcp']
   */
  sourceAllowlist?: string[];

  /**
   * If install requires user-side steps the runtime CANNOT automate
   * (e.g., download Blender desktop, install Adobe CC, open a Notion
   * integration page), describe the steps as a numbered list of
   * markdown lines. The dashboard renders these verbatim.
   */
  manualSetupSteps?: string[];

  /**
   * URL or local command the runtime invokes after install to confirm
   * the connector actually works. CRITICAL: status is never set to
   * `installed` without a successful validation. Marketing copy reads
   * from status; therefore validation_command is the single source of
   * truth for "is this connector real today?"
   */
  validationCommand?: string;

  /**
   * Substring or regex (as plain string) the validation output must
   * contain to count as success. e.g., for `npx remotion --version`,
   * expect `^[0-9]+\.[0-9]+`.
   */
  validationExpectedOutput?: string;

  /** Tools this connector exposes once configured. Names match the
      ToolRegistry entries that will get registered. */
  availableTools: string[];

  /** Risk gate. HIGH/CRITICAL connectors NEVER auto-approve installs
      or external side-effects regardless of the tenant's auto-approve
      setting. Maps to the existing RiskLevel enum so the approval-node
      threshold check works without modification. */
  riskLevel: RiskLevel;

  /** If true, the existing approval-node will gate operations on this
      connector. Default true. */
  approvalRequired: boolean;

  /** If true AND riskLevel <= MEDIUM AND tenant has auto-approve
      enabled, install/operations may auto-approve. Logs always written. */
  supportsAutoApproval: boolean;

  /** This connector can run inside a sandbox (Docker, E2B). Drives
      where the runtime executes the installCommand. */
  supportsSandbox: boolean;

  /** This connector can be invoked over a hosted cloud render path
      (AWS Lambda, Cloud Run). For Remotion: true. For Blender desktop: false. */
  supportsCloud: boolean;

  /** This connector can be invoked locally (subprocess on the same
      machine as the JAK API). For Remotion: true. For Adobe CC web: false. */
  supportsLocal: boolean;

  /** Operating on this connector may write to the user's filesystem.
      Forces an approval gate on file-writing tool calls. */
  canModifyFiles: boolean;

  /** Operating on this connector may publish content to an external
      audience (post to Slack, push to GitHub, deploy to Vercel,
      upload to YouTube). ALWAYS triggers an approval gate. */
  canPublishExternalContent: boolean;

  /** This connector reads or processes user PII / customer data.
      Forces RuntimePIIRedactor to be active for tool inputs. */
  canAccessUserData: boolean;

  /** Whether this connector is enabled in fresh tenants by default.
      Most are off — tenant-admin opts in. */
  defaultEnabled: boolean;

  /** Public docs URL for the marketplace card. */
  docsUrl?: string;

  /** Environment variables the runtime needs to pass through to the
      installed connector. Only listed names; values come from the
      encrypted IntegrationCredential row, never from process.env at
      call time. */
  environmentVariablesRequired?: string[];

  /** Credential fields the user must supply on connect. Mirrors the
      existing ProviderCredentialField shape from mcp-providers.ts. */
  credentialFields?: ConnectorCredentialField[];

  /** Markdown setup instructions shown above the credential form. */
  setupInstructions?: string;

  /** Internal: which existing surface this connector was sourced from.
      `mcp-providers` means it was auto-mapped from MCP_PROVIDERS;
      `manual` means a hand-written manifest in manifests/. Used by
      the registry to avoid duplicate registration on hot-reload. */
  source: 'mcp-providers' | 'manual';

  /** Optional: the canonical source of truth for the package status
      when sourced from MCP_PROVIDERS. */
  packageStatus?: 'OFFICIAL' | 'ANTHROPIC' | 'COMMUNITY';
}

// ─── Runtime view (status + manifest) ─────────────────────────────────────

/**
 * What the dashboard + resolver see when they ask the registry about a
 * connector. `manifest` is the static spec; `status` + `lastValidatedAt`
 * + `installedToolCount` come from runtime state.
 */
export interface ConnectorView {
  manifest: ConnectorManifest;
  status: ConnectorStatus;
  /** ISO timestamp of the last successful validation, if ever. */
  lastValidatedAt?: string;
  /** Number of tools the connector has actually exposed at runtime
      (set after install + validation). */
  installedToolCount?: number;
  /** When status === 'failed_validation' or 'unavailable', the reason. */
  statusReason?: string;
}

// ─── Resolver types ───────────────────────────────────────────────────────

/**
 * What the ConnectorResolver returns when given a natural-language task.
 * Multiple candidates supported because some tasks have several valid
 * paths (e.g., "make a video" → Remotion OR Runway OR FFmpeg).
 */
export interface ConnectorCandidate {
  connectorId: string;
  /** 0-1 confidence the resolver assigns. Heuristic for v1; LLM-driven
      in a follow-up sprint. */
  confidence: number;
  /** Why the resolver picked this connector — surfaced in the dashboard
      so the user always knows what JAK chose and why. */
  reason: string;
  /** Whether the connector is ready to use right now. If false, the
      installer/setup-assistant flow runs first. */
  isReady: boolean;
  /** If the connector is not ready, what the user (or the auto-installer)
      needs to do next. */
  nextStep?: string;
}

export interface ConnectorResolveResult {
  /** The strongest match — usually what the user gets. */
  primary?: ConnectorCandidate;
  /** Backup candidates (sorted by confidence desc). */
  alternatives: ConnectorCandidate[];
  /** Connectors that COULD have served the task but are unavailable
      (disabled, missing credentials, validation failed). The user sees
      this so they understand why they're getting a fallback. */
  unavailable: ConnectorCandidate[];
}
