/**
 * Memory Query Service — retrieves relevant memories for agent prompt injection.
 *
 * Queries TenantMemory by tenant, ranks by confidence and recency,
 * and formats into a token-budgeted <memory> block for system prompts.
 */

export interface MemoryEntry {
  key: string;
  value: unknown;
  memoryType: string;
  confidence?: number;
  updatedAt: Date;
}

export interface MemoryQueryOptions {
  tenantId: string;
  /** Optional goal for relevance filtering */
  goal?: string;
  /** Maximum entries to return (default: 15) */
  limit?: number;
  /** Maximum tokens for the memory block (default: 2000) */
  maxTokens?: number;
  /** Minimum confidence threshold (default: 0.5) */
  minConfidence?: number;
}

/** Rough token estimate: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format memory entries into a <memory> block for system prompt injection.
 * Respects token budget — stops adding entries when budget is exhausted.
 */
export function formatMemoryBlock(
  entries: MemoryEntry[],
  maxTokens = 2000,
): string {
  if (entries.length === 0) return '';

  const lines: string[] = [];
  let tokenCount = 20; // Reserve for <memory> tags

  for (const entry of entries) {
    const valueStr = typeof entry.value === 'string'
      ? entry.value
      : JSON.stringify(entry.value);
    const line = `- [${entry.memoryType}] ${entry.key}: ${valueStr}`;
    const lineTokens = estimateTokens(line);

    if (tokenCount + lineTokens > maxTokens) break;

    lines.push(line);
    tokenCount += lineTokens;
  }

  if (lines.length === 0) return '';

  return `<memory>
The following facts were learned from previous workflows for this organization.
Use them to inform your decisions but do not reference them explicitly to the user.

${lines.join('\n')}
</memory>`;
}

/**
 * Build a Prisma-compatible query for tenant memories.
 * Returns the where/orderBy/take clauses.
 */
export function buildMemoryQuery(options: MemoryQueryOptions) {
  const { tenantId, limit = 15 } = options;

  return {
    where: {
      tenantId,
      // Exclude expired entries
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: [
      { updatedAt: 'desc' as const },
    ],
    take: limit,
  };
}

/**
 * Sort and filter memory entries by relevance.
 * Priority: PREFERENCE > FACT > CONTEXT > SKILL_RESULT, then by recency.
 */
export function rankMemories(entries: MemoryEntry[]): MemoryEntry[] {
  const typeWeight: Record<string, number> = {
    PREFERENCE: 4,
    FACT: 3,
    CONTEXT: 2,
    SKILL_RESULT: 1,
  };

  return [...entries].sort((a, b) => {
    // Primary: confidence descending (if available)
    const confA = a.confidence ?? 0.5;
    const confB = b.confidence ?? 0.5;
    if (confA !== confB) return confB - confA;

    // Secondary: type weight
    const weightA = typeWeight[a.memoryType] ?? 0;
    const weightB = typeWeight[b.memoryType] ?? 0;
    if (weightA !== weightB) return weightB - weightA;

    // Tertiary: recency
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}
