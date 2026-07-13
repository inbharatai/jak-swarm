/**
 * Phase 1 — pure retrieval helper tests (no database required).
 *
 * These cover the unit-testable core of the hybrid retrieval pipeline:
 * identifier extraction, token estimation, composite scoring, complete-item
 * budget allocation, context-text rendering (incl. the empty-query rule and
 * disputed-claim guardrail), and deterministic package id.
 */
import { describe, expect, it } from 'vitest';
import {
  allocateBudgetByCompleteItems,
  buildContextText,
  compositeEntityScore,
  contextPackageId,
  estimateTokens,
  extractTaskIdentifiers,
  RETRIEVAL_WEIGHTS,
  type ContextClaim,
  type ContextEdge,
  type ContextEntity,
  type ContextEvidence,
} from '../../../apps/api/src/services/company-brain/company-brain-v2.core.js';

describe('Phase 1 hybrid retrieval — pure helpers', () => {
  describe('extractTaskIdentifiers', () => {
    it('extracts emails, urls, ids, and search tokens from a task string', () => {
      const ids = extractTaskIdentifiers(
        'Reach out to jane.doe@acme.com about https://acme.com/pricing for deal CRM-1042 and ticket SUP-99.',
      );
      expect(ids.emails).toEqual(['jane.doe@acme.com']);
      expect(ids.urls).toEqual(['https://acme.com/pricing']);
      expect(ids.ids.some((s) => s === 'CRM-1042')).toBe(true);
      expect(ids.ids.some((s) => s === 'SUP-99')).toBe(true);
      expect(ids.tokens.length).toBeGreaterThan(0);
      // tokens feed ts_rank; punctuation-only tasks must not crash.
      expect(extractTaskIdentifiers('   ').tokens).toEqual([]);
    });

    it('is null-safe on undefined input', () => {
      const ids = extractTaskIdentifiers(undefined as unknown as string);
      expect(ids.emails).toEqual([]);
      expect(ids.urls).toEqual([]);
      expect(ids.ids).toEqual([]);
    });
  });

  describe('estimateTokens', () => {
    it('returns 0 for empty text and approximates chars/4 by default', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('abcdefgh')).toBe(2); // 8 chars / 4
    });
    it('uses an injected estimator when provided and floors to >=1', () => {
      const exact = (s: string) => s.length; // 1 token per char
      expect(estimateTokens('abc', exact)).toBe(3);
      expect(estimateTokens('a', exact)).toBe(1);
    });
  });

  describe('compositeEntityScore', () => {
    it('weights exact alias highest and clamps to [0,1]', () => {
      expect(compositeEntityScore({ exactAlias: true, identifier: false, keywordRank: 0, graphNeighbor: false })).toBe(RETRIEVAL_WEIGHTS.exactAlias);
      expect(compositeEntityScore({ exactAlias: false, identifier: true, keywordRank: 0, graphNeighbor: false })).toBe(RETRIEVAL_WEIGHTS.identifier);
      expect(compositeEntityScore({ exactAlias: false, identifier: false, keywordRank: 1, graphNeighbor: false })).toBeCloseTo(RETRIEVAL_WEIGHTS.keyword, 5);
      expect(compositeEntityScore({ exactAlias: false, identifier: false, keywordRank: 0, graphNeighbor: true })).toBe(RETRIEVAL_WEIGHTS.graphNeighbor);
    });
    it('never lets a graph-only neighbor outrank a direct match', () => {
      const direct = compositeEntityScore({ exactAlias: true, identifier: false, keywordRank: 0, graphNeighbor: false });
      const neighbor = compositeEntityScore({ exactAlias: false, identifier: false, keywordRank: 0, graphNeighbor: true });
      expect(direct).toBeGreaterThan(neighbor);
    });
    it('clamps the combined signal to 1.0', () => {
      const all = compositeEntityScore({ exactAlias: true, identifier: true, keywordRank: 1, graphNeighbor: true });
      expect(all).toBeLessThanOrEqual(1);
      expect(all).toBe(1);
    });
  });

  describe('allocateBudgetByCompleteItems', () => {
    it('includes whole items that fit and skips those that do not (never slices an item)', () => {
      const items = [{ text: 'a'.repeat(40) }, { text: 'b'.repeat(8) }, { text: 'c'.repeat(40) }];
      // default estimator: 40-char item = 10 tokens, 8-char = 2 tokens. budget 12.
      const { selected, consumed } = allocateBudgetByCompleteItems(items, 12);
      // First item (10) fits, leaving 2 — the 8-char item (2 tokens) fits, third (10) does not.
      expect(selected.map((s) => s.text[0])).toEqual(['a', 'b']);
      expect(consumed).toBe(12);
    });
    it('returns nothing when the first item exceeds the budget', () => {
      const items = [{ text: 'x'.repeat(100) }];
      const { selected, consumed } = allocateBudgetByCompleteItems(items, 5);
      expect(selected).toEqual([]);
      expect(consumed).toBe(0);
    });
    it('never truncates an item mid-way — partial inclusion is forbidden', () => {
      const huge = [{ text: 'y'.repeat(1000) }];
      const { selected } = allocateBudgetByCompleteItems(huge, 50);
      expect(selected).toEqual([]);
    });
  });

  describe('buildContextText', () => {
    const entity = (over: Partial<ContextEntity> = {}): ContextEntity => ({
      id: 'ent-1', entityType: 'customer', title: 'Acme', summary: 'Renewal due', status: 'active',
      ownerName: 'Asha', priority: 'high', dueAt: null, score: 0.9, sourceArtifactIds: ['art-1'],
      ...over,
    });
    const claim = (over: Partial<ContextClaim> = {}): ContextClaim => ({
      id: 'clm-1', subjectEntityId: 'ent-1', predicate: 'has_renewal_date', objectEntityId: null,
      objectValue: '2026-08-01', normalizedObject: '2026-08-01', status: 'active', confidence: 0.9,
      authorityScore: 0.8, validFrom: null, validTo: null, evidenceIds: ['art-1'], ...over,
    });
    const edge = (over: Partial<ContextEdge> = {}): ContextEdge => ({
      id: 'edge-1', sourceEntityId: 'ent-1', relationshipType: 'owns', targetEntityId: 'ent-2',
      status: 'active', confidence: 0.7, evidenceArtifactIds: ['art-1'], ...over,
    });
    const evidence = (over: Partial<ContextEvidence> = {}): ContextEvidence => ({
      id: 'art-1', sourceType: 'email', artifactType: 'message', title: 'Renewal thread',
      excerpt: '...', occurredAt: null, ...over,
    });

    it('renders all sections when there is relevant evidence', () => {
      const text = buildContextText({
        entities: [entity()], claims: [claim()], disputedClaims: [], edges: [edge()],
        evidence: [evidence()], agentRole: 'Customer Success', tokenBudget: 4000,
      });
      expect(text).toContain('Task-specific Company Brain context for Customer Success');
      expect(text).toContain('Relevant entities:');
      expect(text).toContain('- [customer] Acme');
      expect(text).toContain('Evidence-backed claims:');
      expect(text).toContain('has_renewal_date');
      expect(text).toContain('Relationships:');
      expect(text).toContain('Evidence references:');
      expect(text).toContain('art-1');
    });

    it('preserves evidence ids on claims (Phase 1 requirement)', () => {
      const text = buildContextText({
        entities: [], claims: [claim({ evidenceIds: ['art-1', 'art-2'] })], disputedClaims: [],
        edges: [], evidence: [], agentRole: 'Analyst', tokenBudget: 4000,
      });
      expect(text).toContain('evidence: art-1, art-2');
    });

    it('emits an explicit empty-state line and no fake recency when nothing is relevant', () => {
      const text = buildContextText({
        entities: [], claims: [], disputedClaims: [], edges: [], evidence: [], agentRole: 'Analyst', tokenBudget: 4000,
      });
      expect(text).toContain('No relevant accessible evidence matched this task.');
      expect(text).not.toContain('Relevant entities:');
    });

    it('flags disputed claims so the agent does not silently pick a side', () => {
      const text = buildContextText({
        entities: [], claims: [], disputedClaims: [claim({ id: 'clm-dispute', status: 'disputed' })],
        edges: [], evidence: [], agentRole: 'Analyst', tokenBudget: 4000,
      });
      expect(text).toContain('Unresolved conflicts:');
      expect(text).toContain('DISPUTED');
      expect(text).toContain('do not silently choose a side');
    });

    it('respects the token budget by dropping whole items, never truncating', () => {
      const manyEntities = Array.from({ length: 50 }, (_, i) =>
        entity({ id: `ent-${i}`, title: `Entity ${i}`, summary: 's'.repeat(200) }));
      const text = buildContextText({
        entities: manyEntities, claims: [], disputedClaims: [], edges: [], evidence: [],
        agentRole: 'Analyst', tokenBudget: 100,
      });
      // Budget 100 tokens ≈ 400 chars. Each ~200-char summary entity is ~50 tokens, so at most ~1-2 fit whole.
      const entityLines = text.split('\n').filter((l) => l.startsWith('- [customer]'));
      expect(entityLines.length).toBeLessThan(50);
      // No line should be cut mid-item — every emitted entity line must contain its full summary.
      for (const line of entityLines) expect(line.endsWith('s'.repeat(200)) || line.includes('(evidence:')).toBe(true);
    });
  });

  describe('contextPackageId', () => {
    it('is deterministic for identical inputs and distinct for any differing field', () => {
      const a = contextPackageId({ tenantId: 't1', task: 'task A', agentRole: 'Analyst', generatedAt: '2026-07-13T00:00:00Z' });
      const b = contextPackageId({ tenantId: 't1', task: 'task A', agentRole: 'Analyst', generatedAt: '2026-07-13T00:00:00Z' });
      const c = contextPackageId({ tenantId: 't1', task: 'task B', agentRole: 'Analyst', generatedAt: '2026-07-13T00:00:00Z' });
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    });
  });
});