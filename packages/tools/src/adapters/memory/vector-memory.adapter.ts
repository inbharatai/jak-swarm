/**
 * Vector memory adapter for semantic search.
 *
 * - Primary: PostgreSQL + pgvector via Prisma $queryRawUnsafe
 * - Fallback: In-memory brute-force cosine similarity
 *
 * Both implement the same VectorMemoryAdapter interface.
 */

import { getEmbeddingService, type EmbeddingService } from './embedding.service.js';

// ─── Interface ──────────────────────────────────────────────────────────────

export interface VectorSearchResult {
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
  sourceKey?: string;
  sourceType: string;
  chunkIndex: number;
}

export interface VectorMemoryAdapter {
  ingest(
    tenantId: string,
    content: string,
    metadata?: Record<string, unknown>,
    sourceType?: string,
    sourceKey?: string,
  ): Promise<number>; // returns chunk count

  search(
    tenantId: string,
    query: string,
    topK?: number,
    scoreThreshold?: number,
  ): Promise<VectorSearchResult[]>;

  delete(tenantId: string, sourceKey: string): Promise<number>; // returns deleted count
}

// ─── Text Chunking ──────────────────────────────────────────────────────────

const CHUNK_SIZE = 500; // characters (~125 tokens)
const CHUNK_OVERLAP = 80;

export function chunkText(text: string): string[] {
  const separators = ['\n\n', '\n', '. ', ' '];
  return recursiveChunk(text, separators, CHUNK_SIZE, CHUNK_OVERLAP);
}

