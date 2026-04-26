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
import { CompanyOSIntentSchema } from '../../intents/intent-vocabulary.js';

export const CommanderResponseSchema = z.object({
  directAnswer: z.string().nullable(),
  // `intent` is now constrained to one of the 18 named CompanyOS intents
  // (see packages/agents/src/intents/intent-vocabulary.ts). This drives:
  //   - WorkflowTemplate matching (Commander → template lookup)
  //   - IntentRecord persistence (queryable history per tenant)
  //   - Cockpit intent badge (shows clean human label)
  // Backward compat: when the LLM is uncertain it should choose
  // 'ambiguous_request' — the clarification gate then asks the user.
  intent: CompanyOSIntentSchema.nullable(),
  // The model's self-reported confidence in its intent classification (0-1).
  // Below 0.6 we suggest the user confirm by surfacing it in the cockpit.
  intentConfidence: z.number().min(0).max(1).nullable(),
  subFunction: z.string().nullable(),
  urgency: z.number().int().min(1).max(5).nullable(),
  riskIndicators: z.array(z.string()),
  requiredOutputs: z.array(z.string()),
  clarificationNeeded: z.boolean(),
  clarificationQuestion: z.string().nullable(),
});

export type CommanderResponseT = z.infer<typeof CommanderResponseSchema>;
