/**
 * Artifact service schema-failsafe test.
 *
 * Verifies that when the workflow_artifacts table doesn't exist (e.g.
 * migration 10_workflow_artifacts wasn't deployed), the service throws
 * `ArtifactSchemaUnavailableError` instead of leaking a raw Prisma
 * error message to the client. The route layer translates this into
 * an HTTP 503 with a clear "run migration" hint.
 *
 * What this proves:
 *   1. listArtifactsForWorkflow translates P2021 → ArtifactSchemaUnavailableError
 *   2. createArtifact translates the same error
 *   3. getArtifact translates the same error
 *   4. healthCheck reports schemaPresent=false instead of crashing
 *   5. Errors with NO P2021 code propagate unchanged
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ArtifactService,
  ArtifactSchemaUnavailableError,
} from '../../apps/api/src/services/artifact.service.js';

// Minimal logger mock satisfying the service constructor
const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  level: 'info',
  child: () => log,
};

function makeP2021Error(): Error & { code: string } {
  const err = new Error('The table `public.workflow_artifacts` does not exist in the current database.') as Error & { code: string };
  err.code = 'P2021';
  return err;
}

function makeRandomError(): Error {
  return new Error('database connection refused');
}

function makeMockDb(behavior: 'schema_missing' | 'random_error' | 'returns_empty') {
  const thrower = behavior === 'schema_missing'
    ? () => Promise.reject(makeP2021Error())
    : behavior === 'random_error'
      ? () => Promise.reject(makeRandomError())
      : () => Promise.resolve(null);
  const listThrower = behavior === 'schema_missing'
    ? () => Promise.reject(makeP2021Error())
    : behavior === 'random_error'
      ? () => Promise.reject(makeRandomError())
      : () => Promise.resolve([]);
  const countThrower = behavior === 'schema_missing'
    ? () => Promise.reject(makeP2021Error())
    : behavior === 'random_error'
      ? () => Promise.reject(makeRandomError())
      : () => Promise.resolve(0);
  return {
    workflow: {
      findFirst: vi.fn().mockImplementation(thrower),
    },
    workflowArtifact: {
      findFirst: vi.fn().mockImplementation(thrower),
      findMany: vi.fn().mockImplementation(listThrower),
      create: vi.fn().mockImplementation(thrower),
      update: vi.fn().mockImplementation(thrower),
      count: vi.fn().mockImplementation(countThrower),
    },
  } as never;
}

describe('ArtifactService schema fail-safe', () => {
  describe('when workflow_artifacts table does not exist (P2021)', () => {
    it('listArtifactsForWorkflow throws ArtifactSchemaUnavailableError', async () => {
      const service = new ArtifactService(makeMockDb('schema_missing'), log as never);
      await expect(service.listArtifactsForWorkflow('wf-1', 't-1')).rejects.toBeInstanceOf(ArtifactSchemaUnavailableError);
    });

    it('getArtifact throws ArtifactSchemaUnavailableError', async () => {
      const service = new ArtifactService(makeMockDb('schema_missing'), log as never);
      await expect(service.getArtifact('a-1', 't-1')).rejects.toBeInstanceOf(ArtifactSchemaUnavailableError);
    });

    it('createArtifact throws ArtifactSchemaUnavailableError on workflow lookup', async () => {
      const service = new ArtifactService(makeMockDb('schema_missing'), log as never);
      await expect(service.createArtifact({
        tenantId: 't-1',
        workflowId: 'wf-1',
        producedBy: 'system',
        artifactType: 'final_output',
        fileName: 'out.txt',
        mimeType: 'text/plain',
        inlineContent: 'hello',
      })).rejects.toBeInstanceOf(ArtifactSchemaUnavailableError);
    });

    it('healthCheck reports schemaPresent=false', async () => {
      const service = new ArtifactService(makeMockDb('schema_missing'), log as never);
      const health = await service.healthCheck();
      expect(health.schemaPresent).toBe(false);
      expect(health.rowCount).toBeNull();
    });
  });

  describe('when DB throws non-P2021 errors', () => {
    it('listArtifactsForWorkflow propagates the original error (does NOT mask)', async () => {
      const service = new ArtifactService(makeMockDb('random_error'), log as never);
      await expect(service.listArtifactsForWorkflow('wf-1', 't-1'))
        .rejects.toThrow(/database connection refused/);
    });

    it('healthCheck still reports schemaPresent=false on any DB failure', async () => {
      // We treat any error as "schema effectively unavailable" for the
      // diagnostic — it's a probe, not a surgical check.
      const service = new ArtifactService(makeMockDb('random_error'), log as never);
      const health = await service.healthCheck();
      expect(health.schemaPresent).toBe(false);
    });
  });

  describe('when schema is healthy', () => {
    it('healthCheck reports schemaPresent=true with rowCount', async () => {
      const service = new ArtifactService(makeMockDb('returns_empty'), log as never);
      const health = await service.healthCheck();
      expect(health.schemaPresent).toBe(true);
      expect(health.rowCount).toBe(0);
    });
  });
});