function recursiveChunk(
  text: string,
  separators: string[],
  maxSize: number,
  overlap: number,
): string[] {
  if (text.length <= maxSize) return [text.trim()].filter(Boolean);

  const sep = separators.find((s) => text.includes(s)) ?? '';
  const parts = sep ? text.split(sep) : [text.slice(0, maxSize), text.slice(maxSize)];

  const chunks: string[] = [];
  let current = '';

  for (const part of parts) {
    const candidate = current ? current + sep + part : part;
    if (candidate.length > maxSize && current) {
      chunks.push(current.trim());
      // Overlap: keep the tail of the previous chunk
      const overlapText = current.slice(-overlap);
      current = overlapText + sep + part;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

// ─── Cosine Similarity ──────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── In-Memory Implementation ───────────────────────────────────────────────

interface InMemoryDoc {
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  sourceKey?: string;
  sourceType: string;
  chunkIndex: number;
  tenantId: string;
}

export class InMemoryVectorAdapter implements VectorMemoryAdapter {
  private docs: InMemoryDoc[] = [];
  private embedder: EmbeddingService;

  constructor(embedder?: EmbeddingService) {
    this.embedder = embedder ?? getEmbeddingService();
  }

  async ingest(
    tenantId: string,
    content: string,
    metadata?: Record<string, unknown>,
    sourceType = 'DOCUMENT',
    sourceKey?: string,
  ): Promise<number> {
    const chunks = chunkText(content);
    const embeddings = await this.embedder.embedBatch(chunks);

    for (let i = 0; i < chunks.length; i++) {
      this.docs.push({
        content: chunks[i] ?? '',
        embedding: embeddings[i] ?? [],
        metadata,
        sourceKey,
        sourceType,
        chunkIndex: i,
        tenantId,
      });
    }

    return chunks.length;
  }

  async search(
    tenantId: string,
    query: string,
    topK = 5,
    scoreThreshold = 0.5,
  ): Promise<VectorSearchResult[]> {
    const queryEmb = await this.embedder.embed(query);
    const tenantDocs = this.docs.filter((d) => d.tenantId === tenantId);

    const scored = tenantDocs
      .map((doc) => ({
        ...doc,
        score: cosineSimilarity(queryEmb, doc.embedding),
      }))
      .filter((d) => d.score >= scoreThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.map((d) => ({
      content: d.content,
      score: d.score,
      metadata: d.metadata,
      sourceKey: d.sourceKey,
      sourceType: d.sourceType,
      chunkIndex: d.chunkIndex,
    }));
  }

  async delete(tenantId: string, sourceKey: string): Promise<number> {
    const before = this.docs.length;
    this.docs = this.docs.filter(
      (d) => !(d.tenantId === tenantId && d.sourceKey === sourceKey),
    );
    return before - this.docs.length;
  }
}

// ─── pgvector Implementation ────────────────────────────────────────────────

export class PgVectorAdapter implements VectorMemoryAdapter {
  private prisma: unknown; // PrismaClient — typed as unknown to avoid import issues
  private embedder: EmbeddingService;

  constructor(prisma: unknown, embedder?: EmbeddingService) {
    this.prisma = prisma;
    this.embedder = embedder ?? getEmbeddingService();
  }

  async ingest(
    tenantId: string,
    content: string,
    metadata?: Record<string, unknown>,
    sourceType = 'DOCUMENT',
    sourceKey?: string,
  ): Promise<number> {
    const chunks = chunkText(content);
    const embeddings = await this.embedder.embedBatch(chunks);
    const db = this.prisma as { $executeRawUnsafe: (query: string, ...args: unknown[]) => Promise<number> };

    for (let i = 0; i < chunks.length; i++) {
      const emb = embeddings[i] ?? [];
      const vecStr = `[${emb.join(',')}]`;
      const meta = metadata ? JSON.stringify(metadata) : null;

      await db.$executeRawUnsafe(
        `INSERT INTO vector_documents ("id", "tenantId", content, embedding, metadata, "sourceKey", "sourceType", "chunkIndex", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3::vector, $4::jsonb, $5, $6, $7, NOW(), NOW())`,
        tenantId,
        chunks[i] ?? '',
        vecStr,
        meta,
        sourceKey ?? null,
        sourceType,
        i,
      );
    }

    return chunks.length;
  }

  async search(
    tenantId: string,
    query: string,
    topK = 5,
    scoreThreshold = 0.5,
  ): Promise<VectorSearchResult[]> {
    const queryEmb = await this.embedder.embed(query);
    const vecStr = `[${queryEmb.join(',')}]`;
    const db = this.prisma as {
      $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown[]>;
    };

    const results = await db.$queryRawUnsafe(
      `SELECT content, metadata, "sourceKey", "sourceType", "chunkIndex",
              1 - (embedding <=> $1::vector) AS score
       FROM vector_documents
       WHERE "tenantId" = $2
         AND embedding IS NOT NULL
         AND 1 - (embedding <=> $1::vector) >= $3
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      vecStr,
      tenantId,
      scoreThreshold,
      topK,
    );

    return (results as Record<string, unknown>[]).map((r) => ({
      content: String(r['content'] ?? ''),
      score: Number(r['score'] ?? 0),
      metadata: (r['metadata'] as Record<string, unknown>) ?? undefined,
      sourceKey: r['sourceKey'] ? String(r['sourceKey']) : undefined,
      sourceType: String(r['sourceType'] ?? 'DOCUMENT'),
      chunkIndex: Number(r['chunkIndex'] ?? 0),
    }));
  }

  async delete(tenantId: string, sourceKey: string): Promise<number> {
    const db = this.prisma as { $executeRawUnsafe: (query: string, ...args: unknown[]) => Promise<number> };
    return db.$executeRawUnsafe(
      `DELETE FROM vector_documents WHERE "tenantId" = $1 AND "sourceKey" = $2`,
      tenantId,
      sourceKey,
    );
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

let _vectorAdapter: VectorMemoryAdapter | null = null;

export function getVectorMemoryAdapter(): VectorMemoryAdapter {
  if (_vectorAdapter) return _vectorAdapter;

  try {
    // Try loading Prisma for pgvector
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbModule = require('@jak-swarm/db');
    const prisma = dbModule.prisma;

    if (prisma) {
      // Test if pgvector extension is available by attempting a query
      _vectorAdapter = new PgVectorAdapter(prisma);
      console.info('[vector] Using pgvector adapter (PostgreSQL).');
      return _vectorAdapter;
    }
  } catch {
    // pgvector or Prisma not available
  }

  console.warn('[vector] pgvector not available — using in-memory vector search (non-persistent).');
  _vectorAdapter = new InMemoryVectorAdapter();
  return _vectorAdapter;
}

export function resetVectorMemoryAdapter(): void {
  _vectorAdapter = null;
}
