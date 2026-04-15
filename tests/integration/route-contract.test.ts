import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('JAK Swarm route contract checks', () => {
  it('keeps workflow frontend paths aligned with backend workflow routes', () => {
    const apiClient = readRepoFile('apps/web/src/lib/api-client.ts');
    const workflowRoutes = readRepoFile('apps/api/src/routes/workflows.routes.ts');

    // Frontend API paths in api-client.ts
    expect(apiClient).toContain("'/workflows'");
    expect(apiClient).toContain('`/workflows/${id}`');
    expect(apiClient).toContain('`/workflows/${id}/resume`');
    expect(apiClient).toContain('`/workflows/${id}/pause`');
    expect(apiClient).toContain('`/workflows/${id}/unpause`');
    expect(apiClient).toContain('`/workflows/${id}/stop`');
    expect(apiClient).toContain('`/workflows/${id}/traces`');
    expect(apiClient).toContain('`/workflows/${id}/approvals`');

    // Backend route handlers in workflows.routes.ts
    expect(workflowRoutes).toContain("fastify.post(\n    '/'");
    expect(workflowRoutes).toContain("fastify.get(\n    '/:workflowId'");
    expect(workflowRoutes).toContain("fastify.post(\n    '/:workflowId/resume'");
    expect(workflowRoutes).toContain("fastify.post(\n    '/:workflowId/pause'");
    expect(workflowRoutes).toContain("fastify.post(\n    '/:workflowId/unpause'");
    expect(workflowRoutes).toContain("fastify.post(\n    '/:workflowId/stop'");
    expect(workflowRoutes).toContain("fastify.get(\n    '/:workflowId/traces'");
    expect(workflowRoutes).toContain("fastify.get(\n    '/:workflowId/approvals'");
    expect(workflowRoutes).toContain("fastify.get(\n    '/:workflowId/stream'");
  });

  it('ensures role modes are propagated from API request into swarm execution', () => {
    const webApiClient = readRepoFile('apps/web/src/lib/api-client.ts');
    const workflowRoutes = readRepoFile('apps/api/src/routes/workflows.routes.ts');
    const executionService = readRepoFile('apps/api/src/services/swarm-execution.service.ts');
    const runner = readRepoFile('packages/swarm/src/runner/swarm-runner.ts');
    const state = readRepoFile('packages/swarm/src/state/swarm-state.ts');
    const commanderNode = readRepoFile('packages/swarm/src/graph/nodes/commander-node.ts');

    expect(webApiClient).toContain('roleModes');
    expect(workflowRoutes).toContain('roleModes');
    expect(executionService).toContain('roleModes');
    expect(runner).toContain('roleModes');
    expect(state).toContain('roleModes');
    expect(commanderNode).toContain('Role focus modes selected by user');
  });

  it('ensures stream endpoints used by hooks are present in backend routes', () => {
    const workflowHook = readRepoFile('apps/web/src/hooks/useWorkflowStream.ts');
    const projectHook = readRepoFile('apps/web/src/hooks/useProjectStream.ts');
    const workflowRoutes = readRepoFile('apps/api/src/routes/workflows.routes.ts');
    const projectRoutes = readRepoFile('apps/api/src/routes/projects.routes.ts');

    expect(workflowHook).toContain('/workflows/${workflowId}/stream');
    expect(workflowRoutes).toContain("'/:workflowId/stream'");

    expect(projectHook).toContain('/projects/${projectId}/stream');
    expect(projectRoutes).toContain("'/:id/stream'");
  });

  it('guards stream auth and UI trace rendering contracts against runtime crashes', () => {
    const workflowRoutes = readRepoFile('apps/api/src/routes/workflows.routes.ts');
    const swarmMonitor = readRepoFile('apps/web/src/modules/swarm-monitor/index.tsx');
    const tracesPage = readRepoFile('apps/web/src/app/(dashboard)/traces/page.tsx');

    // Stream route should support header auth with query fallback and structured errors.
    expect(workflowRoutes).toContain('!request.headers.authorization && query.token');
    expect(workflowRoutes).toContain("err('UNAUTHORIZED', 'Unauthorized')");
    expect(workflowRoutes).toContain("err('NOT_FOUND', 'Workflow not found')");

    // UI must guard against non-array traces to prevent .map runtime crash.
    expect(swarmMonitor).toContain('Array.isArray(wf.traces)');
    expect(tracesPage).toContain('Array.isArray(data?.items)');
    expect(tracesPage).toContain('Array.isArray(selectedTraceData.steps)');
  });
});
