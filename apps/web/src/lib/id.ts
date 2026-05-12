'use client';

/**
 * Browser-safe UUID helper.
 *
 * Do not import `@jak-swarm/shared` into client components just for IDs:
 * its package barrel also exports server-only skill parsing code that imports
 * `node:fs`, which breaks the Next.js dev browser bundle.
 */
export function generateBrowserId(prefix = ''): string {
  const uuid = globalThis.crypto.randomUUID();
  return prefix ? `${prefix}${uuid}` : uuid;
}
