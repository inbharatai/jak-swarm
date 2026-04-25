/**
 * Phase 4 — Strict zod schema for Commander LLM output.
 *
 * The schema was previously inlined in commander.agent.ts. Phase 4 lifts
 * it into the central runtime/schemas folder so:
 *   1. The OpenAI structured-output adapter can read it cleanly.
 *   2. Tests can import + assert against it without circulars.
 *   3. Adding a second consumer (e.g. validation in API ingest) is one
 *      import away.
 *
 * Field-level reasoning lives in the agent file; this file is the wire
 * contract only.
 */

import { z } from 'zod';

export const CommanderResponseSchema = z.object({
  directAnswer: z.string().nullable(),
  intent: z.string().nullable(),
  subFunction: z.string().nullable(),
  urgency: z.number().int().min(1).max(5).nullable(),
  riskIndicators: z.array(z.string()),
  requiredOutputs: z.array(z.string()),
  clarificationNeeded: z.boolean(),
  clarificationQuestion: z.string().nullable(),
});

export type CommanderResponseT = z.infer<typeof CommanderResponseSchema>;
