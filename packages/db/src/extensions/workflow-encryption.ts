/**
 * workflow-encryption — Prisma client extension that automatically
 * encrypts the user-PII-bearing fields on `workflow` writes and
 * decrypts them on reads.
 *
 * Designed in Local Sprint 3 to close the runtime finding that
 * `workflows.{goal,error,finalOutput,planJson,stateJson}` were
 * persisting raw user PII.
 *
 * Coverage: every Prisma call site that hits the `workflow` model is
 * intercepted — `WorkflowService`, `swarm-execution.service`,
 * `db-state-store`, plus the routes that create workflows directly
 * (slack, voice, schedules, workpaper, attestation). One extension,
 * eight call sites, no per-route edits.
 *
 * Behavior:
 *   - When JAK_FIELD_ENCRYPTION_KEY is set, writes encrypt the
 *     listed fields before they hit Postgres; reads decrypt them
 *     before returning to the caller.
 *   - When the key is unset (default in dev), the extension is a
 *     no-op — fields pass through unchanged. Boot diagnostics in
 *     production should fail-loud when NODE_ENV=production but no
 *     key is set; that wiring lives outside this extension.
 *   - The cipher is idempotent in both directions so already-encrypted
 *     values aren't double-wrapped on update, and legacy plaintext
 *     rows aren't corrupted on read.
 */

import { Prisma } from '@prisma/client';
import {
  encryptString,
  decryptString,
  encryptJson,
  decryptJson,
  isFieldEncryptionEnabled,
} from '@jak-swarm/security';

/** Fields stored as TEXT — encrypt as a string. */
const TEXT_FIELDS = ['goal', 'error', 'finalOutput'] as const;
/** Fields stored as JSONB — encrypt as `{ enc: "..." }` wrapper. */
const JSON_FIELDS = ['planJson', 'stateJson'] as const;

function encryptWorkflowData<T extends Record<string, unknown>>(data: T): T {
  if (!isFieldEncryptionEnabled()) return data;
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, unknown> = { ...data };
  for (const f of TEXT_FIELDS) {
    if (f in out && typeof out[f] === 'string') {
      out[f] = encryptString(out[f] as string);
    }
  }
  for (const f of JSON_FIELDS) {
    if (f in out && out[f] !== undefined && out[f] !== null) {
      out[f] = encryptJson(out[f]);
    }
  }
  return out as T;
}

function decryptWorkflowRow(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return row;
  if (!isFieldEncryptionEnabled()) {
    // Even with key off, legacy rows may still contain encrypted
    // values from a prior key-on era — but without the key we can't
    // decrypt them. Return as-is; the caller sees the envelope.
    return row;
  }
  const out: Record<string, unknown> = { ...row };
  for (const f of TEXT_FIELDS) {
    if (f in out && typeof out[f] === 'string') {
      try {
        out[f] = decryptString(out[f] as string);
      } catch {
        // Leave the envelope visible rather than throwing —
        // mid-rotation rows would otherwise crash list endpoints.
        // Operators see the envelope and can re-key.
      }
    }
  }
  for (const f of JSON_FIELDS) {
    if (f in out && out[f] !== null && out[f] !== undefined) {
      try {
        out[f] = decryptJson(out[f]);
      } catch {
        // Same defense.
      }
    }
  }
  return out;
}

/**
 * Apply this to a base PrismaClient via `client.$extends(workflowEncryptionExtension)`.
 * The returned client is a drop-in replacement.
 */
export const workflowEncryptionExtension = Prisma.defineExtension({
  name: 'workflow-encryption',
  query: {
    workflow: {
      async create({ args, query }) {
        if (args.data && typeof args.data === 'object') {
          // Prisma typing for args.data is a union; safe to spread.
          args.data = encryptWorkflowData(args.data as unknown as Record<string, unknown>) as typeof args.data;
        }
        const result = await query(args);
        return decryptWorkflowRow(result as unknown as Record<string, unknown>) as typeof result;
      },
      async update({ args, query }) {
        if (args.data && typeof args.data === 'object') {
          args.data = encryptWorkflowData(args.data as unknown as Record<string, unknown>) as typeof args.data;
        }
        const result = await query(args);
        return decryptWorkflowRow(result as unknown as Record<string, unknown>) as typeof result;
      },
      async upsert({ args, query }) {
        if (args.create && typeof args.create === 'object') {
          args.create = encryptWorkflowData(args.create as unknown as Record<string, unknown>) as typeof args.create;
        }
        if (args.update && typeof args.update === 'object') {
          args.update = encryptWorkflowData(args.update as unknown as Record<string, unknown>) as typeof args.update;
        }
        const result = await query(args);
        return decryptWorkflowRow(result as unknown as Record<string, unknown>) as typeof result;
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        return decryptWorkflowRow(result as unknown as Record<string, unknown>) as typeof result;
      },
      async findUniqueOrThrow({ args, query }) {
        const result = await query(args);
        return decryptWorkflowRow(result as unknown as Record<string, unknown>) as typeof result;
      },
      async findFirst({ args, query }) {
        const result = await query(args);
        return decryptWorkflowRow(result as unknown as Record<string, unknown>) as typeof result;
      },
      async findFirstOrThrow({ args, query }) {
        const result = await query(args);
        return decryptWorkflowRow(result as unknown as Record<string, unknown>) as typeof result;
      },
      async findMany({ args, query }) {
        const result = (await query(args)) as unknown as Record<string, unknown>[];
        return result.map((r) => decryptWorkflowRow(r)) as typeof result;
      },
    },
  },
});
