import { describe, it, expect } from 'vitest';
import { generateId, generateTraceId } from '../../../packages/shared/src/utils/id.js';

describe('ID Generation', () => {
  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it('generates IDs with prefix', () => {
    const id = generateId('wf_');
    expect(id.startsWith('wf_')).toBe(true);
  });

  it('generates valid trace IDs', () => {
    const traceId = generateTraceId();
    expect(traceId.startsWith('trc_')).toBe(true);
    expect(traceId.length).toBeGreaterThan(10);
  });

  it('generates unique trace IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });
});
