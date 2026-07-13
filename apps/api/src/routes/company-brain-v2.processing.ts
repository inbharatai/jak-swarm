import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@jak-swarm/db';
import type { CompanyOperatingLayerService } from '../services/company-brain/company-operating-layer.service.js';
import type { CompanyBrainV2Service } from '../services/company-brain/company-brain-v2.service.js';
import { enqueueCompanyBrainJob } from '../services/company-brain/company-brain-worker.service.js';

/**
 * Company Brain artifact processing entrypoints.
 *
 *   - `processArtifact`: the synchronous, operator-initiated path
 *     (`POST /company/artifacts/:id/process`). It does NOT use the durable
 *     queue — it is awaited directly. The prior "list 200 artifacts then
 *     `.find(id)`" scan is replaced with a direct tenant-scoped lookup.
 *   - `schedule`: the auto-trigger after artifact ingestion. This NO LONGER
 *     fires `setImmediate`; it enqueues a durable `company_brain_jobs` row
 *     (migration 119) consumed by `CompanyBrainWorker`. Idempotent per
 *     `(tenantId, idempotencyKey)`.
 */
export function createCompanyBrainProcessor(
  db: PrismaClient,
  legacy: CompanyOperatingLayerService,
  brain: CompanyBrainV2Service,
  log: FastifyBaseLogger,
) {
  const processArtifact = async (input: { tenantId: string; userId: string; artifactId: string; force?: boolean }) => {
    const claimed = await brain.claimArtifactForProcessing({ tenantId: input.tenantId, artifactId: input.artifactId, force: input.force });
    if (!claimed) return { claimed: false, skipped: true };
    try {
      // Direct tenant-scoped lookup — no scan-and-find over the latest 200.
      const status = await brain.getArtifactProcessingStatus({ tenantId: input.tenantId, artifactId: input.artifactId });
      let entityIds: string[] | undefined;
      if (status.needsExtraction) {
        const extracted = await legacy.extractEntitiesFromArtifact({ tenantId: input.tenantId, userId: input.userId, artifactId: input.artifactId });
        entityIds = extracted.entities.map((entity: { id: string }) => entity.id);
      }
      const result = await brain.processExtractedEntities({ tenantId: input.tenantId, userId: input.userId, artifactId: input.artifactId, entityIds });
      await brain.setArtifactProcessingState({ tenantId: input.tenantId, artifactId: input.artifactId, state: 'ready' });
      return { claimed: true, skipped: false, ...result };
    } catch (error_) {
      await brain.markArtifactFailure({ tenantId: input.tenantId, artifactId: input.artifactId, error: error_ });
      throw error_;
    }
  };

  const schedule = async (tenantId: string, userId: string, artifactId: string) => {
    if (process.env['COMPANY_BRAIN_AUTO_PROCESS_ENABLED'] === 'false') return;
    try {
      await enqueueCompanyBrainJob(db, { tenantId, artifactId, userId, idempotencyKey: `artifact:${artifactId}` });
    } catch (error_) {
      // Durable enqueue unavailable (migration 119 not deployed). Log and
      // fall back to the approved profile-only path; the artifact is still
      // ingested. Never silently pretend it was enqueued.
      log.warn({ error_, artifactId }, '[company-brain-v2] durable enqueue unavailable — artifact ingested, processing deferred until migration 119 deploys');
    }
  };

  return { processArtifact, schedule };
}
