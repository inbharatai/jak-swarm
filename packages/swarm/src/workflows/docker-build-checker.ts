import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import type { GeneratedFile } from '@jak-swarm/agents';
import type { BuildChecker, BuildResult } from './vibe-coder-workflow.js';

/**
 * Docker-backed build checker — runs a real `npm install` + build command
 * inside a short-lived `node:20-slim` container and reports back real build
 * errors. Complements the in-memory `staticBuildChecker` (fast, TS-only) and
 * the heuristic checker (catches truncation). Use this as the deepest layer
 * when the agent has to produce a runnable app.
 *
 * Why a dedicated module and not the existing DockerSandboxAdapter:
 *   - The sandbox adapter uses `--network none` for code-execution safety.
 *     A build checker needs npm registry access, so it runs its own
 *     container lifecycle with network enabled and a tight timeout.
 *   - The sandbox adapter is long-lived (sessions, dev servers). This is
 *     scoped to a single build call and destroys its container afterward.
 *   - Tests inject a stub DockerRunner; production uses RealDockerRunner
 *     via execFileSync (no shell interpolation).
 *
 * Graceful skip when Docker is absent — returns `{ok: true, skipped: true}`.
 * Callers that care about real build verification must inspect `skipped`.
 *
 * Threat model caveats:
 *   - Network is enabled during `npm install` — packages declared by the
 *     generated package.json reach npmjs.org. Malicious dep names in
 *     agent output could trigger supply-chain risk. Mitigation: run on CI,
 *     never on end-user machines; containers are destroyed post-check.
 *   - Memory/CPU/PID limits match the sandbox adapter.
 */

export interface DockerBuildRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
}

export interface DockerBuildRunOptions {
  files: GeneratedFile[];
  framework: string;
  timeoutMs: number;
  /** If set, override the default build command (e.g. for generic TS projects). */
  buildCommand?: string;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
}

/**
 * Injection seam. Tests provide a stub that captures the call and returns a
 * canned result. Real code uses `RealDockerRunner`, which shells out to
 * the Docker CLI.
 */
export interface DockerRunner {
  isAvailable(): boolean;
  runBuild(opts: DockerBuildRunOptions): Promise<DockerBuildRunResult>;
}

function defaultBuildCommand(framework: string): string {
  // Install + build in one shell invocation so one failure bubbles out.
  //
  // `npm install --no-audit --no-fund --legacy-peer-deps --prefer-offline`
  // matches the DockerSandboxAdapter's install flags for consistency.
  //
  // --prefer-offline falls back to the cache on flaky networks; we still
  // need network for first-time installs.
  const install = 'npm install --no-audit --no-fund --legacy-peer-deps --prefer-offline 2>&1';
  switch (framework) {
    case 'nextjs':
      // Next build covers typechecking + routing + edge/runtime checks in one pass.
      return `${install} && npx --no-install next build 2>&1`;
    case 'vite':
      return `${install} && npx --no-install vite build 2>&1`;
    case 'typescript':
    case 'node':
      return `${install} && npx --no-install tsc --noEmit 2>&1`;
    default:
      // Fallback: if package.json defines `scripts.build`, run it; else tsc.
      return `${install} && (npm run build --if-present 2>&1 || npx --no-install tsc --noEmit 2>&1)`;
  }
}

function isDockerCliAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sanitizeRelativePath(filePath: string): string {
  const normalized = path.normalize(filePath).replace(/\\/g, '/');
  if (normalized.startsWith('..') || normalized.includes('/../') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid file path (traversal attempt): ${filePath}`);
  }
  return normalized;
}

function writeFilesToDisk(rootDir: string, files: readonly GeneratedFile[]): void {
  for (const f of files) {
    const safe = sanitizeRelativePath(f.path);
    const full = path.join(rootDir, safe);
    if (!full.startsWith(rootDir + path.sep) && full !== rootDir) {
      throw new Error(`Path traversal detected: ${f.path}`);
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content, 'utf8');
  }
}

/**
 * Production runner. Spins up a disposable container, runs the build,
 * captures combined stdout, and destroys the container.
 *
 * Intentionally minimal: no volume caching across runs (deterministic).
 * Can be extended later with a named `node_modules` volume if install time
 * becomes the bench bottleneck.
 */
export class RealDockerRunner implements DockerRunner {
  private availabilityCache: boolean | null = null;

  isAvailable(): boolean {
    if (this.availabilityCache === null) {
      this.availabilityCache = isDockerCliAvailable();
    }
    return this.availabilityCache;
  }

  async runBuild(opts: DockerBuildRunOptions): Promise<DockerBuildRunResult> {
    const started = Date.now();
    const command = opts.buildCommand ?? defaultBuildCommand(opts.framework);

    const id = `jak-build-${crypto.randomUUID().slice(0, 8)}`;
    const projectDir = path.join(os.tmpdir(), 'jak-build-check', id);
    fs.mkdirSync(projectDir, { recursive: true });

    try {
      writeFilesToDisk(projectDir, opts.files);

      // `docker run --rm` creates + runs + cleans up the container in a single
      // command. Network is enabled (no --network none). Memory/CPU limits
      // mirror the long-lived sandbox adapter.
      const args = [
        'run',
        '--rm',
        '--name', id,
        '-v', `${projectDir}:/home/user/project`,
        '-w', '/home/user/project',
        '--memory', '1g',
        '--cpus', '2',
        '--pids-limit', '512',
        // no --read-only: npm install writes to node_modules on disk
        'node:20-slim',
        'sh', '-c', command,
      ];

      if (opts.signal?.aborted) {
        throw new Error('Aborted before start');
      }

      try {
        const stdout = execFileSync('docker', args, {
          encoding: 'utf8',
          timeout: opts.timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
        });
        return {
          exitCode: 0,
          stdout: String(stdout),
          stderr: '',
          durationMs: Date.now() - started,
          command,
        };
      } catch (err: unknown) {
        const execErr = err as {
          stdout?: Buffer | string;
          stderr?: Buffer | string;
          status?: number | null;
          signal?: string;
        };
        const stdoutStr = String(execErr.stdout ?? '');
        const stderrStr = String(execErr.stderr ?? '');
        const status = typeof execErr.status === 'number' ? execErr.status : 1;
        return {
          exitCode: status,
          stdout: stdoutStr,
          stderr: stderrStr,
          durationMs: Date.now() - started,
          command,
        };
      }
    } finally {
      // Best-effort kill + cleanup. `--rm` handles the happy path; this
      // covers timeouts and unexpected kills.
      try {
        execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {
        /* nothing to clean */
      }
    }
  }
}

/**
 * Parse combined Next.js / tsc / npm output and extract the source-file
 * paths that the build complained about. Conservative: we only report
 * paths that exist in the generated file set, so the debugger doesn't
 * chase errors in node_modules.
 */
export function extractAffectedFiles(output: string, files: readonly GeneratedFile[]): string[] {
  const present = new Set(files.map((f) => f.path));
  const affected = new Set<string>();

  const patterns = [
    // tsc: `src/foo.ts(10,5): error TS1234: ...`
    /(?<path>[\w.\-/]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))\(\d+,\d+\):\s*error/g,
    // next build: `./src/app/page.tsx:10:5` or `Error occurred in src/app/foo.tsx`
    /(?<path>(?:\.\/)?[\w.\-/]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)):\d+:\d+/g,
    // generic `Error: something in src/foo.ts`
    /(?:in|at)\s+(?<path>[\w.\-/]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))/g,
  ];

  for (const re of patterns) {
    for (const m of output.matchAll(re)) {
      const raw = m.groups?.['path'];
      if (!raw) continue;
      const normalized = raw.replace(/^\.\//, '');
      if (present.has(normalized)) {
        affected.add(normalized);
      }
    }
  }

  return [...affected];
}

/** Cap build output so we don't overwhelm the debugger's token budget. */
export function capErrorLog(log: string, maxChars = 8000): string {
  if (log.length <= maxChars) return log;
  // Prefer the tail — build failures usually report the root cause last.
  const head = log.slice(0, 1500);
  const tail = log.slice(-maxChars + 1500);
  return `${head}\n... (${log.length - maxChars} chars elided) ...\n${tail}`;
}

export interface DockerBuildCheckerOptions {
  /** Injection for tests. Defaults to a new RealDockerRunner. */
  runner?: DockerRunner;
  /** Build timeout (container-scoped). Default 4 minutes. */
  timeoutMs?: number;
  /** Framework hint; picks the default build command. Default 'nextjs'. */
  framework?: string;
  /** Explicit override of the shell command to run inside the container. */
  buildCommand?: string;
}

export class DockerBuildChecker implements BuildChecker {
  private readonly runner: DockerRunner;
  private readonly timeoutMs: number;
  private readonly framework: string;
  private readonly buildCommand: string | undefined;

  constructor(options: DockerBuildCheckerOptions = {}) {
    this.runner = options.runner ?? new RealDockerRunner();
    this.timeoutMs = options.timeoutMs ?? 240_000;
    this.framework = options.framework ?? 'nextjs';
    this.buildCommand = options.buildCommand;
  }

  async check(files: GeneratedFile[]): Promise<BuildResult> {
    const started = Date.now();

    if (files.length === 0) {
      return {
        ok: false,
        errorLog: 'Docker build checker received zero files',
        affectedFiles: [],
        durationMs: Date.now() - started,
      };
    }

    if (!this.runner.isAvailable()) {
      return {
        ok: true,
        skipped: true,
        skipReason: 'Docker not available on host — build not verified',
        durationMs: Date.now() - started,
      };
    }

    let result: DockerBuildRunResult;
    try {
      result = await this.runner.runBuild({
        files,
        framework: this.framework,
        timeoutMs: this.timeoutMs,
        buildCommand: this.buildCommand,
      });
    } catch (err) {
      // Runner itself threw (Docker died mid-run, disk full, etc.). We
      // treat this as a skip rather than a build failure — the generated
      // code did not cause it.
      return {
        ok: true,
        skipped: true,
        skipReason: `Docker runner error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - started,
      };
    }

    const combined = `${result.stdout}\n${result.stderr}`.trim();

    if (result.exitCode === 0) {
      return { ok: true, durationMs: result.durationMs };
    }

    const affected = extractAffectedFiles(combined, files);
    return {
      ok: false,
      errorLog: capErrorLog(combined || `Build exited with code ${result.exitCode} (no output)`),
      affectedFiles: affected,
      durationMs: result.durationMs,
    };
  }
}

/** Convenience singleton for callers that want the real thing with defaults. */
export const dockerBuildChecker = new DockerBuildChecker();
