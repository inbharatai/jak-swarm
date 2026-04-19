import { describe, it, expect, vi } from 'vitest';
import {
  CheckpointService,
  CheckpointNotFoundError,
  computeCheckpointDiff,
  type CheckpointFileRef,
} from '../../../apps/api/src/services/checkpoint.service.js';

/**
 * Tests for CheckpointService.
 *
 * computeCheckpointDiff is a pure function — tested directly.
 * The service methods are tested against a hand-rolled in-memory Prisma stub
 * that mirrors the shape the service expects ($transaction + project/
 * projectFile/projectVersion collections). Real Prisma integration is
 * covered by the existing postgres-integration test suite — this file is
 * a fast behavioral harness that runs without a database.
 */

function file(path: string, content: string, language: string | null = 'typescript'): CheckpointFileRef {
  return { path, content, language };
}

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => silentLogger(),
    level: 'info',
  } as unknown as import('fastify').FastifyBaseLogger;
}

/**
 * Minimal in-memory Prisma mock. Only implements what CheckpointService calls.
 */
function makeStubPrisma() {
  type ProjectRow = { id: string; tenantId: string; currentVersion: number };
  type FileRow = { projectId: string; path: string; content: string; language: string; size: number; hash: string };
  type VersionRow = {
    id: string;
    projectId: string;
    version: number;
    description: string | null;
    snapshotJson: unknown;
    diffJson: unknown;
    createdBy: string;
    workflowId: string | null;
    createdAt: Date;
  };

  const state = {
    projects: new Map<string, ProjectRow>(),
    files: [] as FileRow[],
    versions: [] as VersionRow[],
    nextVersionId: 1,
  };

  const client = {
    project: {
      findFirst: vi.fn(async (args: { where: { id: string; tenantId?: string } }) => {
        const p = state.projects.get(args.where.id);
        if (!p) return null;
        if (args.where.tenantId && p.tenantId !== args.where.tenantId) return null;
        return p;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: { currentVersion?: number } }) => {
        const p = state.projects.get(args.where.id);
        if (p && typeof args.data.currentVersion === 'number') p.currentVersion = args.data.currentVersion;
        return p;
      }),
    },
    projectFile: {
      findMany: vi.fn(async (args: { where: { projectId: string } }) =>
        state.files.filter((f) => f.projectId === args.where.projectId).sort((a, b) => a.path.localeCompare(b.path)),
      ),
      deleteMany: vi.fn(async (args: { where: { projectId: string } }) => {
        const before = state.files.length;
        state.files = state.files.filter((f) => f.projectId !== args.where.projectId);
        return { count: before - state.files.length };
      }),
      create: vi.fn(async (args: { data: FileRow }) => {
        state.files.push(args.data);
        return args.data;
      }),
    },
    projectVersion: {
      findFirst: vi.fn(async (args: { where: { projectId: string; version?: number }; orderBy?: unknown }) => {
        const matches = state.versions.filter(
          (v) =>
            v.projectId === args.where.projectId &&
            (args.where.version === undefined || v.version === args.where.version),
        );
        if (matches.length === 0) return null;
        // If orderBy is version desc, return the highest.
        return matches.sort((a, b) => b.version - a.version)[0] ?? null;
      }),
      findMany: vi.fn(async (args: { where: { projectId: string }; take?: number }) => {
        const rows = state.versions
          .filter((v) => v.projectId === args.where.projectId)
          .sort((a, b) => b.version - a.version);
        return args.take ? rows.slice(0, args.take) : rows;
      }),
      create: vi.fn(async (args: { data: Omit<VersionRow, 'id' | 'createdAt' | 'workflowId'> & { workflowId?: string } }) => {
        const row: VersionRow = {
          id: `ver-${state.nextVersionId++}`,
          projectId: args.data.projectId,
          version: args.data.version,
          description: args.data.description ?? null,
          snapshotJson: args.data.snapshotJson,
          diffJson: args.data.diffJson,
          createdBy: args.data.createdBy,
          workflowId: args.data.workflowId ?? null,
          createdAt: new Date(),
        };
        state.versions.push(row);
        return row;
      }),
    },
    $transaction: vi.fn(async <T,>(fn: (tx: typeof client) => Promise<T>): Promise<T> => fn(client)),
  };

  return {
    client: client as unknown as ConstructorParameters<typeof CheckpointService>[0],
    state,
    seedProject: (id: string, tenantId: string) => {
      state.projects.set(id, { id, tenantId, currentVersion: 0 });
    },
    seedFiles: (projectId: string, files: ReadonlyArray<{ path: string; content: string; language?: string }>) => {
      state.files = state.files.filter((f) => f.projectId !== projectId);
      for (const f of files) {
        state.files.push({
          projectId,
          path: f.path,
          content: f.content,
          language: f.language ?? 'typescript',
          size: Buffer.byteLength(f.content, 'utf8'),
          hash: 'stubbed',
        });
      }
    },
  };
}

