import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CompanyBrainSchemaUnavailableError } from '../services/company-brain/company-profile.service.js';
import { err } from '../types.js';

export const artifactSource = z.enum(['github','linear','jira','slack','notion','google_drive','gmail','meeting','customer_call','support','document','manual','other']);
export const artifactType = z.enum(['ticket','issue','pull_request','commit','slack_thread','notion_page','document','meeting_transcript','customer_feedback','support_ticket','email','decision_note','other']);
export const entityType = z.enum(['decision','task','spec','customer_signal','risk','owner','deadline','code_change','customer','metric','requirement']);
export const priority = z.enum(['low','medium','high','critical']);
export const paging = z.object({ limit: z.coerce.number().int().positive().max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
export const createArtifactSchema = z.object({
  sourceType: artifactSource, artifactType, title: z.string().min(1).max(500), body: z.string().min(20).max(250_000),
  externalId: z.string().max(500).optional(), sourceUrl: z.string().url().max(2000).optional(), authorName: z.string().max(200).optional(),
  occurredAt: z.string().datetime().optional(), metadata: z.record(z.unknown()).optional(),
}).strict();
export const createEntitySchema = z.object({
  entityType, title: z.string().min(1).max(240), summary: z.string().min(1).max(4000), sourceArtifactIds: z.array(z.string().min(1)).min(1).max(50),
  primaryArtifactId: z.string().min(1).optional(), status: z.string().min(1).max(80).optional(), ownerName: z.string().max(160).nullable().optional(),
  priority: priority.nullable().optional(), confidence: z.number().min(0).max(1).optional(), occurredAt: z.string().datetime().optional(), dueAt: z.string().datetime().optional(),
  relatedEntityIds: z.array(z.string().min(1)).max(100).optional(), properties: z.record(z.unknown()).optional(), extractedBy: z.enum(['manual','connector','openai','system']).optional(),
}).strict();
export const generateSpecSchema = z.object({ driftFindingId: z.string().min(1).optional(), entityIds: z.array(z.string().min(1)).max(100).optional() })
  .strict().refine((value: { driftFindingId?: string; entityIds?: string[] }) => Boolean(value.driftFindingId || value.entityIds?.length), { message: 'driftFindingId or entityIds is required' });

export const writeRoles = ['REVIEWER','TENANT_ADMIN','SYSTEM_ADMIN','OPERATOR'] as const;
export const reviewRoles = ['REVIEWER','TENANT_ADMIN','SYSTEM_ADMIN'] as const;

function validation(error_: any): string {
  return error_.issues.map((issue: { path: Array<string | number>; message: string }) => `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`).join('; ');
}
export function fail(reply: FastifyReply, error_: unknown, code: string): FastifyReply {
  if (error_ instanceof CompanyBrainSchemaUnavailableError) return reply.status(503).send(err('COMPANY_BRAIN_SCHEMA_UNAVAILABLE', error_.message));
  const message = error_ instanceof Error ? error_.message : 'unknown';
  if (/OPENAI_API_KEY/i.test(message)) return reply.status(503).send(err('LLM_KEY_REQUIRED', message));
  if (/not found|not present|not in this tenant/i.test(message)) return reply.status(404).send(err('NOT_FOUND', message));
  if (/already reviewed|immutable|cannot be reviewed|cannot merge/i.test(message)) return reply.status(409).send(err('CONFLICT', message));
  return reply.status(500).send(err(code, message));
}
export function body(schema: any, request: FastifyRequest, reply: FastifyReply): any | null {
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) { reply.status(400).send(err('INVALID_REQUEST', validation(parsed.error))); return null; }
  return parsed.data;
}
export function query(schema: any, request: FastifyRequest, reply: FastifyReply): any | null {
  const parsed = schema.safeParse(request.query ?? {});
  if (!parsed.success) { reply.status(400).send(err('INVALID_QUERY', validation(parsed.error))); return null; }
  return parsed.data;
}
export function id(request: FastifyRequest, reply: FastifyReply): string | null {
  const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params ?? {});
  if (!parsed.success) { reply.status(400).send(err('INVALID_PARAMS', validation(parsed.error))); return null; }
  return parsed.data.id;
}
