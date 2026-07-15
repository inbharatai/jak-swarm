/**
 * company-brain-embeddings.ts — pluggable text embeddings for the Company Brain
 * vector retrieval half (truth-doc C3). The real provider calls an embeddings
 * API (OpenAI/Gemini); the deterministic provider is a bag-of-words stand-in
 * used in tests and when no embedding key is configured, so the wiring is
 * verifiable without an API key and retrieval degrades to lexical-only when
 * embeddings are off.
 */
export const EMBEDDING_DIM = 1536;

export interface EmbeddingProvider {
  /** Embed text into a fixed-dim unit-ish vector. Returns null if unavailable. */
  embed(text: string): Promise<number[] | null>;
  readonly kind: string;
}

/** Deterministic bag-of-words embedding (test/offline stand-in). Not semantic, but two texts sharing tokens produce a high cosine similarity, which is enough to exercise + verify the vector retrieval wiring without an API key. */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'deterministic-bow';
  embed(text: string): Promise<number[] | null> {
    const vec = new Array(EMBEDDING_DIM).fill(0);
    const tokens = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    for (const t of tokens) {
      const dim = Math.abs(hashStr(t)) % EMBEDDING_DIM;
      vec[dim] = (vec[dim] ?? 0) + 1;
    }
    // L2 normalize so cosine is a simple dot product.
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / norm;
    return Promise.resolve(norm > 0 ? vec : null);
  }
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** Cosine similarity of two equal-length vectors (or 0 if mismatched/empty). Pure. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot; // already L2-normalized -> dot is cosine
}
import { config } from '../../config.js';

/** Real OpenAI text-embedding provider (1536-dim). Errors degrade to null
 * (the vector channel is skipped -> lexical+graph). */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'openai-text-embedding-3-small';
  constructor(private readonly apiKey: string, private readonly model = 'text-embedding-3-small') {}
  async embed(text: string): Promise<number[] | null> {
    if (!this.apiKey || !text.trim()) return null;
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: text.slice(0, 8000) }),
      });
      if (!res.ok) return null;
      const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
      return json.data?.[0]?.embedding ?? null;
    } catch { return null; }
  }
}

/** Resolve the brain embedding provider from env. OFF by default so the running
 *  app degrades to lexical+graph unless explicitly enabled:
 *    COMPANY_BRAIN_EMBEDDINGS=1 + OPENAI_API_KEY -> real OpenAI embeddings
 *    COMPANY_BRAIN_EMBEDDINGS=deterministic      -> bag-of-words (dev/test, no key)
 *  Returns undefined (lexical-only) otherwise. */
export function resolveBrainEmbeddingProvider(): EmbeddingProvider | undefined {
  const flag = (process.env['COMPANY_BRAIN_EMBEDDINGS'] ?? '').trim().toLowerCase();
  if (flag === 'deterministic') return new DeterministicEmbeddingProvider();
  if (flag === '1' || flag === 'true') {
    const key = config.openaiApiKey;
    return key ? new OpenAIEmbeddingProvider(key) : undefined;
  }
  return undefined;
}
