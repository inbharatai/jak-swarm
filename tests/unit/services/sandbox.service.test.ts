/**
 * SandboxService unit tests.
 *
 * IMPORTANT — what this service actually is:
 *   apps/api/src/services/sandbox.service.ts is NOT an isolation primitive.
 *   It does not spawn anything itself, does not strip env, does not enforce
 *   tenant scoping, does not enforce disk quotas, and does not configure
 *   network policy. It is a thin LIFECYCLE wrapper around an injected
 *   `SandboxAdapter` (constructor-injected) plus a module-level
 *   `sandboxActivity: Map<string, number>` that tracks last-touched timestamps
 *   for TTL-based cleanup.
 *
 *   Real isolation guarantees (env stripping, network allowlist, memory/disk
 *   caps, audit logging, structured AppError translation) belong to the
 *   adapter implementation in packages/tools/src/adapters/sandbox/ and must
 *   be covered by that adapter's own test file. We pin the lifecycle contract
 *   here and leave `it.todo` markers documenting the gaps.
 *
 *   Things this file genuinely tests:
 *     - getOrCreateSandbox: reuse-if-running, recreate-if-stale, metadata
 *       carries projectId + tenantId, persists sandboxId on Project row.
 *     - syncFilesToSandbox: pulls ProjectFile rows, forwards to writeFiles.
 *     - installAndBuild: install + `npx next build` with a 120s timeout, maps
 *       exitCode to {success, error}.
 *     - startDevServer: persists previewUrl on success, swallows errors to null.
 *     - destroySandbox: tolerates adapter throws ("Already destroyed"), clears
 *       sandboxId/previewUrl, drops activity tracking.
 *     - cleanupIdleSandboxes: only sandboxes idle > DEFAULT_TTL_MS are reaped.
 *     - isAvailable: pass-through.
 *
 *   Surprising behavior worth flagging:
 *     - sandboxActivity is a module-level Map, so it leaks across test cases
 *       unless cleared. We clear it via destroySandbox / cleanupIdleSandboxes
 *       in afterEach. If a future test imports DEFAULT_TTL_MS / the Map
 *       directly, it should reset it explicitly.
 *     - Errors thrown by getOrCreateSandbox / syncFilesToSandbox are plain
 *       `new Error(...)`, NOT a structured AppError. The "translates raw
 *       errors to structured AppError, never leaks stack" guarantee from the
 *       prompt is NOT implemented at this layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SandboxService } from '../../../apps/api/src/services/sandbox.service.js';

// ─── Test doubles ─────────────────────────────────────────────────────────

type AdapterMock = {
  isAvailable: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  getInfo: ReturnType<typeof vi.fn>;
  writeFiles: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  installDeps: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  startDevServer: ReturnType<typeof vi.fn>;
  getPreviewUrl: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

function makeAdapter(overrides: Partial<AdapterMock> = {}): AdapterMock {
  return {
    isAvailable: vi.fn(() => true),
    create: vi.fn(async () => ({ id: 'sb_new', status: 'running', host: 'h' })),
    getInfo: vi.fn(async () => null),
    writeFiles: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    installDeps: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    exec: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    startDevServer: vi.fn(async () => 'https://preview.example/abc'),
    getPreviewUrl: vi.fn(async () => 'https://preview.example/abc'),
    destroy: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeDb(initialProject: any = null) {
  const project = {
    findUnique: vi.fn(async () => initialProject),
    update: vi.fn(async ({ where, data }: any) => ({ ...(initialProject ?? {}), ...data, id: where.id })),
  };
  const projectFile = {
    findMany: vi.fn(async () => [] as Array<{ path: string; content: string }>),
  };
  return { project, projectFile } as any;
}

function makeLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => makeLog()),
    level: 'info',
    silent: vi.fn(),
  } as any;
}

// ─── Hygiene: drain module-level activity Map between tests ──────────────
//
// SandboxService relies on a module-scoped `sandboxActivity` Map. It leaks
// across `it()` cases inside the same Vitest worker. We force-drain it
// between tests by running cleanupIdleSandboxes with Date.now pinned far in
// the future — that loops over EVERY entry in the Map and either destroys
// or deletes it, leaving the Map empty.

afterEach(async () => {
  const drainAdapter = makeAdapter({ destroy: vi.fn(async () => undefined) });
  const drainSvc = new SandboxService(makeDb(), makeLog(), drainAdapter);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 60 * 1000); // +10h
  await drainSvc.cleanupIdleSandboxes();
  vi.restoreAllMocks();
});

// ─── getOrCreateSandbox ───────────────────────────────────────────────────

describe('SandboxService.getOrCreateSandbox', () => {
  it('throws when project does not exist', async () => {
    const db = makeDb(null);
    const svc = new SandboxService(db, makeLog(), makeAdapter());
    await expect(svc.getOrCreateSandbox('proj_missing')).rejects.toThrow(/proj_missing not found/);
  });

  it('reuses an existing running sandbox without recreating', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_existing', previewUrl: null });
    const adapter = makeAdapter({
      getInfo: vi.fn(async () => ({ id: 'sb_existing', status: 'running' })),
    });
    const svc = new SandboxService(db, makeLog(), adapter);

    const info = await svc.getOrCreateSandbox('p1');

    expect(info).toEqual({ id: 'sb_existing', status: 'running' });
    expect(adapter.getInfo).toHaveBeenCalledWith('sb_existing');
    expect(adapter.create).not.toHaveBeenCalled();
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it('clears stale sandboxId and creates a new one when getInfo is null', async () => {
    const db = makeDb({ id: 'p2', tenantId: 't2', sandboxId: 'sb_dead', previewUrl: 'old' });
    const adapter = makeAdapter({
      getInfo: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'sb_fresh', status: 'running' })),
    });
    const svc = new SandboxService(db, makeLog(), adapter);

    const info = await svc.getOrCreateSandbox('p2');

    expect(info.id).toBe('sb_fresh');
    // First update clears stale ref:
    expect(db.project.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'p2' },
      data: { sandboxId: null, previewUrl: null },
    });
    // Second update persists new id:
    expect(db.project.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'p2' },
      data: { sandboxId: 'sb_fresh' },
    });
  });

  it('recreates when existing sandbox is found but not running (status=stopped)', async () => {
    const db = makeDb({ id: 'p3', tenantId: 't3', sandboxId: 'sb_stopped' });
    const adapter = makeAdapter({
      getInfo: vi.fn(async () => ({ id: 'sb_stopped', status: 'stopped' })),
      create: vi.fn(async () => ({ id: 'sb_new', status: 'running' })),
    });
    const svc = new SandboxService(db, makeLog(), adapter);

    const info = await svc.getOrCreateSandbox('p3');

    expect(adapter.create).toHaveBeenCalledTimes(1);
    expect(info.id).toBe('sb_new');
  });

  it('passes projectId + tenantId through as adapter metadata (proxy for tenant scoping at the adapter layer)', async () => {
    const db = makeDb({ id: 'p4', tenantId: 'tenant_xyz', sandboxId: null });
    const adapter = makeAdapter();
    const svc = new SandboxService(db, makeLog(), adapter);

    await svc.getOrCreateSandbox('p4');

    expect(adapter.create).toHaveBeenCalledTimes(1);
    expect(adapter.create).toHaveBeenCalledWith({
      template: 'node',
      timeoutMs: 30 * 60 * 1000,
      metadata: { projectId: 'p4', tenantId: 'tenant_xyz' },
    });
  });
});

// ─── syncFilesToSandbox ───────────────────────────────────────────────────

describe('SandboxService.syncFilesToSandbox', () => {
  it('throws when project has no sandbox', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: null });
    const svc = new SandboxService(db, makeLog(), makeAdapter());
    await expect(svc.syncFilesToSandbox('p1')).rejects.toThrow(/No sandbox for project/);
  });

  it('forwards every ProjectFile row to adapter.writeFiles', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    db.projectFile.findMany.mockResolvedValueOnce([
      { path: 'app/page.tsx', content: 'export default ...' },
      { path: 'package.json', content: '{}' },
    ]);
    const adapter = makeAdapter();
    const svc = new SandboxService(db, makeLog(), adapter);

    await svc.syncFilesToSandbox('p1');

    expect(db.projectFile.findMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(adapter.writeFiles).toHaveBeenCalledWith('sb_1', [
      { path: 'app/page.tsx', content: 'export default ...' },
      { path: 'package.json', content: '{}' },
    ]);
  });

  it('handles an empty file list without erroring', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    db.projectFile.findMany.mockResolvedValueOnce([]);
    const adapter = makeAdapter();
    const svc = new SandboxService(db, makeLog(), adapter);

    await svc.syncFilesToSandbox('p1');
    expect(adapter.writeFiles).toHaveBeenCalledWith('sb_1', []);
  });
});

// ─── installAndBuild ──────────────────────────────────────────────────────

describe('SandboxService.installAndBuild', () => {
  it('throws when project has no sandbox', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: null });
    const svc = new SandboxService(db, makeLog(), makeAdapter());
    await expect(svc.installAndBuild('p1')).rejects.toThrow(/No sandbox for project/);
  });

  it('returns success when both install and build exit 0', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    const adapter = makeAdapter();
    const svc = new SandboxService(db, makeLog(), adapter);

    const result = await svc.installAndBuild('p1');

    expect(result).toEqual({ success: true });
    expect(adapter.installDeps).toHaveBeenCalledWith('sb_1');
    expect(adapter.exec).toHaveBeenCalledWith('sb_1', 'npx next build', { timeoutMs: 120000 });
  });

  it('still attempts the build even when install exits non-zero (warns, does not abort)', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    const log = makeLog();
    const adapter = makeAdapter({
      installDeps: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'EACCES some warning' })),
    });
    const svc = new SandboxService(db, log, adapter);

    const result = await svc.installAndBuild('p1');

    expect(adapter.exec).toHaveBeenCalledWith('sb_1', 'npx next build', { timeoutMs: 120000 });
    expect(result.success).toBe(true);
    expect(log.warn).toHaveBeenCalled();
  });

  it('truncates the warned stderr to first 300 chars (PII / log-bloat guard)', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    const log = makeLog();
    const longErr = 'X'.repeat(1000);
    const adapter = makeAdapter({
      installDeps: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: longErr })),
    });
    const svc = new SandboxService(db, log, adapter);

    await svc.installAndBuild('p1');

    const warnPayload = log.warn.mock.calls[0][0];
    expect(warnPayload.stderr).toBe('X'.repeat(300));
  });

  it('returns success=false with stderr when build exits non-zero', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    const adapter = makeAdapter({
      exec: vi.fn(async () => ({ exitCode: 1, stdout: 'partial', stderr: 'Type error in app/page.tsx' })),
    });
    const svc = new SandboxService(db, makeLog(), adapter);

    const result = await svc.installAndBuild('p1');

    expect(result).toEqual({ success: false, error: 'Type error in app/page.tsx' });
  });

  it('falls back to stdout when build fails with empty stderr', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    const adapter = makeAdapter({
      exec: vi.fn(async () => ({ exitCode: 2, stdout: 'oops', stderr: '' })),
    });
    const svc = new SandboxService(db, makeLog(), adapter);

    const result = await svc.installAndBuild('p1');
    expect(result).toEqual({ success: false, error: 'oops' });
  });
});

// ─── startDevServer ───────────────────────────────────────────────────────

describe('SandboxService.startDevServer', () => {
  it('returns null when project has no sandbox (does not throw)', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: null });
    const svc = new SandboxService(db, makeLog(), makeAdapter());
    expect(await svc.startDevServer('p1')).toBeNull();
  });

  it('persists previewUrl on success', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    const adapter = makeAdapter({
      startDevServer: vi.fn(async () => 'https://preview.example/p1'),
    });
    const svc = new SandboxService(db, makeLog(), adapter);

    const url = await svc.startDevServer('p1');

    expect(url).toBe('https://preview.example/p1');
    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { previewUrl: 'https://preview.example/p1' },
    });
  });

  it('swallows adapter errors and returns null (does not propagate)', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    const log = makeLog();
    const adapter = makeAdapter({
      startDevServer: vi.fn(async () => {
        throw new Error('port already bound');
      }),
    });
    const svc = new SandboxService(db, log, adapter);

    const url = await svc.startDevServer('p1');

    expect(url).toBeNull();
    expect(log.error).toHaveBeenCalled();
    // Must NOT persist a previewUrl on failure
    expect(db.project.update).not.toHaveBeenCalled();
  });
});

// ─── destroySandbox ───────────────────────────────────────────────────────

describe('SandboxService.destroySandbox', () => {
  it('is a no-op when project has no sandbox', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: null });
    const adapter = makeAdapter();
    const svc = new SandboxService(db, makeLog(), adapter);

    await svc.destroySandbox('p1');

    expect(adapter.destroy).not.toHaveBeenCalled();
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it('clears sandboxId + previewUrl after a successful destroy', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    const adapter = makeAdapter();
    const svc = new SandboxService(db, makeLog(), adapter);

    await svc.destroySandbox('p1');

    expect(adapter.destroy).toHaveBeenCalledWith('sb_1');
    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { sandboxId: null, previewUrl: null },
    });
  });

  it('still clears DB row even when adapter.destroy throws ("already destroyed")', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: 'sb_1' });
    const adapter = makeAdapter({
      destroy: vi.fn(async () => {
        throw new Error('not found');
      }),
    });
    const svc = new SandboxService(db, makeLog(), adapter);

    await expect(svc.destroySandbox('p1')).resolves.toBeUndefined();
    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { sandboxId: null, previewUrl: null },
    });
  });
});

// ─── cleanupIdleSandboxes ─────────────────────────────────────────────────

describe('SandboxService.cleanupIdleSandboxes', () => {
  it('returns 0 when there is no tracked activity', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: null });
    const svc = new SandboxService(db, makeLog(), makeAdapter());
    expect(await svc.cleanupIdleSandboxes()).toBe(0);
  });

  it('reaps a sandbox whose last-touch is older than the TTL', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: null });
    const adapter = makeAdapter({
      // Touch the activity Map by going through getOrCreateSandbox
      create: vi.fn(async () => ({ id: 'sb_idle', status: 'running' })),
    });
    // First, register activity by creating a sandbox
    db.project.findUnique.mockResolvedValueOnce({
      id: 'p1',
      tenantId: 't1',
      sandboxId: null,
    });
    const svc = new SandboxService(db, makeLog(), adapter);
    await svc.getOrCreateSandbox('p1'); // populates sandboxActivity

    // Fast-forward past the 30-minute TTL by mocking Date.now
    const realNow = Date.now;
    const future = realNow() + 31 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(future);

    const cleaned = await svc.cleanupIdleSandboxes();

    expect(cleaned).toBe(1);
    expect(adapter.destroy).toHaveBeenCalledWith('sb_idle');

    vi.restoreAllMocks();
  });

  it('does NOT reap a sandbox whose last-touch is within the TTL window', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: null });
    const adapter = makeAdapter({
      create: vi.fn(async () => ({ id: 'sb_fresh_recent', status: 'running' })),
    });
    db.project.findUnique.mockResolvedValueOnce({
      id: 'p1',
      tenantId: 't1',
      sandboxId: null,
    });
    const svc = new SandboxService(db, makeLog(), adapter);
    await svc.getOrCreateSandbox('p1');

    // Only 5 minutes elapse — well under the 30-minute TTL
    const future = Date.now() + 5 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(future);

    const cleaned = await svc.cleanupIdleSandboxes();
    expect(cleaned).toBe(0);
    expect(adapter.destroy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    // Drain the Map so this entry doesn't pollute the next test:
    await svc.destroySandbox('p1').catch(() => {});
  });

  it('drops the activity entry even when adapter.destroy throws during cleanup', async () => {
    const db = makeDb({ id: 'p1', tenantId: 't1', sandboxId: null });
    const adapter = makeAdapter({
      create: vi.fn(async () => ({ id: 'sb_zombie', status: 'running' })),
      destroy: vi.fn(async () => {
        throw new Error('vanished from runtime');
      }),
    });
    db.project.findUnique.mockResolvedValueOnce({
      id: 'p1',
      tenantId: 't1',
      sandboxId: null,
    });
    const svc = new SandboxService(db, makeLog(), adapter);
    await svc.getOrCreateSandbox('p1');

    const future = Date.now() + 31 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(future);

    const cleaned = await svc.cleanupIdleSandboxes();
    // destroy threw, so cleaned counter does NOT increment, but the Map entry IS dropped
    expect(cleaned).toBe(0);

    // Calling cleanup again should find nothing left to reap:
    expect(await svc.cleanupIdleSandboxes()).toBe(0);

    vi.restoreAllMocks();
  });
});

// ─── isAvailable ──────────────────────────────────────────────────────────

describe('SandboxService.isAvailable', () => {
  it('delegates to adapter.isAvailable (true)', () => {
    const adapter = makeAdapter({ isAvailable: vi.fn(() => true) });
    const svc = new SandboxService(makeDb(), makeLog(), adapter);
    expect(svc.isAvailable()).toBe(true);
  });

  it('delegates to adapter.isAvailable (false)', () => {
    const adapter = makeAdapter({ isAvailable: vi.fn(() => false) });
    const svc = new SandboxService(makeDb(), makeLog(), adapter);
    expect(svc.isAvailable()).toBe(false);
  });
});

// ─── Gaps that belong to the adapter layer, not this service ──────────────
//
// The prompt asked us to verify isolation guarantees (env stripping, network
// allowlist, disk quota, audit logging, structured AppError translation,
// hard tenant scoping). None of these are implemented in this file — they
// belong in packages/tools/src/adapters/sandbox/* and must be tested in that
// package's own test suite. Pinning these as it.todo so the gap is visible
// in CI output rather than silently absent.

describe('SandboxService — adapter-layer guarantees (deferred)', () => {
  it.todo(
    'parent-process secrets (DATABASE_URL, OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, etc.) are NOT inherited by the sandboxed process — belongs in adapters/sandbox/<impl>.test.ts because this service does not touch process.env',
  );

  it.todo(
    'memory + disk + cpu caps are forwarded to the underlying runtime call — belongs in the adapter test (E2B SDK / Docker) because SandboxService.create only forwards { template, timeoutMs, metadata }',
  );

  it.todo(
    'outbound network is default-deny / allowlist-enforced — belongs in adapter test because SandboxService never sees a network-policy argument',
  );

  it.todo(
    'per-tenant disk quota: writes that exceed the quota fail with a structured QuotaExceededError — belongs in adapter test; SandboxService.syncFilesToSandbox forwards bytes blindly',
  );

  it.todo(
    'cross-tenant access is rejected at sandbox-id resolution — currently only enforced indirectly via Project.tenantId scoping at the route/auth layer, not inside SandboxService. Add a guard here OR test it where it actually lives (auth middleware / route handler)',
  );

  it.todo(
    'runtime errors are translated to a structured AppError with no raw stack leak — currently SandboxService throws plain `new Error(...)`. Either implement the translation (preferred) or move this assertion to the adapter test',
  );

  it.todo(
    'each session start/end emits an AuditLog row via Prisma — NOT implemented; SandboxService only writes log.info/log.warn. If we want auditability we must add db.auditLog.create() calls and then test them here',
  );
});
