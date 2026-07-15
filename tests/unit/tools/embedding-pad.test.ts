/**
 * embedding-pad.test.ts — pins document-ingestion accuracy: the local 384-dim
 * embedding fallback is padded to the 1536-dim storage column WITHOUT changing
 * cosine similarity (so vector_documents ingest/search works without an OpenAI
 * key, instead of throwing a Postgres dimension-mismatch error).
 */
import { describe, it, expect } from 'vitest';
import { padEmbedding } from '../../../packages/tools/src/adapters/memory/embedding.service.js';

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}
function cosine(a: number[], b: number[]): number {
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  return na && nb ? dot(a, b) / (na * nb) : 0;
}

describe('padEmbedding (document ingestion dim-compat + cosine preservation)', () => {
  it('pads a 384-dim vector to 1536 with zeros', () => {
    const v = Array.from({ length: 384 }, (_, i) => i / 384);
    const padded = padEmbedding(v);
    expect(padded.length).toBe(1536);
    expect(padded.slice(0, 384)).toEqual(v);
    expect(padded.slice(384).every((x) => x === 0)).toBe(true);
  });
  it('truncates a vector longer than the target dim', () => {
    const padded = padEmbedding([1, 2, 3, 4, 5, 6], 4);
    expect(padded).toEqual([1, 2, 3, 4]);
  });
  it('preserves cosine similarity (the zero tail contributes nothing)', () => {
    const a = [0.6, 0.8, 0.0]; // normalized (0.36+0.64=1)
    const b = [0.8, 0.6, 0.0]; // normalized
    const cosBefore = cosine(a, b);
    const cosAfter = cosine(padEmbedding(a, 1536), padEmbedding(b, 1536));
    expect(cosAfter).toBeCloseTo(cosBefore, 6);
  });
  it('returns the vector unchanged when already at the target dim', () => {
    const v = new Array(1536).fill(0.1);
    expect(padEmbedding(v)).toHaveLength(1536);
    expect(padEmbedding(v)).toEqual(v);
  });
});