describe('computeCheckpointDiff — pure diff function', () => {
  it('reports every file as added when there is no previous snapshot', () => {
    const next = [file('a.ts', 'a'), file('b.ts', 'b')];
    const diff = computeCheckpointDiff(null, next);
    expect(diff.added.map((a) => a.path)).toEqual(['a.ts', 'b.ts']);
    expect(diff.modified).toEqual([]);
    expect(diff.deleted).toEqual([]);
    expect(diff.totalFiles).toBe(2);
    expect(diff.hasChanges).toBe(true);
  });

  it('reports no changes when both snapshots are identical', () => {
    const snap = [file('a.ts', 'a'), file('b.ts', 'b')];
    const diff = computeCheckpointDiff(snap, snap);
    expect(diff.added).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.deleted).toEqual([]);
    expect(diff.hasChanges).toBe(false);
  });

  it('detects modified files by content hash (not path alone)', () => {
    const prev = [file('a.ts', 'original')];
    const next = [file('a.ts', 'changed')];
    const diff = computeCheckpointDiff(prev, next);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0]?.path).toBe('a.ts');
    expect(diff.modified[0]?.prevHash).not.toBe(diff.modified[0]?.nextHash);
    expect(diff.added).toEqual([]);
    expect(diff.deleted).toEqual([]);
  });

  it('detects deleted files', () => {
    const prev = [file('a.ts', 'a'), file('b.ts', 'b')];
    const next = [file('a.ts', 'a')];
    const diff = computeCheckpointDiff(prev, next);
    expect(diff.deleted).toHaveLength(1);
    expect(diff.deleted[0]?.path).toBe('b.ts');
  });

  it('handles mixed add/modify/delete in one diff', () => {
    const prev = [file('keep.ts', 'same'), file('change.ts', 'old'), file('gone.ts', 'x')];
    const next = [file('keep.ts', 'same'), file('change.ts', 'new'), file('added.ts', 'y')];
    const diff = computeCheckpointDiff(prev, next);
    expect(diff.added.map((a) => a.path)).toEqual(['added.ts']);
    expect(diff.modified.map((m) => m.path)).toEqual(['change.ts']);
    expect(diff.deleted.map((d) => d.path)).toEqual(['gone.ts']);
    expect(diff.totalFiles).toBe(3);
    expect(diff.hasChanges).toBe(true);
  });
});

describe('CheckpointService.createCheckpoint', () => {
  it('refuses to snapshot a project from a different tenant (cross-tenant guard)', async () => {
    const { client, seedProject } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    const svc = new CheckpointService(client, silentLogger());

    await expect(
      svc.createCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-B' }),
    ).rejects.toBeInstanceOf(CheckpointNotFoundError);
  });

  it('creates version 1 with all files as added when the project has no history', async () => {
    const { client, seedProject, seedFiles, state } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    seedFiles('proj-1', [{ path: 'src/page.tsx', content: 'hello' }]);
    const svc = new CheckpointService(client, silentLogger());

    const cp = await svc.createCheckpoint({
      projectId: 'proj-1',
      tenantId: 'tenant-A',
      stage: 'generator',
    });

    expect(cp.version).toBe(1);
    expect(cp.diff?.added.map((a) => a.path)).toEqual(['src/page.tsx']);
    expect(cp.diff?.modified).toEqual([]);
    expect(cp.diff?.deleted).toEqual([]);
    expect(state.projects.get('proj-1')?.currentVersion).toBe(1);
  });

  it('computes diff vs previous version on subsequent checkpoints', async () => {
    const { client, seedProject, seedFiles } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    const svc = new CheckpointService(client, silentLogger());

    seedFiles('proj-1', [{ path: 'a.ts', content: 'v1' }]);
    const v1 = await svc.createCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A', stage: 'generator' });
    expect(v1.version).toBe(1);

    seedFiles('proj-1', [{ path: 'a.ts', content: 'v2' }, { path: 'b.ts', content: 'new' }]);
    const v2 = await svc.createCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A', stage: 'debugger' });
    expect(v2.version).toBe(2);
    expect(v2.diff?.modified.map((m) => m.path)).toEqual(['a.ts']);
    expect(v2.diff?.added.map((a) => a.path)).toEqual(['b.ts']);
    expect(v2.diff?.deleted).toEqual([]);
  });

  it('auto-generates a description from the stage when none provided', async () => {
    const { client, seedProject, seedFiles } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    seedFiles('proj-1', [{ path: 'a.ts', content: 'x' }]);
    const svc = new CheckpointService(client, silentLogger());

    const cp = await svc.createCheckpoint({
      projectId: 'proj-1',
      tenantId: 'tenant-A',
      stage: 'debugger',
      workflowId: 'wf-abcd1234',
    });

    expect(cp.description).toContain('debugger');
    expect(cp.description).toContain('abcd1234');
  });
});

