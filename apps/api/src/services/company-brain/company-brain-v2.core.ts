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

