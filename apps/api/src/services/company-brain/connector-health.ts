/**
 * connector-health.ts — unified, honest connector runtime-health contract
 * (truth-doc A8: there was no unified connector-health contract; only the 3
 * sync providers surfaced status, with no `healthy/degraded/down` runtime
 * classification across all 22 connectors).
 *
 * Pure + deterministic: derives a health status from fields that already exist
 * on the integration + sync-state rows, so every connector (not just the 3 sync
 * providers) can render an honest live-status badge. No I/O, no migration.
 */
export type ConnectorHealthStatus = 'healthy' | 'degraded' | 'down' | 'unconfigured' | 'reauth_required';

export interface ConnectorRuntimeHealth {
  provider: string;
  connected: boolean;
  status: ConnectorHealthStatus;
  lastSuccessAt?: Date | null;
  lastError?: string | null;
  consecutiveFailures: number;
}

export interface ConnectorHealthInput {
  provider: string;
  /** Integration.status: 'CONNECTED' | 'DISCONNECTED' | 'NEEDS_REAUTH' | 'ERROR' | ... */
  integrationStatus?: string | null;
  /** CompanyConnectorSyncState.consecutiveFailures (sync providers only). */
  syncConsecutiveFailures?: number;
  syncLastError?: string | null;
  syncLastSuccessAt?: Date | null;
}

/**
 * Classify a connector's runtime health from existing fields. Rules:
 *   - NEEDS_REAUTH / DISCONNECTED with prior connection -> reauth_required
 *   - no integration row / DISCONNECTED never-connected -> unconfigured
 *   - CONNECTED with >=3 consecutive sync failures -> down
 *   - CONNECTED with 1-2 consecutive failures or a recent error -> degraded
 *   - CONNECTED otherwise -> healthy
 * Pure so the classification is unit-testable without a database.
 */
export function classifyConnectorHealth(input: ConnectorHealthInput): ConnectorHealthStatus {
  const status = (input.integrationStatus ?? '').toUpperCase();
  if (status === 'NEEDS_REAUTH') return 'reauth_required';
  if (status === 'ERROR') return 'down';
  if (!status || status === 'DISCONNECTED') return 'unconfigured';
  if (status !== 'CONNECTED') return 'unconfigured';

  const failures = input.syncConsecutiveFailures ?? 0;
  if (failures >= 3) return 'down';
  if (failures >= 1 || input.syncLastError) return 'degraded';
  return 'healthy';
}

/** Build a full ConnectorRuntimeHealth snapshot from existing fields. Pure. */
export function buildConnectorHealth(input: ConnectorHealthInput): ConnectorRuntimeHealth {
  return {
    provider: input.provider,
    connected: (input.integrationStatus ?? '').toUpperCase() === 'CONNECTED',
    status: classifyConnectorHealth(input),
    lastSuccessAt: input.syncLastSuccessAt ?? null,
    lastError: input.syncLastError ?? null,
    consecutiveFailures: input.syncConsecutiveFailures ?? 0,
  };
}