describe('CheckpointService.listCheckpoints', () => {
  it('returns checkpoints newest-first with diff embedded', async () => {
    const { client, seedProject, seedFiles } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    const svc = new CheckpointService(client, silentLogger());

    seedFiles('proj-1', [{ path: 'a.ts', content: 'v1' }]);
    await svc.createCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A', stage: 'generator' });
    seedFiles('proj-1', [{ path: 'a.ts', content: 'v2' }]);
    await svc.createCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A', stage: 'debugger' });

    const list = await svc.listCheckpoints({ projectId: 'proj-1', tenantId: 'tenant-A' });
    expect(list).toHaveLength(2);
    expect(list[0]?.version).toBe(2);
    expect(list[1]?.version).toBe(1);
    expect(list[0]?.diff?.modified.map((m) => m.path)).toEqual(['a.ts']);
  });

  it('refuses to list for a different tenant', async () => {
    const { client, seedProject } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    const svc = new CheckpointService(client, silentLogger());

    await expect(
      svc.listCheckpoints({ projectId: 'proj-1', tenantId: 'tenant-B' }),
    ).rejects.toBeInstanceOf(CheckpointNotFoundError);
  });
});

describe('CheckpointService.getCheckpoint', () => {
  it('returns the full snapshot for the requested version', async () => {
    const { client, seedProject, seedFiles } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    seedFiles('proj-1', [{ path: 'a.ts', content: 'hello' }]);
    const svc = new CheckpointService(client, silentLogger());

    const cp = await svc.createCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A', stage: 'generator' });
    const detail = await svc.getCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A', version: cp.version });

    expect(detail.snapshot).toHaveLength(1);
    expect(detail.snapshot[0]?.path).toBe('a.ts');
    expect(detail.snapshot[0]?.content).toBe('hello');
  });

  it('throws when the version does not exist', async () => {
    const { client, seedProject } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    const svc = new CheckpointService(client, silentLogger());

    await expect(
      svc.getCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A', version: 99 }),
    ).rejects.toBeInstanceOf(CheckpointNotFoundError);
  });
});

describe('CheckpointService.restoreCheckpoint', () => {
  it('replaces current files with the target snapshot and creates a rollback version', async () => {
    const { client, seedProject, seedFiles, state } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    const svc = new CheckpointService(client, silentLogger());

    // v1: a.ts=v1
    seedFiles('proj-1', [{ path: 'a.ts', content: 'v1' }]);
    await svc.createCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A', stage: 'generator' });

    // v2: a.ts=v2 + b.ts added
    seedFiles('proj-1', [{ path: 'a.ts', content: 'v2' }, { path: 'b.ts', content: 'extra' }]);
    await svc.createCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A', stage: 'debugger' });

    // Restore to v1 → files should be {a.ts=v1} only
    const restored = await svc.restoreCheckpoint({
      projectId: 'proj-1',
      tenantId: 'tenant-A',
      targetVersion: 1,
      actor: 'user:42',
    });

    expect(restored.version).toBe(3);
    expect(restored.description).toContain('Restored to v1');
    expect(restored.createdBy).toBe('user:42');

    // Physical files match v1
    const now = state.files.filter((f) => f.projectId === 'proj-1');
    expect(now).toHaveLength(1);
    expect(now[0]?.path).toBe('a.ts');
    expect(now[0]?.content).toBe('v1');

    expect(state.projects.get('proj-1')?.currentVersion).toBe(3);
  });

  it('errors when the target version does not exist', async () => {
    const { client, seedProject, seedFiles } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    seedFiles('proj-1', [{ path: 'a.ts', content: 'v1' }]);
    const svc = new CheckpointService(client, silentLogger());

    await expect(
      svc.restoreCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A', targetVersion: 99, actor: 'user:42' }),
    ).rejects.toBeInstanceOf(CheckpointNotFoundError);
  });

  it('refuses restore for a different tenant', async () => {
    const { client, seedProject, seedFiles } = makeStubPrisma();
    seedProject('proj-1', 'tenant-A');
    seedFiles('proj-1', [{ path: 'a.ts', content: 'v1' }]);
    const svc = new CheckpointService(client, silentLogger());
    await svc.createCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-A' });

    await expect(
      svc.restoreCheckpoint({ projectId: 'proj-1', tenantId: 'tenant-B', targetVersion: 1, actor: 'user:42' }),
    ).rejects.toBeInstanceOf(CheckpointNotFoundError);
  });
});
