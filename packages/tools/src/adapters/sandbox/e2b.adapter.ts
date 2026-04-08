/**
 * E2B Cloud Sandbox Adapter
 *
 * Uses E2B (https://e2b.dev) for isolated code execution in the cloud.
 * Requires E2B_API_KEY environment variable.
 *
 * Each sandbox is an isolated Linux VM with:
 * - Node.js 20+ pre-installed
 * - npm/pnpm available
 * - Filesystem access
 * - Process execution
 * - Network access (for dev server previews)
 */

import type {
  SandboxAdapter,
  SandboxInfo,
  SandboxExecResult,
  SandboxFileEntry,
} from './sandbox.interface.js';

// E2B SDK types — imported dynamically to avoid hard dependency
type E2BSandbox = {
  sandboxId: string;
  filesystem: {
    write: (path: string, content: string) => Promise<void>;
    read: (path: string) => Promise<string>;
    list: (path: string) => Promise<Array<{ name: string; type: string }>>;
  };
  process: {
    start: (opts: { cmd: string; cwd?: string; envs?: Record<string, string>; onStdout?: (data: { line: string }) => void; onStderr?: (data: { line: string }) => void }) => Promise<{ exitCode: number; stdout: string; stderr: string; wait: () => Promise<{ exitCode: number }> }>;
  };
  getHost: (port: number) => string;
  close: () => Promise<void>;
};

// In-memory sandbox registry
const activeSandboxes = new Map<string, { sandbox: E2BSandbox; info: SandboxInfo; devProcess?: unknown }>();

async function getE2BModule(): Promise<{ Sandbox: { create: (opts: { template?: string; apiKey?: string; timeout?: number; metadata?: Record<string, string> }) => Promise<E2BSandbox> } }> {
  try {
    // Dynamic import to avoid bundling issues when E2B is not installed
    const mod = await import('@e2b/code-interpreter');
    return mod as unknown as { Sandbox: { create: (opts: { template?: string; apiKey?: string; timeout?: number; metadata?: Record<string, string> }) => Promise<E2BSandbox> } };
  } catch {
    throw new Error(
      'E2B SDK not installed. Run: pnpm --filter @jak-swarm/tools add @e2b/code-interpreter',
    );
  }
}

export class E2BSandboxAdapter implements SandboxAdapter {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env['E2B_API_KEY'];
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async create(options?: {
    template?: string;
    timeoutMs?: number;
    metadata?: Record<string, string>;
  }): Promise<SandboxInfo> {
    if (!this.apiKey) {
      throw new Error('E2B_API_KEY not set. Get one at https://e2b.dev');
    }

    const e2b = await getE2BModule();
    const sandbox = await e2b.Sandbox.create({
      template: options?.template ?? 'node',
      apiKey: this.apiKey,
      timeout: options?.timeoutMs ?? 30 * 60 * 1000, // 30 min default
      metadata: options?.metadata,
    });

    const info: SandboxInfo = {
      id: sandbox.sandboxId,
      status: 'running',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + (options?.timeoutMs ?? 30 * 60 * 1000)),
    };

    activeSandboxes.set(sandbox.sandboxId, { sandbox, info });
    return info;
  }

  async writeFile(sandboxId: string, path: string, content: string): Promise<void> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);
    await entry.sandbox.filesystem.write(path, content);
  }

  async writeFiles(sandboxId: string, files: SandboxFileEntry[]): Promise<void> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);

    // Write files in parallel batches of 10
    const batchSize = 10;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      await Promise.all(
        batch.map(f => entry.sandbox.filesystem.write(f.path, f.content)),
      );
    }
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);
    return entry.sandbox.filesystem.read(path);
  }

  async listFiles(sandboxId: string, directory?: string): Promise<string[]> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);
    const items = await entry.sandbox.filesystem.list(directory ?? '/home/user/project');
    return items.map(item => item.name);
  }

  async exec(sandboxId: string, command: string, options?: {
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
  }): Promise<SandboxExecResult> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    const proc = await entry.sandbox.process.start({
      cmd: command,
      cwd: options?.cwd ?? '/home/user/project',
      envs: options?.env,
      onStdout: (data) => { stdout += data.line + '\n'; },
      onStderr: (data) => { stderr += data.line + '\n'; },
    });

    const result = await proc.wait();

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: result.exitCode,
      durationMs: Date.now() - startTime,
    };
  }

  async installDeps(sandboxId: string, cwd?: string): Promise<SandboxExecResult> {
    return this.exec(sandboxId, 'npm install --legacy-peer-deps', { cwd });
  }

  async startDevServer(sandboxId: string, options?: {
    command?: string;
    port?: number;
    cwd?: string;
  }): Promise<string> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);

    const port = options?.port ?? 3000;
    const command = options?.command ?? `npx next dev -p ${port}`;

    // Start dev server as background process (intentionally not awaited —
    // next dev runs indefinitely, awaiting would block forever)
    const procPromise = entry.sandbox.process.start({
      cmd: command,
      cwd: options?.cwd ?? '/home/user/project',
      envs: { PORT: String(port), NODE_ENV: 'development' },
    });
    entry.devProcess = procPromise;

    // Wait a few seconds for the server to start
    await new Promise(resolve => setTimeout(resolve, 5000));

    const host = entry.sandbox.getHost(port);
    const previewUrl = `https://${host}`;
    entry.info.previewUrl = previewUrl;

    return previewUrl;
  }

  async getPreviewUrl(sandboxId: string, port?: number): Promise<string | null> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) return null;
    if (entry.info.previewUrl) return entry.info.previewUrl;

    try {
      const host = entry.sandbox.getHost(port ?? 3000);
      return `https://${host}`;
    } catch {
      return null;
    }
  }

  async getInfo(sandboxId: string): Promise<SandboxInfo | null> {
    const entry = activeSandboxes.get(sandboxId);
    return entry?.info ?? null;
  }

  async destroy(sandboxId: string): Promise<void> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) return;

    try {
      await entry.sandbox.close();
    } catch {
      // Sandbox may already be closed
    }
    entry.info.status = 'stopped';
    activeSandboxes.delete(sandboxId);
  }
}

/** Singleton instance */
export const e2bSandbox = new E2BSandboxAdapter();
