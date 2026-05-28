import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  // Normalize CRLF → LF so multi-line string matches ("fastify.post(\n    '/'")
  // work consistently on Windows checkouts where core.autocrlf introduces
  // CRLF line endings.
  return readFileSync(resolve(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('JAK Swarm route contract checks', () => {
  it('keeps workflow frontend paths aligned with backend workflow routes', () => {
    const apiClient = readRepoFile('apps/web/src/lib/api-client.ts');
    const workflowRoutes = readRepoFile('apps/api/src/routes/workflows.routes.ts');
    const workflowControlRoutes = readRepoFile('apps/api/src/routes/workflows/workflow-control.routes.ts');
    const workflowQueryRoutes = readRepoFile('apps/api/src/routes/workflows/workflow-query.routes.ts');
    const workflowStreamRoutes = readRepoFile('apps/api/src/routes/workflows/workflow-stream.routes.ts');
    const workflowCreationService = readRepoFile('apps/api/src/services/workflow-creation.service.ts');

    // Frontend API paths in api-client.ts
    expect(apiClient).toContain("'/workflows'");
    expect(apiClient).toContain('`/workflows/${id}`');
    expect(apiClient).toContain('`/workflows/${id}/resume`');
    expect(apiClient).toContain('`/workflows/${id}/pause`');
    expect(apiClient).toContain('`/workflows/${id}/unpause`');
    expect(apiClient).toContain('`/workflows/${id}/stop`');
    expect(apiClient).toContain('`/workflows/${id}/traces`');
    expect(apiClient).toContain('`/workflows/${id}/approvals`');

    // Backend route handlers — Migration 108 split workflows.routes.ts into sub-routers
    expect(workflowRoutes).toContain("fastify.post(\n    '/'");
    expect(workflowQueryRoutes).toContain("fastify.get(\n    '/:workflowId'");
    expect(workflowControlRoutes).toContain("fastify.post(\n    '/:workflowId/resume'");
    expect(workflowControlRoutes).toContain("fastify.post(\n    '/:workflowId/pause'");
    expect(workflowControlRoutes).toContain("fastify.post(\n    '/:workflowId/unpause'");
    expect(workflowControlRoutes).toContain("fastify.post(\n    '/:workflowId/stop'");
    expect(workflowQueryRoutes).toContain("fastify.get(\n    '/:workflowId/traces'");
    expect(workflowQueryRoutes).toContain("fastify.get(\n    '/:workflowId/approvals'");
    expect(workflowStreamRoutes).toContain("'/:workflowId/stream'");
    expect(workflowQueryRoutes).toContain("'/queue/stats'");
    expect(workflowCreationService).toContain('fastify.swarm.enqueueExecution(');
  });

  it('ensures role modes are propagated from API request into swarm execution', () => {
    const webApiClient = readRepoFile('apps/web/src/lib/api-client.ts');
    const workflowRoutes = readRepoFile('apps/api/src/routes/workflows.routes.ts');
    const workflowCreationService = readRepoFile('apps/api/src/services/workflow-creation.service.ts');
    const executionService = readRepoFile('apps/api/src/services/swarm-execution.service.ts');
    const runner = readRepoFile('packages/swarm/src/runner/swarm-runner.ts');
    const state = readRepoFile('packages/swarm/src/state/swarm-state.ts');
    const commanderNode = readRepoFile('packages/swarm/src/graph/nodes/commander-node.ts');

    expect(webApiClient).toContain('roleModes');
    expect(workflowRoutes).toContain('roleModes');
    expect(workflowCreationService).toContain('roleModes');
    expect(executionService).toContain('roleModes');
    expect(runner).toContain('roleModes');
    expect(state).toContain('roleModes');
    expect(commanderNode).toContain('Role focus modes selected by user');
  });

  it('ensures stream endpoints used by hooks are present in backend routes', () => {
    const workflowHook = readRepoFile('apps/web/src/hooks/useWorkflowStream.ts');
    const projectHook = readRepoFile('apps/web/src/hooks/useProjectStream.ts');
    const workflowStreamRoutes = readRepoFile('apps/api/src/routes/workflows/workflow-stream.routes.ts');
    const projectRoutes = readRepoFile('apps/api/src/routes/projects.routes.ts');

    expect(workflowHook).toContain('/workflows/${workflowId}/stream');
    expect(workflowStreamRoutes).toContain("'/:workflowId/stream'");

    expect(projectHook).toContain('/projects/${projectId}/stream');
    expect(projectRoutes).toContain("'/:id/stream'");
  });

  it('guards stream auth and UI trace rendering contracts against runtime crashes', () => {
    const workflowStreamRoutes = readRepoFile('apps/api/src/routes/workflows/workflow-stream.routes.ts');
    const swarmMonitor = readRepoFile('apps/web/src/modules/swarm-monitor/index.tsx');
    const tracesPage = readRepoFile('apps/web/src/app/(dashboard)/traces/page.tsx');

    // Stream route should support header auth with query fallback and structured errors.
    expect(workflowStreamRoutes).toContain('!request.headers.authorization && query.token');
    expect(workflowStreamRoutes).toContain("err('UNAUTHORIZED', 'Unauthorized')");
    expect(workflowStreamRoutes).toContain("err('NOT_FOUND', 'Workflow not found')");

    // UI must guard against non-array traces to prevent .map runtime crash.
    expect(swarmMonitor).toContain('Array.isArray(wf.traces)');
    expect(tracesPage).toContain('Array.isArray(data?.items)');
    expect(tracesPage).toContain('Array.isArray(selectedTraceData.steps)');
  });

  it('keeps tool frontend paths aligned with backend tool routes', () => {
    const apiClient = readRepoFile('apps/web/src/lib/api-client.ts');
    const toolRoutes = readRepoFile('apps/api/src/routes/tools.routes.ts');

    // Frontend calls POST /tools/:toolName/execute
    expect(apiClient).toContain('`/tools/${toolName}/execute`');

    // Backend exposes GET /tools, GET /tools/:toolName, POST /tools/:toolName/execute
    expect(toolRoutes).toContain("fastify.get(\n    '/'");
    expect(toolRoutes).toContain("fastify.get(\n    '/:toolName'");
    expect(toolRoutes).toContain("fastify.post(\n    '/:toolName/execute'");
    expect(toolRoutes).toContain("fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')");
    expect(toolRoutes).toContain("Direct execution is disabled for");
  });

  it('keeps integration routes on canonical success/error envelopes for apiDataFetch callers', () => {
    const integrationRoutes = readRepoFile('apps/api/src/routes/integrations.routes.ts');

    expect(integrationRoutes).toContain("import { ok, err } from '../types.js'");
    expect(integrationRoutes).toContain('reply.send(ok(');
    expect(integrationRoutes).toContain("err('VALIDATION_ERROR'");
    expect(integrationRoutes).toContain("err('NOT_FOUND'");
  });

  it('aligns workflow list pagination query naming between hook and backend', () => {
    const workflowHook = readRepoFile('apps/web/src/hooks/useWorkflow.ts');
    const workflowQueryRoutes = readRepoFile('apps/api/src/routes/workflows/workflow-query.routes.ts');

    expect(workflowHook).toContain("params.set('limit', String(filters.pageSize))");
    expect(workflowQueryRoutes).toContain("parseInt(query.limit ?? '20', 10)");
  });

  it('prevents generic resume/unpause paths from bypassing pending approvals', () => {
    const workflowRoutes = readRepoFile('apps/api/src/routes/workflows.routes.ts');
    const workflowControlRoutes = readRepoFile('apps/api/src/routes/workflows/workflow-control.routes.ts');
    const whatsappRoutes = readRepoFile('apps/api/src/routes/whatsapp.routes.ts');
    const executionService = readRepoFile('apps/api/src/services/swarm-execution.service.ts');
    const runner = readRepoFile('packages/swarm/src/runner/swarm-runner.ts');
    const graphBuilder = readRepoFile('packages/swarm/src/workflow-runtime/langgraph-graph-builder.ts');
    const edges = readRepoFile('packages/swarm/src/graph/edges.ts');

    expect(workflowRoutes).toContain('APPROVAL_REQUIRED');
    expect(workflowControlRoutes).toContain('approvalRequest.findFirst');
    expect(workflowControlRoutes).toContain("status: 'PENDING'");
    expect(workflowRoutes).toContain('enqueueControl({');
    expect(workflowRoutes).toContain("action: 'resume'");

    expect(whatsappRoutes).toContain('generic resume cannot bypass approval');
    expect(executionService).toContain('Refusing generic resume while workflow has a pending approval');

    expect(runner).toContain("approvalDecision.status === 'DEFERRED'");
    expect(runner).not.toContain("approvalDecision.status === 'REJECTED' ? 'REJECTED' : 'APPROVED'");
    expect(graphBuilder).toContain('const approvalReducer =');
    expect(graphBuilder).toContain("decision.status === 'DEFERRED'");
    expect(edges).toContain("lastApproval?.status === 'DEFERRED'");
  });
});
