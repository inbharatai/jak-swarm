import { z } from 'zod';

export const CreateWorkflowSchema = z.object({
  goal: z.string().min(3).max(2000),
  industry: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

export const ApprovalDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'DEFERRED']),
  comment: z.string().max(2000).optional(),
});

export type CreateWorkflowInput = z.infer<typeof CreateWorkflowSchema>;
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionSchema>;
