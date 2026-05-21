import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apiPort = process.env['E2E_API_PORT'] ?? '4000';
const webPort = process.env['E2E_WEB_PORT'] ?? '3100';

// The local e2e stack runs Playwright, Testcontainers, Prisma, pnpm, and the
// API child process together; each can register shutdown hooks legitimately.
process.setMaxListeners(Math.max(process.getMaxListeners(), 100));

const pnpmBin = 'pnpm';
const isWindows = process.platform === 'win32';

let postgres: StartedTestContainer | null = null;
let apiProcess: ChildProcess | null = null;
let mockApiServer: Server | null = null;
let shuttingDown = false;

type MockWorkflow = {
  id: string;
  goal: string;
  roleModes: string[];
  status: 'QUEUED' | 'EXECUTING' | 'COMPLETED';
  createdAt: string;
  updatedAt: string;
  finalOutput: string;
};

const mockWorkflows = new Map<string, MockWorkflow>();

type MockProjectFile = {
  id: string;
  projectId: string;
  path: string;
  content: string;
  language: string | null;
  size: number;
  hash: string | null;
  isDeleted: boolean;
};

type MockProjectConversation = {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type MockProject = {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  description: string | null;
  framework: string;
  status: 'DRAFT' | 'GENERATING' | 'BUILDING' | 'READY' | 'DEPLOYED' | 'FAILED';
  sandboxId: string | null;
  previewUrl: string | null;
  deploymentUrl: string | null;
  githubRepo: string | null;
  currentVersion: number;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
  files: MockProjectFile[];
  versions: Array<{
    id: string;
    projectId: string;
    version: number;
    description: string | null;
    createdBy: string;
    createdAt: string;
  }>;
  conversations: MockProjectConversation[];
};

const mockProjects = new Map<string, MockProject>();

function runPnpm(args: string[], env: NodeJS.ProcessEnv) {
  const command = isWindows ? 'cmd.exe' : pnpmBin;
  const commandArgs = isWindows ? ['/d', '/s', '/c', [pnpmBin, ...args].join(' ')] : args;
  execFileSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (mockApiServer) {
    await new Promise<void>((resolve) => {
      mockApiServer?.close(() => resolve());
    }).catch(() => undefined);
  }

  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill('SIGTERM');
  }

  if (postgres) {
    await postgres.stop().catch((error: unknown) => {
      console.error('[e2e-api-stack] Failed to stop Postgres container:', error);
    });
  }

  process.exit(exitCode);
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  const allowedOrigins = new Set([
    `http://127.0.0.1:${webPort}`,
    `http://localhost:${webPort}`,
  ]);

  if (typeof origin === 'string' && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', `http://127.0.0.1:${webPort}`);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  setCorsHeaders(req, res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function ok(data: unknown) {
  return { success: true, data };
}

function paginated<T>(items: T[] = []) {
  return { items, total: items.length, limit: 50, offset: 0, page: 1, hasMore: false };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mockAuditDashboard() {
  return {
    generatedAt: nowIso(),
    windows: { day: '24h', week: '7d' },
    workflows: {
      total: 0,
      byStatus: [],
      last24h: 0,
      last7d: 0,
    },
    approvals: { byStatus: [] },
    artifacts: {
      available: true,
      byType: [],
      byApprovalState: [],
      signedBundles: 0,
    },
    actionsLast7d: [],
  };
}

function mockSocialDraft(body: Record<string, unknown>) {
  const topic = String(body['topic'] ?? 'AI agents at scale').trim() || 'AI agents at scale';
  const platform = String(body['platform'] ?? 'linkedin').toLowerCase();

  return {
    adapter: platform,
    displayName: platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1),
    draft: {
      kind: 'post',
      body: [
        `${topic} is where agentic teams need discipline, not hype.`,
        '',
        'The useful pattern is closed-loop execution: gather context, draft the action, request approval for risky steps, then preserve evidence in the audit trail.',
        '',
        'JAK Swarm keeps this local test draft in manual handoff mode so nothing is auto-published.',
      ].join('\n'),
      charLimit: platform === 'x' ? 280 : 3000,
      truncated: false,
      hashtags: ['#AgenticAI', '#CompanyOS', '#Execution'],
      checklist: [
        'Reviewer approves copy before publishing',
        'No credentials or private customer data included',
        'Manual handoff only; no auto-publish in local E2E',
      ],
    },
    manualHandoffRequired: true,
    manualHandoffMessage:
      'Draft ready for manual review. JAK never auto-publishes from this local E2E flow; copy the approved text into the destination platform yourself.',
  };
}

function mockToolRequirements() {
  return {
    requirements: [
      {
        capability: 'Document parsing',
        suggestedToolName: 'parse_pdf',
        reason:
          'The task mentions extracting text from PDFs. Use the sandbox adapter first, then require reviewer approval before enabling any production connector.',
        alreadyRegistered: false,
        sandboxAdapterAvailable: true,
        riskLevel: 'MEDIUM',
        approvalRequired: true,
      },
    ],
    safetyNote:
      'Sandbox-only recommendation. A reviewer must approve before a new tool can touch production data or external services.',
  };
}

function mockTraceList() {
  return paginated([
    {
      id: 'trace_local_demo_001',
      workflowId: 'wf_local_demo_001',
      agentRole: 'COMMANDER',
      startedAt: nowIso(),
      createdAt: nowIso(),
      durationMs: 1420,
      error: null,
    },
  ]);
}

function mockTraceDetail() {
  const startedAt = nowIso();
  return {
    id: 'trace_local_demo_001',
    workflowId: 'wf_local_demo_001',
    totalDurationMs: 1420,
    totalTokens: 1240,
    totalCostUsd: 0.0021,
    steps: [
      {
        id: 'step_local_001',
        stepNumber: 1,
        agentRole: 'COMMANDER',
        action: 'Parse goal and build local test plan',
        input: { goal: 'Human QA local smoke test' },
        output: { status: 'planned', next: 'guarded execution' },
        toolCalls: [],
        startedAt,
        completedAt: startedAt,
        durationMs: 420,
        costUsd: 0.0007,
        tokenUsage: 420,
        error: null,
      },
      {
        id: 'step_local_002',
        stepNumber: 2,
        agentRole: 'VERIFIER',
        action: 'Verify audit evidence is visible',
        input: { artifact: 'local-e2e' },
        output: { result: 'verified' },
        toolCalls: [
          {
            id: 'tool_local_001',
            toolName: 'audit.log',
            input: { resource: 'workflow' },
            output: { written: true },
            startedAt,
            completedAt: startedAt,
            durationMs: 120,
            error: null,
          },
        ],
        startedAt,
        completedAt: startedAt,
        durationMs: 1000,
        costUsd: 0.0014,
        tokenUsage: 820,
        error: null,
      },
    ],
  };
}

function normalizeRoleModes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((role): role is string => typeof role === 'string')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
}

