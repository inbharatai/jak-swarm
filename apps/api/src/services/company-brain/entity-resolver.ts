/**
 * entity-resolver.ts — pure stable-identifier entity resolution for the
 * Company Brain (truth-doc C2/D2 foundation).
 *
 * The production v2 brain resolves entities with `properties::TEXT ILIKE`,
 * which is fuzzy and leaky (same person split, or two people merged on a
 * shared substring). This module is the deterministic, pure replacement core:
 * entities resolve by SHARED NORMALIZED STABLE IDENTIFIERS (email, github
 * handle, tenant-scoped external id, phone), not by name substring. It is
 * unit-tested and benchmarked (brain-accuracy-benchmark.ts) so the brain's
 * identity accuracy is a measured number with a regression gate — not an
 * assertion.
 *
 * Pure: no I/O, no LLM, no DB. The v2 brain wires this as the identity layer
 * (C2); until then it is the auditable, benchmarked spec for that wiring.
 */

export type IdentifierKind = 'email' | 'github' | 'phone' | 'external_id';

export interface StableIdentifier {
  kind: IdentifierKind;
  /** Source system for external_id (e.g. "salesforce", "hubspot"). Ignored for email/github/phone. */
  source?: string;
  /** Normalized form used for equality (lowercased, trimmed, digits-only for phone). */
  normalized: string;
}

export interface EntityCandidate {
  id: string;
  tenantId: string;
  name: string;
  identifiers: StableIdentifier[];
}

export interface ResolvedEntity {
  /** Candidate ids that merged into this entity (>=1). */
  memberIds: string[];
  tenantId: string;
  /** The set of distinct normalized identifiers backing the merge. */
  identifierKeys: string[];
}

export interface ResolutionMetrics {
  candidateCount: number;
  clusterCount: number;
  singletonCount: number;
  mergedCount: number;
}

/** Normalize a raw identifier value by kind. Returns '' for unusable input. */
export function normalizeIdentifier(kind: IdentifierKind, value: string): string {
  if (typeof value !== 'string') return '';
  let v = value.trim();
  if (v.length === 0) return '';
  if (kind === 'email') {
    v = v.toLowerCase();
    // strip mailto:
    if (v.startsWith('mailto:')) v = v.slice('mailto:'.length);
    return v;
  }
  if (kind === 'github') {
    v = v.toLowerCase();
    if (v.startsWith('https://github.com/')) v = v.slice('https://github.com/'.length);
    if (v.startsWith('http://github.com/')) v = v.slice('http://github.com/'.length);
    if (v.startsWith('@')) v = v.slice(1);
    v = v.replace(/\/+$/, '');
    return v;
  }
  if (kind === 'phone') {
    return v.replace(/[^\d]/g, '');
  }
  // external_id: lowercase + trim; source disambiguates at the key level.
  return v.toLowerCase();
}

/** A stable hashable key for an identifier. external_id is scoped by source. */
export function identifierKey(id: StableIdentifier): string {
  if (id.kind === 'external_id') {
    return 'external_id:' + (id.source ?? 'unknown') + ':' + id.normalized;
  }
  return id.kind + ':' + id.normalized;
}

/**
 * Resolve a set of candidates into entities by union-find over shared
 * identifier keys (within a tenant). Two candidates merge iff they share at
 * least one identifier key. Name similarity is NEVER used to merge — names
 * collide (two "John Smith"s) and would cause false merges.
 */
export function resolveEntities(candidates: EntityCandidate[]): {
  entities: ResolvedEntity[];
  metrics: ResolutionMetrics;
} {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) && parent.get(cur) !== cur) cur = parent.get(cur) as string;
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    parent.set(ra, rb);
  };

  // key -> first candidate id that claimed it (per tenant, but identifierKey
  // for external_id already scopes by source; email/github are global within a
  // tenant -- we partition by tenantId first to prevent cross-tenant merges).
  const keyToCandidate = new Map<string, string>();

  for (const c of candidates) {
    parent.set(c.id, c.id);
  }
  for (const c of candidates) {
    for (const id of c.identifiers) {
      if (!id.normalized) continue;
      const k = c.tenantId + '|' + identifierKey(id);
      const prev = keyToCandidate.get(k);
      if (prev && prev !== c.id) {
        union(prev, c.id);
      } else {
        keyToCandidate.set(k, c.id);
      }
    }
  }

  const clusters = new Map<string, string[]>();
  for (const c of candidates) {
    const root = find(c.id);
    const arr = clusters.get(root) ?? [];
    arr.push(c.id);
    clusters.set(root, arr);
  }

  const entities: ResolvedEntity[] = [];
  let singletonCount = 0;
  for (const [root, memberIds] of clusters) {
    const tenantId = candidates.find((c) => c.id === root)?.tenantId ?? '';
    const keys = new Set<string>();
    for (const mid of memberIds) {
      const cand = candidates.find((c) => c.id === mid);
      for (const id of cand?.identifiers ?? []) {
        if (id.normalized) keys.add(identifierKey(id));
      }
    }
    entities.push({ memberIds, tenantId, identifierKeys: [...keys] });
    if (memberIds.length === 1) singletonCount += 1;
  }

  return {
    entities,
    metrics: {
      candidateCount: candidates.length,
      clusterCount: entities.length,
      singletonCount,
      mergedCount: candidates.length - singletonCount,
    },
  };
}
