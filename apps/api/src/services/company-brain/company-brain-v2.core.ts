/**
 * Company Brain Graph V2.
 *
 * Adds the governed organisational-memory layer missing from the original
 * artifact -> entity -> drift -> spec pipeline:
 *   - canonical entity resolution with auditable aliases/merges;
 *   - evidence-backed claims with authority, confidence and temporal status;
 *   - first-class typed graph edges;
 *   - contradiction/review handling instead of silent truth replacement;
 *   - task-specific, permission-filtered context packages for every agent.
 *
 * The V2 tables are accessed through parameterised raw SQL because they are
 * introduced additively by migration 118 while the existing Prisma-generated
 * CompanyArtifact / CompanyGraphEntity models remain unchanged. No dynamic
 * identifiers or caller-controlled SQL fragments are used.
 */

import { createHash } from 'node:crypto';

export type ClaimStatus = 'proposed' | 'active' | 'disputed' | 'superseded' | 'rejected';
export type ReviewStatus = 'open' | 'approved' | 'rejected' | 'resolved';
export type ArtifactVisibility = 'public' | 'internal' | 'restricted';

export interface CompanyArtifactV2Row {
  id: string;
  tenantId: string;
  sourceType: string;
  artifactType: string;
  title: string;
  body: string;
  bodyHash: string;
  authorName: string | null;
  occurredAt: Date | null;
  metadata: unknown;
  ingestionStatus: string;
  extractedAt: Date | null;
  visibility: ArtifactVisibility;
  allowedAgentRoles: string[];
  sensitivity: string;
  retentionUntil: Date | null;
  processingState: string;
  processingAttempts: number;
  processingError: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CompanyEntityV2Row {
  id: string;
  tenantId: string;
  primaryArtifactId: string | null;
  entityType: string;
  title: string;
  summary: string;
  status: string;
  ownerName: string | null;
  priority: string | null;
  confidence: number;
  occurredAt: Date | null;
  dueAt: Date | null;
  sourceArtifactIds: unknown;
  relatedEntityIds: unknown;
  properties: unknown;
  extractedBy: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CompanyClaimRow {
  id: string;
  tenantId: string;
  subjectEntityId: string;
  predicate: string;
  objectEntityId: string | null;
  objectValue: unknown;
  normalizedObject: string;
  fingerprint: string;
  status: ClaimStatus;
  confidence: number;
  authorityScore: number;
  validFrom: Date | null;
  validTo: Date | null;
  supersedesClaimId: string | null;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyEdgeRow {
  id: string;
  tenantId: string;
  sourceEntityId: string;
  relationshipType: string;
  targetEntityId: string;
  status: ClaimStatus;
  confidence: number;
  evidenceArtifactIds: unknown;
  validFrom: Date | null;
  validTo: Date | null;
  supersedesEdgeId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyMemoryReviewRow {
  id: string;
  tenantId: string;
  reviewType: 'claim' | 'entity_merge' | 'edge' | 'retention' | 'access';
  resourceId: string;
  status: ReviewStatus;
  reason: string;
  payload: unknown;
  priority: 'low' | 'medium' | 'high' | 'critical';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrainContextPackage {
  task: string;
  agentRole: string;
  generatedAt: string;
  entities: Array<Pick<CompanyEntityV2Row, 'id' | 'entityType' | 'title' | 'summary' | 'status' | 'ownerName' | 'priority' | 'dueAt'>>;
  claims: CompanyClaimRow[];
  edges: CompanyEdgeRow[];
  conflicts: CompanyClaimRow[];
  evidence: Array<{
    id: string;
    sourceType: string;
    artifactType: string;
    title: string;
    excerpt: string;
    occurredAt: string | null;
  }>;
  /** Sources filtered out by access policy (restricted/expired/role-not-allowed), for honest redaction telemetry. */
  omittedCount: number;
  contextText: string;
}

export interface ClaimCandidate {
  tenantId: string;
  subjectEntityId: string;
  predicate: string;
  objectEntityId?: string | null;
  objectValue?: unknown;
  confidence: number;
  authorityScore: number;
  validFrom?: Date | null;
  createdBy?: string | null;
  artifactId: string;
  excerpt?: string | null;
  observedAt?: Date | null;
}

export interface ClaimTransition {
  candidateStatus: ClaimStatus;
  existingStatus?: ClaimStatus;
  supersedesClaimId?: string;
  requiresReview: boolean;
  reason: string;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i',
  'in', 'is', 'it', 'of', 'on', 'or', 'our', 'the', 'this', 'to', 'we', 'what',
  'when', 'where', 'which', 'who', 'with', 'you', 'your',
]);

export const ARTIFACT_WITH_POLICY_SELECT = `
  a.*,
  COALESCE(p."visibility", 'internal') AS "visibility",
  COALESCE(p."allowedAgentRoles", ARRAY[]::TEXT[]) AS "allowedAgentRoles",
  COALESCE(p."sensitivity", 'normal') AS "sensitivity",
  p."retentionUntil" AS "retentionUntil",
  COALESCE(p."processingState", a."ingestionStatus") AS "processingState",
  COALESCE(p."processingAttempts", 0) AS "processingAttempts",
  p."processingError" AS "processingError"
`;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function stableJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(',')}}`;
}

export function normalizeEntityLabel(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(private|pvt|limited|ltd|llp|incorporated|inc|corporation|corp|company|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function labelTokens(value: string): Set<string> {
  return new Set(normalizeEntityLabel(value).split(' ').filter((token) => token.length > 1));
}

export function tokenSimilarity(left: string, right: string): number {
  const a = labelTokens(left);
  const b = labelTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Provenance gate (truth-doc C1): a V2 entity may only influence a workflow
 * if it has at least one source artifact (evidence it was extracted FROM).
 * An entity with no sourceArtifactIds AND no primaryArtifactId is source-less
 * -- an orphan with no evidence -- and must NOT enter agent context. This is
 * distinct from the access filter (which restricts by visibility): the
 * provenance gate drops orphans before access is even considered. Pure.
 */
export function hasEntityProvenance(entity: {
  sourceArtifactIds: unknown;
  primaryArtifactId?: string | null;
}): boolean {
  if (jsonStringArray(entity.sourceArtifactIds).length > 0) return true;
  const primary = typeof entity.primaryArtifactId === 'string' ? entity.primaryArtifactId.trim() : '';
  return primary.length > 0;
}

export function sourceAuthorityScore(artifact: Pick<CompanyArtifactV2Row, 'sourceType' | 'artifactType' | 'title' | 'metadata'>): number {
  const metadata = jsonObject(artifact.metadata);
  const signed = metadata['signed'] === true || metadata['signatureVerified'] === true;
  const approved = metadata['approved'] === true || metadata['approvalStatus'] === 'approved';
  if (signed) return 0.98;
  if (approved) return 0.92;

  const type = `${artifact.sourceType}:${artifact.artifactType}`.toLowerCase();
  if (type.includes('decision_note')) return 0.90;
  if (type.includes('pull_request') || type.includes('commit')) return 0.78;
  if (type.includes('ticket') || type.includes('issue')) return 0.72;
  if (type.includes('customer_call') || type.includes('customer_feedback')) return 0.68;
  if (type.includes('support')) return 0.64;
  if (type.includes('meeting')) return 0.60;
  if (type.includes('gmail') || type.includes('email')) return 0.58;
  if (type.includes('manual')) return 0.55;
  if (type.includes('document')) return 0.70;
  return 0.50;
}

export function canAgentAccessArtifact(
  artifact: Pick<CompanyArtifactV2Row, 'visibility' | 'allowedAgentRoles' | 'retentionUntil'>,
  agentRole: string,
  now = new Date(),
): boolean {
  if (artifact.retentionUntil && artifact.retentionUntil.getTime() < now.getTime()) return false;
  if (artifact.visibility === 'public' || artifact.visibility === 'internal') return true;
  const role = agentRole.trim().toUpperCase();
  return artifact.allowedAgentRoles.some((allowed) => allowed.trim().toUpperCase() === role);
}

// ---------------------------------------------------------------------------
// Entity resolver — Phase 3 canonical identity (6-tier hierarchy).
//
// The resolver decides, for a freshly extracted entity, whether it is the
// SAME canonical thing as an existing entity in the tenant graph. Identity is
// established strictly — never by fuzzy title alone — through a priority
// hierarchy of evidence, strongest first:
//
//   1. provider_external_id        — same integration source + same external id
//   2. verified_stable_identifier  — a shared, verifiable durable identifier
//                                     (email, domain, website, url, crmId,
//                                     externalId, handle, linkedin, github)
//   3. exact_alias                  — exact canonical alias (aliases table)
//   4. deterministic_composite      — exact normalized title AND no conflicting
//                                     identifier (two "Acme" with different
//                                     domains are NOT merged)
//   5. probabilistic_review         — 0.72–0.94 token similarity → human review
//   6. none                         — no reliable match → stay separate
//
// Tiers 1–4 are deterministic auto-merges (similarity 1.0) because the
// evidence is dispositive; tier 5 defers to a human. The algorithm version is
// stamped on every merge and on every deferred/rejected candidate so an audit
// can reconstruct *why* two entities were considered the same.
// ---------------------------------------------------------------------------

/** Bumped only when the tier order, identifier keys or thresholds change. */
export const ENTITY_RESOLVER_ALGORITHM_VERSION = 'entity-resolver-v1';

export type EntityResolutionTier =
  | 'provider_external_id'
  | 'verified_stable_identifier'
  | 'exact_alias'
  | 'deterministic_composite'
  | 'probabilistic_review'
  | 'none';

/**
 * Property keys (case-insensitive, also matched against snake/camel variants)
 * that hold a durable, verifiable identifier suitable for tier-2 identity.
 * Free-form `properties` from the extractor is untrusted input, so an
 * allowlist — not `Object.keys` — drives matching: a tenant cannot invent a
 * new "identity" key that auto-merges two otherwise-unrelated entities.
 */
export const STABLE_IDENTIFIER_KEYS = [
  'email',
  'domain',
  'website',
  'url',
  'crmid',
  'externalid',
  'handle',
  'linkedin',
  'github',
] as const;

const PROVIDER_KEYS = ['provider', 'source', 'integration', 'system'] as const;
const EXTERNAL_ID_KEYS = ['externalid', 'external_id', 'crmid', 'id', 'remoteid', 'sourceid', 'recordid'] as const;

/** Lowercase, trim, drop the scheme/www from URLs so two spellings of the same identifier match. */
export function normalizeStableIdentifier(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  let s = String(value).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  // Collapse mailto: / @ suffix noise on emails handled by the key being 'email'.
  return s;
}

/** Read a property by any case/snake/camel spelling of `key` from a JSON object. */
function pickProperty(properties: Record<string, unknown>, key: string): unknown {
  // Allowlist keys carry no separators (e.g. `crmid`, `externalid`); normalize
  // the input key to lowercase + underscore-stripped so `crm_id`, `crmId` and
  // `CRMID` all resolve to `crmid`.
  const want = key.toLowerCase().replace(/_/g, '');
  for (const [k, v] of Object.entries(properties)) {
    const norm = k.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/_/g, '');
    if (norm === want) return v;
  }
  return undefined;
}

export interface StableIdentifier {
  key: string;
  value: string;
}

/**
 * Extract the verified-stable identifiers carried by an entity's `properties`
 * JSONB. Returns a deduplicated, normalized list. Unknown keys are ignored
 * (allowlist-driven). Used by tier 2 and to detect *conflicting* identifiers
 * in tier 4.
 */
export function extractStableIdentifiers(properties: unknown): StableIdentifier[] {
  const obj = jsonObject(properties);
  const out: StableIdentifier[] = [];
  const seen = new Set<string>();
  for (const key of STABLE_IDENTIFIER_KEYS) {
    const raw = pickProperty(obj, key);
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const v = normalizeStableIdentifier(item);
        if (v && !seen.has(`${key}:${v}`)) {
          seen.add(`${key}:${v}`);
          out.push({ key, value: v });
        }
      }
    } else {
      const v = normalizeStableIdentifier(raw);
      if (v && !seen.has(`${key}:${v}`)) {
        seen.add(`${key}:${v}`);
        out.push({ key, value: v });
      }
    }
  }
  return out;
}

export interface ProviderExternalId {
  provider: string;
  externalId: string;
}

/** Tier-1 evidence: the integration source + its durable external record id. */
export function extractProviderExternalId(properties: unknown): ProviderExternalId | null {
  const obj = jsonObject(properties);
  let provider = '';
  for (const key of PROVIDER_KEYS) {
    const v = normalizeStableIdentifier(pickProperty(obj, key));
    if (v) { provider = v; break; }
  }
  let externalId = '';
  for (const key of EXTERNAL_ID_KEYS) {
    const v = normalizeStableIdentifier(pickProperty(obj, key));
    if (v) { externalId = v; break; }
  }
  if (!provider || !externalId) return null;
  return { provider, externalId };
}

/**
 * Tier-4 conflict check: two entities with the exact same normalized title may
 * still be different canonical things if they carry *contradicting* stable
 * identifiers (e.g. two companies named "Acme" with different domains). A
 * shared identifier is fine (it is tier-2 evidence anyway); a *conflicting*
 * identifier with no shared one blocks the deterministic merge.
 */
export function identifiersConflict(
  a: StableIdentifier[],
  b: StableIdentifier[],
): boolean {
  const byKeyA = new Map<string, Set<string>>();
  for (const id of a) {
    const set = byKeyA.get(id.key) ?? new Set<string>();
    set.add(id.value);
    byKeyA.set(id.key, set);
  }
  let anyShared = false;
  let anyClash = false;
  for (const id of b) {
    const setA = byKeyA.get(id.key);
    if (!setA) continue; // A has no value for this key — cannot clash
    if (setA.has(id.value)) anyShared = true;
    else anyClash = true;
  }
  // A clash blocks the deterministic merge ONLY when no identifier reconciles
  // the two entities (a shared value is dispositive tier-2 evidence anyway).
  return anyClash && !anyShared;
}

export function decideClaimTransition(
  candidate: Pick<ClaimCandidate, 'confidence' | 'authorityScore' | 'validFrom'>,
  existing?: Pick<CompanyClaimRow, 'id' | 'status' | 'authorityScore' | 'validFrom' | 'normalizedObject'>,
  sameValue = false,
): ClaimTransition {
  const candidateTrusted = candidate.authorityScore >= 0.82 && candidate.confidence >= 0.75;
  if (!existing) {
    return candidateTrusted
      ? { candidateStatus: 'active', requiresReview: false, reason: 'High-authority evidence established the first active claim.' }
      : { candidateStatus: 'proposed', requiresReview: true, reason: 'Claim requires review because source authority or extraction confidence is below the auto-activation threshold.' };
  }

  if (sameValue) {
    return {
      candidateStatus: existing.status,
      requiresReview: existing.status === 'proposed' || existing.status === 'disputed',
      reason: 'Equivalent evidence reinforces the existing claim.',
    };
  }

  const candidateTime = candidate.validFrom?.getTime() ?? 0;
  const existingTime = existing.validFrom?.getTime() ?? 0;
  const authorityDelta = candidate.authorityScore - existing.authorityScore;

  if (candidateTrusted && authorityDelta >= 0.15 && candidateTime >= existingTime) {
    return {
      candidateStatus: 'active',
      existingStatus: 'superseded',
      supersedesClaimId: existing.id,
      requiresReview: false,
      reason: 'Newer, materially more authoritative evidence supersedes the previous claim.',
    };
  }

  if (Math.abs(authorityDelta) < 0.15) {
    return {
      candidateStatus: 'disputed',
      requiresReview: true,
      reason: 'Conflicting claims have comparable authority and require human reconciliation.',
    };
  }

  return {
    candidateStatus: candidateTrusted ? 'disputed' : 'proposed',
    requiresReview: true,
    reason: 'Conflicting evidence is not sufficiently authoritative to replace the active claim automatically.',
  };
}

export function inferRelationshipType(sourceType: string, targetType: string): string {
  const source = sourceType.toLowerCase();
  const target = targetType.toLowerCase();
  if (source === 'customer_signal' && ['task', 'spec', 'requirement', 'code_change'].includes(target)) return 'influences';
  if (source === 'decision' && ['task', 'spec', 'requirement', 'code_change'].includes(target)) return 'operationalized_by';
  if (source === 'requirement' && ['task', 'spec', 'code_change'].includes(target)) return 'implemented_by';
  if (source === 'task' && target === 'owner') return 'owned_by';
  if (source === 'task' && target === 'deadline') return 'due_by';
  if (source === 'risk' && ['project', 'task', 'spec', 'requirement'].includes(target)) return 'threatens';
  return 'related_to';
}

export function predicateFromProperty(key: string): string | null {
  const normalized = key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  const allow = new Set([
    'contract_value', 'deal_value', 'deadline', 'launch_date', 'metric_value',
    'project', 'product', 'customer', 'requirement', 'decision', 'version',
    'region', 'country', 'currency', 'stage', 'owner', 'status', 'priority',
  ]);
  return allow.has(normalized) ? normalized : null;
}

export function normalizeObjectValue(value: unknown, objectEntityId?: string | null): string {
  if (objectEntityId) return `entity:${objectEntityId}`;
  if (typeof value === 'string') return normalizeEntityLabel(value);
  if (value instanceof Date) return value.toISOString();
  return stableJson(value);
}

export function excerptForEntity(entity: CompanyEntityV2Row): string {
  return `${entity.title}: ${entity.summary}`.slice(0, 1200);
}

export function contextTokens(task: string): string[] {
  return uniqueStrings(
    normalizeEntityLabel(task)
      .split(' ')
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  ).slice(0, 12);
}

export function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

// ---------------------------------------------------------------------------
// Phase 1 — typed, measured Company Brain context package.
//
// The retrieval pipeline returns this structured package. It deliberately
// retains `contextText` + `omittedCount` so the wired agent-prompt path
// (`PromptBuilder.injectCompanyContext` → `<company_brain>` block) and its
// existing tests keep working unchanged: the richer fields are additive and
// the agents-side `CompanyContextProvider.getContextPackage` contract only
// reads `contextText` + `omittedCount`.
// ---------------------------------------------------------------------------

export const COMPANY_BRAIN_RETRIEVAL_STRATEGY_VERSION = 'hybrid-v1';

export interface ContextActor {
  userId?: string;
  agentRole: string;
  workflowId?: string;
}

export interface ContextScope {
  projectIds: string[];
  customerIds: string[];
  entityIds: string[];
}

export interface ContextOmissions {
  /** Dropped because the source artifact is restricted and the actor's role is not on its allowedAgentRoles. */
  restricted: number;
  /** Dropped because the source artifact's retentionUntil has passed. */
  expired: number;
  /** Candidate entities that did not meet the relevance threshold for this task. */
  irrelevant: number;
}

export interface ContextRetrievalMeta {
  strategyVersion: string;
  candidateCount: number;
  selectedCount: number;
  /** Entities dropped by the C1 provenance gate (source-less orphans). */
  provenanceDrops?: number;
  latencyMs: number;
}

export interface ContextEntity {
  id: string;
  entityType: string;
  title: string;
  summary: string;
  status: string;
  ownerName: string | null;
  priority: string | null;
  dueAt: string | null;
  /** Composite relevance score in [0,1] from the hybrid retrieval. */
  score: number;
  sourceArtifactIds: string[];
}

export interface ContextClaim {
  id: string;
  subjectEntityId: string;
  predicate: string;
  objectEntityId: string | null;
  objectValue: unknown;
  normalizedObject: string;
  status: ClaimStatus;
  confidence: number;
  authorityScore: number;
  validFrom: string | null;
  validTo: string | null;
  /** Preserved evidence ids backing this claim (Phase 1 requirement). */
  evidenceIds: string[];
}

export interface ContextEdge {
  id: string;
  sourceEntityId: string;
  relationshipType: string;
  targetEntityId: string;
  status: ClaimStatus;
  confidence: number;
  evidenceArtifactIds: string[];
}

export interface ContextEvidence {
  id: string;
  sourceType: string;
  artifactType: string;
  title: string;
  excerpt: string;
  occurredAt: string | null;
}

export interface CompanyBrainContextPackage {
  id: string;
  tenantId: string;
  task: string;
  actor: ContextActor;
  scope: ContextScope;
  entities: ContextEntity[];
  claims: ContextClaim[];
  disputedClaims: ContextClaim[];
  edges: ContextEdge[];
  evidence: ContextEvidence[];
  omissions: ContextOmissions;
  retrieval: ContextRetrievalMeta;
  generatedAt: string;
  /** Rendered, budget-allocated text injected into `<company_brain>`. */
  contextText: string;
  /** Sum of omissions (restricted + expired + irrelevant) — telemetry continuity for the agents contract. */
  omittedCount: number;
}

// ---------------------------------------------------------------------------
// Pure retrieval helpers (unit-testable without a database).
// ---------------------------------------------------------------------------

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /https?:\/\/[^\s)'"]+/g;
const IDISH_RE = /\b([A-Z][A-Z0-9_]*-[A-Z0-9-]+|\b[A-Z]{2,}_\d{2,}\b)/g;

export interface TaskIdentifiers {
  emails: string[];
  urls: string[];
  ids: string[];
  /** Normalized search tokens (existing contextTokens output). */
  tokens: string[];
}

export function extractTaskIdentifiers(task: string): TaskIdentifiers {
  const text = task ?? '';
  const emails = uniqueStrings([...text.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase()));
  const urls = uniqueStrings([...text.matchAll(URL_RE)].map((m) => m[0]));
  const ids = uniqueStrings([...text.matchAll(IDISH_RE)].map((m) => m[0]));
  return { emails, urls, ids, tokens: contextTokens(text) };
}

/**
 * Provider-aware token estimation. Without a real tokenizer bound, this is the
 * standard chars/4 approximation; callers may inject a real tokenizer
 * (e.g. tiktoken) by passing `estimator`. We do NOT fake tiktoken.
 */
export function estimateTokens(text: string, estimator?: (text: string) => number): number {
  if (!text) return 0;
  if (typeof estimator === 'function') return Math.max(1, Math.ceil(estimator(text)));
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Signal weights for the hybrid composite score. */
export const RETRIEVAL_WEIGHTS = {
  exactAlias: 1.0,
  identifier: 0.95,
  keyword: 0.6,
  graphNeighbor: 0.25,
} as const;

export interface RelevanceSignal {
  exactAlias: boolean;
  identifier: boolean;
  /** ts_rank in [0,1] (caller normalizes by dividing by a small constant). */
  keywordRank: number;
  /** True if reached via a graph edge from another matched entity. */
  graphNeighbor: boolean;
}

export function compositeEntityScore(signal: RelevanceSignal): number {
  let score = 0;
  if (signal.exactAlias) score += RETRIEVAL_WEIGHTS.exactAlias;
  if (signal.identifier) score += RETRIEVAL_WEIGHTS.identifier;
  if (signal.keywordRank > 0) score += RETRIEVAL_WEIGHTS.keyword * Math.min(1, signal.keywordRank);
  if (signal.graphNeighbor) score += RETRIEVAL_WEIGHTS.graphNeighbor;
  return Math.min(1, score);
}

export interface BudgetedItem {
  text: string;
}

/**
 * Allocate a token budget across complete items only. Iterates in priority
 * order; an item is included only if it fits wholly. NEVER truncates an item
 * mid-way (no mid-claim / mid-evidence-id slicing). Returns the selected
 * items and the tokens consumed.
 */
export function allocateBudgetByCompleteItems<T extends BudgetedItem>(
  items: T[],
  budgetTokens: number,
  estimator?: (text: string) => number,
): { selected: T[]; consumed: number } {
  const selected: T[] = [];
  let consumed = 0;
  for (const item of items) {
    const cost = estimateTokens(item.text, estimator);
    if (consumed + cost > budgetTokens) continue; // skip whole item; do not slice
    selected.push(item);
    consumed += cost;
  }
  return { selected, consumed };
}

/**
 * Build the `<company_brain>` context text from complete items within budget.
 * The header + section labels are added first (reserved); then entities,
 * claims, edges, evidence are each allocated as whole items.
 */
export function buildContextText(input: {
  entities: ContextEntity[];
  claims: ContextClaim[];
  disputedClaims: ContextClaim[];
  edges: ContextEdge[];
  evidence: ContextEvidence[];
  agentRole: string;
  tokenBudget: number;
  estimator?: (text: string) => number;
}): string {
  const header = `Task-specific Company Brain context for ${input.agentRole}:`;
  const headerCost = estimateTokens(header, input.estimator);
  const budget = Math.max(0, input.tokenBudget - headerCost);
  const sections: string[] = [header];

  const entityLines = input.entities.map((e) => `- [${e.entityType}] ${e.title}: ${e.summary}` + (e.sourceArtifactIds.length ? ` (evidence: ${e.sourceArtifactIds.join(', ')})` : ''));
  const claimLines = input.claims.map((c) => `- ${c.subjectEntityId} —${c.predicate}→ ${c.objectEntityId ? `entity:${c.objectEntityId}` : stableJson(c.objectValue)} [${c.status}; authority ${c.authorityScore.toFixed(2)}; confidence ${c.confidence.toFixed(2)}; evidence: ${c.evidenceIds.join(', ') || 'none'}]`);
  const edgeLines = input.edges.map((e) => `- ${e.sourceEntityId} —${e.relationshipType}→ ${e.targetEntityId} [confidence ${e.confidence.toFixed(2)}]`);
  const evidenceLines = input.evidence.map((ev) => `- ${ev.id} | ${ev.sourceType}/${ev.artifactType} | ${ev.title}`);
  const disputeLines = input.disputedClaims.map((c) => `- Claim ${c.id}: ${c.predicate} = ${stableJson(c.objectValue)} (DISPUTED — do not silently choose a side)`);

  const lineCost = (s: string) => estimateTokens(s, input.estimator);
  // Reserve small labels for each present section.
  let reserved = 0;
  const labels: string[] = [];
  if (entityLines.length) { labels.push('Relevant entities:'); reserved += lineCost('Relevant entities:'); }
  if (claimLines.length) { labels.push('Evidence-backed claims:'); reserved += lineCost('Evidence-backed claims:'); }
  if (edgeLines.length) { labels.push('Relationships:'); reserved += lineCost('Relationships:'); }
  if (disputeLines.length) { labels.push('Unresolved conflicts:'); reserved += lineCost('Unresolved conflicts:'); }
  if (evidenceLines.length) { labels.push('Evidence references:'); reserved += lineCost('Evidence references:'); }

  const itemPool = [
    ...entityLines.map((text) => ({ text, kind: 'entity' as const })),
    ...claimLines.map((text) => ({ text, kind: 'claim' as const })),
    ...edgeLines.map((text) => ({ text, kind: 'edge' as const })),
    ...disputeLines.map((text) => ({ text, kind: 'dispute' as const })),
    ...evidenceLines.map((text) => ({ text, kind: 'evidence' as const })),
  ];

  const usable = Math.max(0, budget - reserved);
  const { selected } = allocateBudgetByCompleteItems(itemPool, usable, input.estimator);

  // Re-group selected items by kind to keep sections readable.
  const byKind = { entity: [] as string[], claim: [] as string[], edge: [] as string[], dispute: [] as string[], evidence: [] as string[] };
  for (const item of selected) byKind[item.kind].push(item.text);

  if (byKind.entity.length) { sections.push('', 'Relevant entities:', ...byKind.entity); }
  if (byKind.claim.length) { sections.push('', 'Evidence-backed claims:', ...byKind.claim); }
  if (byKind.edge.length) { sections.push('', 'Relationships:', ...byKind.edge); }
  if (byKind.dispute.length) { sections.push('', 'Unresolved conflicts:', ...byKind.dispute); }
  if (byKind.evidence.length) { sections.push('', 'Evidence references:', ...byKind.evidence); }
  if (selected.length === 0) sections.push('', 'No relevant accessible evidence matched this task.');

  return sections.join('\n');
}

/** Deterministic package id (no uuid dependency). */
export function contextPackageId(input: { tenantId: string; task: string; agentRole: string; generatedAt: string }): string {
  return sha256(`${input.tenantId}|${input.task}|${input.agentRole}|${input.generatedAt}`);
}

