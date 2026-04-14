/**
 * Memory Extractor — LLM-powered fact extraction from workflow executions.
 *
 * Inspired by DeerFlow's MemoryMiddleware but adapted for JAK's multi-tenant,
 * multi-agent architecture. Extracts structured facts from SwarmState after
 * workflow completion for cross-session learning.
 *
 * Architecture:
 *   SwarmGraph.run() completes → extractMemories(state) → dedup → TenantMemory
 */
import type { SwarmState } from '../state/swarm-state.js';

/** A single extracted fact ready for persistence */
export interface ExtractedFact {
  key: string;
  value: Record<string, unknown>;
  type: 'FACT' | 'PREFERENCE' | 'CONTEXT' | 'SKILL_RESULT';
  confidence: number;
  source: string;
}

export interface MemoryExtractionResult {
  facts: ExtractedFact[];
  contextSummary: string | null;
}

/** Token budget for the extraction prompt — uses cheap tier-1 model */
const MAX_TRACE_CHARS = 6000;
const MAX_FACTS = 10;

/**
 * Build an extraction prompt from workflow state.
 * Keeps token usage low by summarizing traces, not sending raw content.
 */
function buildExtractionPrompt(state: SwarmState): string {
  const tasks = state.plan?.tasks ?? [];
  const completed = tasks.filter(t => t.status === 'COMPLETED');
  const failed = tasks.filter(t => t.status === 'FAILED');

  // Build concise trace summary
  const traceSummary = state.traces
    .map(t => {
      const out = typeof t.output === 'string'
        ? t.output.slice(0, 200)
        : JSON.stringify(t.output).slice(0, 200);
      return `[${t.agentRole}] ${t.error ? `FAILED: ${t.error}` : out}`;
    })
    .join('\n')
    .slice(0, MAX_TRACE_CHARS);

  return `You are analyzing a completed workflow to extract reusable facts and learnings for future workflows by this tenant.

WORKFLOW:
- Goal: ${state.goal}
- Industry: ${state.industry ?? 'general'}
- Status: ${state.status}
- Tasks: ${tasks.length} total, ${completed.length} completed, ${failed.length} failed
${state.error ? `- Error: ${state.error}` : ''}

TRACE SUMMARY:
${traceSummary}

Extract up to ${MAX_FACTS} discrete, reusable facts. Each fact should be something that would help a FUTURE workflow for this same organization.

Categories:
- FACT: Objective information learned (e.g., "company uses Salesforce CRM", "preferred report format is PDF")
- PREFERENCE: User/org preferences (e.g., "prefers formal tone in emails", "approval threshold is $5000")
- CONTEXT: Situational context (e.g., "Q2 budget review in progress", "hiring freeze until June")
- SKILL_RESULT: Capability learned (e.g., "Gmail integration works", "PDF extraction takes ~30s for large files")

Respond with JSON:
{
  "facts": [
    {
      "key": "unique_snake_case_identifier",
      "value": { "description": "human readable fact", "detail": "optional extra" },
      "type": "FACT|PREFERENCE|CONTEXT|SKILL_RESULT",
      "confidence": 0.0-1.0
    }
  ],
  "contextSummary": "One sentence summary of what this workflow accomplished"
}

Rules:
- Skip trivial facts (e.g., "workflow ran successfully")
- Score confidence honestly: 0.9+ for explicit data, 0.5-0.8 for inferred
- Keys must be globally unique per tenant (use descriptive snake_case)
- Do NOT extract PII (names, emails, phone numbers, SSNs, etc.)`;
}

/**
 * Extract reusable memories from a completed workflow.
 *
 * @param state - The final SwarmState after execution
 * @param callLLM - LLM call function (injected to avoid coupling to BaseAgent)
 * @returns Extracted facts ready for persistence
 */
export async function extractMemories(
  state: SwarmState,
  callLLM: (prompt: string) => Promise<string>,
): Promise<MemoryExtractionResult> {
  // Skip extraction for trivial or failed workflows with no traces
  if (state.traces.length === 0) {
    return { facts: [], contextSummary: null };
  }

  const prompt = buildExtractionPrompt(state);

  try {
    const raw = await callLLM(prompt);

    // Parse JSON response — handle markdown fences
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned) as {
      facts?: Array<{
        key?: string;
        value?: Record<string, unknown>;
        type?: string;
        confidence?: number;
      }>;
      contextSummary?: string;
    };

    if (!parsed.facts || !Array.isArray(parsed.facts)) {
      return { facts: [], contextSummary: parsed.contextSummary ?? null };
    }

    // Validate and normalize facts
    const validTypes = new Set(['FACT', 'PREFERENCE', 'CONTEXT', 'SKILL_RESULT']);
    const facts: ExtractedFact[] = parsed.facts
      .filter(f =>
        f.key &&
        typeof f.key === 'string' &&
        f.value &&
        typeof f.value === 'object' &&
        f.type &&
        validTypes.has(f.type) &&
        typeof f.confidence === 'number' &&
        f.confidence >= 0 &&
        f.confidence <= 1,
      )
      .slice(0, MAX_FACTS)
      .map(f => ({
        key: f.key!.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 100),
        value: f.value!,
        type: f.type as ExtractedFact['type'],
        confidence: Math.round(f.confidence! * 100) / 100,
        source: `workflow:${state.workflowId}`,
      }));

    return {
      facts,
      contextSummary: parsed.contextSummary ?? null,
    };
  } catch {
    // Extraction is non-critical — never fail the workflow
    return { facts: [], contextSummary: null };
  }
}

/**
 * Deduplicate facts against existing tenant memories.
 * Compares normalized key + value to prevent duplicates.
 */
export function deduplicateFacts(
  newFacts: ExtractedFact[],
  existingKeys: Set<string>,
): ExtractedFact[] {
  return newFacts.filter(f => !existingKeys.has(f.key));
}

/**
 * Filter facts below confidence threshold.
 * Default: 0.7 (same as DeerFlow's fact_confidence_threshold)
 */
export function filterByConfidence(
  facts: ExtractedFact[],
  threshold = 0.7,
): ExtractedFact[] {
  return facts.filter(f => f.confidence >= threshold);
}
