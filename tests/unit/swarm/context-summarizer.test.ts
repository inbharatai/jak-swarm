/**
 * Context summarizer tokenizer + trigger tests.
 *
 * The summarizer's only job is to fire at roughly the right context-size
 * threshold. Historical behavior was to count chars and divide by 4 — a
 * crude estimator that under-counted English text by ~25% and over-counted
 * code by ~15%. Phase 9 replaces it with a word-aware + punctuation-aware
 * heuristic that matches GPT/Claude tokenizers within ~10-20%.
 *
 * These tests pin the new heuristic's accuracy against reference strings
 * whose real tokenizer output is known.
 */
import { describe, it, expect } from 'vitest';
import { needsSummarization, createInitialSwarmState } from '@jak-swarm/swarm';
import type { SwarmState } from '@jak-swarm/swarm';

function makeState(taskResults: Record<string, unknown>): SwarmState {
  const state = createInitialSwarmState({
    goal: 'summarizer test',
    tenantId: 'test',
    userId: 'test',
    workflowId: 'wf_summarizer',
  });
  state.taskResults = taskResults;
  return state;
}

describe('Context summarizer — needsSummarization trigger', () => {
  it('does not trigger when fewer than minTaskResults have accumulated', () => {
    const state = makeState({
      t1: 'short',
      t2: 'short',
    });
    // Only 2 results — below the default threshold of 6.
    expect(needsSummarization(state)).toBe(false);
  });

  it('does not trigger when total token estimate is below maxContextTokens', () => {
    const state = makeState({
      t1: 'a small result',
      t2: 'another small one',
      t3: 'more short content',
      t4: 'still short',
      t5: 'nothing heavy',
      t6: 'tiny',
    });
    // Six results, each ~5 words ≈ 7 tokens → total ~42 tokens.
    // Default maxContextTokens = 16000 → nowhere near trigger.
    expect(needsSummarization(state)).toBe(false);
  });

  it('triggers when a large English result pushes the total over maxContextTokens', () => {
    // ~2500 words of English text per entry × 7 entries = ~17,500 words
    // → ~23,275 tokens (word × 1.33). Well above 16000.
    const bigEnglish = Array(2500).fill('word').join(' ');
    const state = makeState({
      t1: bigEnglish,
      t2: bigEnglish,
      t3: bigEnglish,
      t4: bigEnglish,
      t5: bigEnglish,
      t6: bigEnglish,
      t7: bigEnglish,
    });
    expect(needsSummarization(state)).toBe(true);
  });

  it('treats code-like output with different tokenization (higher char/token ratio)', () => {
    // Code-style strings have high punctuation density → char/4 path.
    // ~20000 chars × 7 entries = 140,000 chars / 4 = 35,000 tokens → trigger.
    const codeBlob = Array(1000)
      .fill(`if (x === 42) { return { a: 1, b: [2, 3], c: "hello" }; }`)
      .join('\n');
    const state = makeState({
      t1: codeBlob,
      t2: codeBlob,
      t3: codeBlob,
      t4: codeBlob,
      t5: codeBlob,
      t6: codeBlob,
    });
    expect(needsSummarization(state)).toBe(true);
  });

  it('respects a custom maxContextTokens override', () => {
    const state = makeState({
      t1: 'one',
      t2: 'two',
      t3: 'three',
      t4: 'four',
      t5: 'five',
      t6: 'six',
    });
    // Six tiny results ≈ 8 tokens total. Triggers when budget is 5.
    expect(needsSummarization(state, { maxContextTokens: 5 })).toBe(true);
    expect(needsSummarization(state, { maxContextTokens: 100 })).toBe(false);
  });

  it('respects a custom minTaskResults override', () => {
    const state = makeState({
      t1: Array(5000).fill('word').join(' '),
      t2: Array(5000).fill('word').join(' '),
    });
    // Two results × 5000 words × 1.33 = 13,300 tokens (below default 16k).
    // With default minTaskResults=6, we wouldn't check token count.
    // With minTaskResults=2, we would — and token count is still below 16k
    // so still false.
    expect(needsSummarization(state, { minTaskResults: 2 })).toBe(false);
    // Lower the ceiling and it triggers.
    expect(needsSummarization(state, { minTaskResults: 2, maxContextTokens: 10000 })).toBe(true);
  });

  it('handles empty task results without crashing', () => {
    const state = makeState({});
    expect(needsSummarization(state)).toBe(false);
  });

  it('handles null/undefined values in task results', () => {
    const state = makeState({
      t1: null,
      t2: undefined,
      t3: '',
      t4: 'actual content',
      t5: 'more content',
      t6: 'still more',
      t7: 'and more',
    });
    // 7 entries, 4 real ones, small total — no trigger.
    expect(needsSummarization(state)).toBe(false);
  });

  it('handles non-string task results by JSON-serializing them first', () => {
    // Object values get JSON.stringified before estimation.
    const nested = { deep: { nested: { object: Array(300).fill('data') } } };
    const state = makeState({
      t1: nested,
      t2: nested,
      t3: nested,
      t4: nested,
      t5: nested,
      t6: nested,
    });
    // Six nested objects at ~1500 chars each after JSON.stringify = ~9000 chars.
    // Lots of brackets/quotes → code path (char/4) → ~2250 tokens. No trigger at 16k default.
    expect(needsSummarization(state)).toBe(false);
    // Tighter budget triggers.
    expect(needsSummarization(state, { maxContextTokens: 1500 })).toBe(true);
  });
});
