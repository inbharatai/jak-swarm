import { z } from 'zod';
import { TenantStatus, TenantPlan } from '../types/tenant.js';
import { RiskLevel } from '../types/workflow.js';

export const TenantSettingsSchema = z.object({
  requireApprovals: z.boolean().default(true),
  approvalThreshold: z.nativeEnum(RiskLevel).default(RiskLevel.HIGH),
  allowedDomains: z.array(z.string().min(1)).default([]),
  maxConcurrentWorkflows: z.number().int().min(1).max(100).default(5),
  enableVoice: z.boolean().default(true),
  enableBrowserAutomation: z.boolean().default(false),
  logRetentionDays: z.number().int().min(7).max(3650).default(90),
});

export const CreateTenantSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  plan: z.nativeEnum(TenantPlan).default(TenantPlan.FREE),
  industry: z.string().optional(),
  settings: TenantSettingsSchema.optional(),
});

export const UpdateTenantSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  status: z.nativeEnum(TenantStatus).optional(),
  plan: z.nativeEnum(TenantPlan).optional(),
  industry: z.string().optional(),
  settings: TenantSettingsSchema.partial().optional(),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
export type UpdateTenantInput = z.infer<typeof UpdateTenantSchema>;
export type TenantSettingsInput = z.infer<typeof TenantSettingsSchema>;
