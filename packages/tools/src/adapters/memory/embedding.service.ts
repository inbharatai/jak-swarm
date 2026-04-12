/**
 * Embedding service with dual-provider strategy:
 * - Primary: OpenAI text-embedding-3-small (1536 dimensions)
 * - Fallback: Local @xenova/transformers all-MiniLM-L6-v2 (384 dimensions)
 */

// ─── Interface ──────────────────────────────────────────────────────────────

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly provider: string;
}

// ─── OpenAI Implementation ──────────────────────────────────────────────────

export class OpenAIEmbeddingService implements EmbeddingService {
  readonly dimensions = 1536;
  readonly provider = 'openai';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: texts,
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => 'unknown');
      throw new Error(`OpenAI embeddings failed (${response.status}): ${err}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain input order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

// ─── Local Implementation (transformers.js) ─────────────────────────────────

export class LocalEmbeddingService implements EmbeddingService {
  readonly dimensions = 384;
  readonly provider = 'local';
  private pipeline: unknown = null;
  private loadPromise: Promise<void> | null = null;

  private async ensureLoaded(): Promise<void> {
    if (this.pipeline) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        // Dynamic import to avoid bundling when not needed
        // @ts-expect-error — @xenova/transformers types may not be installed
        const { pipeline } = await import('@xenova/transformers');
        this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      } catch {
        throw new Error(
          'Local embedding model failed to load. Install @xenova/transformers or set OPENAI_API_KEY.',
        );
      }
    })();

    return this.loadPromise;
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();
    const extractor = this.pipeline as (
      text: string,
      opts: { pooling: string; normalize: boolean },
    ) => Promise<{ tolist: () => number[][] }>;

    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return output.tolist()[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Local model processes sequentially to avoid OOM
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

let _embeddingService: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (_embeddingService) return _embeddingService;

  const openaiKey = process.env['OPENAI_API_KEY'];
  if (openaiKey) {
    _embeddingService = new OpenAIEmbeddingService(openaiKey);
  } else {
    console.warn('[embedding] No OPENAI_API_KEY — using local embedding model (slower, 384 dims).');
    _embeddingService = new LocalEmbeddingService();
  }

  return _embeddingService;
}

/** Reset cached instance (for testing). */
export function resetEmbeddingService(): void {
  _embeddingService = null;
}
