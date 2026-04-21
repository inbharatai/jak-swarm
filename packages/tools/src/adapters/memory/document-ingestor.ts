/**
 * Document ingestion pipeline: text/PDF → chunk → embed → store.
 */

import { getVectorMemoryAdapter, type VectorMemoryAdapter } from './vector-memory.adapter.js';

// ─── Interface ──────────────────────────────────────────────────────────────

export interface IngestResult {
  chunksCreated: number;
  sourceKey: string;
  sourceType: string;
}

// ─── Ingestor ───────────────────────────────────────────────────────────────

export class DocumentIngestor {
  private adapter: VectorMemoryAdapter;

  constructor(adapter?: VectorMemoryAdapter) {
    this.adapter = adapter ?? getVectorMemoryAdapter();
  }

  /**
   * Ingest plain text into the vector store.
   *
   * `documentId` (optional) — soft FK to TenantDocument.id. When set, every
   * chunk row produced for this ingest carries documentId so DELETE /documents/:id
   * can clean up all chunks via a single `deleteMany({ where: { documentId } })`.
   * Calls that predate TenantDocument (direct ingestion scripts) can omit it.
   */
  async ingestText(
    tenantId: string,
    text: string,
    opts?: {
      title?: string;
      sourceType?: string;
      sourceKey?: string;
      metadata?: Record<string, unknown>;
      scopeType?: string;
      scopeId?: string;
      documentId?: string;
    },
  ): Promise<IngestResult> {
    const sourceKey = opts?.sourceKey ?? `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sourceType = opts?.sourceType ?? 'DOCUMENT';
    const metadata = {
      ...opts?.metadata,
      ...(opts?.title ? { title: opts.title } : {}),
      ...(opts?.documentId ? { documentId: opts.documentId } : {}),
      ingestedAt: new Date().toISOString(),
    };

    const chunksCreated = await this.adapter.ingest(
      tenantId,
      text,
      metadata,
      sourceType,
      sourceKey,
      {
        scopeType: opts?.scopeType,
        scopeId: opts?.scopeId,
        documentId: opts?.documentId,
      },
    );

    return { chunksCreated, sourceKey, sourceType };
  }

  /**
   * Ingest a PDF buffer into the vector store.
   */
  async ingestPDF(
    tenantId: string,
    buffer: Buffer,
    opts?: {
      title?: string;
      sourceKey?: string;
      metadata?: Record<string, unknown>;
      scopeType?: string;
      scopeId?: string;
      documentId?: string;
    },
  ): Promise<IngestResult> {
    let text: string;

    try {
      // pdf-parse is already in package.json
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const result = await pdfParse(buffer);
      text = result.text;

      if (!text || text.trim().length === 0) {
        throw new Error('PDF contained no extractable text.');
      }
    } catch (err) {
      throw new Error(`PDF parsing failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return this.ingestText(tenantId, text, {
      ...opts,
      sourceType: 'PDF',
      metadata: {
        ...opts?.metadata,
        format: 'pdf',
      },
    });
  }

  /**
   * Search the vector store.
   */
  async search(
    tenantId: string,
    query: string,
    topK = 5,
    scoreThreshold = 0.5,
    opts?: { scopeType?: string; scopeId?: string },
  ) {
    return this.adapter.search(tenantId, query, topK, scoreThreshold, opts);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _ingestor: DocumentIngestor | null = null;

export function getDocumentIngestor(): DocumentIngestor {
  if (!_ingestor) _ingestor = new DocumentIngestor();
  return _ingestor;
}

export function resetDocumentIngestor(): void {
  _ingestor = null;
}
