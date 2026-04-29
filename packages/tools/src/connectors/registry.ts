/**
 * ConnectorRegistry — singleton process-local registry of all
 * Connector Runtime manifests + their current status.
 *
 * Wraps the existing tool/MCP/integration infrastructure rather than
 * replacing it. The registry is the canonical source for:
 *   - the dashboard "what connectors exist + their status"
 *   - the resolver "which connector should serve this task"
 *   - the installer "what command to run + what to validate"
 *   - the truth-check CI gate "are marketing claims backed by code"
 *
 * Status mutations are runtime-only (process-local Map). Persistent
 * status (configured credentials, last successful validation) lives
 * in the existing Integration + IntegrationCredential Prisma rows.
 * The registry exposes a `hydrateStatus` hook the API layer calls at
 * boot to merge persisted state into the in-memory view.
 */

import type {
  ConnectorManifest,
  ConnectorStatus,
  ConnectorView,
} from './types.js';

class ConnectorRegistryImpl {
  /** id → manifest. Frozen once registered to prevent runtime mutation. */
  private readonly manifests = new Map<string, ConnectorManifest>();
  /** id → runtime status (defaults to manifest's natural baseline). */
  private readonly statuses = new Map<string, ConnectorStatus>();
  /** id → last-validation timestamp (ISO). */
  private readonly lastValidatedAt = new Map<string, string>();
  /** id → tool count after install/validation. */
  private readonly installedToolCount = new Map<string, number>();
  /** id → reason for the current status (when not `available`). */
  private readonly statusReasons = new Map<string, string>();

  /**
   * Register a manifest. Throws if `id` is already taken — the registry
   * is append-only at the manifest layer; status mutations use
   * setStatus() instead.
   */
  register(manifest: ConnectorManifest): void {
    if (this.manifests.has(manifest.id)) {
      throw new Error(`Connector "${manifest.id}" already registered`);
    }
    // Defensively freeze so callers cannot reach in and mutate fields
    // (especially riskLevel / canPublishExternalContent) post-registration.
    this.manifests.set(manifest.id, Object.freeze({ ...manifest }));
    // Default status: `available` for everything except connectors that
    // declare `manualSetupSteps` (those start as `needs_user_setup` so
    // the dashboard immediately tells the user what to do).
    const baseline: ConnectorStatus =
      manifest.manualSetupSteps && manifest.manualSetupSteps.length > 0
        ? 'needs_user_setup'
        : 'available';
    this.statuses.set(manifest.id, baseline);
  }

  /**
   * Update a connector's runtime status. Refuses transitions that would
   * lie to the user — specifically:
   *   - `installed` requires the caller to have just run + verified
   *     `validationCommand`; we trust the caller but log every transition.
   *   - `configured` requires the connector to be `installed` first
   *     (or to have no installable artifact).
   *   - Once `failed_validation`, only an explicit `setStatus` call back
   *     to `installed`/`configured` clears it (no auto-flip).
   *
   * The `reason` is persisted so the dashboard can render it.
   */
  setStatus(id: string, status: ConnectorStatus, reason?: string): void {
    if (!this.manifests.has(id)) {
      throw new Error(`Connector "${id}" not registered`);
    }
    const manifest = this.manifests.get(id)!;

    // Honesty rule: `installed` and `configured` require a real install
    // path. If the manifest declares no installable artifact (no install
    // method AND no MCP), only `available` / `unavailable` /
    // `needs_user_setup` / `disabled` / `blocked_by_policy` are legal.
    if ((status === 'installed' || status === 'configured') && !manifest.installMethod) {
      throw new Error(
        `Cannot set status="${status}" on connector "${id}": manifest declares no installMethod`,
      );
    }

    this.statuses.set(id, status);
    if (reason !== undefined) {
      this.statusReasons.set(id, reason);
    } else {
      this.statusReasons.delete(id);
    }
  }

  /**
   * Mark a connector as freshly validated. Caller is responsible for
   * actually running the validation_command first; the registry does
   * not run subprocesses. Updates lastValidatedAt + installedToolCount.
   */
  recordValidation(id: string, params: {
    success: boolean;
    failureReason?: string;
    installedToolCount?: number;
  }): void {
    if (!this.manifests.has(id)) {
      throw new Error(`Connector "${id}" not registered`);
    }
    const now = new Date().toISOString();
    if (params.success) {
      this.lastValidatedAt.set(id, now);
      if (params.installedToolCount !== undefined) {
        this.installedToolCount.set(id, params.installedToolCount);
      }
      // If it had been failed_validation, lift the failure flag.
      if (this.statuses.get(id) === 'failed_validation') {
        this.statuses.set(id, 'installed');
        this.statusReasons.delete(id);
      }
    } else {
      this.statuses.set(id, 'failed_validation');
      if (params.failureReason !== undefined) {
        this.statusReasons.set(id, params.failureReason);
      }
    }
  }

  /** True iff the manifest is registered. */
  has(id: string): boolean {
    return this.manifests.has(id);
  }

  /** Look up one connector with status. Returns undefined if not registered. */
  get(id: string): ConnectorView | undefined {
    const manifest = this.manifests.get(id);
    if (!manifest) return undefined;
    return this.buildView(id, manifest);
  }

  /** All registered connectors with their current status. Order is
      registration order — the first MCP entries first, then manual
      manifests appended after. */
  list(): ConnectorView[] {
    return Array.from(this.manifests.entries()).map(([id, m]) => this.buildView(id, m));
  }

  /** Filter by category for the marketplace UI. */
  listByCategory(category: ConnectorManifest['category']): ConnectorView[] {
    return this.list().filter((v) => v.manifest.category === category);
  }

  /** Filter by status — used by the dashboard "needs setup" + "ready"
      panels. */
  listByStatus(...statuses: ConnectorStatus[]): ConnectorView[] {
    const set = new Set<ConnectorStatus>(statuses);
    return this.list().filter((v) => set.has(v.status));
  }

  /** Number of registered connectors — used by truth-check CI. */
  size(): number {
    return this.manifests.size;
  }

  /**
   * TEST-ONLY reset hook. Called by registry.test.ts beforeEach so each
   * test gets a clean slate. NOT exposed via the public package index.
   * Real product code never calls this.
   */
  __resetForTest(): void {
    this.manifests.clear();
    this.statuses.clear();
    this.lastValidatedAt.clear();
    this.installedToolCount.clear();
    this.statusReasons.clear();
  }

  private buildView(id: string, manifest: ConnectorManifest): ConnectorView {
    const view: ConnectorView = {
      manifest,
      status: this.statuses.get(id) ?? 'available',
    };
    const lastValidated = this.lastValidatedAt.get(id);
    if (lastValidated !== undefined) view.lastValidatedAt = lastValidated;
    const toolCount = this.installedToolCount.get(id);
    if (toolCount !== undefined) view.installedToolCount = toolCount;
    const reason = this.statusReasons.get(id);
    if (reason !== undefined) view.statusReason = reason;
    return view;
  }
}

/** Module-level singleton — every consumer reads the same registry. */
export const connectorRegistry = new ConnectorRegistryImpl();

/** Type alias for tests that want to assert against the singleton type. */
export type ConnectorRegistry = ConnectorRegistryImpl;
