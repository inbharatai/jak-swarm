/**
 * Per-tenant connector-credential side-channel registry.
 *
 * SwarmState is persisted to Postgres on every transition (`stateJson:
 * checkpoint` at swarm-execution.service.ts), so `state` cannot carry
 * decrypted connector credentials — a Gmail app-password, a CalDAV
 * password, or a Salesforce access-token would be written to the DB in
 * plaintext (a secret-leak regression). The per-tenant connector layer
 * needs these decrypted credentials at tool-execution time, but they
 * must never touch the persisted state.
 *
 * This mirrors the established pattern at `supervisor/llm-key-registry.ts`
 * (and `activity-registry.ts`): a per-workflow-id map, registered by the
 * workflow runtime just before execution runs, consumed by worker nodes
 * when they build the AgentContext (worker-node.ts looks it up by
 * `state.workflowId` — the same key the LLM key path uses). The registry
 * is process-local and ephemeral — it is not persisted and does not cross
 * instance boundaries.
 *
 * Security: the decrypted credentials live only in this in-memory map for
 * the duration of the workflow. They are cleared in the `finally` block
 * (swarm-runner.ts) when the workflow terminates, so we don't leak memory
 * or hold decrypted secrets longer than necessary.
 *
 * Tenant isolation: the map is keyed by `workflowId`, and a workflow is
 * scoped to exactly one tenant, so a tool executing under workflowId W
 * can only ever resolve the credentials registered for W — never another
 * tenant's. The tenantId on the execution context is the trusted source of
 * tenancy (set by the auth/workflow layer, never from request input); the
 * registry lookup is by the same workflowId that state already carries.
 */

// Structural credential shapes — kept decoupled from @jak-swarm/tools
// (whose package exports only the root entry, not an `./adapters`
// subpath) by mirroring the field names the tool resolvers read. These
// are structurally identical to `TenantEmailCredentials` /
// `TenantCalendarCredentials` / `TenantCrmCredentials` in
// packages/tools/src/adapters/adapter-factory.ts and to the
// `emailCredentials` / `calendarCredentials` / `crmCredentials` fields
// on `ToolExecutionContext` in packages/shared. The tool resolver
// accepts the context's fields structurally, so this bundle satisfies
// them without a direct import.

/** Gmail (IMAP/SMTP) app-password credentials. */
export interface TenantEmailCredentials {
  email: string;
  appPassword: string;
}

/** Google Calendar (CalDAV basic-auth) app-password credentials. */
export interface TenantCalendarCredentials {
  email: string;
  appPassword: string;
}

/** Per-tenant CRM OAuth credentials (Salesforce today). */
export interface TenantCrmCredentials {
  salesforce?: { accessToken: string; instanceUrl: string };
}

/**
 * The decrypted per-tenant connector credentials carried for one workflow.
 * Each field is optional — a tenant may have connected Gmail but not
 * Salesforce, etc. Undefined fields mean "not configured for this
 * tenant"; the tool resolver falls back to its Unconfigured stub (which
 * throws on use) rather than silently using another tenant's creds.
 */
export interface TenantCredentialBundle {
  emailCredentials?: TenantEmailCredentials;
  calendarCredentials?: TenantCalendarCredentials;
  crmCredentials?: TenantCrmCredentials;
}

const tenantCredentials = new Map<string, TenantCredentialBundle>();

/**
 * Register decrypted per-tenant connector credentials for a workflow.
 * Called by swarm-runner.ts after swarm-execution.service.ts resolves +
 * decrypts them from the tenant's Integration rows. Safe to call multiple
 * times — the latest bundle wins (merge so partial re-registrations don't
 * drop fields a prior registration set).
 */
export function registerTenantCredentials(
  workflowId: string,
  bundle: TenantCredentialBundle,
): void {
  const existing = tenantCredentials.get(workflowId);
  if (existing) {
    tenantCredentials.set(workflowId, {
      ...existing,
      ...bundle,
      emailCredentials: bundle.emailCredentials ?? existing.emailCredentials,
      calendarCredentials: bundle.calendarCredentials ?? existing.calendarCredentials,
      crmCredentials: bundle.crmCredentials ?? existing.crmCredentials,
    });
  } else {
    tenantCredentials.set(workflowId, bundle);
  }
}

/**
 * Look up the decrypted per-tenant credentials for a workflow. Returns
 * undefined when no bundle is registered (e.g. tenant hasn't connected
 * the provider, unit tests, legacy callers) — worker nodes treat each
 * undefined field as "not configured" and the tool resolver returns its
 * Unconfigured stub.
 */
export function getTenantCredentials(workflowId: string): TenantCredentialBundle | undefined {
  return tenantCredentials.get(workflowId);
}

/**
 * Remove the credential bundle once the workflow terminates. Called by
 * the workflow runtime in `finally` so we don't leak memory or hold
 * decrypted secrets longer than necessary.
 */
export function clearTenantCredentials(workflowId: string): void {
  tenantCredentials.delete(workflowId);
}