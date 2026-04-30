/**
 * Tool installer skeleton — Phase 6 (no-half-measures gap audit §6).
 *
 * Goal: detect when a user's task needs a capability that isn't
 * registered, explain it in layman language, ask for approval, and
 * SAFELY produce an install plan. Real install execution is gated
 * to allowlisted adapters in a follow-up sprint.
 *
 * What ships TODAY:
 *   - `ToolRequirementDetector` — given a task description, returns
 *     the missing capability (if any) using simple heuristics
 *   - `ToolInstallRequest` shape — structured request that goes to
 *     ApprovalRequest
 *   - `ToolInstallerService` interface + `DryRunOnlyInstaller` impl
 *   - Trusted-adapter allowlist — explicit map of `(toolName) →
 *     installer adapter` so an arbitrary `npm install` cannot fire
 *
 * What is INTENTIONALLY NOT shipped today (deferred per gap audit §7):
 *   - Real subprocess execution of install commands (sandbox isolation
 *     + rollback + secret handling = 1-2 weeks of safety work)
 *   - Health-check post-install
 *   - Auto-register-into-tool-registry on success
 *
 * The dry-run path proves the contract works end-to-end without ever
 * running an install command. Sprint 2 wires the real installer
 * inside a sandboxed subprocess.
 */

import { ToolActionCategory } from '../registry/approval-policy.js';

export type ToolRiskCategory = ToolActionCategory.INSTALL;

export interface ToolRequirement {
  /** Layman-friendly capability name ("send a Slack message"). */
  capability: string;
  /** Suggested tool name from the registry, or null if no match. */
  suggestedToolName: string | null;
  /** Layman-friendly explanation of WHY this is needed for the task. */
  reason: string;
  /** True if a tool with this name is already registered. */
  alreadyRegistered: boolean;
}

export interface ToolInstallRequest {
  toolName: string;
  /** Layman-friendly purpose: "Install Slack so JAK can post your update." */
  purpose: string;
  /** Risk category for the centralized ApprovalPolicy. */
  riskCategory: ToolRiskCategory;
  /** Permissions the tool will be granted post-install. */
  requiredPermissions: string[];
  /** Where the tool comes from (npm package, MCP server, builtin module, etc.). */
  installMethod: 'npm' | 'mcp' | 'builtin' | 'external_adapter';
  /** Approval state — must be APPROVED before the dry-run can promote. */
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** Tenant + user requesting the install. */
  tenantId: string;
  userId: string;
}

export interface InstallPlan {
  /** Steps that WOULD run if the request is approved + executed. */
  steps: Array<{ description: string; command?: string; safe: boolean }>;
  /** Total estimated time. */
  estimatedDurationSec: number;
  /** Honest classification — `dry_run` means no command actually fires. */
  mode: 'dry_run' | 'real_install';
  /** Layman-friendly summary for the ApprovalRequest card. */
  summary: string;
  /** True if every step in the plan is in the trusted allowlist. */
  allSafe: boolean;
}

export interface InstallResult {
  success: boolean;
  /** Honest classification — `dry_run` is NOT a real install. */
  mode: 'dry_run' | 'real_install';
  message: string;
  /** Audit-log artifact ID for the install record. */
  auditArtifactId?: string;
}

export interface ToolInstallerService {
  /**
   * Produce a dry-run plan for a given install request. NEVER executes
   * commands. Always returns a plan + per-step safe/unsafe classification.
   */
  dryRun(request: ToolInstallRequest): Promise<InstallPlan>;

  /**
   * Execute an approved install request. Phase 6 ships the dry-run
   * path only — `install()` exists in the interface but throws
   * 'NotImplemented' until Sprint 2 wires the sandboxed subprocess.
   */
  install(input: { request: ToolInstallRequest; approvalId: string }): Promise<InstallResult>;
}

/**
 * Trusted-adapter allowlist: only tools registered here can be
 * installed. The keys are tool names; the values describe what the
 * installer does for that tool.
 *
 * NEW entries require a deliberate code review — never add via runtime
 * input. This is the primary defense against "install arbitrary
 * package" attacks.
 */
export const TRUSTED_INSTALL_ADAPTERS: Record<
  string,
  { method: 'npm' | 'mcp' | 'builtin' | 'external_adapter'; safe: boolean; description: string }
> = {
  // Example entries — empty by default; explicit registrations land in Sprint 2.
  // Format: 'tool_name': { method, safe, description }
};

/**
 * Layman-keyword → suggested tool name table for ToolRequirementDetector.
 * Heuristic only — for richer matching the agent layer can semantic-search
 * tool descriptions (Sprint 2 enhancement).
 */
