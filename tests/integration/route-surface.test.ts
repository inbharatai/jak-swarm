/**
 * Expanded route surface verification
 *
 * Guards that all major route families use canonical envelopes,
 * proper auth, tenant isolation, and consistent patterns.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function fileExists(relativePath: string): boolean {
  return existsSync(resolve(repoRoot, relativePath));
}

describe('Route surface verification', () => {
  it('registers all 20 route files in the API entry point', () => {
    const index = readRepoFile('apps/api/src/index.ts');
    const routeFiles = [
      'authRoutes', 'tenantsRoutes', 'workflowsRoutes', 'approvalsRoutes',
      'skillsRoutes', 'toolsRoutes', 'voiceRoutes', 'memoryRoutes',
      'tracesRoutes', 'analyticsRoutes', 'llmSettingsRoutes', 'schedulesRoutes',
      'onboardingRoutes', 'integrationRoutes', 'projectsRoutes', 'layoutRoutes',
      'usageRoutes', 'paddleRoutes', 'slackRoutes', 'whatsappRoutes',
    ];
    for (const name of routeFiles) {
      expect(index).toContain(name);
    }
  });

  it('all authenticated route files import ok/err canonical envelope helpers', () => {
    const routeFiles = [
      'apps/api/src/routes/auth.routes.ts',
      'apps/api/src/routes/tenants.routes.ts',
      'apps/api/src/routes/workflows.routes.ts',
      'apps/api/src/routes/approvals.routes.ts',
      'apps/api/src/routes/skills.routes.ts',
      'apps/api/src/routes/tools.routes.ts',
      'apps/api/src/routes/voice.routes.ts',
      'apps/api/src/routes/memory.routes.ts',
      'apps/api/src/routes/traces.routes.ts',
      'apps/api/src/routes/analytics.routes.ts',
      'apps/api/src/routes/llm-settings.routes.ts',
      'apps/api/src/routes/schedules.routes.ts',
      'apps/api/src/routes/onboarding.routes.ts',
      'apps/api/src/routes/integrations.routes.ts',
      'apps/api/src/routes/projects.routes.ts',
      'apps/api/src/routes/layouts.routes.ts',
      'apps/api/src/routes/usage.routes.ts',
      'apps/api/src/routes/whatsapp.routes.ts',
    ];

    for (const file of routeFiles) {
      if (!fileExists(file)) continue;
      const content = readRepoFile(file);
      expect(content, `${file} must import ok/err`).toMatch(/import\s+\{[^}]*\bok\b/);
    }
  });

  it('approval routes enforce role-based access control', () => {
    const approvals = readRepoFile('apps/api/src/routes/approvals.routes.ts');
    expect(approvals).toContain("fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')");
    expect(approvals).toContain("z.enum(['APPROVED', 'REJECTED', 'DEFERRED'])");
    expect(approvals).toContain('fastify.authenticate');
  });

  it('auth routes have brute-force rate limiting', () => {
    const auth = readRepoFile('apps/api/src/routes/auth.routes.ts');
    expect(auth).toContain('rateLimit');
    expect(auth).toContain('max: 10');
    expect(auth).toContain('1 minute');
    expect(auth).toContain("z.string().email('Invalid email address')");
    expect(auth).toContain("z.string().min(8");
  });

  it('workflow routes use Zod schema validation on write endpoints', () => {
    const workflows = readRepoFile('apps/api/src/routes/workflows.routes.ts');
    expect(workflows).toContain('z.object({');
    expect(workflows).toContain('.safeParse(request.body)');
    expect(workflows).toContain("err('VALIDATION_ERROR'");
    expect(workflows).toContain("z.string().min(1, 'Goal is required').max(2000)");
  });

  it('tool execution route restricts to admin roles and READ_ONLY risk class', () => {
    const tools = readRepoFile('apps/api/src/routes/tools.routes.ts');
    expect(tools).toContain("fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')");
    expect(tools).toContain('ToolRiskClass.READ_ONLY');
    expect(tools).toContain('Direct execution is disabled for');
  });

  it('integration routes use encrypted credential storage', () => {
    const integrations = readRepoFile('apps/api/src/routes/integrations.routes.ts');
    expect(integrations).toContain('encryptCredentials');
    expect(integrations).toContain('accessTokenEnc');
    expect(integrations).toContain('integrationCredential');
  });

  it('SSE stream routes support both header auth and query token fallback', () => {
    const workflows = readRepoFile('apps/api/src/routes/workflows.routes.ts');
    expect(workflows).toContain('!request.headers.authorization && query.token');
    expect(workflows).toContain('text/event-stream');
    expect(workflows).toContain('reply.hijack()');
    expect(workflows).toContain('X-Accel-Buffering');
  });

  it('queue stats and health endpoints require admin roles', () => {
    const workflows = readRepoFile('apps/api/src/routes/workflows.routes.ts');

    // Both /queue/stats and /queue/health should be admin-only
    const queueStatsSection = workflows.substring(
      workflows.indexOf("'/queue/stats'"),
      workflows.indexOf("'/queue/health'"),
    );
    expect(queueStatsSection).toContain("fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')");

    const queueHealthSection = workflows.substring(
      workflows.indexOf("'/queue/health'"),
      workflows.indexOf("'/:workflowId'", workflows.indexOf("'/queue/health'")),
    );
    expect(queueHealthSection).toContain("fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')");
  });

  it('schedule routes exist and use tenant isolation', () => {
    const schedules = readRepoFile('apps/api/src/routes/schedules.routes.ts');
    expect(schedules).toContain('authenticate');
    expect(schedules).toContain('enforceTenantIsolation');
  });

  it('trace routes exist and are authenticated', () => {
    const traces = readRepoFile('apps/api/src/routes/traces.routes.ts');
    expect(traces).toContain('authenticate');
    expect(traces).toContain("ok(");
  });

  it('onboarding routes use canonical envelopes', () => {
    const onboarding = readRepoFile('apps/api/src/routes/onboarding.routes.ts');
    expect(onboarding).toContain("ok(");
    expect(onboarding).toContain('authenticate');
  });

  it('voice routes are authenticated', () => {
    const voice = readRepoFile('apps/api/src/routes/voice.routes.ts');
    expect(voice).toContain('authenticate');
    expect(voice).toContain("ok(");
  });

  it('project routes use tenant isolation', () => {
    const projects = readRepoFile('apps/api/src/routes/projects.routes.ts');
    expect(projects).toContain('enforceTenantIsolation');
    expect(projects).toContain('authenticate');
  });

  it('tenant routes validate input schemas', () => {
    const tenants = readRepoFile('apps/api/src/routes/tenants.routes.ts');
    expect(tenants).toContain('z.object');
    expect(tenants).toContain('authenticate');
  });

  it('analytics routes are authenticated', () => {
    const analytics = readRepoFile('apps/api/src/routes/analytics.routes.ts');
    expect(analytics).toContain('authenticate');
  });
});

describe('Security contract guards', () => {
  it('API has global rate limiting configured', () => {
    const index = readRepoFile('apps/api/src/index.ts');
    expect(index).toContain('rateLimit');
  });

  it('API has CORS configured', () => {
    const index = readRepoFile('apps/api/src/index.ts');
    expect(index).toContain('cors');
  });

  it('API has security headers (helmet)', () => {
    const index = readRepoFile('apps/api/src/index.ts');
    expect(index).toContain('helmet');
  });

  it('API has structured global error handler', () => {
    const index = readRepoFile('apps/api/src/index.ts');
    expect(index).toContain('setErrorHandler');
  });

  it('tool execution requires both role gate and risk class check', () => {
    const tools = readRepoFile('apps/api/src/routes/tools.routes.ts');
    const executeSection = tools.substring(tools.indexOf("'/:toolName/execute'"));

    // Must have role requirement BEFORE execution
    expect(executeSection).toContain("fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')");
    // Must check risk class
    expect(executeSection).toContain('riskClass !== ToolRiskClass.READ_ONLY');
    // Must restrict to admin roles only
    expect(executeSection).not.toContain("requireRole('MEMBER'");
  });

  it('injection detection runs before workflow execution', () => {
    const exec = readRepoFile('apps/api/src/services/swarm-execution.service.ts');
    const injectionIndex = exec.indexOf('detectInjection(goal)');
    const runnerIndex = exec.indexOf('this.runner.run(');

    expect(injectionIndex).toBeGreaterThan(-1);
    expect(runnerIndex).toBeGreaterThan(-1);
    // Injection check must come before runner execution
    expect(injectionIndex).toBeLessThan(runnerIndex);
  });

  it('PII detection runs before workflow execution', () => {
    const exec = readRepoFile('apps/api/src/services/swarm-execution.service.ts');
    const piiIndex = exec.indexOf('detectPII(goal)');
    const runnerIndex = exec.indexOf('this.runner.run(');

    expect(piiIndex).toBeGreaterThan(-1);
    expect(piiIndex).toBeLessThan(runnerIndex);
  });

  it('distributed lock prevents duplicate execution across instances', () => {
    const exec = readRepoFile('apps/api/src/services/swarm-execution.service.ts');
    expect(exec).toContain('this.lockProvider.acquire');
    expect(exec).toContain('already running on another instance');
    expect(exec).toContain('this.lockProvider.release');
  });

  it('credential storage uses encryption', () => {
    const integrations = readRepoFile('apps/api/src/routes/integrations.routes.ts');
    expect(integrations).toContain("import { encrypt as encryptCredentials }");
    expect(integrations).toContain('encryptCredentials(JSON.stringify(credentials))');
  });
});
