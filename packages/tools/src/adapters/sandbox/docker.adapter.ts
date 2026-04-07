/**
 * Docker Sandbox Adapter (Self-Hosted Fallback)
 *
 * Uses Docker containers for isolated code execution when E2B is not available.
 * Requires Docker to be running on the host machine.
 *
 * SECURITY: All commands are passed as arrays to execFileSync/spawn to prevent
 * shell injection. No string interpolation of user input into shell commands.
 */

import type {
  SandboxAdapter,
  SandboxInfo,
  SandboxExecResult,
  SandboxFileEntry,
} from './sandbox.interface.js';
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

const activeSandboxes = new Map<string, { containerId: string; info: SandboxInfo; projectDir: string; port: number }>();

function isDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findFreePort(): number {
  const usedPorts = new Set([...activeSandboxes.values()].map(s => s.port));
  for (let port = 4000; port < 5000; port++) {
    if (!usedPorts.has(port)) return port;
  }
  throw new Error('No free ports available for sandbox (4000-4999 exhausted)');
}

/**
 * Validate a file path to prevent directory traversal.
 */
function sanitizePath(filePath: string): string {
  const normalized = path.normalize(filePath).replace(/\\/g, '/');
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  return normalized;
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

    // FIX #2: Use execFileSync with argument array — NO shell interpolation
    const containerId = execFileSync('docker', [
      'run', '-d',
      '--name', id,
      '-v', `${projectDir}:/home/user/project`,
      '-w', '/home/user/project',
      '-p', `${port}:3000`,
      '--memory', '512m',           // FIX: Resource limits
      '--cpus', '1',                // FIX: CPU limit
      '--pids-limit', '256',        // FIX: Process limit
      '--network', 'none',          // FIX: No network access (isolation)
      '--read-only',                // FIX: Read-only filesystem
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',  // Writable tmp
      '--tmpfs', '/home/user/project/node_modules:rw,exec,size=1g', // Writable node_modules
      image,
      'tail', '-f', '/dev/null',
    ], { encoding: 'utf8' }).trim();

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

    // FIX #2: Prevent path traversal
    const safePath = sanitizePath(filePath);
    const fullPath = path.join(entry.projectDir, safePath);

    // Verify the resolved path is still within the project directory
    if (!fullPath.startsWith(entry.projectDir)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }

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

    const safePath = sanitizePath(filePath);
    const fullPath = path.join(entry.projectDir, safePath);
    if (!fullPath.startsWith(entry.projectDir)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }

    return fs.readFileSync(fullPath, 'utf8');
  }

  async listFiles(sandboxId: string, directory?: string): Promise<string[]> {
    const entry = activeSandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);
    const safePath = sanitizePath(directory ?? '.');
    const dir = path.join(entry.projectDir, safePath);
    if (!dir.startsWith(entry.projectDir)) throw new Error('Path traversal detected');
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
    const cwd = options?.cwd ?? '/home/user/project';

    // FIX #2: Use execFileSync with argument array — NO shell interpolation
    // Pass command via sh -c but as a single argument, not interpolated
    const args = ['exec'];

    // Add env vars safely as separate args
    if (options?.env) {
      for (const [k, v] of Object.entries(options.env)) {
        // Validate env key (alphanumeric + underscore only)
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
          throw new Error(`Invalid environment variable name: ${k}`);
        }
        args.push('-e', `${k}=${v}`);
      }
    }

    args.push('-w', cwd, entry.containerId, 'sh', '-c', command);

    try {
      const output = execFileSync('docker', args, {
        encoding: 'utf8',
        timeout: options?.timeoutMs ?? 120000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        stdout: output.trim(),
        stderr: '',
        exitCode: 0,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const execError = err as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: String(execError.stdout ?? '').trim(),
        stderr: String(execError.stderr ?? '').trim(),
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

    // Start dev server in background using execFileSync-safe pattern
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
      execFileSync('docker', ['rm', '-f', entry.containerId], { stdio: 'ignore' });
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
