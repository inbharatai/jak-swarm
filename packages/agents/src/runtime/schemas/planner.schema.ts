/**
 * Phase 4 — Strict zod schema for Planner LLM output.
 *
 * Used by both runtimes:
 *   - LegacyRuntime: schema parses output AFTER JSON-mode strips fences.
 *   - OpenAIRuntime: schema is passed to Responses API
 *     `text.format: json_schema` for model-layer enforcement.
 *
 * Why nullable instead of optional: OpenAI's strict json_schema mode
 * requires every property to be present in `required`. To express
 * "this field is sometimes absent" we mark it nullable and make it
 * required. The runtime/agent layer normalises null → default.
 *
 * The post-processing layer in `planner.agent.ts` (deterministic
 * verb→worker overrides) STAYS as defense-in-depth even with this
 * schema in place. Belt and suspenders — the override logic is one
 * of the highest-leverage hardenings in the system.
 */

import { z } from 'zod';

const TaskRiskLevel = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const PlannerTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  agentRole: z.string(),
  toolsRequired: z.array(z.string()),
  riskLevel: TaskRiskLevel,
  requiresApproval: z.boolean(),
  dependsOn: z.array(z.string()),
  retryable: z.boolean(),
  maxRetries: z.number().int().min(0).max(3),
});

export const PlannerResponseSchema = z.object({
  planName: z.string(),
  tasks: z.array(PlannerTaskSchema).min(1).max(20),
  estimatedDurationMinutes: z.number().int().min(1).max(720),
});

export type PlannerResponseT = z.infer<typeof PlannerResponseSchema>;
export type PlannerTaskT = z.infer<typeof PlannerTaskSchema>;