function roleToMockTask(role: string, index: number) {
  const defaults = {
    id: `task_${index + 1}_${role}`,
    dependsOn: index === 0 ? [] : [`task_${index}_${role}`],
    status: 'pending',
    riskLevel: 'LOW',
    requiresApproval: false,
  };

  switch (role) {
    case 'ceo':
      return {
        ...defaults,
        name: 'CEO Agent frames strategy and success criteria',
        description: 'Clarify the business outcome, operating assumptions, and decision risks.',
        agentRole: 'WORKER_STRATEGIST',
      };
    case 'cto':
      return {
        ...defaults,
        name: 'CTO Agent checks architecture and execution feasibility',
        description: 'Review technical constraints, build sequence, and validation plan.',
        agentRole: 'WORKER_TECHNICAL',
      };
    case 'cmo':
      return {
        ...defaults,
        name: 'CMO Agent drafts positioning and GTM actions',
        description: 'Turn the goal into a buyer-facing message and launch checklist.',
        agentRole: 'WORKER_MARKETING',
      };
    case 'coding':
      return {
        ...defaults,
        name: 'Coding Agent scopes implementation tasks',
        description: 'Translate the spec into files, tests, and acceptance criteria.',
        agentRole: 'WORKER_CODER',
      };
    case 'research':
      return {
        ...defaults,
        name: 'Research Agent gathers evidence',
        description: 'Collect source-backed context before execution decisions.',
        agentRole: 'WORKER_RESEARCH',
      };
    case 'design':
      return {
        ...defaults,
        name: 'Design Agent shapes user experience',
        description: 'Create UX requirements, accessibility notes, and review criteria.',
        agentRole: 'WORKER_DESIGNER',
      };
    case 'automation':
      return {
        ...defaults,
        name: 'Automation Agent defines operational handoff',
        description: 'Plan scheduled runs, integration steps, and rollback controls.',
        agentRole: 'WORKER_OPS',
      };
    case 'legal':
      return {
        ...defaults,
        name: 'Legal Agent flags review concerns',
        description: 'Identify compliance, contract, and policy risks before action.',
        agentRole: 'WORKER_LEGAL',
      };
    default:
      return {
        ...defaults,
        name: 'Ops Agent routes the request',
        description: 'Use the general workflow operator when no specific role is selected.',
        agentRole: 'WORKER_OPS',
      };
  }
}

