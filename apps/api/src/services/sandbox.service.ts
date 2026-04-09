/**
 * SandboxService
 *
 * Manages sandbox lifecycle, TTL, and resource cleanup.
 * Wraps the SandboxAdapter with project-aware operations.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';

// Sandbox types — defined locally to avoid deep path imports
interface SandboxInfo {
  id: string;
  status: string;
  host?: string;
}

interface SandboxAdapter {
  isAvailable(): boolean;
  create(opts: { template?: string; timeoutMs?: number; metadata?: Record<string, string> }): Promise<SandboxInfo>;
  getInfo(sandboxId: string): Promise<SandboxInfo | null>;
  writeFiles(sandboxId: string, files: Array<{ path: string; content: string }>): Promise<void>;
  writeFile(sandboxId: string, path: string, content: string): Promise<void>;
  installDeps(sandboxId: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  exec(sandboxId: string, command: string, opts?: { timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  startDevServer(sandboxId: string, options?: { command?: string; port?: number; cwd?: string }): Promise<string>;
  getPreviewUrl(sandboxId: string, port?: number): Promise<string | null>;
  destroy(sandboxId: string): Promise<void>;
}

// Auto-destroy sandbox after 30 minutes of inactivity
const DEFAULT_TTL_MS = 30 * 60 * 1000;

// Track sandbox activity timestamps
const sandboxActivity = new Map<string, number>();

export class SandboxService {
  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
    private readonly adapter: SandboxAdapter,
  ) {}

  /**
   * Get or create a sandbox for a project.
   * Reuses existing sandbox if still active.
   */
  async getOrCreateSandbox(projectId: string): Promise<SandboxInfo> {
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error(`Project ${projectId} not found`);

    // Check for existing sandbox
    if (project.sandboxId) {
      const info = await this.adapter.getInfo(project.sandboxId);
      if (info && info.status === 'running') {
        this.touchSandbox(project.sandboxId);
        return info;
      }
      // Sandbox expired or stopped — clean up reference
      await this.db.project.update({
        where: { id: projectId },
        data: { sandboxId: null, previewUrl: null },
      });
    }

    // Create new sandbox
    const info = await this.adapter.create({
      template: 'node',
      timeoutMs: DEFAULT_TTL_MS,
      metadata: { projectId, tenantId: project.tenantId },
    });

    await this.db.project.update({
      where: { id: projectId },
      data: { sandboxId: info.id },
    });

    this.touchSandbox(info.id);
    this.log.info({ projectId, sandboxId: info.id }, 'Created sandbox');

    return info;
  }

  /**
   * Sync all project files to the sandbox filesystem.
   */
  async syncFilesToSandbox(projectId: string): Promise<void> {
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    if (!project?.sandboxId) throw new Error('No sandbox for project');

    const files = await this.db.projectFile.findMany({
      where: { projectId },
    });

    await this.adapter.writeFiles(
      project.sandboxId,
      files.map(f => ({ path: f.path, content: f.content })),
    );

    this.touchSandbox(project.sandboxId);
    this.log.info({ projectId, fileCount: files.length }, 'Synced files to sandbox');
  }

  /**
   * Install npm dependencies in the sandbox.
   */
  async installAndBuild(projectId: string): Promise<{ success: boolean; error?: string }> {
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    if (!project?.sandboxId) throw new Error('No sandbox for project');

    this.touchSandbox(project.sandboxId);

    // Install
    const installResult = await this.adapter.installDeps(project.sandboxId);
    if (installResult.exitCode !== 0) {
      this.log.warn({ projectId, stderr: installResult.stderr.slice(0, 300) }, 'npm install warnings');
    }

    // Build
    const buildResult = await this.adapter.exec(project.sandboxId, 'npx next build', {
      timeoutMs: 120000,
    });

    if (buildResult.exitCode === 0) {
      return { success: true };
    }

    return { success: false, error: buildResult.stderr || buildResult.stdout };
  }

  /**
   * Start dev server and get preview URL.
   */
  async startDevServer(projectId: string): Promise<string | null> {
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    if (!project?.sandboxId) return null;

    try {
      const previewUrl = await this.adapter.startDevServer(project.sandboxId);
      await this.db.project.update({
        where: { id: projectId },
        data: { previewUrl },
      });
      return previewUrl;
    } catch (err) {
      this.log.error({ projectId, err }, 'Failed to start dev server');
      return null;
    }
  }

  /**
   * Destroy sandbox and clean up.
   */
  async destroySandbox(projectId: string): Promise<void> {
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    if (!project?.sandboxId) return;

    try {
      await this.adapter.destroy(project.sandboxId);
    } catch {
      // Already destroyed
    }

    sandboxActivity.delete(project.sandboxId);
    await this.db.project.update({
      where: { id: projectId },
      data: { sandboxId: null, previewUrl: null },
    });

    this.log.info({ projectId }, 'Sandbox destroyed');
  }

  /**
   * Check adapter availability.
   */
  isAvailable(): boolean {
    return this.adapter.isAvailable();
  }

  /**
   * Touch sandbox to update last activity time.
   */
  private touchSandbox(sandboxId: string) {
    sandboxActivity.set(sandboxId, Date.now());
  }

  /**
   * Clean up idle sandboxes. Call this periodically.
   */
  async cleanupIdleSandboxes(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [sandboxId, lastActivity] of sandboxActivity.entries()) {
      if (now - lastActivity > DEFAULT_TTL_MS) {
        try {
          await this.adapter.destroy(sandboxId);
          sandboxActivity.delete(sandboxId);
          cleaned++;
          this.log.info({ sandboxId }, 'Cleaned up idle sandbox');
        } catch {
          sandboxActivity.delete(sandboxId);
        }
      }
    }

    return cleaned;
  }
}
