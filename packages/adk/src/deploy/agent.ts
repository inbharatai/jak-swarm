/**
 * ADK deploy entry point — Agent Engine expects `root_agent` export.
 *
 * This is the thin shim that `npx @google/adk deploy agent_engine` uses
 * to discover and deploy the agent. The actual agent logic lives in
 * agent-engine-entry.ts, which creates the LlmAgent with JAK API tools
 * and Google Search Grounding.
 *
 * Deploy with:
 *   npx @google/adk deploy agent_engine packages/adk/src/deploy \
 *     --project=<GCP_PROJECT_ID> --region=<REGION> \
 *     --display_name=jak-swarm-gateway \
 *     --env_vars=JAK_API_URL=<url>,JAK_API_KEY=<key>
 *
 * Or use the TypeScript deploy script:
 *   npx tsx scripts/deploy-agent-engine.ts
 */
import { createJakGatewayAgent } from './agent-engine-entry.js';

export const root_agent = createJakGatewayAgent();