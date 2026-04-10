import { z } from 'zod';

// Maximum depth check to prevent deeply nested payloads
const MAX_INPUT_KEYS = 50;

export const ToolExecutionRequestSchema = z.object({
  toolName: z.string().min(1).max(200),
  input: z.record(z.unknown()).refine(
    (obj) => Object.keys(obj).length <= MAX_INPUT_KEYS,
    { message: `Tool input must not exceed ${MAX_INPUT_KEYS} keys` },
  ),
  context: z
    .object({
      tenantId: z.string().optional(),
      userId: z.string().optional(),
      workflowId: z.string().optional(),
      runId: z.string().optional(),
      approvalId: z.string().optional(),
    })
    .optional(),
});

export type ToolExecutionRequestInput = z.infer<typeof ToolExecutionRequestSchema>;
