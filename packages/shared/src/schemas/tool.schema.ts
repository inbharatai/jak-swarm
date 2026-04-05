import { z } from 'zod';

export const ToolExecutionRequestSchema = z.object({
  toolName: z.string().min(1),
  input: z.record(z.unknown()),
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
