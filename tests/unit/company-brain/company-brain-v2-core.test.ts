import { describe, expect, it } from 'vitest';
import {
  canAgentAccessArtifact,
  decideClaimTransition,
  inferRelationshipType,
  normalizeEntityLabel,
  sourceAuthorityScore,
  tokenSimilarity,
  type CompanyClaimRow,
} from '../../../apps/api/src/services/company-brain/company-brain-v2.service.js';

describe('Company Brain Graph V2 core', () => {
  it('normalizes legal suffixes and punctuation for canonical entity resolution', () => {
    expect(normalizeEntityLabel('Acme Technologies Pvt. Ltd.')).toBe('acme technologies');
    expect(normalizeEntityLabel('ACME-Technologies Company')).toBe('acme technologies');
  });

  it('computes conservative token similarity', () => {
    expect(tokenSimilarity('Project Alpha Hindi Interface', 'Hindi Interface - Project Alpha')).toBe(1);
    expect(tokenSimilarity('Project Alpha', 'Customer Renewal')).toBe(0);
  });

  it('ranks signed and approved evidence above conversational evidence', () => {
    expect(sourceAuthorityScore({
      sourceType: 'document',
      artifactType: 'document',
      title: 'Signed contract',
      metadata: { signed: true },
    })).toBe(0.98);
    expect(sourceAuthorityScore({
      sourceType: 'gmail',
      artifactType: 'email',
      title: 'Sales email',
      metadata: {},
    })).toBeLessThan(0.7);
  });

  it('keeps low-authority facts proposed instead of silently activating them', () => {
    const transition = decideClaimTransition({ confidence: 0.7, authorityScore: 0.58, validFrom: new Date('2026-07-01') });
    expect(transition.candidateStatus).toBe('proposed');
    expect(transition.requiresReview).toBe(true);
  });

  it('activates the first high-authority claim', () => {
    const transition = decideClaimTransition({ confidence: 0.91, authorityScore: 0.95, validFrom: new Date('2026-07-01') });
    expect(transition.candidateStatus).toBe('active');
    expect(transition.requiresReview).toBe(false);
  });

  it('supersedes older truth only when newer evidence is materially more authoritative', () => {
    const existing = {
      id: 'claim-old',
      status: 'active',
      authorityScore: 0.62,
      validFrom: new Date('2026-06-01'),
      normalizedObject: '8 lakh',
    } satisfies Pick<CompanyClaimRow, 'id' | 'status' | 'authorityScore' | 'validFrom' | 'normalizedObject'>;
    const transition = decideClaimTransition(
      { confidence: 0.92, authorityScore: 0.95, validFrom: new Date('2026-07-01') },
      existing,
      false,
    );
    expect(transition.candidateStatus).toBe('active');
    expect(transition.existingStatus).toBe('superseded');
    expect(transition.supersedesClaimId).toBe('claim-old');
  });

  it('sends comparable contradictory claims to human review', () => {
    const existing = {
      id: 'claim-old',
      status: 'active',
      authorityScore: 0.82,
      validFrom: new Date('2026-06-01'),
      normalizedObject: 'august',
    } satisfies Pick<CompanyClaimRow, 'id' | 'status' | 'authorityScore' | 'validFrom' | 'normalizedObject'>;
    const transition = decideClaimTransition(
      { confidence: 0.9, authorityScore: 0.85, validFrom: new Date('2026-07-01') },
      existing,
      false,
    );
    expect(transition.candidateStatus).toBe('disputed');
    expect(transition.requiresReview).toBe(true);
  });

  it('enforces artifact visibility, role allowlists, and retention', () => {
    const now = new Date('2026-07-13T10:00:00Z');
    expect(canAgentAccessArtifact({ visibility: 'internal', allowedAgentRoles: [], retentionUntil: null }, 'WORKER_RESEARCH', now)).toBe(true);
    expect(canAgentAccessArtifact({ visibility: 'restricted', allowedAgentRoles: ['WORKER_FINANCE'], retentionUntil: null }, 'WORKER_RESEARCH', now)).toBe(false);
    expect(canAgentAccessArtifact({ visibility: 'restricted', allowedAgentRoles: ['WORKER_FINANCE'], retentionUntil: null }, 'worker_finance', now)).toBe(true);
    expect(canAgentAccessArtifact({ visibility: 'internal', allowedAgentRoles: [], retentionUntil: new Date('2026-07-12') }, 'WORKER_RESEARCH', now)).toBe(false);
  });

  it('creates meaningful typed relationships instead of generic JSON links', () => {
    expect(inferRelationshipType('customer_signal', 'task')).toBe('influences');
    expect(inferRelationshipType('decision', 'code_change')).toBe('operationalized_by');
    expect(inferRelationshipType('requirement', 'spec')).toBe('implemented_by');
    expect(inferRelationshipType('customer', 'product')).toBe('related_to');
  });
});