const CAPABILITY_KEYWORDS: Array<{ pattern: RegExp; toolName: string; capability: string }> = [
  { pattern: /\bsend.*(slack|message)\b/i, toolName: 'slack_post_message', capability: 'send a Slack message' },
  { pattern: /\bsend.*(email|gmail)\b/i, toolName: 'gmail_send_email', capability: 'send an email' },
  { pattern: /\bschedule.*(meeting|calendar)\b/i, toolName: 'gcal_create_event', capability: 'schedule a calendar event' },
  { pattern: /\b(post|publish).*(linkedin|li)\b/i, toolName: 'linkedin_publish_post', capability: 'publish a LinkedIn post' },
  { pattern: /\b(post|publish).*(instagram|ig)\b/i, toolName: 'instagram_publish_post', capability: 'publish an Instagram post' },
  { pattern: /\b(open|create).*(github|pr|pull request)\b/i, toolName: 'github_open_pr', capability: 'open a GitHub PR' },
];

export class ToolRequirementDetector {
  constructor(private readonly registeredToolNames: Set<string>) {}

  /**
   * Detect whether a user's task description references a capability
   * the system can't currently fulfil. Returns one ToolRequirement
   * per detected gap.
   */
  detectFromTask(taskDescription: string): ToolRequirement[] {
    const requirements: ToolRequirement[] = [];
    const seen = new Set<string>();

    for (const { pattern, toolName, capability } of CAPABILITY_KEYWORDS) {
      if (pattern.test(taskDescription) && !seen.has(toolName)) {
        seen.add(toolName);
        const alreadyRegistered = this.registeredToolNames.has(toolName);
        requirements.push({
          capability,
          suggestedToolName: toolName,
          reason: `Your task mentions ${capability.toLowerCase()}. ${
            alreadyRegistered
              ? 'JAK already has this capability available.'
              : `JAK needs the ${toolName} tool installed to do this.`
          }`,
          alreadyRegistered,
        });
      }
    }

    return requirements;
  }
}

/**
 * Dry-run-only installer. Produces a plan; never executes. The
 * `install()` method throws 'NotImplemented' so any callsite that
 * tries to actually install gets a loud failure instead of fake
 * success.
 */
export class DryRunOnlyInstaller implements ToolInstallerService {
  async dryRun(request: ToolInstallRequest): Promise<InstallPlan> {
    const adapter = TRUSTED_INSTALL_ADAPTERS[request.toolName];
    const isTrusted = adapter !== undefined;
    const methodMatches = adapter?.method === request.installMethod;

    const steps: InstallPlan['steps'] = [];

    if (!isTrusted) {
      steps.push({
        description: `Tool '${request.toolName}' is NOT in the trusted allowlist. Install rejected.`,
        safe: false,
      });
      return {
        steps,
        estimatedDurationSec: 0,
        mode: 'dry_run',
        summary: `Cannot install '${request.toolName}': not in the trusted allowlist. Ask your platform team to add it.`,
        allSafe: false,
      };
    }

    if (!methodMatches) {
      steps.push({
        description: `Install method '${request.installMethod}' does not match adapter method '${adapter.method}'.`,
        safe: false,
      });
      return {
        steps,
        estimatedDurationSec: 0,
        mode: 'dry_run',
        summary: `Cannot install '${request.toolName}': method mismatch.`,
        allSafe: false,
      };
    }

    steps.push({
      description: `Verify '${request.toolName}' adapter signature against trusted registry`,
      safe: true,
    });
    steps.push({
      description: `Install '${request.toolName}' via ${adapter.method} (sandboxed subprocess)`,
      command: `<sandboxed ${adapter.method} install ${request.toolName}>`,
      safe: true,
    });
    steps.push({
      description: `Run health check post-install`,
      safe: true,
    });
    steps.push({
      description: `Register tool in ToolRegistry with ${request.requiredPermissions.length} permissions`,
      safe: true,
    });

    return {
      steps,
      estimatedDurationSec: 30,
      mode: 'dry_run',
      summary: `Dry-run plan for installing '${request.toolName}'. ${request.purpose}`,
      allSafe: steps.every((s) => s.safe),
    };
  }

  async install(): Promise<InstallResult> {
    throw new Error(
      'DryRunOnlyInstaller.install is not implemented yet. ' +
        'Real install execution requires the sandboxed-subprocess runtime ' +
        '(Phase 6 follow-up sprint per qa/no-half-measures-gap-audit-2026-04-30.md §7). ' +
        'Use dryRun() for the plan; do not call install() until the sandbox ships.',
    );
  }
}
