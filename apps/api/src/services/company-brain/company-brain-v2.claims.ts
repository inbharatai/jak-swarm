/** Evidence-backed claims, typed edges and review records for Company Brain V2. */
import { randomUUID } from 'node:crypto';
import {
  clamp01,
  decideClaimTransition,
  jsonStringArray,
  normalizeObjectValue,
  sha256,
  uniqueStrings,
  type ClaimCandidate,
  type ClaimTransition,
  type CompanyClaimRow,
  type CompanyEdgeRow,
  type CompanyMemoryReviewRow,
} from './company-brain-v2.core.js';
import { CompanyBrainEntityStore } from './company-brain-v2.entities.js';

export abstract class CompanyBrainClaimStore extends CompanyBrainEntityStore {
  protected async upsertClaim(candidate: ClaimCandidate): Promise<{ claim: CompanyClaimRow; transition: ClaimTransition }> {
    const normalizedObject = normalizeObjectValue(candidate.objectValue, candidate.objectEntityId);
    const fingerprint = sha256([
      candidate.tenantId,
      candidate.subjectEntityId,
      candidate.predicate,
      normalizedObject,
    ].join(':'));

    const duplicates = await this.query<CompanyClaimRow>(
      `SELECT * FROM "company_claims"
       WHERE "tenantId" = $1 AND "fingerprint" = $2
       LIMIT 1`,
      candidate.tenantId,
      fingerprint,
    );
    if (duplicates[0]) {
      const existing = duplicates[0];
      if (existing.status === 'rejected' || existing.status === 'superseded') {
        await this.addClaimEvidence(existing, candidate);
        return {
          claim: existing,
          transition: {
            candidateStatus: existing.status,
            requiresReview: false,
            reason: 'Equivalent evidence was recorded without changing a reviewer-rejected or superseded claim.',
          },
        };
      }

      const nextConfidence = Math.max(existing.confidence, clamp01(candidate.confidence));
      const nextAuthority = Math.max(existing.authorityScore, clamp01(candidate.authorityScore));
      const competitors = await this.query<CompanyClaimRow>(
        `SELECT * FROM "company_claims"
         WHERE "tenantId" = $1 AND "subjectEntityId" = $2 AND "predicate" = $3
           AND "status" = 'active' AND "id" <> $4
         ORDER BY "authorityScore" DESC, "updatedAt" DESC LIMIT 1`,
        candidate.tenantId,
        candidate.subjectEntityId,
        candidate.predicate,
        existing.id,
      );
      const transition = decideClaimTransition({
        predicate: candidate.predicate,
        confidence: nextConfidence,
        authorityScore: nextAuthority,
        validFrom: candidate.validFrom ?? existing.validFrom,
      }, competitors[0], false);

      if (transition.existingStatus && competitors[0]) {
        await this.execute(
          `UPDATE "company_claims"
           SET "status" = $3, "validTo" = COALESCE($4, CURRENT_TIMESTAMP), "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1 AND "tenantId" = $2`,
          competitors[0].id,
          candidate.tenantId,
          transition.existingStatus,
          candidate.validFrom ?? null,
        );
      }

      const rows = await this.query<CompanyClaimRow>(
        `UPDATE "company_claims"
         SET "confidence" = $3,
             "authorityScore" = $4,
             "status" = $5,
             "supersedesClaimId" = COALESCE($6, "supersedesClaimId"),
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "tenantId" = $2
         RETURNING *`,
        existing.id,
        candidate.tenantId,
        nextConfidence,
        nextAuthority,
        transition.candidateStatus,
        transition.supersedesClaimId ?? null,
      );
      const reinforced = rows[0] ?? existing;
      await this.addClaimEvidence(reinforced, candidate);
      if (transition.requiresReview) {
        await this.createReview({
          tenantId: candidate.tenantId,
          reviewType: 'claim',
          resourceId: reinforced.id,
          reason: transition.reason,
          priority: transition.candidateStatus === 'disputed' ? 'high' : 'medium',
          payload: {
            candidateClaimId: reinforced.id,
            existingClaimId: competitors[0]?.id ?? null,
            predicate: candidate.predicate,
            candidateValue: candidate.objectValue ?? null,
            existingValue: competitors[0]?.objectValue ?? null,
            candidateAuthority: nextAuthority,
            existingAuthority: competitors[0]?.authorityScore ?? null,
          },
        });
      } else {
        await this.execute(
          `UPDATE "company_memory_reviews"
           SET "status" = 'resolved', "reviewComment" = 'Resolved by stronger equivalent evidence.',
               "reviewedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
           WHERE "tenantId" = $1 AND "reviewType" = 'claim' AND "resourceId" = $2 AND "status" = 'open'`,
          candidate.tenantId,
          reinforced.id,
        );
      }
      return { claim: reinforced, transition };
    }

    const activeRows = await this.query<CompanyClaimRow>(
      `SELECT * FROM "company_claims"
       WHERE "tenantId" = $1 AND "subjectEntityId" = $2 AND "predicate" = $3
         AND "status" = 'active'
       ORDER BY "authorityScore" DESC, "updatedAt" DESC
       LIMIT 1`,
      candidate.tenantId,
      candidate.subjectEntityId,
      candidate.predicate,
    );
    const active = activeRows[0];
    const transition = decideClaimTransition(candidate, active, false);
    const claimId = randomUUID();

    if (transition.existingStatus && active) {
      await this.execute(
        `UPDATE "company_claims"
         SET "status" = $3, "validTo" = COALESCE($4, CURRENT_TIMESTAMP), "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "tenantId" = $2`,
        active.id,
        candidate.tenantId,
        transition.existingStatus,
        candidate.validFrom ?? null,
      );
    }

    const rows = await this.query<CompanyClaimRow>(
      `INSERT INTO "company_claims"
        ("id", "tenantId", "subjectEntityId", "predicate", "objectEntityId", "objectValue",
         "normalizedObject", "fingerprint", "status", "confidence", "authorityScore",
         "validFrom", "supersedesClaimId", "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6::JSONB, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      claimId,
      candidate.tenantId,
      candidate.subjectEntityId,
      candidate.predicate,
      candidate.objectEntityId ?? null,
      JSON.stringify(candidate.objectValue ?? null),
      normalizedObject,
      fingerprint,
      transition.candidateStatus,
      clamp01(candidate.confidence),
      clamp01(candidate.authorityScore),
      candidate.validFrom ?? null,
      transition.supersedesClaimId ?? null,
      candidate.createdBy ?? null,
    );
    const claim = rows[0];
    if (!claim) throw new Error('Company claim insert did not return a row.');
    await this.addClaimEvidence(claim, candidate);

    if (transition.requiresReview) {
      await this.createReview({
        tenantId: candidate.tenantId,
        reviewType: 'claim',
        resourceId: claim.id,
        reason: transition.reason,
        priority: transition.candidateStatus === 'disputed' ? 'high' : 'medium',
        payload: {
          candidateClaimId: claim.id,
          existingClaimId: active?.id ?? null,
          predicate: candidate.predicate,
          candidateValue: candidate.objectValue ?? null,
          existingValue: active?.objectValue ?? null,
          candidateAuthority: candidate.authorityScore,
          existingAuthority: active?.authorityScore ?? null,
        },
      });
    }
    return { claim, transition };
  }

  protected async addClaimEvidence(claim: CompanyClaimRow, candidate: ClaimCandidate): Promise<void> {
    await this.execute(
      `INSERT INTO "company_claim_evidence"
        ("id", "tenantId", "claimId", "artifactId", "excerpt", "sourceAuthority", "observedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("claimId", "artifactId") DO UPDATE
       SET "excerpt" = COALESCE(EXCLUDED."excerpt", "company_claim_evidence"."excerpt"),
           "sourceAuthority" = GREATEST("company_claim_evidence"."sourceAuthority", EXCLUDED."sourceAuthority"),
           "observedAt" = COALESCE(EXCLUDED."observedAt", "company_claim_evidence"."observedAt")`,
      randomUUID(),
      candidate.tenantId,
      claim.id,
      candidate.artifactId,
      candidate.excerpt?.slice(0, 4000) ?? null,
      clamp01(candidate.authorityScore),
      candidate.observedAt ?? null,
    );
  }

  protected async upsertEdge(input: {
    tenantId: string;
    sourceEntityId: string;
    relationshipType: string;
    targetEntityId: string;
    confidence: number;
    evidenceArtifactIds: string[];
    validFrom?: Date | null;
    createdBy?: string | null;
  }): Promise<CompanyEdgeRow> {
    if (input.sourceEntityId === input.targetEntityId) {
      throw new Error('Company graph edges cannot point an entity to itself.');
    }
    const existing = await this.query<CompanyEdgeRow>(
      `SELECT * FROM "company_edges"
       WHERE "tenantId" = $1 AND "sourceEntityId" = $2 AND "relationshipType" = $3
         AND "targetEntityId" = $4 AND "status" = 'active'
       LIMIT 1`,
      input.tenantId,
      input.sourceEntityId,
      input.relationshipType,
      input.targetEntityId,
    );
    if (existing[0]) {
      const evidence = uniqueStrings([
        ...jsonStringArray(existing[0].evidenceArtifactIds),
        ...input.evidenceArtifactIds,
      ]);
      const rows = await this.query<CompanyEdgeRow>(
        `UPDATE "company_edges"
         SET "confidence" = GREATEST("confidence", $3),
             "evidenceArtifactIds" = $4::JSONB,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "tenantId" = $2
         RETURNING *`,
        existing[0].id,
        input.tenantId,
        clamp01(input.confidence),
        JSON.stringify(evidence),
      );
      return rows[0] ?? existing[0];
    }

    const rows = await this.query<CompanyEdgeRow>(
      `INSERT INTO "company_edges"
        ("id", "tenantId", "sourceEntityId", "relationshipType", "targetEntityId", "status",
         "confidence", "evidenceArtifactIds", "validFrom", "createdBy")
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7::JSONB, $8, $9)
       RETURNING *`,
      randomUUID(),
      input.tenantId,
      input.sourceEntityId,
      input.relationshipType,
      input.targetEntityId,
      clamp01(input.confidence),
      JSON.stringify(uniqueStrings(input.evidenceArtifactIds)),
      input.validFrom ?? null,
      input.createdBy ?? null,
    );
    if (!rows[0]) throw new Error('Company edge insert did not return a row.');
    return rows[0];
  }

  protected async createReview(input: {
    tenantId: string;
    reviewType: CompanyMemoryReviewRow['reviewType'];
    resourceId: string;
    reason: string;
    payload: Record<string, unknown>;
    priority: CompanyMemoryReviewRow['priority'];
  }): Promise<CompanyMemoryReviewRow> {
    const existing = await this.query<CompanyMemoryReviewRow>(
      `SELECT * FROM "company_memory_reviews"
       WHERE "tenantId" = $1 AND "reviewType" = $2 AND "resourceId" = $3 AND "status" = 'open'
       LIMIT 1`,
      input.tenantId,
      input.reviewType,
      input.resourceId,
    );
    if (existing[0]) return existing[0];
    const rows = await this.query<CompanyMemoryReviewRow>(
      `INSERT INTO "company_memory_reviews"
        ("id", "tenantId", "reviewType", "resourceId", "status", "reason", "payload", "priority")
       VALUES ($1, $2, $3, $4, 'open', $5, $6::JSONB, $7)
       RETURNING *`,
      randomUUID(),
      input.tenantId,
      input.reviewType,
      input.resourceId,
      input.reason,
      JSON.stringify(input.payload),
      input.priority,
    );
    if (!rows[0]) throw new Error('Company memory review insert did not return a row.');
    return rows[0];
  }
}
