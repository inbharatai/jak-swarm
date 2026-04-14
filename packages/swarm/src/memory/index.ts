export {
  extractMemories,
  deduplicateFacts,
  filterByConfidence,
} from './memory-extractor.js';
export type {
  ExtractedFact,
  MemoryExtractionResult,
} from './memory-extractor.js';

export {
  formatMemoryBlock,
  buildMemoryQuery,
  rankMemories,
} from './memory-query.js';
export type {
  MemoryEntry,
  MemoryQueryOptions,
} from './memory-query.js';
