import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Lightweight OpenAPI component registry.
 * Converts Zod schemas to JSON Schema definitions and registers them
 * with Fastify's swagger plugin so the /docs UI and /openapi.json
 * endpoint are fully typed from the source of truth (Zod).
 */

export function zodToOpenAPISchema(schema: z.ZodTypeAny, name: string) {
  const json = zodToJsonSchema(schema, {
    name,
    $refStrategy: 'none',
    target: 'openApi3',
  });
  // zod-to-json-schema wraps in an { $ref: { def: ... } } envelope;
  // unwrap it for fastify/swagger which expects plain JSON Schema.
  const def = (json as Record<string, unknown>)[name];
  if (!def) return json as Record<string, unknown>;
  return def as Record<string, unknown>;
}

/** Registry of schema name -> JSON Schema object */
export const openapiComponents: Record<string, Record<string, unknown>> = {};

/** Register a Zod schema as an OpenAPI component */
export function registerSchema(name: string, schema: z.ZodTypeAny) {
  openapiComponents[name] = zodToOpenAPISchema(schema, name);
}

/** Build the components block for fastify/swagger openapi config */
export function buildOpenAPIComponents() {
  return {
    schemas: openapiComponents,
  };
}
