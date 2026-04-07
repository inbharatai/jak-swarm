/**
 * Docker Sandbox Adapter (Self-Hosted Fallback)
 *
 * Uses Docker containers for isolated code execution when E2B is not available.
 * Requires Docker to be running on the host machine.
 *
 * This is a fallback for self-hosted deployments where E2B cloud isn't desired.
 */

import type {
  SandboxAdapter,
  SandboxInfo,
  SandboxExecResult,
  SandboxFileEntry,
} from './sandbox.interface.js';
import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

const activeSandboxes = new Map<string, { containerId: string; info: SandboxInfo; projectDir: string; port: number }>();

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findFreePort(): number {
  // Simple port allocation starting from 4000
  const usedPorts = new Set([...activeSandboxes.values()].map(s => s.port));
  for (let port = 4000; port < 5000; port++) {
    if (!usedPorts.has(port)) return port;
  }
  return 4000 + Math.floor(Math.random() * 1000);
}

export class DockerSandboxAdapter implements SandboxAdapter {
  private dockerAvailable: boolean | null = null;

  isAvailable(): boolean {
    if (this.dockerAvailable === null) {
      this.dockerAvailable = isDockerAvailable();
    }
    return this.dockerAvailable;
  }

  async create(options?: {
    template?: string;
    timeoutMs?: number;
    metadata?: Record<string, string>;
  }): Promise<SandboxInfo> {
    if (!this.isAvailable()) {
      throw new Error('Docker is not available. Install Docker or use E2B cloud.');
    }

    const id = `jak-sandbox-${crypto.randomUUID().slice(0, 8)}`;
    const projectDir = path.join(os.tmpdir(), 'jak-sandboxes', id);
    fs.mkdirSync(projectDir, { recursive: true });

    const port = findFreePort();
    const image = 'node:20-slim';
    const timeoutSec = Math.floor((options?.timeoutMs ?? 30 * 60 * 1000) / 1000);

    // Start container with mounted project directory
    const containerId = execSync(
      `docker run -d --name ${id} -v "${projectDir}:/home/user/project" -w /home/user/project -p ${port}:3000 --stop-timeout ${timeoutSec} ${image} tail -f /dev/null`,
      { encoding: 'utf8' },
    ).trim();

    const info: SandboxInfo = {
      id,
      status: 'running',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + (options?.timeoutMs ?? 30 * 60 * 1000)),
    };

    activeSandboxes.set(id, { containerId, info, projectDir, port });
    return info;
  }

  async writeFile(sandboxId: string, filePath: string, content: string): Promise<void> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);

    const fullPath = path.join(entry.projectDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  async writeFiles(sandboxId: string, files: SandboxFileEntry[]): Promise<void> {
    for (const file of files) {
      await this.writeFile(sandboxId, file.path, file.content);
    }
  }

  async readFile(sandboxId: string, filePath: string): Promise<string> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);
    return fs.readFileSync(path.join(entry.projectDir, filePath), 'utf8');
  }

  async listFiles(sandboxId: string, directory?: string): Promise<string[]> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);
    const dir = path.join(entry.projectDir, directory ?? '.');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir);
  }

  async exec(sandboxId: string, command: string, options?: {
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
  }): Promise<SandboxExecResult> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);

    const startTime = Date.now();
    const envFlags = options?.env
      ? Object.entries(options.env).map(([k, v]) => `-e ${k}=${v}`).join(' ')
      : '';
    const cwd = options?.cwd ?? '/home/user/project';

    try {
      const output = execSync(
        `docker exec ${envFlags} -w ${cwd} ${entry.containerId} sh -c "${command.replace(/"/g, '\\"')}"`,
        {
          encoding: 'utf8',
          timeout: options?.timeoutMs ?? 120000,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
      );

      return {
        stdout: output.trim(),
        stderr: '',
        exitCode: 0,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const execError = err as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: (execError.stdout ?? '').toString().trim(),
        stderr: (execError.stderr ?? '').toString().trim(),
        exitCode: execError.status ?? 1,
        durationMs: Date.now() - startTime,
      };
    }
  }

  async installDeps(sandboxId: string, cwd?: string): Promise<SandboxExecResult> {
    return this.exec(sandboxId, 'npm install --legacy-peer-deps', { cwd, timeoutMs: 180000 });
  }

  async startDevServer(sandboxId: string, options?: {
    command?: string;
    port?: number;
    cwd?: string;
  }): Promise<string> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);

    const command = options?.command ?? 'npx next dev -p 3000';

    // Start dev server in background
    spawn('docker', ['exec', '-d', entry.containerId, 'sh', '-c', command], {
      stdio: 'ignore',
      detached: true,
    });

    // Wait for server startup
    await new Promise(resolve => setTimeout(resolve, 8000));

    const previewUrl = `http://localhost:${entry.port}`;
    entry.info.previewUrl = previewUrl;
    return previewUrl;
  }

  async getPreviewUrl(sandboxId: string): Promise<string | null> {
    const entry = activeSandboxes.get(sandboxId);
    return entry?.info.previewUrl ?? null;
  }

  async getInfo(sandboxId: string): Promise<SandboxInfo | null> {
    const entry = activeSandboxes.get(sandboxId);
    return entry?.info ?? null;
  }

  async destroy(sandboxId: string): Promise<void> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) return;

    try {
      execSync(`docker rm -f ${entry.containerId}`, { stdio: 'ignore' });
    } catch {
      // Container may already be removed
    }

    try {
      fs.rmSync(entry.projectDir, { recursive: true, force: true });
    } catch {
      // Directory may already be removed
    }

    entry.info.status = 'stopped';
    activeSandboxes.delete(sandboxId);
  }
}

/** Singleton instance */
export const dockerSandbox = new DockerSandboxAdapter();
