import type { FastifyPluginAsync } from 'fastify';
import legacyRoutes from './company-operating-layer.legacy-routes.js';
import brainRoutes from './company-brain-v2.routes.js';

const companyOperatingLayerRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(legacyRoutes);
  await fastify.register(brainRoutes);
};
export default companyOperatingLayerRoutes;
