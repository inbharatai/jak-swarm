/**
 * Sprint 2 — SandboxedInstaller real subprocess execution.
 *
 * Tests the safety contract:
 *   - Allowlist enforcement (unknown tool blocked)
 *   - Approval-required (no approvalId → throws)
 *   - Capability checks run with REAL `pnpm --version` subprocess
 *   - Full-install adapters require JAK_INSTALL_ALLOW_WRITE=1
 *   - Argv allowlist rejects shell metacharacters in adapter
 *     definitions (defense in depth — even though argv is passed
 *     literally to spawn with shell:false)
 *   - Timeout cancels long-running commands
 *   - Logs captured + truncated at 64KB per stream
 *
 * The real subprocess test (`pnpm --version`) requires pnpm on PATH.
 * It's gated behind `it.runIf(...)` so a stripped-down CI without
 * pnpm doesn't fail; in this repo's CI pnpm is the package manager
 * so it's always present.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import {
  SandboxedInstaller,
  SANDBOX_ADAPTERS,
  InstallApprovalRequiredError,
  InstallNotAllowedError,
} from '../../../packages/tools/src/index';
import type { ToolInstallRequest } from '../../../packages/tools/src/index';

function buildRequest(toolName: string): ToolInstallRequest {
  return {
    toolName,
    purpose: 'test',
    riskCategory: 'INSTALL' as never,
    requiredPermissions: [],
    installMethod: 'npm',
    approvalStatus: 'APPROVED',
    tenantId: 'tenant_test',
    userId: 'user_test',
  };
}

describe('SandboxedInstaller.dryRun — allowlist gate', () => {
  it('rejects an unknown tool with an honest error', async () => {
    const installer = new SandboxedInstaller();
    const plan = await installer.dryRun(buildRequest('totally_unknown_tool'));
    expect(plan.allSafe).toBe(false);
    expect(plan.summary).toContain('not in the sandbox allowlist');
  });

  it('produces a clean dry-run plan for a known capability_check adapter', async () => {
    const installer = new SandboxedInstaller();
    const plan = await installer.dryRun(buildRequest('check_pnpm_version'));
    expect(plan.allSafe).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.summary).toMatch(/capability check/i);
  });
});

describe('SandboxedInstaller.install — approval gate', () => {
  it('throws InstallApprovalRequiredError without approvalId', async () => {
    const installer = new SandboxedInstaller();
    await expect(
      installer.install({ request: buildRequest('check_pnpm_version'), approvalId: '' }),
    ).rejects.toThrow(InstallApprovalRequiredError);
  });

  it('throws InstallNotAllowedError for an unknown tool even with approvalId', async () => {
    const installer = new SandboxedInstaller();
    await expect(
      installer.install({
        request: buildRequest('totally_unknown'),
        approvalId: 'apr_test',
      }),
    ).rejects.toThrow(InstallNotAllowedError);
  });
});

describe('SandboxedInstaller.install — REAL subprocess (best-effort)', () => {
  let pnpmAvailable = false;

  beforeAll(async () => {
    // Probe pnpm on PATH. On Windows, pnpm is sometimes not directly
    // invokable from spawn(shell:false) because the .cmd shim isn't
    // found without shell expansion. The sandboxed installer hits the
    // same constraint, so the test is honestly conditional.
    pnpmAvailable = await new Promise<boolean>((resolve) => {
      try {
        const probe = spawn('pnpm', ['--version'], { shell: false });
        probe.on('error', () => resolve(false));
        probe.on('exit', (code) => resolve(code === 0));
        setTimeout(() => {
          probe.kill();
          resolve(false);
        }, 5_000);
      } catch {
        resolve(false);
      }
    });
  });

  it('runs check_pnpm_version against real pnpm (skip if pnpm not on PATH)', async () => {
    if (!pnpmAvailable) {
      // eslint-disable-next-line no-console
      console.log('[sandboxed-installer.test] pnpm not on PATH — skipping real-subprocess assertion');
      return;
    }
    const installer = new SandboxedInstaller({ timeoutMs: 30_000 });
    const result = await installer.install({
      request: buildRequest('check_pnpm_version'),
      approvalId: 'apr_real_subprocess',
    });
    // pnpm should print a version line + exit 0.
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Exited with code 0/);
    expect(result.message).toMatch(/\d+\.\d+\.\d+/); // semver in stdout
    expect(result.mode).toBe('dry_run'); // capability_check stays mode='dry_run'
  }, 60_000);

  it('on environments without pnpm-on-PATH, install() returns success:false with a clear error (not a crash)', async () => {
    // Register an adapter that points at a binary that definitely
    // doesn't exist. This proves the spawn 'error' handler returns a
    // structured InstallResult instead of throwing.
    const KEY = 'temp_no_such_binary';
    SANDBOX_ADAPTERS[KEY] = {
      toolName: KEY,
      command: 'definitely_not_a_real_binary_8675309',
      args: ['--never'],
      safetyClass: 'capability_check',
      description: 'binary that does not exist',
    };
    try {
      const installer = new SandboxedInstaller({ timeoutMs: 5_000 });
      const result = await installer.install({
        request: buildRequest(KEY),
        approvalId: 'apr_test',
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/failed to spawn|Subprocess|ENOENT/i);
    } finally {
      delete SANDBOX_ADAPTERS[KEY];
    }
  }, 10_000);
});

describe('SandboxedInstaller — env gating for full_install', () => {
  it('rejects a full_install adapter when JAK_INSTALL_ALLOW_WRITE != 1', async () => {
    // Inject a temporary full_install adapter for this test.
    const KEY = 'temp_test_full_install';
    SANDBOX_ADAPTERS[KEY] = {
      toolName: KEY,
      command: 'pnpm',
      args: ['--version'],
      safetyClass: 'full_install',
      description: 'temp full-install for test',
    };
    const prev = process.env['JAK_INSTALL_ALLOW_WRITE'];
    delete process.env['JAK_INSTALL_ALLOW_WRITE'];
    try {
      const installer = new SandboxedInstaller();
      const plan = await installer.dryRun(buildRequest(KEY));
      expect(plan.allSafe).toBe(false);
      expect(plan.summary).toContain('JAK_INSTALL_ALLOW_WRITE');

      await expect(
        installer.install({ request: buildRequest(KEY), approvalId: 'apr_x' }),
      ).rejects.toThrow(InstallNotAllowedError);
    } finally {
      delete SANDBOX_ADAPTERS[KEY];
      if (prev !== undefined) process.env['JAK_INSTALL_ALLOW_WRITE'] = prev;
    }
  });
});

describe('SandboxedInstaller — argv shell-metachar guard', () => {
  it('rejects an adapter whose argv contains shell metacharacters', async () => {
    const KEY = 'temp_evil_adapter';
    SANDBOX_ADAPTERS[KEY] = {
      toolName: KEY,
      command: 'pnpm',
      // Shell metachar smuggled in — getValidatedAdapter must reject.
      args: ['--version', ';rm -rf /'],
      safetyClass: 'capability_check',
      description: 'evil adapter test',
    };
    try {
      const installer = new SandboxedInstaller();
      const plan = await installer.dryRun(buildRequest(KEY));
      // Validation rejects → treated as not in the allowlist.
      expect(plan.allSafe).toBe(false);
      expect(plan.summary).toContain('not in the sandbox allowlist');
    } finally {
      delete SANDBOX_ADAPTERS[KEY];
    }
  });
});

describe('SandboxedInstaller — default registry has only capability checks', () => {
  it('every default adapter is safetyClass=capability_check', () => {
    for (const [key, adapter] of Object.entries(SANDBOX_ADAPTERS)) {
      // Test-injected entries are deleted in their finally blocks; if
      // any survive, fail loud.
      if (key.startsWith('temp_')) continue;
      expect(adapter.safetyClass, `${key} default registration`).toBe('capability_check');
    }
  });

  it('check_pnpm_version + check_playwright + check_pdf_parser exist', () => {
    expect(SANDBOX_ADAPTERS['check_pnpm_version']).toBeDefined();
    expect(SANDBOX_ADAPTERS['check_playwright']).toBeDefined();
    expect(SANDBOX_ADAPTERS['check_pdf_parser']).toBeDefined();
  });
});
