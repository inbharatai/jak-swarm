/**
 * Front-end-only connection-status normalizer.
 *
 * The Prisma `Integration.status` field is currently a free-form String.
 * Brief mandates: layman-friendly status taxonomy of {Connected /
 * Not connected / Expired / Permission needed / Coming soon}. Rather
 * than blocking on a back-end migration this session, we normalize at
 * the UI boundary so the dashboard speaks the user's language today.
 *
 * Phase 2 will migrate the Prisma column to a proper enum and remove
 * this normalizer.
 */

export type LaymanConnectionStatus =
  | 'CONNECTED'
  | 'NOT_CONNECTED'
  | 'EXPIRED'
  | 'PERMISSION_NEEDED'
  | 'COMING_SOON';

export interface LaymanStatusDisplay {
  status: LaymanConnectionStatus;
  /** Short label suitable for a status badge. */
  label: string;
  /** Tone hint for badge styling. */
  tone: 'success' | 'warning' | 'neutral' | 'info' | 'error';
}

/**
 * Normalize ANY backend status string into the layman taxonomy.
 *
 * Inputs the back-end actually returns today (audit confirmed):
 *   - 'CONNECTED' (default)
 *   - 'DISCONNECTED'
 *   - 'EXPIRED'
 *   - free-form provider-specific values
 *
 * `null`/`undefined`/empty → NOT_CONNECTED (the integration isn't set up yet).
 */
export function normalizeConnectionStatus(
  raw: string | null | undefined,
  options?: { knownButUnconfigured?: boolean },
): LaymanStatusDisplay {
  // Coming-soon overrides everything: it's a UX promise, not a state.
  if (options?.knownButUnconfigured) {
    return { status: 'COMING_SOON', label: 'Coming soon', tone: 'neutral' };
  }

  const v = (raw ?? '').toUpperCase();

  if (v === 'CONNECTED' || v === 'ACTIVE' || v === 'AUTHORIZED') {
    return { status: 'CONNECTED', label: 'Connected', tone: 'success' };
  }
  if (v === 'EXPIRED' || v === 'TOKEN_EXPIRED' || v === 'REFRESH_FAILED') {
    return { status: 'EXPIRED', label: 'Reconnect needed', tone: 'warning' };
  }
  if (
    v === 'PERMISSION_NEEDED' ||
    v === 'INSUFFICIENT_SCOPE' ||
    v === 'PERMISSION_DENIED' ||
    v === 'SCOPE_MISSING'
  ) {
    return { status: 'PERMISSION_NEEDED', label: 'Permission needed', tone: 'warning' };
  }
  if (v === 'ERROR' || v === 'FAILED') {
    return { status: 'EXPIRED', label: 'Connection error', tone: 'error' };
  }
  // 'DISCONNECTED', '', null, anything else → not connected.
  return { status: 'NOT_CONNECTED', label: 'Not connected', tone: 'neutral' };
}
