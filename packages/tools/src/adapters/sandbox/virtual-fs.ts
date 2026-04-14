/**
 * Virtual Sandbox Filesystem
 *
 * Provides a tenant-scoped virtual filesystem abstraction over the
 * underlying sandbox provider (E2B / Docker). Agents reference files as
 * `/workspace/<relative-path>` — this layer translates the virtual path
 * to the sandbox-specific physical path.
 *
 * Inspired by DeerFlow's `/mnt/user-data/` pattern but adapted for
 * JAK's multi-tenant, multi-provider sandbox architecture.
 *
 * Key capabilities:
 *   - Virtual path ↔ physical path translation per provider
 *   - Per-tenant workspace isolation
 *   - File upload / download through the virtual FS
 *   - Directory listing with virtual paths
 *   - Safe path validation (no path traversal)
 */

import type { SandboxAdapter, SandboxFileEntry } from './sandbox.interface.js';

/* ---------------------------------------------------------------------- */
/*  Constants                                                              */
/* ---------------------------------------------------------------------- */

/** The virtual prefix agents use when referencing files. */
export const VIRTUAL_PREFIX = '/workspace';

/** Physical roots per sandbox provider. */
const PHYSICAL_ROOTS: Record<string, string> = {
  e2b: '/home/user/workspace',
  docker: '/app/workspace',
  local: '/tmp/jak-sandboxes',
};

/* ---------------------------------------------------------------------- */
/*  Path helpers                                                           */
/* ---------------------------------------------------------------------- */

/**
 * Normalise and validate a virtual path.
 * Rejects path traversal sequences (`..`) and absolute paths outside the
 * virtual prefix.
 */
export function normaliseVirtualPath(virtualPath: string): string {
  // Strip the /workspace prefix if present
  let rel = virtualPath.startsWith(VIRTUAL_PREFIX)
    ? virtualPath.slice(VIRTUAL_PREFIX.length)
    : virtualPath;

  // Collapse forward slashes & strip leading slash
  rel = rel.replace(/\/+/g, '/').replace(/^\//, '');

  // Reject traversal and empty segments
  const segments = rel.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new PathTraversalError(virtualPath);
  }
  // Reject null bytes
  if (rel.includes('\0')) {
    throw new PathTraversalError(virtualPath);
  }

  return segments.join('/');
}

/**
 * Convert a virtual path to the sandbox-specific physical path.
 */
export function toPhysicalPath(
  virtualPath: string,
  providerType: 'e2b' | 'docker' | 'local',
  tenantId?: string,
): string {
  const rel = normaliseVirtualPath(virtualPath);
  const root = PHYSICAL_ROOTS[providerType] ?? PHYSICAL_ROOTS.local;
  const tenantSegment = tenantId ? `/${tenantId}` : '';
  return `${root}${tenantSegment}/${rel}`;
}

/**
 * Convert a physical path back to a virtual path for display.
 */
export function toVirtualPath(physicalPath: string): string {
  for (const root of Object.values(PHYSICAL_ROOTS)) {
    if (physicalPath.startsWith(root)) {
      const rest = physicalPath.slice(root.length).replace(/^\/[^/]+\//, '/'); // strip tenant segment
      return `${VIRTUAL_PREFIX}${rest.startsWith('/') ? rest : '/' + rest}`;
    }
  }
  return `${VIRTUAL_PREFIX}/${physicalPath.replace(/^\//, '')}`;
}

/* ---------------------------------------------------------------------- */
/*  Error                                                                  */
/* ---------------------------------------------------------------------- */

export class PathTraversalError extends Error {
  constructor(path: string) {
    super(`Path traversal detected: "${path}"`);
    this.name = 'PathTraversalError';
  }
}

/* ---------------------------------------------------------------------- */
/*  VirtualFilesystem                                                       */
/* ---------------------------------------------------------------------- */

export interface VirtualFsOptions {
  adapter: SandboxAdapter;
  sandboxId: string;
  tenantId: string;
  providerType: 'e2b' | 'docker' | 'local';
}

/**
 * Tenant-scoped virtual filesystem wrapping a concrete sandbox adapter.
 *
 * All methods accept virtual paths (`/workspace/src/index.ts`) and
 * translate them to the appropriate physical path for the sandbox.
 */
export class VirtualFilesystem {
  private adapter: SandboxAdapter;
  private sandboxId: string;
  private tenantId: string;
  private providerType: 'e2b' | 'docker' | 'local';

  constructor(opts: VirtualFsOptions) {
    this.adapter = opts.adapter;
    this.sandboxId = opts.sandboxId;
    this.tenantId = opts.tenantId;
    this.providerType = opts.providerType;
  }

  /** Write a single file. */
  async writeFile(virtualPath: string, content: string): Promise<void> {
    const physical = toPhysicalPath(virtualPath, this.providerType, this.tenantId);
    await this.adapter.writeFile(this.sandboxId, physical, content);
  }

  /** Write multiple files atomically. */
  async writeFiles(entries: Array<{ path: string; content: string }>): Promise<void> {
    const translated: SandboxFileEntry[] = entries.map((e) => ({
      path: toPhysicalPath(e.path, this.providerType, this.tenantId),
      content: e.content,
    }));
    await this.adapter.writeFiles(this.sandboxId, translated);
  }

  /** Read a single file. */
  async readFile(virtualPath: string): Promise<string> {
    const physical = toPhysicalPath(virtualPath, this.providerType, this.tenantId);
    return this.adapter.readFile(this.sandboxId, physical);
  }

  /** List files in a directory, returning virtual paths. */
  async listFiles(virtualDir?: string): Promise<string[]> {
    const physicalDir = virtualDir
      ? toPhysicalPath(virtualDir, this.providerType, this.tenantId)
      : toPhysicalPath('/', this.providerType, this.tenantId);

    const files = await this.adapter.listFiles(this.sandboxId, physicalDir);
    return files.map((f) => toVirtualPath(f));
  }

  /** Execute a command inside the sandbox workspace directory. */
  async exec(
    command: string,
    opts?: { timeoutMs?: number; env?: Record<string, string> },
  ) {
    const cwd = toPhysicalPath('/', this.providerType, this.tenantId);
    return this.adapter.exec(this.sandboxId, command, { cwd, ...opts });
  }
}

/* ---------------------------------------------------------------------- */
/*  Factory                                                                */
/* ---------------------------------------------------------------------- */

/**
 * Create a VirtualFilesystem for a given sandbox.
 */
export function createVirtualFs(
  adapter: SandboxAdapter,
  sandboxId: string,
  tenantId: string,
  providerType: 'e2b' | 'docker' | 'local' = 'e2b',
): VirtualFilesystem {
  return new VirtualFilesystem({ adapter, sandboxId, tenantId, providerType });
}
