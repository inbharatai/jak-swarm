/**
 * company-brain-provenance-gate.test.ts — pins C1: source-less V2 entities are
 * gated out of agent context (truth-doc C1: no source-less claim may influence
 * a workflow). Pure helper tested in isolation; the context provider applies
 * it before access filtering.
 */
import { describe, it, expect } from 'vitest';
import { hasEntityProvenance } from '../../../apps/api/src/services/company-brain/company-brain-v2.core.js';

describe('hasEntityProvenance (C1 provenance gate)', () => {
  it('passes an entity backed by sourceArtifactIds (pg parses jsonb -> JS array)', () => {
    expect(hasEntityProvenance({ sourceArtifactIds: ['art_1'] })).toBe(true);
    expect(hasEntityProvenance({ sourceArtifactIds: ['art_1', 'art_2'] })).toBe(true);
  });
  it('passes an entity with no sourceArtifactIds but a primaryArtifactId', () => {
    expect(hasEntityProvenance({ sourceArtifactIds: '[]', primaryArtifactId: 'art_primary' })).toBe(true);
    expect(hasEntityProvenance({ sourceArtifactIds: null, primaryArtifactId: 'art_primary' })).toBe(true);
  });
  it('drops a source-less orphan (no sourceArtifactIds and no primaryArtifactId)', () => {
    expect(hasEntityProvenance({ sourceArtifactIds: '[]' })).toBe(false);
    expect(hasEntityProvenance({ sourceArtifactIds: null })).toBe(false);
    expect(hasEntityProvenance({ sourceArtifactIds: undefined, primaryArtifactId: null })).toBe(false);
    expect(hasEntityProvenance({ sourceArtifactIds: '[]', primaryArtifactId: '' })).toBe(false);
    expect(hasEntityProvenance({ sourceArtifactIds: '[]', primaryArtifactId: '   ' })).toBe(false);
  });
  it('treats a non-array / malformed sourceArtifactIds as empty', () => {
    expect(hasEntityProvenance({ sourceArtifactIds: 'not-json' })).toBe(false);
    expect(hasEntityProvenance({ sourceArtifactIds: 123 })).toBe(false);
  });
});
