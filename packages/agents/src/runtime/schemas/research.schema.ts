/**
 * Phase 4 — Strict zod schema for Research agent's structured output.
 *
 * Research is a tool-loop agent (web_search + search_knowledge), so the
 * schema is applied AFTER the loop terminates rather than via
 * `respondStructured` directly. The agent calls executeWithTools, then
 * runs the result through ResearchResponseSchema.safeParse() to
 * normalise output. Failures fall back to the existing prose-extraction
 * recovery path.
 */

import { z } from 'zod';

const SourceQualityTier = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const Freshness = z.enum(['fresh', 'recent', 'dated', 'stale', 'unknown']);

const ResearchSourceSchema = z.object({
  title: z.string(),
  url: z.string().nullable().optional(),
  excerpt: z.string(),
  relevanceScore: z.number().min(0).max(1),
  publishedDate: z.string().nullable().optional(),
  qualityTier: SourceQualityTier.optional(),
  freshness: Freshness.optional(),
});

const ResearchDisagreementSchema = z.object({
  point: z.string(),
  positions: z.array(z.object({
    claim: z.string(),
    supportingSources: z.array(z.string()),
  })),
  analystView: z.string().optional(),
});

export const ResearchResponseSchema = z.object({
  findings: z.string().min(1),
  keyPoints: z.array(z.string()).min(1).max(10),
  sources: z.array(ResearchSourceSchema),
  disagreements: z.array(ResearchDisagreementSchema).optional(),
  citations: z.array(z.object({
    claim: z.string(),
    sourceIndices: z.array(z.number().int().min(0)),
  })).optional(),
  overallFreshness: Freshness.optional(),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string()),
  suggestedFollowUp: z.array(z.string()).optional(),
});

export type ResearchResponseT = z.infer<typeof ResearchResponseSchema>;