function mockWorkflowTasks(roleModes: string[]) {
  const roles = roleModes.length > 0 ? roleModes : ['automation'];
  return roles.map((role, index) => roleToMockTask(role, index));
}

function mockWorkflowFinalOutput(workflow: MockWorkflow) {
  const roles = workflow.roleModes.length > 0
    ? workflow.roleModes.map((role) => role.toUpperCase()).join(', ')
    : 'AUTO';
  return [
    `Local E2E proof complete for ${roles}.`,
    '',
    'CEO/CTO/CMO-style role routing is wired through the workspace role picker, POST /workflows, the workflow SSE stream, and the final workflow fetch.',
    '',
    'Honest boundary: this screenshot proves the command loop and role-event rendering locally. It does not prove live OpenAI model quality or production connector execution.',
  ].join('\n');
}

function projectFile(projectId: string, filePath: string, content: string, language: string | null): MockProjectFile {
  return {
    id: `file_${projectId}_${filePath.replace(/[^a-z0-9]/gi, '_')}`,
    projectId,
    path: filePath,
    content,
    language,
    size: Buffer.byteLength(content, 'utf8'),
    hash: `local-${Buffer.byteLength(content, 'utf8')}`,
    isDeleted: false,
  };
}

function mockGeneratedProjectFiles(projectId: string, appName: string, prompt: string): MockProjectFile[] {
  const safeName = appName.trim() || 'JAK Demo App';
  return [
    projectFile(
      projectId,
      'src/app/page.tsx',
      [
        "export default function Page() {",
        '  return (',
        '    <main className="min-h-screen bg-slate-950 px-8 py-12 text-white">',
        '      <section className="mx-auto max-w-3xl rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-8">',
        `        <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">${safeName}</p>`,
        '        <h1 className="mt-4 text-5xl font-bold">Local vibe-coding proof</h1>',
        `        <p className="mt-4 text-slate-300">${prompt.replace(/`/g, "'")}</p>`,
        '      </section>',
        '    </main>',
        '  );',
        '}',
        '',
      ].join('\n'),
      'tsx',
    ),
    projectFile(
      projectId,
      'package.json',
      JSON.stringify({
        scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
        dependencies: { next: '16.2.6', react: '19.2.3', 'react-dom': '19.2.3' },
      }, null, 2),
      'json',
    ),
    projectFile(
      projectId,
      'README.md',
      [
        `# ${safeName}`,
        '',
        'Generated by the deterministic local E2E mock to prove the Builder UI flow.',
        '',
        'Honest boundary: this local proof does not claim a live OpenAI app-generation run.',
        '',
      ].join('\n'),
      'markdown',
    ),
  ];
}

function mockProjectCheckpoint(project: MockProject) {
  return {
    id: `checkpoint_${project.id}_${project.currentVersion}`,
    version: project.currentVersion,
    description: project.currentVersion === 1 ? 'Project created' : 'Local E2E generated app files',
    stage: project.currentVersion === 1 ? 'manual' : 'generator',
    workflowId: null,
    createdBy: 'local-e2e',
    createdAt: project.updatedAt,
    diff: {
      added: project.files.map((file) => ({ path: file.path, nextSize: file.size, nextHash: file.hash })),
      modified: [],
      deleted: [],
      totalFiles: project.files.length,
      hasChanges: project.files.length > 0,
    },
  };
}

