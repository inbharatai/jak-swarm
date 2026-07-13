import type { FastifyBaseLogger } from 'fastify';
import type { CompanyOperatingLayerService } from '../services/company-brain/company-operating-layer.service.js';
import type { CompanyBrainV2Service } from '../services/company-brain/company-brain-v2.service.js';

export function createCompanyBrainProcessor(legacy: CompanyOperatingLayerService, brain: CompanyBrainV2Service, log: FastifyBaseLogger) {
  const processArtifact = async (input: { tenantId: string; userId: string; artifactId: string; force?: boolean }) => {
    const claimed = await brain.claimArtifactForProcessing({ tenantId: input.tenantId, artifactId: input.artifactId, force: input.force });
    if (!claimed) return { claimed: false, skipped: true };
    try {
      const artifacts = await legacy.listArtifacts({ tenantId: input.tenantId, limit: 200, offset: 0 });
      const artifact = artifacts.items.find((item: { id: string; extractedAt: Date | null }) => item.id === input.artifactId);
      let entityIds: string[] | undefined;
      if (!artifact?.extractedAt) {
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
  const schedule = (tenantId: string, userId: string, artifactId: string) => {
    if (process.env['COMPANY_BRAIN_AUTO_PROCESS_ENABLED'] === 'false') return;
    setImmediate(() => void processArtifact({ tenantId, userId, artifactId }).catch((error_) => log.warn({ error_, artifactId }, '[company-brain-v2] immediate processing failed')));
  };
  return { processArtifact, schedule };
}
