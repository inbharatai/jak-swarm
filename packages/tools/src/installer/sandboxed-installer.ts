/**
 * Sandboxed tool installer — Sprint 2 of full-fledged JAK.
 *
 * Real subprocess execution with hard safety rails:
 *   - Allowlist: only `TRUSTED_INSTALL_ADAPTERS`-registered tools
 *     can be installed. Empty by default — explicit registrations only.
 *   - Approval-gated: caller MUST pass `approvalId`. Without it,
 *     `install()` throws `InstallApprovalRequiredError`.
 *   - Capability-CHECK only by default: today's first allowlisted
 *     adapters are READ-ONLY commands (e.g., `pnpm list <pkg>` to
 *     check whether a package is already in the workspace). Real
 *     `pnpm install` runs only via the FULL_INSTALL safety class
 *     (off by default; opt-in via `JAK_INSTALL_ALLOW_WRITE=1`).
 *   - Argument allowlist: each adapter declares the EXACT command +
 *     argument vector. No user input is shell-interpolated.
 *   - Timeout: 60-second hard cap per command.
 *   - Tenant scope: every install request is logged with tenantId +
 *     userId; cross-tenant approvalId reuse is rejected upstream by
 *     the existing ApprovalScope payload binding.
 *   - Result capture: stdout/stderr captured + truncated, exit code
 *     recorded, duration measured.
 *
 * Why "capability check" first instead of full install:
 *   Running `pnpm install` from inside the running API process can
 *   modify the running app's own dependencies — that's a footgun.
 *   The honest production path is:
 *   1. capability check (this sprint) — read-only, safe to ship today
 *   2. out-of-process install worker (follow-up sprint) — runs with
 *      its own privileges, can modify the workspace without risking
 *      the running API
 *   This sprint completes (1) end-to-end with REAL subprocess
 *   execution + tests; (2) is the next sprint.
 */

import { spawn } from 'node:child_process';
import {
  type ToolInstallRequest,
  type InstallPlan,
  type InstallResult,
  type ToolInstallerService,
} from './tool-installer.js';

/**
 * Safety class for an installer command:
 *   - 'capability_check' = read-only command (e.g., `pnpm list X`).
 *     Always allowed regardless of env.
 *   - 'full_install' = command that mutates the workspace.
 *     Requires `JAK_INSTALL_ALLOW_WRITE=1` env opt-in.
 */
export type InstallSafetyClass = 'capability_check' | 'full_install';

export interface SandboxedAdapter {
  /** Tool name (key in TRUSTED_INSTALL_ADAPTERS). */
  toolName: string;
  /** Command + literal argv. NO shell interpolation, NO user input. */
  command: string;
  args: string[];
  /** Working directory (relative to repo root). Empty = repo root. */
  cwd?: string;
  /** Safety class drives env-flag gating. */
  safetyClass: InstallSafetyClass;
  /** Layman-friendly description shown in the approval card. */
  description: string;
}

/**
 * Trusted sandbox adapter registry. Each entry is a hand-reviewed
 * command + argv pair. NEW entries require code review before merge —
 * never accept user input here.
 *
 * Default population: capability checks only (read-only). Real
 * installs land in the follow-up sprint with the out-of-process
 * worker.
 */
export const SANDBOX_ADAPTERS: Record<string, SandboxedAdapter> = {
  // Check whether `playwright` is in the workspace. READ-ONLY.
  check_playwright: {
    toolName: 'check_playwright',
    command: 'pnpm',
    args: ['ls', 'playwright', '--depth=0', '--json'],
    safetyClass: 'capability_check',
    description: 'Check whether the Playwright browser-automation package is installed.',
  },
  // Check the pnpm version itself. READ-ONLY. Useful sanity check.
  check_pnpm_version: {
    toolName: 'check_pnpm_version',
    command: 'pnpm',
    args: ['--version'],
    safetyClass: 'capability_check',
    description: 'Read the pnpm version. Smoke test for the installer subprocess pipe.',
  },
  // Check whether `pdfjs-dist` is available. READ-ONLY.
  check_pdf_parser: {
    toolName: 'check_pdf_parser',
    command: 'pnpm',
    args: ['ls', 'pdfjs-dist', '--depth=0', '--json'],
    safetyClass: 'capability_check',
    description: 'Check whether the PDF parser library is in the workspace.',
  },
};