function sendSseEvent(res: ServerResponse, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleMockApi(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${apiPort}`);
  const method = req.method ?? 'GET';
  const pathname = url.pathname.replace(/\/$/, '') || '/';

  if (method === 'OPTIONS') {
    return sendJson(req, res, 204, {});
  }

  if ((method === 'GET' || method === 'HEAD') && (pathname === '/healthz' || pathname === '/health')) {
    return sendJson(req, res, 200, {
      ok: true,
      status: 'ok',
      mode: 'local-e2e-mock',
      message:
        'Testcontainers/Docker was unavailable, so Playwright is using the deterministic local E2E mock API.',
    });
  }

  if (method === 'GET' && (pathname === '/auth/me' || pathname === '/me')) {
    return sendJson(req, res, 200, ok({
      id: 'user_dev_bypass',
      email: 'dev@jakswarm.local',
      role: 'ADMIN',
      tenantId: 'tenant_dev_bypass',
    }));
  }

  if (method === 'GET' && pathname === '/trial/status') {
    return sendJson(req, res, 200, ok({
      plan: 'beta',
      status: 'active',
      daysRemaining: 30,
      trialEndsAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
    }));
  }

  if (method === 'GET' && pathname === '/onboarding/state') {
    return sendJson(req, res, 200, ok({ completedSteps: [], dismissed: false }));
  }

  if (method === 'POST' && pathname === '/onboarding/state') {
    const body = await readJson(req);
    return sendJson(req, res, 200, ok({
      completedSteps: Array.isArray(body['completedSteps']) ? body['completedSteps'] : [],
      dismissed: Boolean(body['dismissed']),
    }));
  }

  if (method === 'GET' && pathname === '/integrations') {
    return sendJson(req, res, 200, ok([]));
  }

  if (method === 'GET' && pathname === '/integrations/oauth/providers') {
    return sendJson(req, res, 200, ok([
      { id: 'gmail', label: 'Gmail', configured: false },
      { id: 'slack', label: 'Slack', configured: false },
      { id: 'github', label: 'GitHub', configured: false },
      { id: 'notion', label: 'Notion', configured: false },
      { id: 'linear', label: 'Linear', configured: false },
    ]));
  }

  if (method === 'GET' && pathname.startsWith('/integrations/providers/')) {
    const provider = pathname.split('/').pop() ?? 'provider';
    return sendJson(req, res, 200, ok({
      name: provider.toUpperCase(),
      description: 'Local E2E provider metadata. Configure real credentials in deployment.',
      credentialFields: [],
      setupInstructions: 'Use OAuth/credential setup in a real environment.',
      maturity: 'partial',
      note: 'Local deterministic E2E response; not a live connector.',
    }));
  }

  if (method === 'GET' && pathname === '/whatsapp/status') {
    return sendJson(req, res, 200, ok({
      status: 'disconnected',
      connected: false,
      message: 'whatsapp-client is not running in the local E2E mock API.',
    }));
  }

  if (method === 'GET' && pathname === '/whatsapp/number') {
    return sendJson(req, res, 200, ok({
      number: null,
      status: 'NOT_CONFIGURED',
      verificationCode: null,
      expiresAt: null,
      verifiedAt: null,
    }));
  }

  if (method === 'POST' && pathname === '/voice/sessions') {
    return sendJson(req, res, 200, ok({
      sessionId: 'voice_local_demo_001',
      webRtcConfig: { provider: 'mock', mode: 'browser-stt' },
      expiresInSeconds: 600,
    }));
  }

  if (method === 'GET' && /^\/voice\/sessions\/[^/]+\/token$/.test(pathname)) {
    return sendJson(req, res, 200, ok({
      sessionId: pathname.split('/')[3],
      clientToken: 'local-e2e-token',
      model: 'mock-realtime-local',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      isMock: true,
    }));
  }

  if (method === 'POST' && pathname === '/social-drafts') {
    const body = await readJson(req);
    await sleep(350);
    return sendJson(req, res, 200, ok(mockSocialDraft(body)));
  }

  if (method === 'POST' && pathname === '/tool-installer/detect') {
    await sleep(350);
    return sendJson(req, res, 200, ok(mockToolRequirements()));
  }

  if (method === 'POST' && pathname === '/tool-installer/plan') {
    return sendJson(req, res, 200, ok({
      plan: [
        'Keep the tool in sandbox mode',
        'Run reviewer approval',
        'Register only after production credentials and audit policy are configured',
      ],
      approvalRequired: true,
    }));
  }

  if (method === 'GET' && pathname === '/standing-orders') {
    return sendJson(req, res, 200, ok({ items: [], count: 0 }));
  }

  if (method === 'POST' && pathname === '/standing-orders') {
    const body = await readJson(req);
    return sendJson(req, res, 201, ok({
      id: 'so_local_demo_001',
      name: String(body['name'] ?? 'Local standing order'),
      status: 'ACTIVE',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }));
  }

  if (method === 'GET' && pathname === '/schedules') {
    return sendJson(req, res, 200, ok([]));
  }

  if (method === 'GET' && pathname === '/audit/dashboard') {
    return sendJson(req, res, 200, ok(mockAuditDashboard()));
  }

  if (method === 'GET' && pathname === '/audit/log') {
    return sendJson(req, res, 200, ok(paginated([])));
  }

  if (method === 'GET' && pathname === '/audit/reviewer-queue') {
    return sendJson(req, res, 200, ok({
      workflowApprovals: { items: [], total: 0 },
      artifactApprovals: { items: [], total: 0 },
      limit: 50,
      offset: 0,
    }));
  }

  if (method === 'GET' && /^\/audit\/workflows\/[^/]+\/trail$/.test(pathname)) {
    const workflowId = pathname.split('/')[3];
    return sendJson(req, res, 200, ok({
      workflow: {
        id: workflowId,
        goal: 'Local E2E workflow trail',
        status: 'COMPLETED',
        startedAt: nowIso(),
        completedAt: nowIso(),
        totalCostUsd: 0,
      },
      events: [],
      eventCount: 0,
    }));
  }

  if (method === 'GET' && pathname === '/compliance/frameworks') {
    return sendJson(req, res, 200, ok({ frameworks: [] }));
  }

  if (method === 'GET' && pathname === '/memory') {
    return sendJson(req, res, 200, ok(paginated([])));
  }

  if (method === 'GET' && pathname === '/skills') {
    return sendJson(req, res, 200, ok(paginated([])));
  }

  if (method === 'GET' && pathname === '/tools') {
    return sendJson(req, res, 200, ok([]));
  }

  if (method === 'GET' && pathname === '/approvals') {
    return sendJson(req, res, 200, ok({ items: [], total: 0, limit: 50, offset: 0 }));
  }

  if (method === 'GET' && pathname === '/inbox') {
    return sendJson(req, res, 200, ok({ items: [], total: 0, unread: 0 }));
  }

  if (method === 'GET' && pathname === '/inbox/messages') {
    return sendJson(req, res, 200, ok({ items: [], total: 0, unread: 0 }));
  }

  if (method === 'GET' && pathname === '/team/departments') {
    return sendJson(req, res, 200, ok({ items: [], total: 0 }));
  }

  if (method === 'GET' && pathname === '/team/members') {
    return sendJson(req, res, 200, ok({ items: [], total: 0, limit: 50, offset: 0 }));
  }

  if (method === 'GET' && pathname === '/tenants/current/settings') {
    return sendJson(req, res, 200, ok({
      name: 'Local E2E Tenant',
      plan: 'beta',
      approvalMode: 'required_for_risky_actions',
    }));
  }

  if (method === 'GET' && pathname === '/tenants/current/users') {
    return sendJson(req, res, 200, ok([
      {
        id: 'user_dev_bypass',
        email: 'dev@jakswarm.local',
        role: 'ADMIN',
        createdAt: nowIso(),
      },
    ]));
  }

  if (method === 'GET' && pathname === '/tenants/current/api-keys') {
    return sendJson(req, res, 200, ok([]));
  }

  if (method === 'GET' && pathname === '/analytics/summary') {
    return sendJson(req, res, 200, ok({
      workflows: { total: 0, completed: 0, failed: 0 },
      cost: { totalUsd: 0 },
      latency: { p50Ms: 0, p95Ms: 0 },
    }));
  }

  if (method === 'GET' && pathname === '/calendar/events') {
    return sendJson(req, res, 200, ok({ items: [], total: 0 }));
  }

  if (method === 'GET' && pathname === '/projects') {
    return sendJson(req, res, 200, ok({
      projects: [...mockProjects.values()],
      total: mockProjects.size,
      totalPages: 1,
    }));
  }

  if (method === 'POST' && pathname === '/projects') {
    const body = await readJson(req);
    const id = `project_local_demo_${Date.now()}`;
    const now = nowIso();
    const project: MockProject = {
      id,
      tenantId: 'tenant_dev_bypass',
      userId: 'user_dev_bypass',
      name: String(body['name'] ?? 'Local Vibe Coding App'),
      description: typeof body['description'] === 'string' ? body['description'] : null,
      framework: String(body['framework'] ?? 'nextjs'),
      status: 'DRAFT',
      sandboxId: null,
      previewUrl: null,
      deploymentUrl: null,
      githubRepo: null,
      currentVersion: 1,
      totalCostUsd: 0,
      createdAt: now,
      updatedAt: now,
      files: [],
      versions: [{
        id: `version_${id}_1`,
        projectId: id,
        version: 1,
        description: 'Project created',
        createdBy: 'local-e2e',
        createdAt: now,
      }],
      conversations: [],
    };
    mockProjects.set(id, project);
    return sendJson(req, res, 201, ok(project));
  }

  if (method === 'GET' && /^\/projects\/[^/]+\/checkpoints$/.test(pathname)) {
    const projectId = pathname.split('/')[2] ?? '';
    const project = mockProjects.get(projectId);
    return sendJson(req, res, 200, ok(project ? [mockProjectCheckpoint(project)] : []));
  }

  if (method === 'POST' && /^\/projects\/[^/]+\/checkpoints$/.test(pathname)) {
    const projectId = pathname.split('/')[2] ?? '';
    const project = mockProjects.get(projectId);
    if (!project) {
      return sendJson(req, res, 404, {
        success: false,
        error: { code: 'LOCAL_E2E_PROJECT_NOT_FOUND', message: `Project ${projectId} does not exist.` },
      });
    }
    return sendJson(req, res, 201, ok(mockProjectCheckpoint(project)));
  }

  if (method === 'GET' && /^\/projects\/[^/]+\/stream$/.test(pathname)) {
    const projectId = pathname.split('/')[2] ?? '';
    const project = mockProjects.get(projectId);
    setCorsHeaders(req, res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sendSseEvent(res, {
      type: 'generation_completed',
      projectId,
      status: project?.status ?? 'READY',
      message: 'Local E2E project stream completed.',
      timestamp: nowIso(),
    });
    return res.end();
  }

  if (method === 'POST' && /^\/projects\/[^/]+\/generate$/.test(pathname)) {
    const projectId = pathname.split('/')[2] ?? '';
    const project = mockProjects.get(projectId);
    if (!project) {
      return sendJson(req, res, 404, {
        success: false,
        error: { code: 'LOCAL_E2E_PROJECT_NOT_FOUND', message: `Project ${projectId} does not exist.` },
      });
    }
    const body = await readJson(req);
    const description = String(body['description'] ?? 'Build a local demo app');
    project.status = 'READY';
    project.currentVersion += 1;
    project.files = mockGeneratedProjectFiles(project.id, project.name, description);
    project.updatedAt = nowIso();
    project.conversations.push({
      id: `conv_${project.id}_${project.conversations.length + 1}`,
      projectId: project.id,
      role: 'user',
      content: description,
      metadata: null,
      createdAt: project.updatedAt,
    });
    project.conversations.push({
      id: `conv_${project.id}_${project.conversations.length + 1}`,
      projectId: project.id,
      role: 'assistant',
      content:
        'Local E2E builder proof complete. Generated a Next.js page, package.json, and README. Honest boundary: this is deterministic local proof, not a live OpenAI generation run.',
      metadata: { mode: 'local-e2e-mock' },
      createdAt: project.updatedAt,
    });
    project.versions.push({
      id: `version_${project.id}_${project.currentVersion}`,
      projectId: project.id,
      version: project.currentVersion,
      description: 'Local E2E generated app files',
      createdBy: 'local-e2e',
      createdAt: project.updatedAt,
    });
    mockProjects.set(project.id, project);
    await sleep(250);
    return sendJson(req, res, 202, ok({
      projectId: project.id,
      status: 'READY',
      message: 'Local E2E generation completed',
    }));
  }

  if (method === 'POST' && /^\/projects\/[^/]+\/iterate$/.test(pathname)) {
    const projectId = pathname.split('/')[2] ?? '';
    const project = mockProjects.get(projectId);
    if (!project) {
      return sendJson(req, res, 404, {
        success: false,
        error: { code: 'LOCAL_E2E_PROJECT_NOT_FOUND', message: `Project ${projectId} does not exist.` },
      });
    }
    const body = await readJson(req);
    const message = String(body['message'] ?? 'Refine the generated app');
    const now = nowIso();
    project.conversations.push({ id: `conv_${project.id}_${project.conversations.length + 1}`, projectId, role: 'user', content: message, metadata: null, createdAt: now });
    project.conversations.push({
      id: `conv_${project.id}_${project.conversations.length + 1}`,
      projectId,
      role: 'assistant',
      content: 'Local E2E iteration accepted. A live deployment would route this through the vibe-coder generation/debug loop.',
      metadata: { mode: 'local-e2e-mock' },
      createdAt: now,
    });
    project.updatedAt = now;
    mockProjects.set(projectId, project);
    return sendJson(req, res, 202, ok({ projectId, status: 'READY', message: 'Local E2E iteration completed' }));
  }

  if (method === 'POST' && /^\/projects\/[^/]+\/deploy$/.test(pathname)) {
    const projectId = pathname.split('/')[2] ?? '';
    const project = mockProjects.get(projectId);
    if (!project) {
      return sendJson(req, res, 404, {
        success: false,
        error: { code: 'LOCAL_E2E_PROJECT_NOT_FOUND', message: `Project ${projectId} does not exist.` },
      });
    }
    project.status = 'DEPLOYED';
    project.deploymentUrl = `https://local-e2e-${projectId}.example.invalid`;
    project.updatedAt = nowIso();
    mockProjects.set(projectId, project);
    return sendJson(req, res, 202, ok({ projectId, status: 'DEPLOYED', message: 'Local E2E deployment marker set' }));
  }

  if (method === 'PUT' && /^\/projects\/[^/]+\/files\/.+$/.test(pathname)) {
    const parts = pathname.split('/');
    const projectId = parts[2] ?? '';
    const filePath = decodeURIComponent(parts.slice(4).join('/'));
    const project = mockProjects.get(projectId);
    if (!project) {
      return sendJson(req, res, 404, {
        success: false,
        error: { code: 'LOCAL_E2E_PROJECT_NOT_FOUND', message: `Project ${projectId} does not exist.` },
      });
    }
    const body = await readJson(req);
    const content = String(body['content'] ?? '');
    const index = project.files.findIndex((file) => file.path === filePath);
    const nextFile = projectFile(projectId, filePath, content, project.files[index]?.language ?? 'plaintext');
    if (index >= 0) project.files[index] = nextFile;
    else project.files.push(nextFile);
    project.updatedAt = nowIso();
    mockProjects.set(projectId, project);
    return sendJson(req, res, 200, ok(nextFile));
  }

  if (method === 'GET' && /^\/projects\/[^/]+$/.test(pathname)) {
    const projectId = pathname.split('/')[2] ?? '';
    const project = mockProjects.get(projectId);
    if (!project) {
      return sendJson(req, res, 404, {
        success: false,
        error: { code: 'LOCAL_E2E_PROJECT_NOT_FOUND', message: `Project ${projectId} does not exist.` },
      });
    }
    return sendJson(req, res, 200, ok(project));
  }

  if (method === 'GET' && pathname === '/workflows') {
    return sendJson(req, res, 200, ok(paginated([...mockWorkflows.values()])));
  }

  if (method === 'POST' && pathname === '/workflows') {
    const body = await readJson(req);
    const roleModes = normalizeRoleModes(body['roleModes']);
    const id = `wf_local_demo_${Date.now()}`;
    const now = nowIso();
    const workflow: MockWorkflow = {
      id,
      goal: String(body['goal'] ?? 'Local E2E workflow'),
      roleModes,
      status: 'QUEUED',
      createdAt: now,
      updatedAt: now,
      finalOutput: '',
    };
    workflow.finalOutput = mockWorkflowFinalOutput(workflow);
    mockWorkflows.set(id, workflow);
    return sendJson(req, res, 201, ok(workflow));
  }

  if (method === 'GET' && /^\/workflows\/[^/]+\/stream$/.test(pathname)) {
    const workflowId = pathname.split('/')[2] ?? 'wf_local_demo_001';
    const workflow = mockWorkflows.get(workflowId) ?? {
      id: workflowId,
      goal: 'Local E2E workflow',
      roleModes: ['cto'],
      status: 'QUEUED' as const,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      finalOutput: '',
    };
    workflow.status = 'EXECUTING';
    workflow.updatedAt = nowIso();
    workflow.finalOutput = workflow.finalOutput || mockWorkflowFinalOutput(workflow);
    mockWorkflows.set(workflowId, workflow);
    const tasks = mockWorkflowTasks(workflow.roleModes);

    setCorsHeaders(req, res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    sendSseEvent(res, {
      type: 'plan_created',
      workflowId,
      plan: {
        goal: workflow.goal,
        tasks,
      },
    });
    await sleep(120);

    for (const task of tasks) {
      sendSseEvent(res, {
        type: 'worker_started',
        workflowId,
        taskId: task.id,
        taskName: task.name,
        agentRole: task.agentRole,
      });
      await sleep(120);
      sendSseEvent(res, {
        type: 'worker_completed',
        workflowId,
        taskId: task.id,
        taskName: task.name,
        agentRole: task.agentRole,
        success: true,
        durationMs: 860,
      });
      await sleep(90);
    }

    sendSseEvent(res, {
      type: 'cost_updated',
      workflowId,
      costUsd: 0,
      calls: tasks.length,
      promptTokens: 0,
      completionTokens: 0,
      runtime: 'local-e2e-mock',
      model: 'mock-openai-role-proof',
    });
    workflow.status = 'COMPLETED';
    workflow.updatedAt = nowIso();
    mockWorkflows.set(workflowId, workflow);
    await sleep(80);
    sendSseEvent(res, { type: 'completed', workflowId });
    return res.end();
  }

  if (method === 'GET' && /^\/workflows\/[^/]+$/.test(pathname)) {
    const workflowId = pathname.split('/')[2] ?? 'wf_local_demo_001';
    const workflow = mockWorkflows.get(workflowId);
    if (!workflow) {
      return sendJson(req, res, 404, {
        success: false,
        error: {
          code: 'LOCAL_E2E_WORKFLOW_NOT_FOUND',
          message: `Workflow ${workflowId} does not exist in the local E2E mock API.`,
        },
      });
    }
    return sendJson(req, res, 200, ok({
      ...workflow,
      status: 'COMPLETED',
      completedAt: workflow.updatedAt,
    }));
  }

  if (method === 'GET' && pathname === '/traces') {
    return sendJson(req, res, 200, ok(mockTraceList()));
  }

  if (method === 'GET' && pathname === '/traces/trace_local_demo_001') {
    return sendJson(req, res, 200, ok(mockTraceDetail()));
  }

  if (method === 'GET') {
    return sendJson(req, res, 200, ok({}));
  }

  return sendJson(req, res, 404, {
    success: false,
    error: {
      code: 'LOCAL_E2E_MOCK_ROUTE_NOT_IMPLEMENTED',
      message: `${method} ${pathname} is not implemented in the deterministic local E2E mock API.`,
    },
  });
}

async function startMockApi(error: unknown) {
  if (process.env['E2E_ALLOW_MOCK_API'] === '0') {
    throw error;
  }

  console.warn('[e2e-api-stack] Testcontainers/Docker is unavailable.');
  console.warn('[e2e-api-stack] Starting deterministic local mock API instead.');
  console.warn('[e2e-api-stack] Set E2E_ALLOW_MOCK_API=0 to require the real Postgres/API stack.');
  console.warn('[e2e-api-stack] Original startup error:', error);

  mockApiServer = createServer((req, res) => {
    handleMockApi(req, res).catch((routeError: unknown) => {
      console.error('[e2e-api-stack] Mock API route failed:', routeError);
      sendJson(req, res, 500, {
        success: false,
        error: { code: 'LOCAL_E2E_MOCK_ERROR', message: 'Local E2E mock API route failed' },
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (listenError: Error) => reject(listenError);
    mockApiServer?.once('error', onError);
    mockApiServer?.listen(Number(apiPort), '127.0.0.1', () => {
      mockApiServer?.off('error', onError);
      console.log(`[e2e-api-stack] Mock API listening on http://127.0.0.1:${apiPort}`);
      resolve();
    });
  });
}

async function main() {
  console.log('[e2e-api-stack] Starting disposable pgvector/Postgres...');
  try {
    postgres = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({
        POSTGRES_DB: 'jakswarm',
        POSTGRES_USER: 'jakswarm',
        POSTGRES_PASSWORD: 'jakswarm',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/i))
      .start();
  } catch (error: unknown) {
    await startMockApi(error);
    return;
  }

  const host = postgres.getHost();
  const port = postgres.getMappedPort(5432);
  const dbUrl = `postgresql://jakswarm:jakswarm@${host}:${port}/jakswarm`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    API_PORT: apiPort,
    PORT: apiPort,
    DATABASE_URL: dbUrl,
    DIRECT_URL: dbUrl,
    AUTH_SECRET: process.env['AUTH_SECRET'] ?? 'e2e-local-auth-secret-change-me',
    JAK_DEV_AUTH_BYPASS: '1',
    OPENAI_API_KEY: process.env['OPENAI_API_KEY'] ?? 'sk-test-local-e2e-0000',
    REDIS_URL: '',
    REQUIRE_REDIS_IN_PROD: 'false',
    WHATSAPP_AUTO_START: '0',
    LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'warn',
    CORS_ORIGINS: process.env['CORS_ORIGINS'] ?? `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
    API_PUBLIC_URL: process.env['API_PUBLIC_URL'] ?? `http://127.0.0.1:${apiPort}`,
    WEB_PUBLIC_URL: process.env['WEB_PUBLIC_URL'] ?? `http://127.0.0.1:${webPort}`,
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? 'local-e2e-placeholder',
  };

  console.log('[e2e-api-stack] Applying Prisma migrations...');
  runPnpm(['--filter', '@jak-swarm/db', 'db:migrate:deploy'], env);

  console.log('[e2e-api-stack] Seeding dev-bypass tenant/user...');
  runPnpm(['--filter', '@jak-swarm/db', 'exec', 'tsx', '../../scripts/seed-dev-bypass.ts'], env);

  console.log(`[e2e-api-stack] Starting API on http://127.0.0.1:${apiPort} ...`);
  const apiArgs = ['--filter', '@jak-swarm/api', 'dev'];
  apiProcess = spawn(
    isWindows ? 'cmd.exe' : pnpmBin,
    isWindows ? ['/d', '/s', '/c', [pnpmBin, ...apiArgs].join(' ')] : apiArgs,
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env,
    },
  );

  apiProcess.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[e2e-api-stack] API exited unexpectedly code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      void shutdown(code ?? 1);
    }
  });
}

process.once('SIGINT', () => void shutdown(130));
process.once('SIGTERM', () => void shutdown(143));
process.once('uncaughtException', (error) => {
  console.error('[e2e-api-stack] Uncaught exception:', error);
  void shutdown(1);
});
process.once('unhandledRejection', (error) => {
  console.error('[e2e-api-stack] Unhandled rejection:', error);
  void shutdown(1);
});

main().catch((error) => {
  console.error('[e2e-api-stack] Failed to start:', error);
  void shutdown(1);
});
