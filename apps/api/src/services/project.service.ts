import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import * as crypto from 'node:crypto';

export type ProjectStatus = 'DRAFT' | 'GENERATING' | 'BUILDING' | 'READY' | 'DEPLOYED' | 'FAILED';

export class ProjectService {
  constructor(
    private readonly db: PrismaClient,
    private readonly logger: Logger,
  ) {}

  async createProject(
    tenantId: string,
    userId: string,
    name: string,
    description?: string,
    framework?: string,
    templateId?: string,
  ) {
    return this.db.project.create({
      data: {
        tenantId,
        userId,
        name,
        description,
        framework: framework ?? 'nextjs',
        templateId,
        status: 'DRAFT',
      },
    });
  }

  async getProject(tenantId: string, projectId: string) {
    return this.db.project.findFirst({
      where: { id: projectId, tenantId },
      include: {
        // FIX #3: No more isDeleted filter — files are hard-deleted
        files: { orderBy: { path: 'asc' } },
        versions: { orderBy: { version: 'desc' }, take: 10 },
        conversations: { orderBy: { createdAt: 'asc' }, take: 50 },
      },
    });
  }

  async listProjects(tenantId: string, options?: { page?: number; limit?: number; status?: string }) {
    const page = options?.page ?? 1;
    const limit = Math.min(options?.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (options?.status) where.status = options.status;

    const [projects, total] = await Promise.all([
      this.db.project.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { files: true, versions: true } },
        },
      }),
      this.db.project.count({ where }),
    ]);

    return { projects, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateProjectStatus(projectId: string, status: ProjectStatus, extra?: Record<string, unknown>) {
    const data: Record<string, unknown> = { status };
    if (extra) Object.assign(data, extra);
    return this.db.project.update({ where: { id: projectId }, data });
  }

  async updateProject(tenantId: string, projectId: string, data: {
    name?: string;
    description?: string;
    sandboxId?: string;
    previewUrl?: string;
    deploymentUrl?: string;
    deploymentId?: string;
    githubRepo?: string;
    lastBuildError?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return this.db.project.update({
      where: { id: projectId },
      data,
    });
  }

  async deleteProject(tenantId: string, projectId: string) {
    // Verify tenant ownership before delete
    const project = await this.db.project.findFirst({ where: { id: projectId, tenantId } });
    if (!project) throw new Error('Project not found');
    return this.db.project.delete({ where: { id: projectId } });
  }

  // ─── File Operations ──────────────────────────────────────────────

  async saveFiles(projectId: string, files: Array<{ path: string; content: string; language?: string }>, versionId?: string) {
    const operations = files.map(file => {
      const hash = crypto.createHash('sha256').update(file.content).digest('hex');
      return this.db.projectFile.upsert({
        where: { projectId_path: { projectId, path: file.path } },
        create: {
          projectId,
          path: file.path,
          content: file.content,
          language: file.language ?? this.inferLanguage(file.path),
          size: Buffer.byteLength(file.content, 'utf8'),
          hash,
          versionId,
        },
        update: {
          content: file.content,
          language: file.language ?? this.inferLanguage(file.path),
          size: Buffer.byteLength(file.content, 'utf8'),
          hash,
          versionId,
        },
      });
    });

    return Promise.all(operations);
  }

  async getFiles(projectId: string) {
    return this.db.projectFile.findMany({
      where: { projectId },
      orderBy: { path: 'asc' },
    });
  }

  async getFile(projectId: string, path: string) {
    return this.db.projectFile.findFirst({
      where: { projectId, path },
    });
  }

  async updateFile(projectId: string, path: string, content: string) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return this.db.projectFile.update({
      where: { projectId_path: { projectId, path } },
      data: {
        content,
        size: Buffer.byteLength(content, 'utf8'),
        hash,
      },
    });
  }

  // ─── Version Operations ───────────────────────────────────────────

  // FIX #25: Use $transaction for atomic version creation
  async createVersion(projectId: string, description: string, createdBy: string = 'agent', workflowId?: string) {
    return this.db.$transaction(async (tx) => {
      // Get current files for snapshot
      const files = await tx.projectFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } });
      const snapshot = files.map(f => ({ path: f.path, content: f.content, language: f.language }));

      // Atomic version number increment
      const lastVersion = await tx.projectVersion.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;

      const version = await tx.projectVersion.create({
        data: {
          projectId,
          version: nextVersion,
          description,
          snapshotJson: snapshot as unknown as Record<string, unknown>,
          createdBy,
          workflowId,
        },
      });

      await tx.project.update({
        where: { id: projectId },
        data: { currentVersion: nextVersion },
      });

      return version;
    });
  }

  async getVersions(projectId: string) {
    return this.db.projectVersion.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
  }

  // FIX #19: Wrap rollback in $transaction for atomicity
  async rollbackToVersion(projectId: string, targetVersion: number) {
    const version = await this.db.projectVersion.findFirst({
      where: { projectId, version: targetVersion },
    });
    if (!version) throw new Error(`Version ${targetVersion} not found`);

    const snapshot = version.snapshotJson as unknown as Array<{ path: string; content: string; language: string }>;
    if (!snapshot || !Array.isArray(snapshot)) throw new Error('Version snapshot is corrupted');

    return this.db.$transaction(async (tx) => {
      // FIX #3: Hard-delete all current files (no soft-delete)
      await tx.projectFile.deleteMany({ where: { projectId } });

      // Restore from snapshot
      for (const file of snapshot) {
        const hash = crypto.createHash('sha256').update(file.content).digest('hex');
        await tx.projectFile.create({
          data: {
            projectId,
            path: file.path,
            content: file.content,
            language: file.language ?? this.inferLanguage(file.path),
            size: Buffer.byteLength(file.content, 'utf8'),
            hash,
          },
        });
      }

      // Create new version marking the rollback
      const lastVersion = await tx.projectVersion.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;

      const newVersion = await tx.projectVersion.create({
        data: {
          projectId,
          version: nextVersion,
          description: `Rollback to v${targetVersion}`,
          snapshotJson: snapshot as unknown as Record<string, unknown>,
          createdBy: 'system',
        },
      });

      await tx.project.update({
        where: { id: projectId },
        data: { currentVersion: nextVersion },
      });

      return newVersion;
    });
  }

  // ─── Conversation Operations ──────────────────────────────────────

  async addConversation(projectId: string, role: string, content: string, metadata?: Record<string, unknown>, workflowId?: string) {
    return this.db.projectConversation.create({
      data: { projectId, role, content, metadata: metadata as Record<string, unknown> | undefined, workflowId },
    });
  }

  async getConversations(projectId: string) {
    return this.db.projectConversation.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private inferLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      css: 'css', html: 'html', json: 'json', md: 'markdown',
      prisma: 'prisma', sql: 'sql', yaml: 'yaml', yml: 'yaml',
      env: 'dotenv', sh: 'shell', mjs: 'javascript', cjs: 'javascript',
    };
    return langMap[ext ?? ''] ?? 'text';
  }
}
