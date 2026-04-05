import { z } from 'zod';
import { AgentRole } from '../types/agent.js';

export const AgentConfigSchema = z.object({
  role: z.nativeEnum(AgentRole),
  systemPrompt: z.string().min(10),
  tools: z.array(z.string()),
  maxTurns: z.number().int().min(1).max(50).optional(),
});

export const RunAgentSchema = z.object({
  goal: z.string().min(3).max(2000),
  industry: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

export type AgentConfigInput = z.infer<typeof AgentConfigSchema>;
export type RunAgentInput = z.infer<typeof RunAgentSchema>;
