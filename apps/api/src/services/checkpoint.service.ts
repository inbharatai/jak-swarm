import { Prisma, type PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import * as crypto from 'node:crypto';

/**
 * Checkpoint service.
 *
 * Wraps `ProjectVersion` with a structured diff so the Vibe Coder UI can
 * show "what changed at each stage" and let the operator revert to any
 * prior checkpoint. The underlying storage is the same `project_versions`
 * table used by the existing rollback flow — this service adds:
 *
 *   1. A diff computed at checkpoint-creation time (added/modified/deleted
 *      paths with size + hash metadata) and persisted to `diffJson`.
 *   2. Stage labels (`architect` | `generator` | `debugger` | `deployer` |
 *      `manual`) so restoring to a stage is an obvious operation.
 *   3. Tenant-scoped read/restore guards — the endpoints that host this
 *      service perform the tenant check, but the service double-checks
 *      on restore to prevent cross-tenant revert via a stale projectId.
 *   4. Actor attribution for audit (who pressed "restore") without lying
 *      about the original `createdBy` on the restored snapshot.
 *
 * Does NOT diff file CONTENT — only metadata. Full content diffs would
 * explode the JSON column on projects with 20+ files; the UI fetches
 * the two snapshots and diffs client-side when it needs to.
 */

type TransactionClient = Prisma.TransactionClient;

export type CheckpointStage =
  | 'architect'
  | 'generator'
  | 'debugger'
  | 'deployer'
  | 'manual'
  | 'rollback';

export interface CheckpointFileRef {
  path: string;
  content: string;
  language: string | null;
}

export interface CheckpointDiffEntry {
  path: string;
  prevSize?: number;
  nextSize?: number;
  prevHash?: string;
  nextHash?: string;
}

export interface CheckpointDiff {
  added: CheckpointDiffEntry[];
  modified: CheckpointDiffEntry[];
  deleted: CheckpointDiffEntry[];
  /** Total file count in the new snapshot — convenient for UI. */
  totalFiles: number;
  /** Whether any file content changed (added/modified/deleted > 0). */
  hasChanges: boolean;
}

export interface CheckpointSummary {
  id: string;
  version: number;
  description: string | null;
  stage: CheckpointStage | null;
  workflowId: string | null;
  createdBy: string;
  createdAt: Date;
  diff: CheckpointDiff | null;
}

export interface CheckpointDetail extends CheckpointSummary {
  snapshot: CheckpointFileRef[];
}

/**
 * Pure helper — exported for tests. Computes a structural diff between
 * two snapshots. Neither snapshot may contain duplicate paths (ProjectFile
 * enforces unique (projectId, path)).
 */
export function computeCheckpointDiff(
  prev: readonly CheckpointFileRef[] | null | undefined,
  next: readonly CheckpointFileRef[],
): CheckpointDiff {
  const prevMap = new Map((prev ?? []).map((f) => [f.path, f] as const));
  const nextMap = new Map(next.map((f) => [f.path, f] as const));

  const added: CheckpointDiffEntry[] = [];
  const modified: CheckpointDiffEntry[] = [];
  const deleted: CheckpointDiffEntry[] = [];

  for (const [path, nextFile] of nextMap) {
    const prevFile = prevMap.get(path);
    if (!prevFile) {
      added.push({
        path,
        nextSize: Buffer.byteLength(nextFile.content, 'utf8'),
        nextHash: sha256(nextFile.content),
      });
      continue;
    }
    const prevHash = sha256(prevFile.content);
    const nextHash = sha256(nextFile.content);
    if (prevHash !== nextHash) {
      modified.push({
        path,
        prevSize: Buffer.byteLength(prevFile.content, 'utf8'),
        nextSize: Buffer.byteLength(nextFile.content, 'utf8'),
        prevHash,
        nextHash,
      });
    }
  }

  for (const [path, prevFile] of prevMap) {
    if (!nextMap.has(path)) {
      deleted.push({
        path,
        prevSize: Buffer.byteLength(prevFile.content, 'utf8'),
        prevHash: sha256(prevFile.content),
      });
    }
  }

  return {
    added,
    modified,
    deleted,
    totalFiles: next.length,
    hasChanges: added.length + modified.length + deleted.length > 0,
  };
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    css: 'css', html: 'html', json: 'json', md: 'markdown',
    prisma: 'prisma', sql: 'sql', yaml: 'yaml', yml: 'yaml',
    env: 'dotenv', sh: 'shell', mjs: 'javascript', cjs: 'javascript',
  };
  return langMap[ext ?? ''] ?? 'text';
}