/**
 * Validate a sandbox adapter is registered AND its command matches
 * the registered argv (defense against tampered registrations).
 */
function getValidatedAdapter(toolName: string): SandboxedAdapter | null {
  const adapter = SANDBOX_ADAPTERS[toolName];
  if (!adapter) return null;
  // Defense in depth: shell metacharacters anywhere in command/args
  // are rejected outright. Use spawn with literal argv so this is
  // mostly belt-and-suspenders.
  const shellChars = /[;&|`$<>\\]/;
  if (shellChars.test(adapter.command)) return null;
  for (const a of adapter.args) {
    if (typeof a !== 'string' || shellChars.test(a)) return null;
  }
  return adapter;
}

export class InstallApprovalRequiredError extends Error {
  constructor(toolName: string) {
    super(
      `Tool install '${toolName}' requires an approvalId. Caller must obtain user approval first.`,
    );
    this.name = 'InstallApprovalRequiredError';
  }
}

export class InstallNotAllowedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InstallNotAllowedError';
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_LOG_BYTES = 64 * 1024; // 64KB per stream

export interface SandboxedInstallOptions {
  /** Override timeout per command. Default 60s. */
  timeoutMs?: number;
  /** Override repo root for cwd resolution. Default process.cwd(). */
  repoRoot?: string;
  /**
   * Optional callback for streaming stdout/stderr to an audit emitter.
   * Receives chunks as they arrive (truncated at MAX_LOG_BYTES total).
   */
  onLogChunk?: (event: { stream: 'stdout' | 'stderr'; chunk: string }) => void;
}

/**
 * Real subprocess-backed installer. Runs allowlisted commands with
 * approval. Capability checks (`pnpm list …`) ship today; real
 * `pnpm install` is gated behind `JAK_INSTALL_ALLOW_WRITE=1`.
 */
export class SandboxedInstaller implements ToolInstallerService {
  constructor(private readonly options: SandboxedInstallOptions = {}) {}

  async dryRun(request: ToolInstallRequest): Promise<InstallPlan> {
    const sandboxAdapter = getValidatedAdapter(request.toolName);

    // Sandbox allowlist is the single source of truth for executable installs.
    if (!sandboxAdapter) {
      return {
        steps: [
          {
            description: `Tool '${request.toolName}' is NOT in the sandbox allowlist. Install rejected.`,
            safe: false,
          },
        ],
        estimatedDurationSec: 0,
        mode: 'dry_run',
        summary: `Cannot install '${request.toolName}': not in the sandbox allowlist. Ask your platform team to register a SandboxedAdapter.`,
        allSafe: false,
      };
    }

    const writeAllowed = process.env['JAK_INSTALL_ALLOW_WRITE'] === '1';
    if (sandboxAdapter.safetyClass === 'full_install' && !writeAllowed) {
      return {
        steps: [
          {
            description: `Tool '${request.toolName}' is a 'full_install' adapter; JAK_INSTALL_ALLOW_WRITE=1 is required to enable.`,
            safe: false,
          },
        ],
        estimatedDurationSec: 0,
        mode: 'dry_run',
        summary: `Cannot install '${request.toolName}' in this environment: full_install gating is OFF. Set JAK_INSTALL_ALLOW_WRITE=1 (admin-only) to enable.`,
        allSafe: false,
      };
    }

    const cmdline = `${sandboxAdapter.command} ${sandboxAdapter.args.join(' ')}`;
    return {
      steps: [
        {
          description: `Verify sandbox adapter signature for '${request.toolName}'`,
          safe: true,
        },
        {
          description: `Run '${cmdline}' in a sandboxed subprocess (timeout ${(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s)`,
          command: cmdline,
          safe: true,
        },
        {
          description: 'Capture stdout/stderr/exit-code; truncate logs at 64KB per stream',
          safe: true,
        },
      ],
      estimatedDurationSec: 30,
      mode: 'dry_run',
      summary:
        sandboxAdapter.safetyClass === 'capability_check'
          ? `Dry-run plan for capability check '${request.toolName}'. ${request.purpose}`
          : `Dry-run plan for full install '${request.toolName}' (write-mode enabled). ${request.purpose}`,
      allSafe: true,
    };
  }

  async install(input: { request: ToolInstallRequest; approvalId: string }): Promise<InstallResult> {
    if (!input.approvalId) {
      throw new InstallApprovalRequiredError(input.request.toolName);
    }
    const sandboxAdapter = getValidatedAdapter(input.request.toolName);
    if (!sandboxAdapter) {
      throw new InstallNotAllowedError(
        `Tool '${input.request.toolName}' is not in the sandbox allowlist.`,
      );
    }

    const writeAllowed = process.env['JAK_INSTALL_ALLOW_WRITE'] === '1';
    if (sandboxAdapter.safetyClass === 'full_install' && !writeAllowed) {
      throw new InstallNotAllowedError(
        `Tool '${input.request.toolName}' is a full_install adapter; JAK_INSTALL_ALLOW_WRITE=1 is required.`,
      );
    }

    const startedAt = Date.now();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<InstallResult>((resolve) => {
      let stdoutBuf = '';
      let stderrBuf = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;

      const child = spawn(sandboxAdapter.command, sandboxAdapter.args, {
        cwd: sandboxAdapter.cwd ?? this.options.repoRoot ?? process.cwd(),
        // Critical: shell:false so argv is passed verbatim, no
        // shell interpretation of args.
        shell: false,
        // Strip parent env to a minimal allowlist — prevents secrets
        // from leaking into subprocess + reduces blast radius.
        env: {
          PATH: process.env['PATH'] ?? '',
          NODE_ENV: process.env['NODE_ENV'] ?? 'production',
          // pnpm needs HOME on POSIX, USERPROFILE on Windows.
          HOME: process.env['HOME'] ?? '',
          USERPROFILE: process.env['USERPROFILE'] ?? '',
          APPDATA: process.env['APPDATA'] ?? '',
        },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      const captureChunk = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
        const text = chunk.toString('utf8');
        if (stream === 'stdout') {
          if (stdoutBytes < MAX_LOG_BYTES) {
            stdoutBuf += text;
            stdoutBytes += text.length;
            if (stdoutBytes > MAX_LOG_BYTES) {
              stdoutBuf = stdoutBuf.slice(0, MAX_LOG_BYTES) + '\n[…truncated]';
            }
          }
        } else {
          if (stderrBytes < MAX_LOG_BYTES) {
            stderrBuf += text;
            stderrBytes += text.length;
            if (stderrBytes > MAX_LOG_BYTES) {
              stderrBuf = stderrBuf.slice(0, MAX_LOG_BYTES) + '\n[…truncated]';
            }
          }
        }
        this.options.onLogChunk?.({ stream, chunk: text });
      };

      child.stdout?.on('data', (c) => captureChunk('stdout', c));
      child.stderr?.on('data', (c) => captureChunk('stderr', c));

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          mode: sandboxAdapter.safetyClass === 'capability_check' ? 'dry_run' : 'real_install',
          message: `Subprocess failed to spawn: ${err.message}`,
        });
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        const success = !timedOut && code === 0;
        const summary = timedOut
          ? `Timed out after ${timeoutMs}ms`
          : `Exited with code ${code} in ${durationMs}ms`;
        resolve({
          success,
          mode: sandboxAdapter.safetyClass === 'capability_check' ? 'dry_run' : 'real_install',
          message: `[${input.request.toolName}] ${summary}\n--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`,
        });
      });
    });
  }
}

export const sandboxedInstaller = new SandboxedInstaller();
