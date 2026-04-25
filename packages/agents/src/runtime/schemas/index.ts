/**
 * Phase 4 — Central index for all runtime-validated zod schemas.
 *
 * Both runtimes (Legacy + OpenAI) use the same schemas — the difference
 * is enforcement layer:
 *   - LegacyRuntime: schema parses output AFTER JSON-mode strips fences.
 *   - OpenAIRuntime: schema is the json_schema enforced by the model.
 */

export { CommanderResponseSchema, type CommanderResponseT } from './commander.schema.js';
export { PlannerResponseSchema, type PlannerResponseT, type PlannerTaskT } from './planner.schema.js';
export { ResearchResponseSchema, type ResearchResponseT } from './research.schema.js';