function parseSnapshot(raw: Prisma.JsonValue | null): CheckpointFileRef[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((f): CheckpointFileRef | null => {
      if (!f || typeof f !== 'object') return null;
      const rec = f as Record<string, unknown>;
      if (typeof rec['path'] !== 'string' || typeof rec['content'] !== 'string') return null;
      return {
        path: rec['path'],
        content: rec['content'],
        language: typeof rec['language'] === 'string' ? rec['language'] : null,
      };
    })
    .filter((f): f is CheckpointFileRef => f !== null);
}

function parseDiff(raw: Prisma.JsonValue | null): CheckpointDiff | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec['added']) || !Array.isArray(rec['modified']) || !Array.isArray(rec['deleted'])) {
    return null;
  }
  return {
    added: rec['added'] as CheckpointDiffEntry[],
    modified: rec['modified'] as CheckpointDiffEntry[],
    deleted: rec['deleted'] as CheckpointDiffEntry[],
    totalFiles: typeof rec['totalFiles'] === 'number' ? rec['totalFiles'] : 0,
    hasChanges: Boolean(rec['hasChanges']),
  };
}

export class CheckpointNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckpointNotFoundError';
  }
}

export class CheckpointService {
  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Create a checkpoint. Atomically snapshots the current files, computes
   * the diff vs the previous version, and bumps `project.currentVersion`.
   *
   * If there is no previous version, `diff.added` covers the entire file
   * tree and `deleted` / `modified` are empty.
   */
  async createCheckpoint(input: {
    projectId: string;
    tenantId: string;
    description?: string;
    stage?: CheckpointStage;
    workflowId?: string;
    createdBy?: string;
  }): Promise<CheckpointSummary> {
    const { projectId, tenantId, description, stage, workflowId } = input;
    const createdBy = input.createdBy ?? 'system';

    // Tenant gate — refuse to write a checkpoint for a project in a different tenant.
    const project = await this.db.project.findFirst({
      where: { id: projectId, tenantId },
      select: { id: true },
    });
    if (!project) throw new CheckpointNotFoundError(`Project ${projectId} not found for tenant`);

    return this.db.$transaction(async (tx: TransactionClient) => {
      const files = await tx.projectFile.findMany({
        where: { projectId },
        orderBy: { path: 'asc' },
      });
      const nextSnapshot: CheckpointFileRef[] = files.map((f) => ({
        path: f.path,
        content: f.content,
        language: f.language,
      }));

      const prevVersion = await tx.projectVersion.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
      });
      const prevSnapshot = parseSnapshot(prevVersion?.snapshotJson ?? null);
      const diff = computeCheckpointDiff(prevSnapshot, nextSnapshot);

      const nextVersionNumber = (prevVersion?.version ?? 0) + 1;

      const description_ =
        description ??
        (stage
          ? `Checkpoint after ${stage}${workflowId ? ` (workflow ${workflowId.slice(-8)})` : ''}`
          : `Checkpoint v${nextVersionNumber}`);

      const version = await tx.projectVersion.create({
        data: {
          projectId,
          version: nextVersionNumber,
          description: description_,
          snapshotJson: nextSnapshot as unknown as Prisma.InputJsonValue,
          diffJson: diff as unknown as Prisma.InputJsonValue,
          createdBy,
          workflowId,
        },
      });

      await tx.project.update({
        where: { id: projectId },
        data: { currentVersion: nextVersionNumber },
      });

      return {
        id: version.id,
        version: version.version,
        description: version.description,
        stage: stage ?? null,
        workflowId: version.workflowId,
        createdBy: version.createdBy,
        createdAt: version.createdAt,
        diff,
      };
    });
  }

  /**
   * List checkpoints for a project, newest first. Diff is returned if it
   * was stored; legacy versions created before this service may have
   * `diff: null` — callers render that as "(diff unavailable)".
   */
  async listCheckpoints(input: {
    projectId: string;
    tenantId: string;
    limit?: number;
  }): Promise<CheckpointSummary[]> {
    const { projectId, tenantId } = input;
    const limit = Math.min(input.limit ?? 50, 200);

    const project = await this.db.project.findFirst({
      where: { id: projectId, tenantId },
      select: { id: true },
    });
    if (!project) throw new CheckpointNotFoundError(`Project ${projectId} not found for tenant`);

    const versions = await this.db.projectVersion.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      take: limit,
    });

    return versions.map((v) => ({
      id: v.id,
      version: v.version,
      description: v.description,
      stage: inferStageFromDescription(v.description),
      workflowId: v.workflowId,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
      diff: parseDiff(v.diffJson ?? null),
    }));
  }

  /** Full snapshot + diff for one checkpoint. */
  async getCheckpoint(input: {
    projectId: string;
    tenantId: string;
    version: number;
  }): Promise<CheckpointDetail> {
    const { projectId, tenantId, version } = input;

    const project = await this.db.project.findFirst({
      where: { id: projectId, tenantId },
      select: { id: true },
    });
    if (!project) throw new CheckpointNotFoundError(`Project ${projectId} not found for tenant`);

    const row = await this.db.projectVersion.findFirst({
      where: { projectId, version },
    });
    if (!row) throw new CheckpointNotFoundError(`Checkpoint v${version} not found`);

    return {
      id: row.id,
      version: row.version,
      description: row.description,
      stage: inferStageFromDescription(row.description),
      workflowId: row.workflowId,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      diff: parseDiff(row.diffJson ?? null),
      snapshot: parseSnapshot(row.snapshotJson ?? null),
    };
  }

  /**
   * Restore the project files to a specific checkpoint. Creates a NEW
   * version row (tagged `rollback`) so the operator can un-revert if they
   * change their mind. Atomic inside a transaction.
   *
   * Returns a summary of the newly-created rollback checkpoint.
   */
  async restoreCheckpoint(input: {
    projectId: string;
    tenantId: string;
    targetVersion: number;
    actor: string;
  }): Promise<CheckpointSummary> {
    const { projectId, tenantId, targetVersion, actor } = input;

    const project = await this.db.project.findFirst({
      where: { id: projectId, tenantId },
      select: { id: true },
    });
    if (!project) throw new CheckpointNotFoundError(`Project ${projectId} not found for tenant`);

    const target = await this.db.projectVersion.findFirst({
      where: { projectId, version: targetVersion },
    });
    if (!target) throw new CheckpointNotFoundError(`Checkpoint v${targetVersion} not found`);

    const targetSnapshot = parseSnapshot(target.snapshotJson ?? null);
    if (targetSnapshot.length === 0) {
      this.log.warn(
        { projectId, targetVersion },
        '[Checkpoint] Target snapshot is empty — restore will wipe the project',
      );
    }

    return this.db.$transaction(async (tx: TransactionClient) => {
      // Hard-delete current files so nothing survives from the newer version
      // that isn't in the target snapshot.
      await tx.projectFile.deleteMany({ where: { projectId } });

      for (const file of targetSnapshot) {
        const content = file.content;
        await tx.projectFile.create({
          data: {
            projectId,
            path: file.path,
            content,
            language: file.language ?? inferLanguage(file.path),
            size: Buffer.byteLength(content, 'utf8'),
            hash: sha256(content),
          },
        });
      }

      // Tag the new version as a rollback so the timeline shows it clearly.
      const lastVersion = await tx.projectVersion.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
      });
      const nextVersionNumber = (lastVersion?.version ?? 0) + 1;
      const prevSnapshot = parseSnapshot(lastVersion?.snapshotJson ?? null);
      const diff = computeCheckpointDiff(prevSnapshot, targetSnapshot);

      const created = await tx.projectVersion.create({
        data: {
          projectId,
          version: nextVersionNumber,
          description: `Restored to v${targetVersion} by ${actor}`,
          snapshotJson: targetSnapshot as unknown as Prisma.InputJsonValue,
          diffJson: diff as unknown as Prisma.InputJsonValue,
          createdBy: actor,
        },
      });

      await tx.project.update({
        where: { id: projectId },
        data: { currentVersion: nextVersionNumber },
      });

      this.log.info(
        { projectId, targetVersion, newVersion: nextVersionNumber, actor },
        '[Checkpoint] Restored',
      );

      return {
        id: created.id,
        version: created.version,
        description: created.description,
        stage: 'rollback' as CheckpointStage,
        workflowId: created.workflowId,
        createdBy: created.createdBy,
        createdAt: created.createdAt,
        diff,
      };
    });
  }
}

/**
 * Best-effort stage extraction from a description like
 * "Checkpoint after generator (workflow ...)". Returns null when the
 * description doesn't match a known pattern — caller renders as
 * "(no stage)".
 */
function inferStageFromDescription(description: string | null): CheckpointStage | null {
  if (!description) return null;
  const lower = description.toLowerCase();
  if (lower.startsWith('restored to')) return 'rollback';
  const stages: CheckpointStage[] = ['architect', 'generator', 'debugger', 'deployer', 'manual', 'rollback'];
  for (const s of stages) {
    if (lower.includes(`after ${s}`) || lower.includes(`checkpoint ${s}`)) return s;
  }
  return null;
}
